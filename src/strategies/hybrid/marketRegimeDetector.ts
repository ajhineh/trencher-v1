// src/strategies/hybrid/marketRegimeDetector.ts

import { CoinExExecutor } from '../../futures/execution/coinexExecutor';
import { logger } from '../../logger';

export type MarketRegime = 'BULL' | 'BEAR' | 'SIDEWAYS' | 'VOLATILE';

export class MarketRegimeDetector {
    private executor: CoinExExecutor;
    private lastRegime: MarketRegime = 'SIDEWAYS';
    private lastUpdate: number = 0;
    private updateIntervalMs: number = 5 * 60 * 1000; // Update every 5 mins

    constructor(executor: CoinExExecutor) {
        this.executor = executor;
    }

    /**
     * Analyze current market regime suitable for controlling Alpha Bot risk
     */
    async detectRegime(): Promise<{ regime: MarketRegime; confidence: number; btcTrend: string }> {
        // Cache result
        if (Date.now() - this.lastUpdate < this.updateIntervalMs) {
            return {
                regime: this.lastRegime,
                confidence: 1.0, // cached
                btcTrend: 'CACHED'
            };
        }

        logger.info('[MarketRegime] Analyzing Global Market State (BTC)...');

        // Fetch standard indicators for BTCUSDT
        // We use 4h or 1h candles for trend
        try {
            const { prices } = await this.executor.getCandles('BTCUSDT', '1h', 200);

            if (prices.length < 50) {
                logger.warn('[MarketRegime] Not enough data for analysis');
                return { regime: 'SIDEWAYS', confidence: 0, btcTrend: 'UNKNOWN' };
            }

            const currentPrice = prices[prices.length - 1];
            const sma50 = this.calculateSMA(prices, 50);
            const sma200 = this.calculateSMA(prices, 200); // Only if we have 200 candles, else approximates

            // Volatility (Standard Deviation of last 20)
            const volatility = this.calculateVolatility(prices, 20);
            const isVolatile = volatility > 0.02; // > 2% std dev

            let regime: MarketRegime = 'SIDEWAYS';
            let btcTrend = 'NEUTRAL';

            if (currentPrice > sma50) {
                btcTrend = 'UPTREND';
                if (sma50 > (sma200 || 0)) {
                    regime = 'BULL';
                } else {
                    regime = 'SIDEWAYS'; // Possible reversal
                }
            } else {
                btcTrend = 'DOWNTREND';
                if (currentPrice < sma50) {
                    regime = 'BEAR';
                }
            }

            if (isVolatile) {
                // Volatility overrides trend for safety
                // Or we can say VOLATILE_BULL, etc. For now, strict:
                // regime = 'VOLATILE'; // Optional: keeping direction is often better
            }

            logger.info(`[MarketRegime] Result: ${regime} | BTC: $${currentPrice} | SMA50: ${sma50.toFixed(0)}`);

            this.lastRegime = regime;
            this.lastUpdate = Date.now();

            return {
                regime,
                confidence: 0.9,
                btcTrend
            };

        } catch (error) {
            logger.error(`[MarketRegime] Error detecting regime: ${error}`);
            return { regime: 'SIDEWAYS', confidence: 0, btcTrend: 'ERROR' };
        }
    }

    private calculateSMA(data: number[], period: number): number {
        if (data.length < period) return 0;
        const slice = data.slice(-period);
        const sum = slice.reduce((a, b) => a + b, 0);
        return sum / period;
    }

    private calculateVolatility(data: number[], period: number): number {
        if (data.length < period) return 0;
        // Standard Deviation Relative to Mean
        const slice = data.slice(-period);
        const mean = slice.reduce((a, b) => a + b, 0) / period;
        const sqDiffs = slice.map(v => Math.pow(v - mean, 2));
        const avgSqDiff = sqDiffs.reduce((a, b) => a + b, 0) / period;
        const stdDev = Math.sqrt(avgSqDiff);

        return stdDev / mean; // Coefficient of Variation
    }
}
