// src/futures/orderflow/advancedSignalGenerator.ts

/**
 * Advanced Signal Generator
 * Combines all order flow components for comprehensive signals
 */

import { OrderFlowSignal, VolumeDelta, BidAskImbalance } from './types';
import { FootprintBar, FootprintAnalysis } from './footprintBuilder';
import { IcebergOrder } from './icebergDetector';
import { LargeOrder } from './largeOrderTracker';

export interface AdvancedOrderFlowSignal extends OrderFlowSignal {
    // Additional advanced metrics
    footprintPattern: string;
    icebergActivity: boolean;
    institutionalActivity: boolean;
    absorptionDetected: boolean;
    rejectionDetected: boolean;

    // Detailed breakdown
    componentScores: {
        volumeDelta: number;
        bidAskImbalance: number;
        footprint: number;
        iceberg: number;
        largeOrders: number;
    };
}

export class AdvancedSignalGenerator {
    /**
     * Generate advanced signal from all components
     */
    generateSignal(data: {
        volumeDelta: VolumeDelta;
        bidAskImbalance: BidAskImbalance;
        footprint?: FootprintBar;
        footprintAnalysis?: FootprintAnalysis;
        icebergs?: IcebergOrder[];
        largeOrders?: LargeOrder[];
        currentPrice: number;
    }): AdvancedOrderFlowSignal {
        let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
        let confidence = 0;
        const reasons: string[] = [];

        const componentScores = {
            volumeDelta: 0,
            bidAskImbalance: 0,
            footprint: 0,
            iceberg: 0,
            largeOrders: 0
        };

        // 1. Volume Delta (25% weight)
        const deltaScore = this.analyzeVolumeDelta(data.volumeDelta, reasons);
        componentScores.volumeDelta = deltaScore;
        confidence += deltaScore * 0.25;

        // 2. Bid/Ask Imbalance (25% weight)
        const imbalanceScore = this.analyzeBidAskImbalance(data.bidAskImbalance, reasons);
        componentScores.bidAskImbalance = imbalanceScore;
        confidence += imbalanceScore * 0.25;

        // 3. Footprint Analysis (20% weight)
        if (data.footprintAnalysis) {
            const footprintScore = this.analyzeFootprint(data.footprintAnalysis, reasons);
            componentScores.footprint = footprintScore;
            confidence += footprintScore * 0.20;
        }

        // 4. Iceberg Orders (15% weight)
        if (data.icebergs && data.icebergs.length > 0) {
            const icebergScore = this.analyzeIcebergs(data.icebergs, reasons);
            componentScores.iceberg = icebergScore;
            confidence += icebergScore * 0.15;
        }

        // 5. Large Orders (15% weight)
        if (data.largeOrders && data.largeOrders.length > 0) {
            const largeOrderScore = this.analyzeLargeOrders(data.largeOrders, reasons);
            componentScores.largeOrders = largeOrderScore;
            confidence += largeOrderScore * 0.15;
        }

        // Determine direction based on strongest signals
        direction = this.determineDirection(componentScores, data);

        // Calculate entry/exit
        const stopLoss = direction === 'LONG'
            ? data.currentPrice * 0.995  // 0.5% below
            : data.currentPrice * 1.005; // 0.5% above
        const takeProfit = direction === 'LONG'
            ? data.currentPrice * 1.02   // 2% above
            : data.currentPrice * 0.98;  // 2% below

        return {
            direction,
            confidence: Math.min(100, confidence),
            reasons,
            volumeDelta: data.volumeDelta.delta,
            bidAskImbalance: data.bidAskImbalance.imbalance,
            entry: data.currentPrice,
            stopLoss,
            takeProfit,
            timestamp: Date.now(),

            // Advanced metrics
            footprintPattern: data.footprintAnalysis?.imbalance || 'NEUTRAL',
            icebergActivity: (data.icebergs?.length || 0) > 0,
            institutionalActivity: (data.largeOrders?.length || 0) > 0,
            absorptionDetected: data.footprintAnalysis?.absorption || false,
            rejectionDetected: data.footprintAnalysis?.rejection || false,
            componentScores
        };
    }

