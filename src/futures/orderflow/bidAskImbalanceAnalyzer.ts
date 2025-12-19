// src/futures/orderflow/bidAskImbalanceAnalyzer.ts

/**
 * Bid/Ask Imbalance Analyzer
 * Analyzes order book imbalance
 */

import { OrderBookSnapshot, BidAskImbalance } from './types';

export class BidAskImbalanceAnalyzer {
    /**
     * Calculate bid/ask imbalance
     */
    calculateImbalance(
        orderBook: OrderBookSnapshot,
        levels: number = 10
    ): BidAskImbalance {
        // Sum top N levels
        const bidVolume = orderBook.bids
            .slice(0, levels)
            .reduce((sum, level) => sum + level.quantity, 0);

        const askVolume = orderBook.asks
            .slice(0, levels)
            .reduce((sum, level) => sum + level.quantity, 0);

        const total = bidVolume + askVolume;
        const imbalance = total > 0 ? (bidVolume - askVolume) / total : 0;
        const imbalanceRatio = askVolume > 0 ? bidVolume / askVolume : 0;

        return {
            timestamp: Date.now(),
            bidVolume,
            askVolume,
            imbalance,
            imbalanceRatio
        };
    }

    /**
     * Calculate weighted imbalance (closer levels have more weight)
     */
    calculateWeightedImbalance(
        orderBook: OrderBookSnapshot,
        levels: number = 10
    ): BidAskImbalance {
        let weightedBidVolume = 0;
        let weightedAskVolume = 0;

        // Weight: closer levels = higher weight
        for (let i = 0; i < levels && i < orderBook.bids.length; i++) {
            const weight = levels - i;  // 10, 9, 8, ...
            weightedBidVolume += orderBook.bids[i].quantity * weight;
        }

        for (let i = 0; i < levels && i < orderBook.asks.length; i++) {
            const weight = levels - i;
            weightedAskVolume += orderBook.asks[i].quantity * weight;
        }

        const total = weightedBidVolume + weightedAskVolume;
        const imbalance = total > 0 ? (weightedBidVolume - weightedAskVolume) / total : 0;
        const imbalanceRatio = weightedAskVolume > 0 ? weightedBidVolume / weightedAskVolume : 0;

        return {
            timestamp: Date.now(),
            bidVolume: weightedBidVolume,
            askVolume: weightedAskVolume,
            imbalance,
            imbalanceRatio
        };
    }

    /**
     * Generate signal from imbalance
     */
    generateSignal(imbalance: BidAskImbalance): 'BUY' | 'SELL' | 'NEUTRAL' {
        // Strong bid side (buying pressure)
        if (imbalance.imbalance > 0.2) {
            return 'BUY';
        }

        // Strong ask side (selling pressure)
        if (imbalance.imbalance < -0.2) {
            return 'SELL';
        }

        return 'NEUTRAL';
    }

    /**
     * Get signal strength (0-100)
     */
    getSignalStrength(imbalance: BidAskImbalance): number {
        // Convert imbalance to strength
        const strength = Math.abs(imbalance.imbalance) * 250;  // -0.4 to 0.4 -> 0 to 100
        return Math.min(100, strength);
    }

    /**
     * Detect extreme imbalance
     */
    isExtremeImbalance(imbalance: BidAskImbalance): boolean {
        return Math.abs(imbalance.imbalance) > 0.4;
    }

    /**
     * Get imbalance description
     */
    getImbalanceDescription(imbalance: BidAskImbalance): string {
        if (imbalance.imbalance > 0.4) {
            return 'Extreme buying pressure';
        } else if (imbalance.imbalance > 0.2) {
            return 'Strong buying pressure';
        } else if (imbalance.imbalance > 0.1) {
            return 'Moderate buying pressure';
        } else if (imbalance.imbalance < -0.4) {
            return 'Extreme selling pressure';
        } else if (imbalance.imbalance < -0.2) {
            return 'Strong selling pressure';
        } else if (imbalance.imbalance < -0.1) {
            return 'Moderate selling pressure';
        } else {
            return 'Balanced';
        }
    }
}
