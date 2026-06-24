import { TradeMemoryEntry } from './tradeMemory';
import { logger } from '../logger';

export interface PatternInsight {
    category: string;
    description: string;
    evidence: string;
    winRate: number;
    sampleSize: number;
    suggestion: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    paramKey?: string;  // .env key to change
    paramValue?: string; // suggested value
    paramCurrent?: string; // current value
}

export class PatternAnalyzer {
    analyze(trades: TradeMemoryEntry[]): PatternInsight[] {
        if (trades.length < 5) {
            logger.info('[PatternAnalyzer] Not enough trades to analyze (min 5)');
            return [];
        }

        const insights: PatternInsight[] = [];

        insights.push(...this.analyzeByRiskLevel(trades));
        insights.push(...this.analyzeByChannelWidth(trades));
        insights.push(...this.analyzeByTrendAlignment(trades));
        insights.push(...this.analyzeByConfidence(trades));
        insights.push(...this.analyzeByLeverage(trades));
        insights.push(...this.analyzeByATR(trades));

        // Sort by priority and win rate impact
        insights.sort((a, b) => {
            const prio = { HIGH: 0, MEDIUM: 1, LOW: 2 };
            return prio[a.priority] - prio[b.priority];
        });

        logger.info(`[PatternAnalyzer] Generated ${insights.length} insights from ${trades.length} trades`);
        return insights;
    }

    private winRate(trades: TradeMemoryEntry[]): number {
        if (!trades.length) return 0;
        return trades.filter(t => t.outcome === 'WIN' || t.outcome === 'PARTIAL_WIN').length / trades.length * 100;
    }

    private analyzeByRiskLevel(trades: TradeMemoryEntry[]): PatternInsight[] {
        const insights: PatternInsight[] = [];
        const groups: Record<string, TradeMemoryEntry[]> = { VERY_LOW: [], LOW: [], MEDIUM: [] };
        trades.forEach(t => groups[t.context.riskLevel]?.push(t));

        for (const [level, group] of Object.entries(groups)) {
            if (group.length < 3) continue;
            const wr = this.winRate(group);
            if (wr < 30) {
                insights.push({
                    category: 'Risk Level',
                    description: `Risk level ${level} has very low win rate`,
                    evidence: `${group.length} trades, win rate: ${wr.toFixed(0)}%`,
                    winRate: wr,
                    sampleSize: group.length,
                    suggestion: `Consider disabling ${level} risk trades or reducing leverage`,
                    priority: wr < 20 ? 'HIGH' : 'MEDIUM'
                });
            }
        }
        return insights;
    }

    private analyzeByChannelWidth(trades: TradeMemoryEntry[]): PatternInsight[] {
        const insights: PatternInsight[] = [];
        const narrow = trades.filter(t => t.context.channelWidthPct < 0.005);
        const wide   = trades.filter(t => t.context.channelWidthPct > 0.012);
        const normal = trades.filter(t => t.context.channelWidthPct >= 0.005 && t.context.channelWidthPct <= 0.012);

        if (narrow.length >= 3) {
            const wr = this.winRate(narrow);
            if (wr < 35) {
                insights.push({
                    category: 'Channel Width',
                    description: 'Very narrow channels have poor win rate',
                    evidence: `${narrow.length} trades with channelWidth < 0.5%, win rate: ${wr.toFixed(0)}%`,
                    winRate: wr,
                    sampleSize: narrow.length,
                    suggestion: 'Increase AMIRO_MIN_CHANNEL_WIDTH_PCT to filter out narrow channels',
                    priority: 'HIGH',
                    paramKey: 'AMIRO_MIN_CHANNEL_WIDTH_PCT',
                    paramValue: '0.006'
                });
            }
        }

        if (wide.length >= 3) {
            const wr = this.winRate(wide);
            if (wr < 35) {
                insights.push({
                    category: 'Channel Width',
                    description: 'Very wide channels (high volatility) have poor win rate',
                    evidence: `${wide.length} trades with channelWidth > 1.2%, win rate: ${wr.toFixed(0)}%`,
                    winRate: wr,
                    sampleSize: wide.length,
                    suggestion: 'Decrease AMIRO_MAX_CHANNEL_WIDTH_PCT to avoid overly volatile markets',
                    priority: 'HIGH',
                    paramKey: 'AMIRO_MAX_CHANNEL_WIDTH_PCT',
                    paramValue: '0.010'
                });
            }
        }

        return insights;
    }