    /**
     * Analyze volume delta
     */
    private analyzeVolumeDelta(delta: VolumeDelta, reasons: string[]): number {
        if (delta.deltaPercentage > 30) {
            reasons.push(`Very strong buying pressure (${delta.deltaPercentage.toFixed(1)}%)`);
            return 100;
        } else if (delta.deltaPercentage > 20) {
            reasons.push(`Strong buying pressure (${delta.deltaPercentage.toFixed(1)}%)`);
            return 80;
        } else if (delta.deltaPercentage < -30) {
            reasons.push(`Very strong selling pressure (${delta.deltaPercentage.toFixed(1)}%)`);
            return 100;
        } else if (delta.deltaPercentage < -20) {
            reasons.push(`Strong selling pressure (${delta.deltaPercentage.toFixed(1)}%)`);
            return 80;
        }

        return Math.abs(delta.deltaPercentage) * 2;
    }

    /**
     * Analyze bid/ask imbalance
     */
    private analyzeBidAskImbalance(imbalance: BidAskImbalance, reasons: string[]): number {
        if (imbalance.imbalance > 0.4) {
            reasons.push(`Extreme bid pressure (${(imbalance.imbalance * 100).toFixed(1)}%)`);
            return 100;
        } else if (imbalance.imbalance > 0.2) {
            reasons.push(`Strong bid pressure (${(imbalance.imbalance * 100).toFixed(1)}%)`);
            return 75;
        } else if (imbalance.imbalance < -0.4) {
            reasons.push(`Extreme ask pressure (${(imbalance.imbalance * 100).toFixed(1)}%)`);
            return 100;
        } else if (imbalance.imbalance < -0.2) {
            reasons.push(`Strong ask pressure (${(imbalance.imbalance * 100).toFixed(1)}%)`);
            return 75;
        }

        return Math.abs(imbalance.imbalance) * 200;
    }

    /**
     * Analyze footprint
     */
    private analyzeFootprint(analysis: FootprintAnalysis, reasons: string[]): number {
        let score = 0;

        if (analysis.absorption) {
            reasons.push('Absorption detected - strong support/resistance');
            score += 50;
        }

        if (analysis.rejection) {
            reasons.push('Rejection detected - weak level');
            score += 30;
        }

        if (analysis.imbalance === 'BUY') {
            reasons.push('Footprint shows buying imbalance');
            score += analysis.strength * 0.5;
        } else if (analysis.imbalance === 'SELL') {
            reasons.push('Footprint shows selling imbalance');
            score += analysis.strength * 0.5;
        }

        return Math.min(100, score);
    }

    /**
     * Analyze iceberg orders
     */
    private analyzeIcebergs(icebergs: IcebergOrder[], reasons: string[]): number {
        const bidIcebergs = icebergs.filter(i => i.side === 'BID');
        const askIcebergs = icebergs.filter(i => i.side === 'ASK');

        if (bidIcebergs.length > askIcebergs.length) {
            reasons.push(`${bidIcebergs.length} iceberg buy orders detected`);
            return 70;
        } else if (askIcebergs.length > bidIcebergs.length) {
            reasons.push(`${askIcebergs.length} iceberg sell orders detected`);
            return 70;
        }

        return 50;
    }

    /**
     * Analyze large orders
     */
    private analyzeLargeOrders(orders: LargeOrder[], reasons: string[]): number {
        const buyOrders = orders.filter(o => o.side === 'BUY');
        const sellOrders = orders.filter(o => o.side === 'SELL');

        const buyVolume = buyOrders.reduce((sum, o) => sum + o.quantity, 0);
        const sellVolume = sellOrders.reduce((sum, o) => sum + o.quantity, 0);

        if (buyVolume > sellVolume * 1.5) {
            reasons.push('Institutional buying detected');
            return 80;
        } else if (sellVolume > buyVolume * 1.5) {
            reasons.push('Institutional selling detected');
            return 80;
        }

        return 50;
    }

    /**
     * Determine final direction
     */
    private determineDirection(
        scores: any,
        data: any
    ): 'LONG' | 'SHORT' | 'NEUTRAL' {
        // Count bullish vs bearish signals
        let bullishScore = 0;
        let bearishScore = 0;

        if (data.volumeDelta.deltaPercentage > 0) bullishScore += scores.volumeDelta;
        else bearishScore += Math.abs(scores.volumeDelta);

        if (data.bidAskImbalance.imbalance > 0) bullishScore += scores.bidAskImbalance;
        else bearishScore += Math.abs(scores.bidAskImbalance);

        if (data.footprintAnalysis?.imbalance === 'BUY') bullishScore += scores.footprint;
        else if (data.footprintAnalysis?.imbalance === 'SELL') bearishScore += scores.footprint;

        // Determine direction
        if (bullishScore > bearishScore * 1.2) return 'LONG';
        if (bearishScore > bullishScore * 1.2) return 'SHORT';
        return 'NEUTRAL';
    }
}
