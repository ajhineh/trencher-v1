// src/trading/stagedExit.ts
/**
 * Staged Exit Strategy (Locked Implementation)
 * 
 * Strategy:
 * - +20% → Sell 30% (first profit taking)
 * - +50% → Sell 30% (second profit taking)
 * - +100% → Activate trailing stop 10-15% (ride the pump)
 * 
 * Goal: Capital recovery early, asymmetric upside later
 */

import { logger } from "../logger";

export interface StagedExitConfig {
    // Stage 1
    tp1Percent: number;        // +20%
    tp1SellPercent: number;    // Sell 30%

    // Stage 2
    tp2Percent: number;        // +50%
    tp2SellPercent: number;    // Sell 30%

    // Stage 3: Trailing activation
    tp3Percent: number;        // +100%
    trailingPercent: number;   // Trail 10-15% below peak
    enableTrailing: boolean;   // Whether to use trailing stop at all
}

export interface StagedExitState {
    positionId: string;
    entryPrice: number;
    currentAmount: number;     // Remaining token amount
    initialAmount: number;     // Original token amount

    // Tracking stages
    tp1Executed: boolean;
    tp2Executed: boolean;
    trailingActive: boolean;

    // Trailing state
    peakPrice: number;
    trailingStopPrice: number;

    // Statistics
    totalSold: number;         // Total tokens sold
    realizedProfit: number;    // Profit from partial sells
}

export class StagedExitManager {
    private config: StagedExitConfig;
    private states: Map<string, StagedExitState> = new Map();

    constructor(config?: Partial<StagedExitConfig>) {
        // Eagle Strategy values 🦅
        this.config = {
            tp1Percent: 25,          // +25% (faster capital recovery)
            tp1SellPercent: 50,      // Sell 50% (full capital back + profit)
            tp2Percent: 75,          // +75% (lock more profit)
            tp2SellPercent: 30,      // Sell 30%
            tp3Percent: 100,         // +100%
            trailingPercent: 15,     // Trail 15% (more conservative)
            enableTrailing: false,   // 🦅 Trailing stop disabled for Eagle for safe profit
            ...config,
        };
    }

    /**
     * Initialize staged exit for a position
     */
    initializePosition(
        positionId: string,
        entryPrice: number,
        tokenAmount: number
    ): void {
        this.states.set(positionId, {
            positionId,
            entryPrice,
            currentAmount: tokenAmount,
            initialAmount: tokenAmount,
            tp1Executed: false,
            tp2Executed: false,
            trailingActive: false,
            peakPrice: entryPrice,
            trailingStopPrice: 0,
            totalSold: 0,
            realizedProfit: 0,
        });

        logger.info(
            `[STAGED-EXIT] Initialized for ${positionId.slice(0, 8)}... | ` +
            `Entry: ${entryPrice.toFixed(6)} | Amount: ${tokenAmount.toFixed(2)}`
        );
    }