    private analyzeByTrendAlignment(trades: TradeMemoryEntry[]): PatternInsight[] {
        const insights: PatternInsight[] = [];
        const fullAlign    = trades.filter(t => t.context.macroTrend === t.context.structuralTrend && t.context.structuralTrend === t.context.tradingTrend);
        const partialAlign = trades.filter(t => t.context.macroTrend !== t.context.structuralTrend || t.context.structuralTrend !== t.context.tradingTrend);

        if (fullAlign.length >= 3 && partialAlign.length >= 3) {
            const wrFull    = this.winRate(fullAlign);
            const wrPartial = this.winRate(partialAlign);
            if (wrFull - wrPartial > 15) {
                insights.push({
                    category: 'Trend Alignment',
                    description: 'Full 3-timeframe alignment significantly outperforms partial alignment',
                    evidence: `Full align: ${wrFull.toFixed(0)}% vs Partial: ${wrPartial.toFixed(0)}% (${fullAlign.length} vs ${partialAlign.length} trades)`,
                    winRate: wrFull,
                    sampleSize: fullAlign.length + partialAlign.length,
                    suggestion: 'Consider only trading VERY_LOW risk (full 3-TF alignment)',
                    priority: 'MEDIUM'
                });
            }
        }
        return insights;
    }

    private analyzeByConfidence(trades: TradeMemoryEntry[]): PatternInsight[] {
        const insights: PatternInsight[] = [];
        const highConf = trades.filter(t => t.context.confidence >= 75);
        const lowConf  = trades.filter(t => t.context.confidence < 75);

        if (highConf.length >= 3 && lowConf.length >= 3) {
            const wrHigh = this.winRate(highConf);
            const wrLow  = this.winRate(lowConf);
            if (wrHigh - wrLow > 15) {
                insights.push({
                    category: 'Confidence Score',
                    description: 'High-confidence trades significantly outperform low-confidence ones',
                    evidence: `Conf>=75: ${wrHigh.toFixed(0)}% win | Conf<75: ${wrLow.toFixed(0)}% win`,
                    winRate: wrHigh,
                    sampleSize: trades.length,
                    suggestion: 'Add AMIRO_MIN_CONFIDENCE=75 to block low-confidence entries',
                    priority: 'MEDIUM',
                    paramKey: 'AMIRO_MIN_CONFIDENCE',
                    paramValue: '75'
                });
            }
        }
        return insights;
    }

    private analyzeByLeverage(trades: TradeMemoryEntry[]): PatternInsight[] {
        const insights: PatternInsight[] = [];
        const highLev = trades.filter(t => t.context.leverage >= 15);
        const lowLev  = trades.filter(t => t.context.leverage < 15);

        if (highLev.length >= 3 && lowLev.length >= 3) {
            // Compare avg PnL USDT magnitude (absolute)
            const avgLossHigh = highLev.filter(t => t.outcome === 'LOSS').reduce((s, t) => s + Math.abs(t.finalPnlUsdt), 0) / Math.max(1, highLev.filter(t => t.outcome === 'LOSS').length);
            const avgLossLow  = lowLev.filter(t => t.outcome === 'LOSS').reduce((s, t) => s + Math.abs(t.finalPnlUsdt), 0) / Math.max(1, lowLev.filter(t => t.outcome === 'LOSS').length);
            if (avgLossHigh > avgLossLow * 1.5) {
                insights.push({
                    category: 'Leverage',
                    description: 'High leverage trades (>=15x) produce significantly larger losses per SL',
                    evidence: `Avg loss at >=15x: ${avgLossHigh.toFixed(2)} USDT vs <15x: ${avgLossLow.toFixed(2)} USDT`,
                    winRate: this.winRate(lowLev),
                    sampleSize: trades.length,
                    suggestion: 'Consider reducing AMIRO_LEV_VERY_LOW_MAX from 15 to 12',
                    priority: 'HIGH',
                    paramKey: 'AMIRO_LEV_VERY_LOW_MAX',
                    paramValue: '12',
                    paramCurrent: '15'
                });
            }
        }
        return insights;
    }

    private analyzeByATR(trades: TradeMemoryEntry[]): PatternInsight[] {
        const insights: PatternInsight[] = [];
        // Trades where SL was within 1x ATR (too tight)
        const tightSL = trades.filter(t => t.context.slDistancePct < t.context.atrPct);
        if (tightSL.length >= 3) {
            const wr = this.winRate(tightSL);
            if (wr < 30) {
                insights.push({
                    category: 'ATR vs SL',
                    description: 'Trades with SL tighter than ATR get stopped out frequently',
                    evidence: `${tightSL.length} trades with SL < 1x ATR, win rate: ${wr.toFixed(0)}%`,
                    winRate: wr,
                    sampleSize: tightSL.length,
                    suggestion: 'Increase AMIRO_ATR_SL_MULT from current to 2.0',
                    priority: 'HIGH',
                    paramKey: 'AMIRO_ATR_SL_MULT',
                    paramValue: '2.0'
                });
            }
        }
        return insights;
    }
}
