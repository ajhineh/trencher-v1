// src/analysis/coordinatedBuyingDetector.ts

import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import { logger } from '../logger';

export interface CoordinatedBuyingSignals {
    isCoordinated: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    signals: string[];
    score: number; // 0-100
    details: {
        simultaneousBuys?: number;
        similarAmounts?: boolean;
        newWallets?: number;
        timeCluster?: boolean;
    };
}

interface BuyTransaction {
    signature: string;
    buyer: string;
    amount: number;
    timestamp: number;
}

/**
 * Detect coordinated buying patterns
 */
export async function detectCoordinatedBuying(
    connection: Connection,
    poolAddress: PublicKey,
    recentTransactions: BuyTransaction[]
): Promise<CoordinatedBuyingSignals> {
    const signals: string[] = [];
    const details: CoordinatedBuyingSignals['details'] = {};
    let score = 0;

    if (recentTransactions.length < 3) {
        return {
            isCoordinated: false,
            riskLevel: 'LOW',
            signals: [],
            score: 0,
            details: {},
        };
    }

    // Signal 1: Simultaneous buys (within 10 seconds)
    const timeWindow = 10000; // 10 seconds
    const timestamps = recentTransactions.map(tx => tx.timestamp).sort((a, b) => a - b);
    let maxSimultaneous = 1;
    let currentCluster = 1;

    for (let i = 1; i < timestamps.length; i++) {
        if (timestamps[i] - timestamps[i - 1] < timeWindow) {
            currentCluster++;
            maxSimultaneous = Math.max(maxSimultaneous, currentCluster);
        } else {
            currentCluster = 1;
        }
    }

    if (maxSimultaneous >= 5) {
        signals.push(`${maxSimultaneous} simultaneous buys within 10 seconds`);
        details.simultaneousBuys = maxSimultaneous;
        details.timeCluster = true;
        score += 40;
    } else if (maxSimultaneous >= 3) {
        signals.push(`${maxSimultaneous} buys in quick succession`);
        details.simultaneousBuys = maxSimultaneous;
        score += 20;
    }

    // Signal 2: Similar buy amounts (suggests coordination)
    const amounts = recentTransactions.map(tx => tx.amount);
    const avgAmount = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    const similarAmounts = amounts.filter(a => Math.abs(a - avgAmount) / avgAmount < 0.1).length;

    if (similarAmounts >= recentTransactions.length * 0.7) {
        signals.push(`${similarAmounts}/${recentTransactions.length} buys with similar amounts`);
        details.similarAmounts = true;
        score += 30;
    }

    // Signal 3: New wallets (created recently)
    // Note: This would require additional on-chain queries
    // For now, we'll use a simplified heuristic based on unique buyers
    const uniqueBuyers = new Set(recentTransactions.map(tx => tx.buyer)).size;
    const buyerRatio = uniqueBuyers / recentTransactions.length;

    if (buyerRatio < 0.5 && recentTransactions.length > 10) {
        signals.push(`Low unique buyer ratio: ${(buyerRatio * 100).toFixed(0)}%`);
        score += 20;
    }

    // Signal 4: Burst pattern (many buys in short time, then silence)
    const now = Date.now();
    const recentBuys = recentTransactions.filter(tx => now - tx.timestamp < 60000).length;
    const olderBuys = recentTransactions.filter(tx => now - tx.timestamp >= 60000).length;

    if (recentBuys > 10 && olderBuys === 0) {
        signals.push(`Burst pattern: ${recentBuys} buys in last minute`);
        score += 25;
    }

    // Determine risk level
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    if (score >= 60) {
        riskLevel = 'HIGH';
    } else if (score >= 35) {
        riskLevel = 'MEDIUM';
    } else {
        riskLevel = 'LOW';
    }

    const isCoordinated = score >= 50;

    if (isCoordinated) {
        logger.warn(
            `[CoordinatedBuying] DETECTED! Score: ${score}/100 (${riskLevel}) | Signals: ${signals.join(', ')}`
        );
    }

    return {
        isCoordinated,
        riskLevel,
        signals,
        score,
        details,
    };
}

/**
 * Quick check for coordinated buying
 */
export function quickCoordinatedCheck(
    recentBuyers: number,
    ageMs: number
): boolean {
    const ageMinutes = ageMs / (60 * 1000);
    const buyersPerMinute = recentBuyers / Math.max(ageMinutes, 1);

    // Suspicious if more than 15 buyers per minute
    return buyersPerMinute > 15;
}

/**
 * Wrapper class for compatibility with risk scoring system
 */
export class CoordinatedBuyingDetector {
    async analyze(tokenAddress: string): Promise<{ riskScore: number }> {
        // Simplified analysis - in production would fetch real transaction data
        // For now, return moderate risk
        return { riskScore: 30 };
    }
}

// Singleton instance
let coordinatedBuyingDetectorInstance: CoordinatedBuyingDetector | null = null;

export function getCoordinatedBuyingDetector(): CoordinatedBuyingDetector {
    if (!coordinatedBuyingDetectorInstance) {
        coordinatedBuyingDetectorInstance = new CoordinatedBuyingDetector();
    }
    return coordinatedBuyingDetectorInstance;
}
