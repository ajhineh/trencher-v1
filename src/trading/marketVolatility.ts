// src/trading/marketVolatility.ts

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';

export interface VolatilityMetrics {
    currentVolatility: number; // Percentage (0-100+)
    volatilityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    priceChange1h: number; // Percentage
    priceChange24h: number; // Percentage
    averageVolatility7d: number; // 7-day average
    recommendation: {
        positionSizeMultiplier: number; // 0.5 to 1.5
        tpMultiplier: number; // 0.8 to 1.5
        slMultiplier: number; // 0.8 to 1.2
    };
}

interface PricePoint {
    timestamp: number;
    price: number;
}

class MarketVolatilityTracker {
    private priceHistory: PricePoint[] = [];
    private maxHistorySize: number = 1000;
    private lastFetchTime: number = 0;
    private cacheDuration: number = 60000; // 1 minute
    private cachedMetrics: VolatilityMetrics | null = null;

    /**
     * Add a price point to history
     */
    addPricePoint(price: number): void {
        const now = Date.now();
        this.priceHistory.push({ timestamp: now, price });

        // Keep only recent history
        const cutoff = now - 7 * 24 * 60 * 60 * 1000; // 7 days
        this.priceHistory = this.priceHistory.filter(p => p.timestamp > cutoff);

        // Limit size
        if (this.priceHistory.length > this.maxHistorySize) {
            this.priceHistory = this.priceHistory.slice(-this.maxHistorySize);
        }
    }

    /**
     * Calculate volatility from price history
     */
    private calculateVolatility(prices: number[]): number {
        if (prices.length < 2) return 0;

        // Calculate returns
        const returns: number[] = [];
        for (let i = 1; i < prices.length; i++) {
            const returnPct = (prices[i] - prices[i - 1]) / prices[i - 1];
            returns.push(returnPct);
        }

        // Calculate standard deviation of returns
        const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
        const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / returns.length;
        const stdDev = Math.sqrt(variance);

        // Annualize volatility (assuming hourly data)
        const annualizedVolatility = stdDev * Math.sqrt(24 * 365) * 100;

        return annualizedVolatility;
    }

    /**
     * Get price change over a time period
     */
    private getPriceChange(hours: number): number {
        const now = Date.now();
        const cutoff = now - hours * 60 * 60 * 1000;

        const recentPrices = this.priceHistory.filter(p => p.timestamp > cutoff);
        if (recentPrices.length < 2) return 0;

        const oldestPrice = recentPrices[0].price;
        const latestPrice = recentPrices[recentPrices.length - 1].price;

        return ((latestPrice - oldestPrice) / oldestPrice) * 100;
    }

    /**
     * Get current volatility metrics
     */
    async getVolatilityMetrics(): Promise<VolatilityMetrics> {
        const now = Date.now();

        // Return cached if still valid
        if (this.cachedMetrics && now - this.lastFetchTime < this.cacheDuration) {
            return this.cachedMetrics;
        }

        // Fetch latest SOL price from CoinGecko
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(
                'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true&include_1h_change=true',
                { signal: controller.signal }
            );
            clearTimeout(timeoutId);

            const data = await response.json() as any;
            const currentPrice = data?.solana?.usd ?? 0;

            if (currentPrice > 0) {
                this.addPricePoint(currentPrice);
            }
        } catch (error: any) {
            logger.warn(`[Volatility] Error fetching SOL price: ${error?.message ?? error}`);
        }

        // Calculate metrics
        const priceChange1h = this.getPriceChange(1);
        const priceChange24h = this.getPriceChange(24);

        // Calculate current volatility (last 24 hours)
        const last24h = this.priceHistory.filter(
            p => p.timestamp > now - 24 * 60 * 60 * 1000
        );
        const currentVolatility = this.calculateVolatility(last24h.map(p => p.price));

        // Calculate 7-day average volatility
        const last7d = this.priceHistory.filter(
            p => p.timestamp > now - 7 * 24 * 60 * 60 * 1000
        );
        const averageVolatility7d = this.calculateVolatility(last7d.map(p => p.price));

        // Determine volatility level
        let volatilityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
        if (currentVolatility < 30) {
            volatilityLevel = 'LOW';
        } else if (currentVolatility < 60) {
            volatilityLevel = 'MEDIUM';
        } else if (currentVolatility < 100) {
            volatilityLevel = 'HIGH';
        } else {
            volatilityLevel = 'EXTREME';
        }

        // Calculate recommendations
        let positionSizeMultiplier = 1.0;
        let tpMultiplier = 1.0;
        let slMultiplier = 1.0;

        switch (volatilityLevel) {
            case 'LOW':
                positionSizeMultiplier = 1.2; // Increase position size
                tpMultiplier = 1.3; // Wider TP
                slMultiplier = 1.1; // Slightly wider SL
                break;
            case 'MEDIUM':
                positionSizeMultiplier = 1.0; // Normal
                tpMultiplier = 1.0;
                slMultiplier = 1.0;
                break;
            case 'HIGH':
                positionSizeMultiplier = 0.7; // Reduce position size
                tpMultiplier = 0.9; // Tighter TP
                slMultiplier = 0.9; // Tighter SL
                break;
            case 'EXTREME':
                positionSizeMultiplier = 0.5; // Significantly reduce
                tpMultiplier = 0.8; // Much tighter TP
                slMultiplier = 0.8; // Much tighter SL
                break;
        }

        const metrics: VolatilityMetrics = {
            currentVolatility,
            volatilityLevel,
            priceChange1h,
            priceChange24h,
            averageVolatility7d,
            recommendation: {
                positionSizeMultiplier,
                tpMultiplier,
                slMultiplier,
            },
        };

        this.cachedMetrics = metrics;
        this.lastFetchTime = now;

        logger.info(
            `[Volatility] Current: ${currentVolatility.toFixed(1)}% (${volatilityLevel}) | ` +
            `1h: ${priceChange1h > 0 ? '+' : ''}${priceChange1h.toFixed(2)}% | ` +
            `24h: ${priceChange24h > 0 ? '+' : ''}${priceChange24h.toFixed(2)}%`
        );

        return metrics;
    }

    /**
     * Clear all history (for testing)
     */
    clearHistory(): void {
        this.priceHistory = [];
        this.cachedMetrics = null;
    }
}

// Singleton instance
let volatilityTrackerInstance: MarketVolatilityTracker | null = null;

export function getVolatilityTracker(): MarketVolatilityTracker {
    if (!volatilityTrackerInstance) {
        volatilityTrackerInstance = new MarketVolatilityTracker();
    }
    return volatilityTrackerInstance;
}

export { MarketVolatilityTracker };
