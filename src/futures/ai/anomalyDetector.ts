// src/futures/ai/anomalyDetector.ts

/**
 * Anomaly Detector
 * Detects unusual market behavior
 */

import { AnomalyDetection, RecentMarketData } from './types';
import { OrderFlowSignal } from '../orderflow/types';

export class AnomalyDetector {
    /**
     * Detect anomalies in market data
     */
    async detectAnomalies(
        signal: OrderFlowSignal,
        recentData: RecentMarketData
    ): Promise<AnomalyDetection> {
        const anomalies: string[] = [];
        let maxSeverity: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

        // 1. Volume spike detection
        const volumeAnomaly = this.detectVolumeSpikeAnomaly(recentData.volumes);
        if (volumeAnomaly) {
            anomalies.push('UNUSUAL_VOLUME');
            maxSeverity = this.updateSeverity(maxSeverity, 'MEDIUM');
        }

        // 2. Price manipulation detection
        const manipulationAnomaly = this.detectPriceManipulation(recentData.prices);
        if (manipulationAnomaly) {
            anomalies.push('MANIPULATION');
            maxSeverity = this.updateSeverity(maxSeverity, 'HIGH');
        }

        // 3. Flash crash pattern
        const flashCrashAnomaly = this.detectFlashCrashPattern(recentData.prices);
        if (flashCrashAnomaly) {
            anomalies.push('FLASH_CRASH');
            maxSeverity = this.updateSeverity(maxSeverity, 'HIGH');
        }

        // 4. Signal inconsistency
        const signalAnomaly = this.detectSignalInconsistency(signal);
        if (signalAnomaly) {
            anomalies.push('SIGNAL_INCONSISTENCY');
            maxSeverity = this.updateSeverity(maxSeverity, 'MEDIUM');
        }

        if (anomalies.length === 0) {
            return {
                detected: false,
                type: 'NONE',
                severity: 'LOW',
                recommendation: 'PROCEED_CAUTIOUSLY',
                details: ['No anomalies detected']
            };
        }

        return {
            detected: true,
            type: anomalies[0] as any,
            severity: maxSeverity,
            recommendation: this.makeRecommendation(maxSeverity),
            details: anomalies
        };
    }

    /**
     * Detect volume spike anomaly
     */
    private detectVolumeSpikeAnomaly(volumes: number[]): boolean {
        if (volumes.length < 20) return false;

        const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const avgVolume = volumes.slice(0, -5).reduce((a, b) => a + b, 0) / (volumes.length - 5);

        // Spike if recent volume is 5x average
        return recentVolume > avgVolume * 5;
    }

    /**
     * Detect price manipulation
     */
    private detectPriceManipulation(prices: number[]): boolean {
        if (prices.length < 20) return false;

        // Look for pump and dump pattern
        const recentPrices = prices.slice(-10);
        const maxPrice = Math.max(...recentPrices);
        const minPrice = Math.min(...recentPrices);
        const currentPrice = prices[prices.length - 1];

        // Rapid rise and fall
        const range = (maxPrice - minPrice) / minPrice;
        const fromMax = (maxPrice - currentPrice) / maxPrice;

        // If price rose >10% and fell >8% in 10 periods = manipulation
        return range > 0.10 && fromMax > 0.08;
    }

    /**
     * Detect flash crash pattern
     */
    private detectFlashCrashPattern(prices: number[]): boolean {
        if (prices.length < 10) return false;

        // Look for sudden large drop
        for (let i = prices.length - 5; i < prices.length - 1; i++) {
            const drop = (prices[i] - prices[i + 1]) / prices[i];

            // Drop >5% in single period = flash crash
            if (drop > 0.05) {
                return true;
            }
        }

        return false;
    }

    /**
     * Detect signal inconsistency
     */
    private detectSignalInconsistency(signal: OrderFlowSignal): boolean {
        // Cast to AdvancedOrderFlowSignal if needed, or check existence safely
        const advancedSignal = signal as any;

        // Check if component scores are available
        if (!advancedSignal.componentScores) return false;

        const scores = Object.values(advancedSignal.componentScores) as number[];
        // Filter out non-numeric values if any
        const numericScores = scores.filter(s => typeof s === 'number');

        if (numericScores.length === 0) return false;

        const avg = numericScores.reduce((a, b) => a + b, 0) / numericScores.length;

        // If any score deviates >40 from average = inconsistent
        return numericScores.some(score => Math.abs(score - avg) > 40);
    }

    /**
     * Update severity to maximum
     */
    private updateSeverity(
        current: 'LOW' | 'MEDIUM' | 'HIGH',
        newSeverity: 'LOW' | 'MEDIUM' | 'HIGH'
    ): 'LOW' | 'MEDIUM' | 'HIGH' {
        const levels = { LOW: 1, MEDIUM: 2, HIGH: 3 };
        return levels[newSeverity] > levels[current] ? newSeverity : current;
    }

    /**
     * Make recommendation based on severity
     */
    private makeRecommendation(
        severity: 'LOW' | 'MEDIUM' | 'HIGH'
    ): 'WAIT' | 'PROCEED_CAUTIOUSLY' | 'ABORT' {
        if (severity === 'HIGH') return 'ABORT';
        if (severity === 'MEDIUM') return 'WAIT';
        return 'PROCEED_CAUTIOUSLY';
    }
}
