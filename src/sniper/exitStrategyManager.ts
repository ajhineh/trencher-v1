// src/sniper/exitStrategyManager.ts

/**
 * Exit Strategy Manager
 * Manages flexible exit strategies: Take Profit, Stop Loss, Trailing Stop, and Hybrid
 */

import { logger } from '../logger';

export type ExitStrategy = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'HYBRID';

export interface ExitConfig {
    strategy: ExitStrategy;

    // Take Profit
    takeProfitPercent?: number;       // e.g., 50 = +50%

    // Stop Loss
    stopLossPercent?: number;         // e.g., 30 = -30%

    // Trailing Stop
    trailingStopPercent?: number;     // e.g., 20 = -20% from peak
    trailingActivationPercent?: number; // e.g., 30 = activate after +30%

    // Hybrid (uses all three)
    enableHybrid?: boolean;
}

export interface PositionInfo {
    mint: string;
    entryPrice: number;
    currentPrice: number;
    highestPrice: number;
    profitPercent: number;
    holdingTime: number; // seconds
}

export interface SellDecision {
    action: 'HOLD' | 'SELL_PARTIAL' | 'SELL_ALL';
    percentage?: number;
    reasoning: string[];
    confidence: number;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH';
    triggeredBy?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP';
}

export class ExitStrategyManager {
    private config: ExitConfig;
    private trailingStops: Map<string, {
        highestPrice: number;
        activated: boolean;
    }> = new Map();

    constructor(config: ExitConfig) {
        this.config = config;
        logger.info(`📊 Exit Strategy: ${config.strategy}`);

        if (config.strategy === 'HYBRID' || config.enableHybrid) {
            logger.info(`   TP: +${config.takeProfitPercent}%`);
            logger.info(`   SL: -${config.stopLossPercent}%`);
            logger.info(`   Trailing: -${config.trailingStopPercent}% (activate at +${config.trailingActivationPercent}%)`);
        }
    }

    /**
     * Evaluate exit decision based on strategy
     */
    async evaluateExit(position: PositionInfo): Promise<SellDecision> {
        const decisions: SellDecision[] = [];

        switch (this.config.strategy) {
            case 'TAKE_PROFIT':
                decisions.push(this.checkTakeProfit(position));
                break;

            case 'STOP_LOSS':
                decisions.push(this.checkStopLoss(position));
                break;

            case 'TRAILING_STOP':
                decisions.push(this.checkTrailingStop(position));
                break;

            case 'HYBRID':
                // Check all three
                decisions.push(this.checkStopLoss(position));
                decisions.push(this.checkTakeProfit(position));
                decisions.push(this.checkTrailingStop(position));
                break;
        }

        // Filter out HOLD decisions and select highest priority
        const actionableDecisions = decisions.filter(d => d.action !== 'HOLD');

        if (actionableDecisions.length === 0) {
            return {
                action: 'HOLD',
                reasoning: ['No exit conditions met'],
                confidence: 100,
                urgency: 'LOW'
            };
        }

        // Return highest urgency decision
        return this.selectBestDecision(actionableDecisions);
    }

    /**
     * Check Take Profit condition
     */
    private checkTakeProfit(position: PositionInfo): SellDecision {
        const tpPercent = this.config.takeProfitPercent || 50;

        if (position.profitPercent >= tpPercent) {
            return {
                action: 'SELL_ALL',
                percentage: 100,
                reasoning: [
                    `Take Profit triggered at +${position.profitPercent.toFixed(2)}%`,
                    `Target was +${tpPercent}%`
                ],
                confidence: 100,
                urgency: 'MEDIUM',
                triggeredBy: 'TAKE_PROFIT'
            };
        }

        return {
            action: 'HOLD',
            reasoning: [`TP not reached: ${position.profitPercent.toFixed(2)}% < ${tpPercent}%`],
            confidence: 100,
            urgency: 'LOW'
        };
    }

