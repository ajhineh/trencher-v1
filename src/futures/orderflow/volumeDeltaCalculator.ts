// src/futures/orderflow/volumeDeltaCalculator.ts

/**
 * Volume Delta Calculator
 * Calculates buying vs selling pressure
 */

import { Trade, VolumeDelta } from './types';

export class VolumeDeltaCalculator {
    private deltas: Map<string, VolumeDelta[]> = new Map();
    private maxHistory = 1000;

    /**
     * Calculate volume delta from trades
     */
    calculateDelta(symbol: string, trades: Trade[]): VolumeDelta {
        let buyVolume = 0;
        let sellVolume = 0;

        // Aggregate volumes
        for (const trade of trades) {
            if (trade.side === 'BUY') {
                buyVolume += trade.quantity;
            } else {
                sellVolume += trade.quantity;
            }
        }

        const delta = buyVolume - sellVolume;
        const total = buyVolume + sellVolume;
        const deltaPercentage = total > 0 ? (delta / total) * 100 : 0;

        // Get cumulative delta
        const previousCumulative = this.getLatestCumulativeDelta(symbol);
        const cumulativeDelta = previousCumulative + delta;

        const volumeDelta: VolumeDelta = {
            timestamp: Date.now(),
            buyVolume,
            sellVolume,
            delta,
            cumulativeDelta,
            deltaPercentage
        };

        // Store delta
        this.storeDelta(symbol, volumeDelta);

        return volumeDelta;
    }

    /**
     * Get latest cumulative delta
     */
    private getLatestCumulativeDelta(symbol: string): number {
        const history = this.deltas.get(symbol) || [];
        if (history.length === 0) return 0;
        return history[history.length - 1].cumulativeDelta;
    }

    /**
     * Store delta in history
     */
    private storeDelta(symbol: string, delta: VolumeDelta): void {
        const history = this.deltas.get(symbol) || [];
        history.push(delta);

        // Keep only recent history
        if (history.length > this.maxHistory) {
            history.shift();
        }

        this.deltas.set(symbol, history);
    }

    /**
     * Get delta history
     */
    getDeltaHistory(symbol: string, count: number = 100): VolumeDelta[] {
        const history = this.deltas.get(symbol) || [];
        return history.slice(-count);
    }

    /**
     * Generate signal from delta
     */
    generateSignal(delta: VolumeDelta): 'BUY' | 'SELL' | 'NEUTRAL' {
        // Strong buying pressure
        if (delta.deltaPercentage > 20) {
            return 'BUY';
        }

        // Strong selling pressure
        if (delta.deltaPercentage < -20) {
            return 'SELL';
        }

        return 'NEUTRAL';
    }

    /**
     * Get signal strength (0-100)
     */
    getSignalStrength(delta: VolumeDelta): number {
        // Convert delta percentage to strength
        const strength = Math.abs(delta.deltaPercentage) * 2;
        return Math.min(100, strength);
    }

    /**
     * Reset cumulative delta
     */
    resetCumulativeDelta(symbol: string): void {
        this.deltas.set(symbol, []);
    }
}
