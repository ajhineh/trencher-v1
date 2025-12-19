// src/analysis/multiTimeframeAnalysis.ts

/**
 * Multi-Timeframe Analysis
 * Analyzes token price and volume across multiple timeframes
 */

import { logger } from "../logger";

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export type Trend = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface TimeframeData {
    timeframe: Timeframe;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
}

export interface TechnicalIndicators {
    sma20: number;
    sma50: number;
    ema12: number;
    ema26: number;
    rsi: number;
    macd: number;
    signal: number;
}

export interface TimeframeAnalysis {
    timeframe: Timeframe;
    data: TimeframeData[];
    indicators: TechnicalIndicators;
    trend: Trend;
    strength: number; // 0-100
    signals: {
        buy: number; // 0-100
        sell: number; // 0-100
        hold: number; // 0-100
    };
}

export interface MultiTimeframeAnalysis {
    token: string;
    timestamp: number;

    // Individual timeframe analyses
    timeframes: {
        '1m': TimeframeAnalysis;
        '5m': TimeframeAnalysis;
        '15m': TimeframeAnalysis;
        '1h': TimeframeAnalysis;
        '4h': TimeframeAnalysis;
        '1d': TimeframeAnalysis;
    };

    // Overall trends
    trends: {
        shortTerm: Trend;   // 1m, 5m
        mediumTerm: Trend;  // 15m, 1h
        longTerm: Trend;    // 4h, 1d
    };

    // Combined signals
    overallSignal: {
        action: 'BUY' | 'SELL' | 'HOLD';
        confidence: number; // 0-100
        confluence: number; // 0-100 (agreement across timeframes)
    };

    // Recommendations
    recommendation: string;
}

export class MultiTimeframeAnalyzer {
    private cache: Map<string, { analysis: MultiTimeframeAnalysis; timestamp: number }> = new Map();
    private cacheTimeout: number = 60 * 1000; // 1 minute

    /**
     * Analyze token across all timeframes
     */
    async analyze(tokenAddress: string): Promise<MultiTimeframeAnalysis> {
        // Check cache
        const cached = this.cache.get(tokenAddress);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.analysis;
        }

        logger.info(`[MTF] Analyzing ${tokenAddress.slice(0, 8)}... across all timeframes`);

        try {
            // Fetch data for all timeframes
            const timeframeData = await this.fetchAllTimeframes(tokenAddress);

            // Analyze each timeframe
            const analyses: any = {};
            for (const tf of ['1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]) {
                analyses[tf] = await this.analyzeTimeframe(tf, timeframeData[tf]);
            }

            // Determine overall trends
            const trends = {
                shortTerm: this.combineTrends([analyses['1m'].trend, analyses['5m'].trend]),
                mediumTerm: this.combineTrends([analyses['15m'].trend, analyses['1h'].trend]),
                longTerm: this.combineTrends([analyses['4h'].trend, analyses['1d'].trend]),
            };

            // Calculate overall signal
            const overallSignal = this.calculateOverallSignal(analyses, trends);

            // Generate recommendation
            const recommendation = this.generateRecommendation(trends, overallSignal);

            const analysis: MultiTimeframeAnalysis = {
                token: tokenAddress,
                timestamp: Date.now(),
                timeframes: analyses,
                trends,
                overallSignal,
                recommendation,
            };

            // Cache result
            this.cache.set(tokenAddress, { analysis, timestamp: Date.now() });

            logger.info(
                `[MTF] ${tokenAddress.slice(0, 8)}... ` +
                `Signal: ${overallSignal.action}, ` +
                `Confidence: ${overallSignal.confidence}%, ` +
                `Confluence: ${overallSignal.confluence}%`
            );

            return analysis;
        } catch (error) {
            logger.error(`[MTF] Error analyzing ${tokenAddress}: ${error}`);
            throw error;
        }
    }

    /**
     * Fetch data for all timeframes
     */
    private async fetchAllTimeframes(tokenAddress: string): Promise<Record<Timeframe, TimeframeData[]>> {
        // TODO: Implement actual data fetching from price API
        // For now, generate sample data
        const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
        const data: any = {};

        for (const tf of timeframes) {
            data[tf] = this.generateSampleData(tf, 100);
        }

        return data;
    }

