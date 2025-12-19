// src/trading/trailingStopLoss.ts

/**
 * Trailing Stop Loss System
 * Automatically adjusts stop loss as price moves in profit
 */

import { logger } from "../logger";
import { Position } from "../state/positions";

export interface TrailingConfig {
    enabled: boolean;
    activationPercent: number; // Start trailing after this profit %
    trailPercent: number; // Trail distance from peak %
    updateInterval: number; // Update frequency in ms
}

export interface TrailingState {
    positionId: string;
    peakPrice: number;
    currentSL: number;
    trailingActive: boolean;
    lastUpdate: number;
}

export class TrailingStopLoss {
    private trailingStates: Map<string, TrailingState> = new Map();
    private config: TrailingConfig;

    constructor(config?: Partial<TrailingConfig>) {
        this.config = {
            enabled: true,
            activationPercent: 10, // Start trailing after 10% profit
            trailPercent: 5, // Trail 5% below peak
            updateInterval: 5000, // Update every 5 seconds
            ...config,
        };
    }

    /**
     * Initialize trailing for a position
     */
    initializeTrailing(position: Position): void {
        if (!this.config.enabled) return;

        this.trailingStates.set(position.id, {
            positionId: position.id,
            peakPrice: position.buyPriceInQuote,
            currentSL: position.buyPriceInQuote * (1 - position.slPercent / 100),
            trailingActive: false,
            lastUpdate: Date.now(),
        });

        logger.info(
            `[TrailingSL] Initialized for position ${position.id.slice(0, 8)}... ` +
            `Entry: ${position.buyPriceInQuote.toFixed(6)}, Initial SL: ${this.trailingStates.get(position.id)!.currentSL.toFixed(6)}`
        );
    }

    /**
     * Update trailing stop loss based on current price
     */
    updateTrailing(
        positionId: string,
        currentPrice: number,
        entryPrice: number
    ): { shouldUpdate: boolean; newSL: number; reason: string } {
        const state = this.trailingStates.get(positionId);
        if (!state) {
            return { shouldUpdate: false, newSL: 0, reason: 'No trailing state' };
        }

        // Check update interval
        if (Date.now() - state.lastUpdate < this.config.updateInterval) {
            return { shouldUpdate: false, newSL: state.currentSL, reason: 'Too soon to update' };
        }

        const currentProfitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

        // Activate trailing if profit threshold reached
        if (!state.trailingActive && currentProfitPercent >= this.config.activationPercent) {
            state.trailingActive = true;
            logger.info(
                `[TrailingSL] Activated for ${positionId.slice(0, 8)}... ` +
                `Profit: ${currentProfitPercent.toFixed(2)}%`
            );
        }

        // If trailing not active, no update
        if (!state.trailingActive) {
            return { shouldUpdate: false, newSL: state.currentSL, reason: 'Trailing not activated yet' };
        }

        // Update peak price if current price is higher
        if (currentPrice > state.peakPrice) {
            state.peakPrice = currentPrice;

            // Calculate new trailing SL
            const newSL = currentPrice * (1 - this.config.trailPercent / 100);

            // Only update if new SL is higher than current SL
            if (newSL > state.currentSL) {
                const oldSL = state.currentSL;
                state.currentSL = newSL;
                state.lastUpdate = Date.now();

                logger.info(
                    `[TrailingSL] Updated ${positionId.slice(0, 8)}... ` +
                    `Peak: ${state.peakPrice.toFixed(6)}, ` +
                    `SL: ${oldSL.toFixed(6)} → ${newSL.toFixed(6)} ` +
                    `(+${((newSL - oldSL) / oldSL * 100).toFixed(2)}%)`
                );

                return {
                    shouldUpdate: true,
                    newSL,
                    reason: `Trailing SL updated to ${newSL.toFixed(6)} (${this.config.trailPercent}% below peak)`,
                };
            }
        }

        return { shouldUpdate: false, newSL: state.currentSL, reason: 'No update needed' };
    }

    /**
     * Check if stop loss should be triggered
     */
    shouldTriggerSL(positionId: string, currentPrice: number): boolean {
        const state = this.trailingStates.get(positionId);
        if (!state || !state.trailingActive) return false;

        return currentPrice <= state.currentSL;
    }

    /**
     * Get current trailing state
     */
    getState(positionId: string): TrailingState | undefined {
        return this.trailingStates.get(positionId);
    }

    /**
     * Remove trailing state (when position closes)
     */
    removeTrailing(positionId: string): void {
        this.trailingStates.delete(positionId);
        logger.info(`[TrailingSL] Removed trailing for ${positionId.slice(0, 8)}...`);
    }

    /**
     * Get statistics
     */
    getStatistics(): {
        totalPositions: number;
        activeTrailing: number;
        avgPeakProfit: number;
    } {
        const states = Array.from(this.trailingStates.values());
        const activeStates = states.filter(s => s.trailingActive);

        const avgPeakProfit = activeStates.length > 0
            ? activeStates.reduce((sum, s) => {
                const profit = ((s.peakPrice - s.currentSL) / s.currentSL) * 100;
                return sum + profit;
            }, 0) / activeStates.length
            : 0;

        return {
            totalPositions: states.length,
            activeTrailing: activeStates.length,
            avgPeakProfit,
        };
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<TrailingConfig>): void {
        this.config = { ...this.config, ...config };
        logger.info(`[TrailingSL] Config updated:`, this.config);
    }

    /**
     * Get configuration
     */
    getConfig(): TrailingConfig {
        return { ...this.config };
    }
}

// Singleton instance
let trailingInstance: TrailingStopLoss | null = null;

export function getTrailingStopLoss(): TrailingStopLoss {
    if (!trailingInstance) {
        trailingInstance = new TrailingStopLoss();
    }
    return trailingInstance;
}
