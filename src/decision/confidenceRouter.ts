// src/decision/confidenceRouter.ts

/**
 * Confidence-Based Router
 * مسیریابی تصمیمات بر اساس میزان اطمینان
 * 
 * Flow:
 * 1. Quick Rules (1-10ms) - confidence >= 0.95
 * 2. Fast Classifier (50-200ms) - confidence >= 0.85
 * 3. DQN Agent (100-300ms) - confidence >= 0.60
 * 4. Conservative Decision - confidence < 0.60
 */

import { createConditionalDQN, ConditionalDQNAgent } from '../rl/conditionalDQN';

import { Connection } from '@solana/web3.js';
import { logger } from '../logger';
import {
    ConfidenceMetrics,
    isHighConfidence,
    isMediumConfidence,
    calculateConfidence
} from './confidenceMetrics';
import {
    quickSecurityCheckV2,
    runEnhancedSecurityChecksV2
} from '../analysis/enhancedSecurityIntegration';
import { getRiskScoringSystem } from '../risk/riskScoringSystem';

export interface TokenContext {
    mintAddress: string;
    creatorAddress: string;
    createdAtMs: number;
    liquidityUSD?: number;
    topHolderPercent?: number;
    top5HolderPercent?: number;
    buyerCountLast5Min?: number;
    slippagePercent?: number;
    metadata?: any;
    topHolders?: Array<{
        address: string;
        balance: number;
        percentageOfSupply: number;
    }>;
}

export interface DecisionWithConfidence {
    action: 'ALLOW' | 'BLOCK' | 'PROBE';
    confidence: ConfidenceMetrics;
    riskScore: number;
    latency: number;
    method: 'QUICK_RULES' | 'FAST_CLASSIFIER' | 'DQN' | 'CONSERVATIVE';
    reason: string;
}

export class ConfidenceRouter {
    private connection: Connection;
    private dqnAgent: ConditionalDQNAgent;
    private stats = {
        totalDecisions: 0,
        quickRules: 0,
        fastClassifier: 0,
        dqn: 0,
        conservative: 0,
        totalLatency: 0
    };

    constructor(connection: Connection) {
        this.connection = connection;
        // Initialize DQN with estimated dimensions
        // State: 50 features (RiskScore + SecurityChecks + TokenContext)
        // Actions: 3 (BLOCK=0, ALLOW=1, PROBE=2)
        this.dqnAgent = createConditionalDQN(50, 3, 0.7);
    }