    /**
     * Generate sample data for testing
     */
    private generateSampleData(timeframe: Timeframe, count: number): TimeframeData[] {
        const data: TimeframeData[] = [];
        const now = Date.now();
        const intervals = {
            '1m': 60 * 1000,
            '5m': 5 * 60 * 1000,
            '15m': 15 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '4h': 4 * 60 * 60 * 1000,
            '1d': 24 * 60 * 60 * 1000,
        };

        let price = 1.0;
        for (let i = count; i >= 0; i--) {
            const change = (Math.random() - 0.48) * 0.05; // Slight upward bias
            price = price * (1 + change);

            data.push({
                timeframe,
                open: price * 0.99,
                high: price * 1.02,
                low: price * 0.98,
                close: price,
                volume: Math.random() * 1000000,
                timestamp: now - (i * intervals[timeframe]),
            });
        }

        return data;
    }

    /**
     * Analyze single timeframe
     */
    private async analyzeTimeframe(timeframe: Timeframe, data: TimeframeData[]): Promise<TimeframeAnalysis> {
        // Calculate indicators
        const indicators = this.calculateIndicators(data);

        // Determine trend
        const trend = this.determineTrend(data, indicators);

        // Calculate trend strength
        const strength = this.calculateTrendStrength(data, indicators);

        // Generate signals
        const signals = this.generateSignals(indicators, trend);

        return {
            timeframe,
            data,
            indicators,
            trend,
            strength,
            signals,
        };
    }

    /**
     * Calculate technical indicators
     */
    private calculateIndicators(data: TimeframeData[]): TechnicalIndicators {
        const closes = data.map(d => d.close);

        return {
            sma20: this.calculateSMA(closes, 20),
            sma50: this.calculateSMA(closes, 50),
            ema12: this.calculateEMA(closes, 12),
            ema26: this.calculateEMA(closes, 26),
            rsi: this.calculateRSI(closes, 14),
            macd: 0, // Simplified
            signal: 0, // Simplified
        };
    }

    /**
     * Calculate Simple Moving Average
     */
    private calculateSMA(data: number[], period: number): number {
        if (data.length < period) return data[data.length - 1];
        const slice = data.slice(-period);
        return slice.reduce((sum, val) => sum + val, 0) / period;
    }

    /**
     * Calculate Exponential Moving Average
     */
    private calculateEMA(data: number[], period: number): number {
        if (data.length < period) return data[data.length - 1];

        const multiplier = 2 / (period + 1);
        let ema = this.calculateSMA(data.slice(0, period), period);

        for (let i = period; i < data.length; i++) {
            ema = (data[i] - ema) * multiplier + ema;
        }

        return ema;
    }