    /**
     * Check Stop Loss condition
     */
    private checkStopLoss(position: PositionInfo): SellDecision {
        const slPercent = this.config.stopLossPercent || 30;

        if (position.profitPercent <= -slPercent) {
            return {
                action: 'SELL_ALL',
                percentage: 100,
                reasoning: [
                    `Stop Loss triggered at ${position.profitPercent.toFixed(2)}%`,
                    `Limit was -${slPercent}%`,
                    '🚨 EMERGENCY EXIT'
                ],
                confidence: 100,
                urgency: 'HIGH',
                triggeredBy: 'STOP_LOSS'
            };
        }

        return {
            action: 'HOLD',
            reasoning: [`SL not reached: ${position.profitPercent.toFixed(2)}% > -${slPercent}%`],
            confidence: 100,
            urgency: 'LOW'
        };
    }

    /**
     * Check Trailing Stop condition
     */
    private checkTrailingStop(position: PositionInfo): SellDecision {
        const trailingPercent = this.config.trailingStopPercent || 20;
        const activationPercent = this.config.trailingActivationPercent || 30;

        // Get or initialize trailing stop state
        let trailingState = this.trailingStops.get(position.mint);

        if (!trailingState) {
            trailingState = {
                highestPrice: position.currentPrice,
                activated: false
            };
            this.trailingStops.set(position.mint, trailingState);
        }

        // Update highest price
        if (position.currentPrice > trailingState.highestPrice) {
            trailingState.highestPrice = position.currentPrice;
        }

        // Check if trailing stop should activate
        if (!trailingState.activated && position.profitPercent >= activationPercent) {
            trailingState.activated = true;
            logger.info(`🎯 Trailing Stop ACTIVATED at +${position.profitPercent.toFixed(2)}%`);
        }

        // If activated, check if price dropped enough from peak
        if (trailingState.activated) {
            const dropFromPeak = ((trailingState.highestPrice - position.currentPrice) / trailingState.highestPrice) * 100;

            if (dropFromPeak >= trailingPercent) {
                return {
                    action: 'SELL_ALL',
                    percentage: 100,
                    reasoning: [
                        `Trailing Stop triggered`,
                        `Peak: $${trailingState.highestPrice.toFixed(6)}`,
                        `Current: $${position.currentPrice.toFixed(6)}`,
                        `Drop: -${dropFromPeak.toFixed(2)}% (limit: -${trailingPercent}%)`
                    ],
                    confidence: 100,
                    urgency: 'HIGH',
                    triggeredBy: 'TRAILING_STOP'
                };
            }

            return {
                action: 'HOLD',
                reasoning: [
                    `Trailing: -${dropFromPeak.toFixed(2)}% from peak (limit: -${trailingPercent}%)`,
                    `Peak: $${trailingState.highestPrice.toFixed(6)}`
                ],
                confidence: 100,
                urgency: 'LOW'
            };
        }

        return {
            action: 'HOLD',
            reasoning: [`Trailing not activated yet (need +${activationPercent}%, at +${position.profitPercent.toFixed(2)}%)`],
            confidence: 100,
            urgency: 'LOW'
        };
    }

    /**
     * Select best decision from multiple options
     */
    private selectBestDecision(decisions: SellDecision[]): SellDecision {
        // Priority: HIGH > MEDIUM > LOW
        const urgencyOrder = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };

        decisions.sort((a, b) => urgencyOrder[b.urgency] - urgencyOrder[a.urgency]);

        return decisions[0];
    }

    /**
     * Reset trailing stop for a position (e.g., after selling)
     */
    resetTrailingStop(mint: string): void {
        this.trailingStops.delete(mint);
        logger.info(`🔄 Trailing stop reset for ${mint}`);
    }

    /**
     * Get current config
     */
    getConfig(): ExitConfig {
        return this.config;
    }

    /**
     * Update config (useful for dynamic adjustments)
     */
    updateConfig(newConfig: Partial<ExitConfig>): void {
        this.config = { ...this.config, ...newConfig };
        logger.info(`📊 Exit Strategy updated: ${JSON.stringify(newConfig)}`);
    }
}
