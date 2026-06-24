// src/trading/dynamicStopLoss.ts
/**
 * Dynamic Stop Loss Calculator
 * 
 * Adjusts SL based on:
 * 1. Liquidity Depth - Lower liq = Tighter SL (rug risk)
 * 2. Buyer Momentum - Dropping buyers = Tighter SL
 * 3. Volatility - High volatility = Wider SL (avoid noise)
 * 
 * Philosophy: Adapt to market conditions, not fixed %
 */

import { logger } from "../logger";

export interface DynamicSLInput {
    // Liquidity metrics
    currentLiquiditySol: number;
    initialLiquiditySol: number;

    // Buyer momentum
    currentBuyersPerSec: number;
    initialBuyersPerSec: number;

    // Price volatility
    priceHistory: number[];  // Last N prices

    // Position info
    entryPrice: number;
    currentPrice: number;
    holdTimeSeconds: number;
}

export interface DynamicSLOutput {
    stopLossPrice: number;
    stopLossPercent: number;
    reason: string;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export class DynamicStopLossCalculator {
    // Base SL range (configurable)
    private readonly BASE_SL_MIN = 8;   // Minimum -8%
    private readonly BASE_SL_MAX = 20;  // Maximum -20%

    /**
     * Calculate dynamic stop loss
     */
    calculate(input: DynamicSLInput): DynamicSLOutput {
        let slPercent = 12; // Starting point: -12% (middle of range)
        const reasons: string[] = [];
        let urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';

        // Factor 1: Liquidity Depth
        const liqChange = (input.currentLiquiditySol - input.initialLiquiditySol) / input.initialLiquiditySol;

        if (liqChange < -0.5) {
            // Liquidity dropped >50% → CRITICAL RISK (rug pull?)
            slPercent = this.BASE_SL_MIN; // Tightest: -8%
            reasons.push(`Liquidity crash: ${(liqChange * 100).toFixed(0)}%`);
            urgency = 'CRITICAL';

            logger.warn(
                `[DYNAMIC-SL] 🚨 CRITICAL: Liquidity down ${(liqChange * 100).toFixed(0)}% → Tight SL: ${slPercent}%`
            );
        } else if (liqChange < -0.25) {
            // Liquidity dropped 25-50% → HIGH RISK
            slPercent = 10;
            reasons.push(`Liquidity drop: ${(liqChange * 100).toFixed(0)}%`);
            urgency = 'HIGH';
        } else if (liqChange < -0.1) {
            // Liquidity dropped 10-25% → MEDIUM RISK
            slPercent = 12;
            reasons.push(`Liquidity declining: ${(liqChange * 100).toFixed(0)}%`);
            urgency = urgency === 'LOW' ? 'MEDIUM' : urgency;
        } else if (liqChange > 0.2) {
            // Liquidity growing +20% → Can afford wider SL
            slPercent = 15;
            reasons.push(`Liquidity growing: +${(liqChange * 100).toFixed(0)}%`);
        }

        // Factor 2: Buyer Momentum
        const buyerChange = input.currentBuyersPerSec > 0
            ? (input.currentBuyersPerSec - input.initialBuyersPerSec) / input.initialBuyersPerSec
            : -1; // If no buyers now, treat as -100%

        if (input.currentBuyersPerSec < 0.1 && input.holdTimeSeconds > 30) {
            // Almost no buyers for 30+ seconds → DEAD TRADE
            slPercent = Math.min(slPercent, this.BASE_SL_MIN);
            reasons.push('Buyer activity dead');
            urgency = urgency === 'CRITICAL' ? 'CRITICAL' : 'HIGH';

            logger.warn(`[DYNAMIC-SL] ⚠️ No buyer momentum → Tight SL: ${slPercent}%`);
        } else if (buyerChange < -0.5) {
            // Buyers dropped >50% → MOMENTUM DYING
            slPercent = Math.min(slPercent, 10);
            reasons.push(`Buyers down ${(buyerChange * 100).toFixed(0)}%`);
            urgency = urgency === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
        } else if (buyerChange > 0.5) {
            // Buyers growing → Can afford wider SL
            slPercent = Math.max(slPercent, 15);
            reasons.push(`Buyers growing: +${(buyerChange * 100).toFixed(0)}%`);
        }

        // Factor 3: Volatility (reduce noise-triggered SLs)
        if (input.priceHistory.length >= 5) {
            const volatility = this.calculateVolatility(input.priceHistory);

            if (volatility > 0.05) {
                // High volatility (>5% avg deviation) → Wider SL to avoid noise
                const volatilityAdjustment = Math.min(volatility * 100, 5); // Max +5%
                slPercent += volatilityAdjustment;
                reasons.push(`High volatility: +${volatilityAdjustment.toFixed(1)}%`);

                logger.debug(`[DYNAMIC-SL] High volatility detected → Widening SL by ${volatilityAdjustment.toFixed(1)}%`);
            }
        }

        // Factor 4: Time-based adjustment (early exits tighter)
        if (input.holdTimeSeconds < 15) {
            // Very early in trade → Tighter SL (probably bad entry)
            slPercent = Math.min(slPercent, 10);
            reasons.push('Early hold time');
        }

        // Enforce bounds
        slPercent = Math.max(this.BASE_SL_MIN, Math.min(this.BASE_SL_MAX, slPercent));

        // Calculate actual price
        const stopLossPrice = input.entryPrice * (1 - slPercent / 100);

        return {
            stopLossPrice,
            stopLossPercent: slPercent,
            reason: reasons.join(', '),
            urgency,
        };
    }

    /**
     * Calculate price volatility (standard deviation)
     */
    private calculateVolatility(prices: number[]): number {
        if (prices.length < 2) return 0;

        const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        const squaredDiffs = prices.map(p => Math.pow(p - mean, 2));
        const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / prices.length;
        const stdDev = Math.sqrt(variance);

        // Return as percentage of mean
        return stdDev / mean;
    }

    /**
     * Check if current price hit stop loss
     */
    shouldTriggerStopLoss(currentPrice: number, stopLossPrice: number): boolean {
        return currentPrice <= stopLossPrice;
    }

    /**
     * Get urgency level color for logging
     */
    getUrgencyEmoji(urgency: DynamicSLOutput['urgency']): string {
        switch (urgency) {
            case 'CRITICAL': return '🚨';
            case 'HIGH': return '⚠️';
            case 'MEDIUM': return '⚡';
            case 'LOW': return '✅';
        }
    }
}

// Singleton
let dynamicSLInstance: DynamicStopLossCalculator | null = null;

export function getDynamicSLCalculator(): DynamicStopLossCalculator {
    if (!dynamicSLInstance) {
        dynamicSLInstance = new DynamicStopLossCalculator();
    }
    return dynamicSLInstance;
}
