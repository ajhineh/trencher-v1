// src/analysis/pumpDumpDetector.ts

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';

export interface PumpDumpSignals {
    isPumpDump: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    signals: string[];
    score: number; // 0-100, higher = more likely pump & dump
    details: {
        rapidLiquidityIncrease?: boolean;
        suspiciousCreatorHistory?: boolean;
        abnormalBuyingPattern?: boolean;
        lowHolderCount?: boolean;
        newTokenAge?: boolean;
    };
}

interface PoolMetrics {
    currentLiquidity: number;
    initialLiquidity: number;
    liquidityGrowthRate: number;
    holderCount: number;
    tokenAgeMs: number;
    recentBuyers: number;
    creatorAddress: string;
}

/**
 * Detect pump & dump schemes based on various signals
 */
export async function detectPumpDump(
    connection: Connection,
    poolMetrics: PoolMetrics
): Promise<PumpDumpSignals> {
    const signals: string[] = [];
    const details: PumpDumpSignals['details'] = {};
    let score = 0;

    // Signal 1: Rapid liquidity increase (suspicious if >500% in short time)
    if (poolMetrics.liquidityGrowthRate > 5.0) {
        signals.push(`Rapid liquidity increase: ${(poolMetrics.liquidityGrowthRate * 100).toFixed(0)}%`);
        details.rapidLiquidityIncrease = true;
        score += 30;
    }

    // Signal 2: Very new token (< 5 minutes old)
    const ageMinutes = poolMetrics.tokenAgeMs / (60 * 1000);
    if (ageMinutes < 5) {
        signals.push(`Very new token: ${ageMinutes.toFixed(1)} minutes old`);
        details.newTokenAge = true;
        score += 20;
    }

    // Signal 3: Low holder count relative to liquidity
    const liquidityPerHolder = poolMetrics.currentLiquidity / Math.max(poolMetrics.holderCount, 1);
    if (poolMetrics.holderCount < 10 && poolMetrics.currentLiquidity > 5000) {
        signals.push(`Low holder count: ${poolMetrics.holderCount} holders with $${poolMetrics.currentLiquidity.toFixed(0)} liquidity`);
        details.lowHolderCount = true;
        score += 25;
    }

    // Signal 4: Abnormal buying pattern (too many buyers too quickly)
    const buyersPerMinute = poolMetrics.recentBuyers / Math.max(ageMinutes, 1);
    if (buyersPerMinute > 10) {
        signals.push(`Abnormal buying rate: ${buyersPerMinute.toFixed(1)} buyers/minute`);
        details.abnormalBuyingPattern = true;
        score += 15;
    }

    // Signal 5: Suspicious liquidity ratio (initial vs current)
    if (poolMetrics.initialLiquidity > 0) {
        const liquidityRatio = poolMetrics.currentLiquidity / poolMetrics.initialLiquidity;
        if (liquidityRatio > 10) {
            signals.push(`Suspicious liquidity growth: ${liquidityRatio.toFixed(1)}x in ${ageMinutes.toFixed(1)} minutes`);
            score += 20;
        }
    }

    // Determine risk level based on score
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    if (score >= 70) {
        riskLevel = 'CRITICAL';
    } else if (score >= 50) {
        riskLevel = 'HIGH';
    } else if (score >= 30) {
        riskLevel = 'MEDIUM';
    } else {
        riskLevel = 'LOW';
    }

    const isPumpDump = score >= 50;

    if (isPumpDump) {
        logger.warn(
            `[PumpDump] DETECTED! Score: ${score}/100 (${riskLevel}) | Signals: ${signals.join(', ')}`
        );
    } else {
        logger.info(
            `[PumpDump] Score: ${score}/100 (${riskLevel}) | No major concerns`
        );
    }

    return {
        isPumpDump,
        riskLevel,
        signals,
        score,
        details,
    };
}

/**
 * Simplified version for quick checks
 */
export function quickPumpDumpCheck(
    liquidityUsd: number,
    holderCount: number,
    ageMs: number,
    recentBuyers: number
): boolean {
    const ageMinutes = ageMs / (60 * 1000);

    // Red flags
    const veryNew = ageMinutes < 3;
    const lowHolders = holderCount < 5;
    const highLiquidity = liquidityUsd > 10000;
    const manyBuyers = recentBuyers > 20;

    // Suspicious if multiple red flags
    const redFlags = [veryNew, lowHolders && highLiquidity, manyBuyers && veryNew].filter(Boolean).length;

    return redFlags >= 2;
}

/**
 * Wrapper class for compatibility with risk scoring system
 */
export class PumpDumpDetector {
    async analyze(tokenAddress: string): Promise<{ riskScore: number }> {
        // Simplified analysis - in production would fetch real data
        // For now, return moderate risk
        return { riskScore: 40 };
    }
}

// Singleton instance
let pumpDumpDetectorInstance: PumpDumpDetector | null = null;

export function getPumpDumpDetector(): PumpDumpDetector {
    if (!pumpDumpDetectorInstance) {
        pumpDumpDetectorInstance = new PumpDumpDetector();
    }
    return pumpDumpDetectorInstance;
}