    /**
     * مسیریابی اصلی تصمیم
     */
    async route(
        tokenMint: string,
        context: TokenContext
    ): Promise<DecisionWithConfidence> {
        const startTime = Date.now();
        this.stats.totalDecisions++;

        try {
            // LEVEL 1: Quick Rules Check (target: 1-10ms)
            const quickResult = await this.quickRulesCheck(tokenMint, context);
            if (quickResult.shouldProceed === false) {
                this.stats.quickRules++;
                const latency = Date.now() - startTime;
                this.stats.totalLatency += latency;

                // Logging skipped for brevity in diff, keep original logging if possible or re-add
                logger.info(
                    `[ROUTER] Quick Rules: ${quickResult.action} ` +
                    `(confidence: ${(quickResult.confidence.overall * 100).toFixed(1)}%, ` +
                    `latency: ${latency}ms)`
                );

                return {
                    action: quickResult.action,
                    confidence: quickResult.confidence,
                    riskScore: quickResult.riskScore,
                    latency,
                    method: 'QUICK_RULES',
                    reason: quickResult.reason
                };
            }

            // LEVEL 2: Fast Classifier (target: 50-200ms)
            const classifierResult = await this.fastClassifier(tokenMint, context);

            if (isHighConfidence(classifierResult.confidence)) {
                this.stats.fastClassifier++;
                const latency = Date.now() - startTime;
                this.stats.totalLatency += latency;

                logger.info(
                    `[ROUTER] Fast Classifier: ${classifierResult.action} ` +
                    `(confidence: ${(classifierResult.confidence.overall * 100).toFixed(1)}%, ` +
                    `latency: ${latency}ms)`
                );

                return {
                    ...classifierResult,
                    latency,
                    method: 'FAST_CLASSIFIER'
                };
            }

            // LEVEL 3: DQN Decision (Integrated)
            if (isMediumConfidence(classifierResult.confidence)) {
                // Prepare state vector from context & risk
                // This is a simplified vectorization for the integration
                const stateVector = this.vectorizeState(classifierResult.riskScore, context);

                const dqnResult = await this.dqnAgent.selectActionConditional(
                    stateVector,
                    classifierResult.confidence.overall
                );

                // Map DQN action (0,1,2) to Decision
                const dqnActionMap: Record<number, 'BLOCK' | 'ALLOW' | 'PROBE'> = {
                    0: 'BLOCK',
                    1: 'ALLOW',
                    2: 'PROBE'
                };
                const action = dqnActionMap[dqnResult.action] || 'PROBE';

                this.stats.dqn++;
                const latency = Date.now() - startTime;
                this.stats.totalLatency += latency;

                logger.info(
                    `[ROUTER] DQN Decision: ${action} ` +
                    `(confidence: ${(classifierResult.confidence.overall * 100).toFixed(1)}%, ` +
                    `latency: ${latency}ms, usedDQN: ${dqnResult.usedDQN})`
                );

                return {
                    action,
                    confidence: classifierResult.confidence, // Use classifier confidence as base
                    riskScore: classifierResult.riskScore,
                    latency,
                    method: 'DQN',
                    reason: `AI Model Decision (Action ${dqnResult.action})`
                };
            }

            // LEVEL 4: Conservative Decision
            this.stats.conservative++;
            const latency = Date.now() - startTime;
            this.stats.totalLatency += latency;

            // Submit for Async Review
            const asyncManager = require('../agents/async/asyncReviewManager').AsyncReviewManager.getInstance();
            const reviewSubmission = asyncManager.submitForReview(tokenMint, context);

            if (reviewSubmission.shouldBuy) {
                logger.info(`[ROUTER] High Risk Bypass: ALLOW`);
                return {
                    action: 'ALLOW',
                    confidence: classifierResult.confidence,
                    riskScore: classifierResult.riskScore,
                    latency,
                    method: 'CONSERVATIVE',
                    reason: `High Risk Mode: ${reviewSubmission.message}`
                };
            }

            logger.info(`[ROUTER] Conservative: PROBE/QUEUED`);

            return {
                action: 'PROBE',
                confidence: classifierResult.confidence,
                riskScore: classifierResult.riskScore,
                latency,
                method: 'CONSERVATIVE',
                reason: `Queued for Async Review: ${reviewSubmission.message}`
            };

        } catch (error: any) {
            const latency = Date.now() - startTime;
            logger.error(`[ROUTER] Error: ${error.message}`);

            return {
                action: 'BLOCK',
                confidence: { overall: 0, layerAgreement: 0, dataQuality: 0, historicalAccuracy: 0, breakdown: { securityLayersAgreement: 0, riskFactorsConsistency: 0, dataCompleteness: 0, categoryConfidence: 0 } },
                riskScore: 100,
                latency,
                method: 'CONSERVATIVE',
                reason: `Error: ${error.message}`
            };
        }
    }

    /**
     * LEVEL 1: Quick Rules Check
     * بررسی‌های سریع برای rejection یا approval فوری
     */
    private async quickRulesCheck(
        tokenMint: string,
        context: TokenContext
    ): Promise<{
        shouldProceed: boolean;
        action: 'ALLOW' | 'BLOCK' | 'PROBE';
        confidence: ConfidenceMetrics;
        riskScore: number;
        reason: string;
    }> {
        // استفاده از quick security check موجود
        const quickCheck = await quickSecurityCheckV2(
            this.connection,
            tokenMint,
            context.creatorAddress,
            context.metadata
        );

        // High confidence rejection
        if (!quickCheck.isApproved && quickCheck.riskScore >= 90) {
            return {
                shouldProceed: false,
                action: 'BLOCK',
                confidence: {
                    overall: 0.95,
                    layerAgreement: 0.9,
                    dataQuality: 0.9,
                    historicalAccuracy: 0.95,
                    breakdown: { securityLayersAgreement: 0.9, riskFactorsConsistency: 0.9, dataCompleteness: 0.9, categoryConfidence: 0.95 }
                },
                riskScore: quickCheck.riskScore,
                reason: quickCheck.reason
            };
        }

        // High confidence approval (very rare)
        if (quickCheck.isApproved && quickCheck.riskScore <= 10) {
            return {
                shouldProceed: false,
                action: 'ALLOW',
                confidence: {
                    overall: 0.95,
                    layerAgreement: 0.9,
                    dataQuality: 0.9,
                    historicalAccuracy: 0.95,
                    breakdown: { securityLayersAgreement: 0.9, riskFactorsConsistency: 0.9, dataCompleteness: 0.9, categoryConfidence: 0.95 }
                },
                riskScore: quickCheck.riskScore,
                reason: 'Passed all quick checks with high confidence'
            };
        }

        // نیاز به بررسی بیشتر
        return {
            shouldProceed: true,
            action: 'PROBE',
            confidence: {
                overall: 0.5,
                layerAgreement: 0.5,
                dataQuality: 0.5,
                historicalAccuracy: 0.5,
                breakdown: { securityLayersAgreement: 0.5, riskFactorsConsistency: 0.5, dataCompleteness: 0.5, categoryConfidence: 0.5 }
            },
            riskScore: quickCheck.riskScore,
            reason: 'Needs further analysis'
        };
    }