    /**
     * Update price and check if any action needed
     */
    update(
        positionId: string,
        currentPrice: number
    ): {
        action: 'SELL_PARTIAL' | 'SELL_ALL' | 'HOLD' | 'TRAILING_ACTIVATED';
        amount?: number;
        reason: string;
        percent?: number;
    } {
        const state = this.states.get(positionId);
        if (!state) {
            return { action: 'HOLD', reason: 'No state found' };
        }

        const profitPercent = ((currentPrice - state.entryPrice) / state.entryPrice) * 100;

        // Update peak price for trailing
        if (currentPrice > state.peakPrice) {
            state.peakPrice = currentPrice;

            // Update trailing stop if active
            if (state.trailingActive) {
                state.trailingStopPrice = state.peakPrice * (1 - this.config.trailingPercent / 100);
                logger.debug(
                    `[STAGED-EXIT] Peak updated: ${state.peakPrice.toFixed(6)} | ` +
                    `Trailing SL: ${state.trailingStopPrice.toFixed(6)}`
                );
            }
        }

        // Check trailing stop (if active)
        if (this.config.enableTrailing && state.trailingActive && currentPrice <= state.trailingStopPrice) {
            logger.info(
                `[STAGED-EXIT] 📉 Trailing stop hit for ${positionId.slice(0, 8)}... | ` +
                `Price: ${currentPrice.toFixed(6)} <= ${state.trailingStopPrice.toFixed(6)}`
            );
            return {
                action: 'SELL_ALL',
                amount: state.currentAmount,
                reason: 'TRAILING_STOP',
                percent: 100,
            };
        }

        // Stage 3: Activate trailing at +100%
        if (this.config.enableTrailing && profitPercent >= this.config.tp3Percent && !state.trailingActive) {
            state.trailingActive = true;
            state.trailingStopPrice = currentPrice * (1 - this.config.trailingPercent / 100);

            logger.info(
                `[STAGED-EXIT] 🚀 +100% reached! Trailing activated | ` +
                `Peak: ${currentPrice.toFixed(6)} | ` +
                `Trailing: ${this.config.trailingPercent}% (${state.trailingStopPrice.toFixed(6)})`
            );

            return {
                action: 'TRAILING_ACTIVATED',
                reason: `Trailing activated at +${profitPercent.toFixed(1)}%`,
            };
        }

        // Stage 2: +50% → Sell 30%
        if (profitPercent >= this.config.tp2Percent && !state.tp2Executed) {
            const sellAmount = state.initialAmount * (this.config.tp2SellPercent / 100);
            state.tp2Executed = true;
            state.currentAmount -= sellAmount;
            state.totalSold += sellAmount;

            logger.info(
                `[STAGED-EXIT] 💰 TP2 (+75%) triggered | ` +
                `Selling ${this.config.tp2SellPercent}% (${sellAmount.toFixed(2)} tokens) | ` +
                `Remaining: ${state.currentAmount.toFixed(2)}`
            );

            return {
                action: 'SELL_PARTIAL',
                amount: sellAmount,
                reason: 'TP2_75_PERCENT',
                percent: this.config.tp2SellPercent,
            };
        }

        // Stage 1: +20% → Sell 30%
        if (profitPercent >= this.config.tp1Percent && !state.tp1Executed) {
            const sellAmount = state.initialAmount * (this.config.tp1SellPercent / 100);
            state.tp1Executed = true;
            state.currentAmount -= sellAmount;
            state.totalSold += sellAmount;

            logger.info(
                `[STAGED-EXIT] 💰 TP1 (+25%) triggered | ` +
                `Selling ${this.config.tp1SellPercent}% (${sellAmount.toFixed(2)} tokens) | ` +
                `Remaining: ${state.currentAmount.toFixed(2)}`
            );

            return {
                action: 'SELL_PARTIAL',
                amount: sellAmount,
                reason: 'TP1_25_PERCENT',
                percent: this.config.tp1SellPercent,
            };
        }

        // No action needed
        return { action: 'HOLD', reason: `Profit: ${profitPercent.toFixed(1)}%` };
    }

    /**
     * Get current state
     */
    getState(positionId: string): StagedExitState | undefined {
        return this.states.get(positionId);
    }

    /**
     * Remove position (when fully closed)
     */
    removePosition(positionId: string): void {
        this.states.delete(positionId);
        logger.info(`[STAGED-EXIT] Removed position ${positionId.slice(0, 8)}...`);
    }

    /**
     * Get statistics
     */
    getStatistics(positionId: string): {
        tp1Done: boolean;
        tp2Done: boolean;
        trailingActive: boolean;
        remainingPercent: number;
        soldPercent: number;
    } | null {
        const state = this.states.get(positionId);
        if (!state) return null;

        return {
            tp1Done: state.tp1Executed,
            tp2Done: state.tp2Executed,
            trailingActive: state.trailingActive,
            remainingPercent: (state.currentAmount / state.initialAmount) * 100,
            soldPercent: (state.totalSold / state.initialAmount) * 100,
        };
    }
}

// Singleton instance
let stagedExitInstance: StagedExitManager | null = null;

export function getStagedExitManager(): StagedExitManager {
    if (!stagedExitInstance) {
        stagedExitInstance = new StagedExitManager();
    }
    return stagedExitInstance;
}
