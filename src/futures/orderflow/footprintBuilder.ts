// src/futures/orderflow/footprintBuilder.ts

/**
 * Footprint Builder
 * Creates footprint charts showing volume at each price level
 */

import { Trade } from './types';

export interface FootprintLevel {
    price: number;
    bidVolume: number;    // Volume from sellers (market sell orders)
    askVolume: number;    // Volume from buyers (market buy orders)
    delta: number;        // askVolume - bidVolume
    totalVolume: number;
}

export interface FootprintBar {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;

    // Volume at each price level
    levels: Map<number, FootprintLevel>;

    // Aggregates
    totalBuyVolume: number;
    totalSellVolume: number;
    totalDelta: number;
    totalVolume: number;

    // Point of Control (price with most volume)
    poc: number;

    // Value Area (70% of volume)
    valueAreaHigh: number;
    valueAreaLow: number;
}

export interface FootprintAnalysis {
    absorption: boolean;
    rejection: boolean;
    imbalance: 'BUY' | 'SELL' | 'NEUTRAL';
    poc: number;
    strength: number;  // 0-100
}

export class FootprintBuilder {
    private priceTickSize: number = 0.01;  // Price precision

    /**
     * Build footprint from trades
     */
    buildFootprint(
        trades: Trade[],
        timeframeMs: number
    ): FootprintBar {
        if (trades.length === 0) {
            throw new Error('No trades to build footprint');
        }

        // Initialize bar
        const bar: FootprintBar = {
            timestamp: trades[0].timestamp,
            open: trades[0].price,
            high: Math.max(...trades.map(t => t.price)),
            low: Math.min(...trades.map(t => t.price)),
            close: trades[trades.length - 1].price,
            levels: new Map(),
            totalBuyVolume: 0,
            totalSellVolume: 0,
            totalDelta: 0,
            totalVolume: 0,
            poc: 0,
            valueAreaHigh: 0,
            valueAreaLow: 0
        };

        // Build levels from trades
        for (const trade of trades) {
            const price = this.roundPrice(trade.price);

            if (!bar.levels.has(price)) {
                bar.levels.set(price, {
                    price,
                    bidVolume: 0,
                    askVolume: 0,
                    delta: 0,
                    totalVolume: 0
                });
            }

            const level = bar.levels.get(price)!;

            if (trade.side === 'BUY') {
                // Market buy order (aggressor buying)
                level.askVolume += trade.quantity;
                bar.totalBuyVolume += trade.quantity;
            } else {
                // Market sell order (aggressor selling)
                level.bidVolume += trade.quantity;
                bar.totalSellVolume += trade.quantity;
            }

            level.totalVolume = level.bidVolume + level.askVolume;
            level.delta = level.askVolume - level.bidVolume;
        }

        bar.totalDelta = bar.totalBuyVolume - bar.totalSellVolume;
        bar.totalVolume = bar.totalBuyVolume + bar.totalSellVolume;

        // Find POC (Point of Control)
        bar.poc = this.findPOC(bar.levels);

        // Calculate Value Area
        const valueArea = this.calculateValueArea(bar.levels, bar.totalVolume);
        bar.valueAreaHigh = valueArea.high;
        bar.valueAreaLow = valueArea.low;

        return bar;
    }

    /**
     * Find Point of Control (price with most volume)
     */
    private findPOC(levels: Map<number, FootprintLevel>): number {
        let maxVolume = 0;
        let pocPrice = 0;

        for (const [price, level] of levels) {
            if (level.totalVolume > maxVolume) {
                maxVolume = level.totalVolume;
                pocPrice = price;
            }
        }

        return pocPrice;
    }

    /**
     * Calculate Value Area (70% of volume)
     */
    private calculateValueArea(
        levels: Map<number, FootprintLevel>,
        totalVolume: number
    ): { high: number; low: number } {
        // Sort levels by volume
        const sortedLevels = Array.from(levels.values())
            .sort((a, b) => b.totalVolume - a.totalVolume);

        const targetVolume = totalVolume * 0.7;
        let accumulatedVolume = 0;
        const valueLevels: number[] = [];

        // Accumulate levels until we reach 70% of volume
        for (const level of sortedLevels) {
            valueLevels.push(level.price);
            accumulatedVolume += level.totalVolume;

            if (accumulatedVolume >= targetVolume) {
                break;
            }
        }

        return {
            high: Math.max(...valueLevels),
            low: Math.min(...valueLevels)
        };
    }

    /**
     * Analyze footprint for patterns
     */
    analyzeFootprint(bar: FootprintBar): FootprintAnalysis {
        const absorption = this.detectAbsorption(bar);
        const rejection = this.detectRejection(bar);
        const imbalance = this.detectImbalance(bar);
        const strength = this.calculateStrength(bar);

        return {
            absorption,
            rejection,
            imbalance,
            poc: bar.poc,
            strength
        };
    }

    /**
     * Detect absorption pattern
     * High volume but small price movement = strong support/resistance
     */
    private detectAbsorption(bar: FootprintBar): boolean {
        const priceRange = bar.high - bar.low;
        const avgPrice = (bar.high + bar.low) / 2;
        const rangePercent = (priceRange / avgPrice) * 100;

        // High volume but small range
        return bar.totalVolume > 0 && rangePercent < 0.1;  // Less than 0.1% range
    }

    /**
     * Detect rejection pattern
     * Low volume but large price movement = weak level
     */
    private detectRejection(bar: FootprintBar): boolean {
        const priceRange = bar.high - bar.low;
        const avgPrice = (bar.high + bar.low) / 2;
        const rangePercent = (priceRange / avgPrice) * 100;

        // Low volume but large range
        return bar.totalVolume > 0 && rangePercent > 0.5;  // More than 0.5% range
    }

    /**
     * Detect volume imbalance
     */
    private detectImbalance(bar: FootprintBar): 'BUY' | 'SELL' | 'NEUTRAL' {
        if (bar.totalVolume === 0) return 'NEUTRAL';

        const deltaPercent = (bar.totalDelta / bar.totalVolume) * 100;

        if (deltaPercent > 20) return 'BUY';
        if (deltaPercent < -20) return 'SELL';
        return 'NEUTRAL';
    }

    /**
     * Calculate pattern strength
     */
    private calculateStrength(bar: FootprintBar): number {
        if (bar.totalVolume === 0) return 0;

        const deltaPercent = Math.abs((bar.totalDelta / bar.totalVolume) * 100);
        return Math.min(100, deltaPercent * 2);
    }

    /**
     * Round price to tick size
     */
    private roundPrice(price: number): number {
        return Math.round(price / this.priceTickSize) * this.priceTickSize;
    }

    /**
     * Get levels around POC
     */
    getLevelsAroundPOC(
        bar: FootprintBar,
        range: number = 5
    ): FootprintLevel[] {
        const levels: FootprintLevel[] = [];
        const pocPrice = bar.poc;

        for (const [price, level] of bar.levels) {
            const distance = Math.abs(price - pocPrice);
            const distancePercent = (distance / pocPrice) * 100;

            if (distancePercent <= range) {
                levels.push(level);
            }
        }

        return levels.sort((a, b) => b.price - a.price);
    }
}
