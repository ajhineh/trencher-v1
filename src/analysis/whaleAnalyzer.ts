// src/analysis/whaleAnalyzer.ts

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';

export interface WhaleActivitySignals {
    hasWhaleActivity: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    signals: string[];
    score: number; // 0-100
    details: {
        largeHolders?: number;
        whaleConcentration?: number;
        recentWhaleActivity?: boolean;
        topHolderPercent?: number;
    };
}

interface HolderData {
    address: string;
    balance: number;
    percentOfSupply: number;
}

/**
 * Analyze whale activity and concentration
 */
export async function analyzeWhaleActivity(
    connection: Connection,
    tokenMint: PublicKey,
    holderData: HolderData[],
    totalSupply: number
): Promise<WhaleActivitySignals> {
    const signals: string[] = [];
    const details: WhaleActivitySignals['details'] = {};
    let score = 0;

    if (holderData.length === 0) {
        return {
            hasWhaleActivity: false,
            riskLevel: 'LOW',
            signals: ['No holder data available'],
            score: 0,
            details: {},
        };
    }

    // Sort holders by balance
    const sortedHolders = [...holderData].sort((a, b) => b.balance - a.balance);

    // Signal 1: Large single holder (>20% of supply)
    const topHolder = sortedHolders[0];
    if (topHolder && topHolder.percentOfSupply > 20) {
        signals.push(`Top holder owns ${topHolder.percentOfSupply.toFixed(1)}% of supply`);
        details.topHolderPercent = topHolder.percentOfSupply;
        score += 40;
    } else if (topHolder && topHolder.percentOfSupply > 10) {
        signals.push(`Top holder owns ${topHolder.percentOfSupply.toFixed(1)}% of supply`);
        details.topHolderPercent = topHolder.percentOfSupply;
        score += 20;
    }

    // Signal 2: Multiple large holders (top 3 > 50%)
    const top3Percent = sortedHolders.slice(0, 3).reduce((sum, h) => sum + h.percentOfSupply, 0);
    if (top3Percent > 50) {
        signals.push(`Top 3 holders own ${top3Percent.toFixed(1)}% of supply`);
        details.whaleConcentration = top3Percent;
        score += 35;
    } else if (top3Percent > 40) {
        signals.push(`Top 3 holders own ${top3Percent.toFixed(1)}% of supply`);
        details.whaleConcentration = top3Percent;
        score += 20;
    }

    // Signal 3: Count of large holders (>5% each)
    const largeHolders = holderData.filter(h => h.percentOfSupply > 5).length;
    if (largeHolders >= 5) {
        signals.push(`${largeHolders} holders with >5% of supply each`);
        details.largeHolders = largeHolders;
        score += 25;
    } else if (largeHolders >= 3) {
        signals.push(`${largeHolders} holders with >5% of supply each`);
        details.largeHolders = largeHolders;
        score += 15;
    }

    // Signal 4: Very few total holders (concentration risk)
    if (holderData.length < 10) {
        signals.push(`Only ${holderData.length} total holders`);
        score += 20;
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

    const hasWhaleActivity = score >= 50;

    if (hasWhaleActivity) {
        logger.warn(
            `[WhaleActivity] HIGH CONCENTRATION! Score: ${score}/100 (${riskLevel}) | Signals: ${signals.join(', ')}`
        );
    } else {
        logger.info(
            `[WhaleActivity] Score: ${score}/100 (${riskLevel})`
        );
    }

    return {
        hasWhaleActivity,
        riskLevel,
        signals,
        score,
        details,
    };
}

/**
 * Quick whale check using holder analysis data
 */
export function quickWhaleCheck(
    top5HoldersPercent: number,
    largestHolderPercent: number,
    totalHolders: number
): boolean {
    // High risk if:
    // - Top 5 holders own >60% OR
    // - Largest holder owns >25% OR
    // - Very few holders (<5)
    return (
        top5HoldersPercent > 60 ||
        largestHolderPercent > 25 ||
        totalHolders < 5
    );
}

/**
 * Wrapper class for compatibility with risk scoring system
 */
export class WhaleAnalyzer {
    private connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    async analyze(tokenAddress: string): Promise<{ riskScore: number }> {
        // Simplified analysis - in production would fetch real holder data
        // For now, return moderate risk
        return { riskScore: 35 };
    }
}

// Singleton instance
let whaleAnalyzerInstance: WhaleAnalyzer | null = null;

export function getWhaleAnalyzer(connection: Connection): WhaleAnalyzer {
    if (!whaleAnalyzerInstance) {
        whaleAnalyzerInstance = new WhaleAnalyzer(connection);
    }
    return whaleAnalyzerInstance;
}
