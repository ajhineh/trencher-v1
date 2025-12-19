// src/futures/ai/contextAnalyzer.ts

/**
 * Context Analyzer
 * Analyzes market conditions and context
 */

import { MarketContext, RecentMarketData } from './types';

export class ContextAnalyzer {
    /**
     * Analyze market context
     */
    async analyzeMarketContext(
        symbol: string,
        recentData: RecentMarketData
    ): Promise<MarketContext> {
        const trend = this.detectTrend(recentData.prices);
        const volatility = this.calculateVolatility(recentData.prices);
        const volume = this.analyzeVolume(recentData.volumes);
        const marketPhase = this.identifyMarketPhase(recentData);

        return {
            trend,
            volatility,
            volume,
            marketPhase,
            sentiment: 'NEUTRAL',  // Can be enhanced with sentiment API
            newsImpact: 'NEUTRAL'   // Can be enhanced with news API
        };
    }

    /**
     * Detect trend using moving averages
     */
    private detectTrend(prices: number[]): 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' {
        if (prices.length < 50) return 'SIDEWAYS';

        const sma20 = this.calculateSMA(prices, 20);
        const sma50 = this.calculateSMA(prices, 50);

        const current = prices[prices.length - 1];

        // Strong uptrend
        if (sma20 > sma50 * 1.01 && current > sma20) {
            return 'UPTREND';
        }

        // Strong downtrend
        if (sma20 < sma50 * 0.99 && current < sma20) {
            return 'DOWNTREND';
        }

        return 'SIDEWAYS';
    }

    /**
     * Calculate volatility
     */
    private calculateVolatility(prices: number[]): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
        if (prices.length < 20) return 'MEDIUM';

        const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
        const stdDev = this.standardDeviation(returns);

        // Annualized volatility (assuming 1-minute data)
        const annualizedVol = stdDev * Math.sqrt(525600); // minutes in a year

        if (annualizedVol < 0.3) return 'LOW';      // < 30%
        if (annualizedVol < 0.6) return 'MEDIUM';   // 30-60%
        if (annualizedVol < 1.0) return 'HIGH';     // 60-100%
        return 'EXTREME';                            // > 100%
    }

    /**
     * Analyze volume
     */
    private analyzeVolume(volumes: number[]): 'LOW' | 'MEDIUM' | 'HIGH' {
        if (volumes.length < 20) return 'MEDIUM';

        const recentVolume = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

        const ratio = recentVolume / avgVolume;

        if (ratio < 0.7) return 'LOW';
        if (ratio < 1.3) return 'MEDIUM';
        return 'HIGH';
    }

    /**
     * Identify market phase
     */
    private identifyMarketPhase(
        data: RecentMarketData
    ): 'ACCUMULATION' | 'DISTRIBUTION' | 'MARKUP' | 'MARKDOWN' | 'CONSOLIDATION' {
        const prices = data.prices;
        const volumes = data.volumes;

        if (prices.length < 50) return 'CONSOLIDATION';

        const trend = this.detectTrend(prices);
        const volumeTrend = this.analyzeVolume(volumes);

        // Markup: uptrend with increasing volume
        if (trend === 'UPTREND' && volumeTrend === 'HIGH') {
            return 'MARKUP';
        }

        // Markdown: downtrend with increasing volume
        if (trend === 'DOWNTREND' && volumeTrend === 'HIGH') {
            return 'MARKDOWN';
        }

        // Accumulation: sideways with increasing volume
        if (trend === 'SIDEWAYS' && volumeTrend === 'HIGH') {
            const priceChange = (prices[prices.length - 1] - prices[0]) / prices[0];
            return priceChange > 0 ? 'ACCUMULATION' : 'DISTRIBUTION';
        }

        return 'CONSOLIDATION';
    }

    /**
     * Calculate Simple Moving Average
     */
    private calculateSMA(prices: number[], period: number): number {
        if (prices.length < period) return prices[prices.length - 1];

        const slice = prices.slice(-period);
        return slice.reduce((a, b) => a + b, 0) / period;
    }

    /**
     * Calculate standard deviation
     */
    private standardDeviation(values: number[]): number {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const squareDiffs = values.map(value => Math.pow(value - avg, 2));
        const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
        return Math.sqrt(avgSquareDiff);
    }
}