    /**
     * Calculate Relative Strength Index
     */
    private calculateRSI(data: number[], period: number = 14): number {
        if (data.length < period + 1) return 50;

        let gains = 0;
        let losses = 0;

        for (let i = data.length - period; i < data.length; i++) {
            const change = data[i] - data[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }

        const avgGain = gains / period;
        const avgLoss = losses / period;

        if (avgLoss === 0) return 100;

        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    /**
     * Determine trend from data and indicators
     */
    private determineTrend(data: TimeframeData[], indicators: TechnicalIndicators): Trend {
        const currentPrice = data[data.length - 1].close;

        // Multiple criteria
        const criteria = {
            priceAboveSMA20: currentPrice > indicators.sma20,
            priceAboveSMA50: currentPrice > indicators.sma50,
            sma20AboveSMA50: indicators.sma20 > indicators.sma50,
            rsiAbove50: indicators.rsi > 50,
            rsiAbove70: indicators.rsi > 70,
            rsiBelow30: indicators.rsi < 30,
        };

        // Bullish if most criteria are met
        const bullishScore = [
            criteria.priceAboveSMA20,
            criteria.priceAboveSMA50,
            criteria.sma20AboveSMA50,
            criteria.rsiAbove50,
        ].filter(Boolean).length;

        if (bullishScore >= 3) return 'BULLISH';
        if (bullishScore <= 1) return 'BEARISH';
        return 'NEUTRAL';
    }

    /**
     * Calculate trend strength
     */
    private calculateTrendStrength(data: TimeframeData[], indicators: TechnicalIndicators): number {
        const currentPrice = data[data.length - 1].close;
        const priceChange = ((currentPrice - data[0].close) / data[0].close) * 100;

        // Combine multiple factors
        let strength = 0;

        // Price momentum
        strength += Math.min(Math.abs(priceChange) * 2, 40);

        // RSI strength
        if (indicators.rsi > 70 || indicators.rsi < 30) {
            strength += 30;
        } else if (indicators.rsi > 60 || indicators.rsi < 40) {
            strength += 15;
        }

        // MA alignment
        if (Math.abs(indicators.sma20 - indicators.sma50) / indicators.sma50 > 0.05) {
            strength += 30;
        }

        return Math.min(strength, 100);
    }

    /**
     * Generate trading signals
     */
    private generateSignals(indicators: TechnicalIndicators, trend: Trend): {
        buy: number;
        sell: number;
        hold: number;
    } {
        let buy = 0;
        let sell = 0;

        // RSI signals
        if (indicators.rsi < 30) buy += 40;
        if (indicators.rsi > 70) sell += 40;

        // Trend signals
        if (trend === 'BULLISH') buy += 30;
        if (trend === 'BEARISH') sell += 30;

        // MA crossover signals
        if (indicators.ema12 > indicators.ema26) buy += 30;
        if (indicators.ema12 < indicators.ema26) sell += 30;

        const hold = 100 - Math.max(buy, sell);

        return { buy, sell, hold };
    }

    /**
     * Combine trends from multiple timeframes
     */
    private combineTrends(trends: Trend[]): Trend {
        const bullish = trends.filter(t => t === 'BULLISH').length;
        const bearish = trends.filter(t => t === 'BEARISH').length;

        if (bullish > bearish) return 'BULLISH';
        if (bearish > bullish) return 'BEARISH';
        return 'NEUTRAL';
    }

    /**
     * Calculate overall signal from all timeframes
     */
    private calculateOverallSignal(
        analyses: Record<Timeframe, TimeframeAnalysis>,
        trends: { shortTerm: Trend; mediumTerm: Trend; longTerm: Trend }
    ): { action: 'BUY' | 'SELL' | 'HOLD'; confidence: number; confluence: number } {
        // Weight timeframes differently
        const weights = {
            '1m': 0.05,
            '5m': 0.10,
            '15m': 0.15,
            '1h': 0.25,
            '4h': 0.25,
            '1d': 0.20,
        };

        let buyScore = 0;
        let sellScore = 0;

        for (const [tf, analysis] of Object.entries(analyses)) {
            const weight = weights[tf as Timeframe];
            buyScore += analysis.signals.buy * weight;
            sellScore += analysis.signals.sell * weight;
        }

        // Calculate confluence (agreement across timeframes)
        const allTrends = [trends.shortTerm, trends.mediumTerm, trends.longTerm];
        const bullishCount = allTrends.filter(t => t === 'BULLISH').length;
        const bearishCount = allTrends.filter(t => t === 'BEARISH').length;
        const confluence = Math.max(bullishCount, bearishCount) / 3 * 100;

        // Determine action
        let action: 'BUY' | 'SELL' | 'HOLD';
        let confidence: number;

        if (buyScore > sellScore && buyScore > 50) {
            action = 'BUY';
            confidence = Math.min(buyScore, 100);
        } else if (sellScore > buyScore && sellScore > 50) {
            action = 'SELL';
            confidence = Math.min(sellScore, 100);
        } else {
            action = 'HOLD';
            confidence = 50;
        }

        // Adjust confidence based on confluence
        confidence = (confidence + confluence) / 2;

        return { action, confidence, confluence };
    }

    /**
     * Generate recommendation
     */
    private generateRecommendation(
        trends: { shortTerm: Trend; mediumTerm: Trend; longTerm: Trend },
        signal: { action: 'BUY' | 'SELL' | 'HOLD'; confidence: number; confluence: number }
    ): string {
        const { shortTerm, mediumTerm, longTerm } = trends;
        const { action, confidence, confluence } = signal;

        if (action === 'BUY' && confluence > 70) {
            return `Strong BUY signal with ${confluence.toFixed(0)}% confluence. All timeframes align bullish.`;
        }

        if (action === 'SELL' && confluence > 70) {
            return `Strong SELL signal with ${confluence.toFixed(0)}% confluence. All timeframes align bearish.`;
        }

        if (action === 'BUY' && confidence > 60) {
            return `BUY signal (${confidence.toFixed(0)}% confidence). Short: ${shortTerm}, Medium: ${mediumTerm}, Long: ${longTerm}`;
        }

        if (action === 'SELL' && confidence > 60) {
            return `SELL signal (${confidence.toFixed(0)}% confidence). Short: ${shortTerm}, Medium: ${mediumTerm}, Long: ${longTerm}`;
        }

        return `HOLD. Mixed signals across timeframes. Wait for better confluence.`;
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
    }
}

// Singleton instance
let mtfInstance: MultiTimeframeAnalyzer | null = null;

export function getMultiTimeframeAnalyzer(): MultiTimeframeAnalyzer {
    if (!mtfInstance) {
        mtfInstance = new MultiTimeframeAnalyzer();
    }
    return mtfInstance;
}