    /**
     * LEVEL 2: Fast Classifier
     * استفاده از RiskScoringSystem موجود + محاسبه confidence
     */
    private async fastClassifier(
        tokenMint: string,
        context: TokenContext
    ): Promise<{
        action: 'ALLOW' | 'BLOCK' | 'PROBE';
        confidence: ConfidenceMetrics;
        riskScore: number;
        reason: string;
    }> {
        // اجرای security checks کامل
        const securityChecks = await runEnhancedSecurityChecksV2(
            this.connection,
            {
                mintAddress: context.mintAddress,
                creatorAddress: context.creatorAddress,
                createdAtMs: context.createdAtMs,
                liquidityUSD: context.liquidityUSD || 0,
                topHolderPercent: context.topHolderPercent || 0,
                top5HolderPercent: context.top5HolderPercent || 0,
                buyerCountLast5Min: context.buyerCountLast5Min || 0,
                slippagePercent: context.slippagePercent || 0,
                securityRiskScore: 0,
                metadata: context.metadata,
                topHolders: context.topHolders
            }
        );

        // محاسبه risk score
        const riskScoringSystem = getRiskScoringSystem(this.connection);
        const riskScore = await riskScoringSystem.calculateRisk(
            tokenMint,
            undefined,
            undefined
        );

        // محاسبه confidence
        const confidence = calculateConfidence(riskScore, securityChecks);

        // تصمیم‌گیری بر اساس risk score
        let action: 'ALLOW' | 'BLOCK' | 'PROBE';
        let reason: string;

        if (!securityChecks.isApproved || riskScore.overall >= 75) {
            action = 'BLOCK';
            reason = securityChecks.recommendations || 'High risk detected';
        } else if (riskScore.overall >= 50) {
            action = 'PROBE';
            reason = 'Medium risk - use small position';
        } else {
            action = 'ALLOW';
            reason = 'Low risk - approved for trading';
        }

        return {
            action,
            confidence,
            riskScore: riskScore.overall,
            reason
        };
    }

    /**
     * Helper to convert context to feature vector
     */
    private vectorizeState(riskScore: number, context: TokenContext): number[] {
        // Simple normalization
        return [
            riskScore / 100,
            context.liquidityUSD ? Math.min(context.liquidityUSD / 100000, 1) : 0,
            context.topHolderPercent ? context.topHolderPercent / 100 : 0,
            context.buyerCountLast5Min ? Math.min(context.buyerCountLast5Min / 100, 1) : 0,
            // Fill remaining dimensions with 0 for now (to match 50 dim)
            ...Array(46).fill(0)
        ];
    }

    /**
     * دریافت آمار استفاده
     */
    getStats() {
        const avgLatency = this.stats.totalDecisions > 0
            ? this.stats.totalLatency / this.stats.totalDecisions
            : 0;

        return {
            totalDecisions: this.stats.totalDecisions,
            methodDistribution: { ...this.stats },
            methodPercentages: {
                quickRules: (this.stats.quickRules / this.stats.totalDecisions * 100).toFixed(1) + '%',
                fastClassifier: (this.stats.fastClassifier / this.stats.totalDecisions * 100).toFixed(1) + '%',
                dqn: (this.stats.dqn / this.stats.totalDecisions * 100).toFixed(1) + '%',
                conservative: (this.stats.conservative / this.stats.totalDecisions * 100).toFixed(1) + '%'
            },
            avgLatency: avgLatency.toFixed(2) + 'ms'
        };
    }

    /**
     * ریست آمار
     */
    resetStats() {
        this.stats = {
            totalDecisions: 0,
            quickRules: 0,
            fastClassifier: 0,
            dqn: 0,
            conservative: 0,
            totalLatency: 0
        };
    }
}

// Singleton instance
let routerInstance: ConfidenceRouter | null = null;

export function getConfidenceRouter(connection: Connection): ConfidenceRouter {
    if (!routerInstance) {
        routerInstance = new ConfidenceRouter(connection);
    }
    return routerInstance;
}
