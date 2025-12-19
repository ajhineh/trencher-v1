// src/sniper/aiSniperBot.ts

/**
 * AI-Powered Sniper Bot
 * Fast token buying with AI validation
 * Supports CONSERVATIVE and NORMAL modes
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { executeDirectBuy } from '../pumpswap/execute-buy-direct';
import { RiskScorer } from '../risk/riskScorer';
import { BuyerActivityMonitor } from './buyerActivityMonitor';
import { logger } from '../logger';
import {
    SniperConfig,
    TokenOpportunity,
    AIAnalysisResult,
    SniperResult
} from './types';

export class AISniperBot {
    private connection: Connection;
    private keypair: Keypair;
    private config: SniperConfig;
    private riskScorer: RiskScorer;
    private buyerMonitor: BuyerActivityMonitor;

    constructor(
        connection: Connection,
        keypair: Keypair,
        config: SniperConfig
    ) {
        this.connection = connection;
        this.keypair = keypair;
        this.config = config;
        this.riskScorer = new RiskScorer();
        this.buyerMonitor = new BuyerActivityMonitor(connection);

        logger.info(`🎯 AI Sniper Mode: ${config.mode}`);
    }

    /**
     * Snipe new token with AI validation
     */
    async snipeToken(opportunity: TokenOpportunity): Promise<SniperResult> {
        const startTime = Date.now();
        logger.info('🎯 New token detected:', opportunity.mint.toBase58());

        try {
            // Route to mode-specific logic
            if (this.config.mode === 'CONSERVATIVE') {
                return await this.conservativeSnipe(opportunity, startTime);
            } else {
                return await this.normalSnipe(opportunity, startTime);
            }
        } catch (error: any) {
            logger.error(`Snipe error: ${error.message}`);
            return {
                success: false,
                aiDecision: {
                    shouldBuy: false,
                    confidence: 0,
                    reasons: [error.message],
                    suggestedAmount: 0,
                    riskLevel: 'HIGH'
                },
                error: error.message
            };
        }
    }

    /**
     * CONSERVATIVE mode: Strict AI validation
     */
    private async conservativeSnipe(opportunity: TokenOpportunity, startTime: number): Promise<SniperResult> {
        // Full AI analysis
        const aiDecision = await this.quickAIAnalysis(opportunity);
        const analysisTime = Date.now() - startTime;

        logger.info(`🤖 AI Analysis (CONSERVATIVE) in ${analysisTime}ms`);
        logger.info(`   Confidence: ${aiDecision.confidence}%`);
        logger.info(`   Risk Level: ${aiDecision.riskLevel}`);

        if (!aiDecision.shouldBuy) {
            logger.info('❌ AI rejected token');
            return { success: false, aiDecision };
        }

        // Strict thresholds
        const thresholds = this.config.conservativeThresholds;

        if (aiDecision.confidence < thresholds.minConfidence) {
            logger.info(`❌ Confidence too low: ${aiDecision.confidence}% < ${thresholds.minConfidence}%`);
            return { success: false, aiDecision };
        }

        if (aiDecision.riskLevel !== 'LOW') {
            logger.info(`❌ Risk too high: ${aiDecision.riskLevel} (need LOW)`);
            return { success: false, aiDecision };
        }

        // Execute buy
        return await this.executeBuy(opportunity, aiDecision, startTime);
    }

    /**
     * NORMAL mode: Relaxed validation + buyer activity check
     */
    private async normalSnipe(opportunity: TokenOpportunity, startTime: number): Promise<SniperResult> {
        // Quick AI analysis
        const aiDecision = await this.quickAIAnalysis(opportunity);
        const analysisTime = Date.now() - startTime;

        logger.info(`🤖 AI Analysis (NORMAL) in ${analysisTime}ms`);
        logger.info(`   Confidence: ${aiDecision.confidence}%`);
        logger.info(`   Risk Level: ${aiDecision.riskLevel}`);

        if (!aiDecision.shouldBuy) {
            logger.info('❌ AI rejected token');
            return { success: false, aiDecision };
        }

        // Relaxed thresholds
        const thresholds = this.config.normalThresholds;

        if (aiDecision.confidence < thresholds.minConfidence) {
            logger.info(`❌ Confidence too low: ${aiDecision.confidence}% < ${thresholds.minConfidence}%`);
            return { success: false, aiDecision };
        }

        // Check buyer activity (CRITICAL for NORMAL mode)
        logger.info('👥 Checking buyer activity...');
        const hasActiveBuyers = await this.buyerMonitor.hasActiveBuyers(
            opportunity.mint,
            thresholds.minActiveBuyers,
            thresholds.buyerWindowSeconds
        );

        if (!hasActiveBuyers) {
            logger.info('❌ Not enough active buyers');
            return { success: false, aiDecision };
        }

        // Execute buy
        return await this.executeBuy(opportunity, aiDecision, startTime);
    }

    /**
     * Execute buy transaction
     */
    private async executeBuy(
        opportunity: TokenOpportunity,
        aiDecision: AIAnalysisResult,
        startTime: number
    ): Promise<SniperResult> {
        logger.info('⚡ Executing fast buy...');
        logger.info(`   Amount: ${aiDecision.suggestedAmount} SOL`);

        // 4. Fast buy execution
        logger.info('⚡ Executing fast buy...');
        logger.info(`   Amount: ${aiDecision.suggestedAmount} SOL`);

        const txSignature = await executeDirectBuy(
            this.connection,
            opportunity.poolKey,
            opportunity.mint,
            this.keypair,
            BigInt(Math.floor(aiDecision.suggestedAmount * 1e9)), // SOL to lamports
            this.config.maxSlippage,
            true // skipPreflight for speed
        );

        if (txSignature) {
            logger.info('✅ Token sniped successfully!');
            logger.info(`   TX: ${txSignature}`);

            const totalTime = Date.now() - startTime;
            logger.info(`   Total time: ${totalTime}ms`);

            return {
                success: true,
                txSignature,
                aiDecision
            };
        }

        return {
            success: false,
            aiDecision,
            error: 'Transaction failed'
        };

    } catch(error: any) {
        logger.error('❌ Sniper error:', error.message);
        return {
            success: false,
            aiDecision: {
                shouldBuy: false,
                confidence: 0,
                reasons: ['Error during sniping'],
                suggestedAmount: 0,
                riskLevel: 'HIGH'
            },
            error: error.message
        };
    }


    /**
     * Quick AI analysis (target <1 second)
     */
    private async quickAIAnalysis(
        opportunity: TokenOpportunity
    ): Promise<AIAnalysisResult> {
        const checks = await Promise.all([
            this.checkLiquidity(opportunity),
            this.checkCreatorHistory(opportunity.creatorAddress),
            this.quickRiskCheck(opportunity.mint)
        ]);

        const [liquidityOk, creatorOk, riskOk] = checks;

        let confidence = 50;
        const reasons: string[] = [];
        let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';

        // Liquidity check (30 points)
        if (liquidityOk.passed) {
            confidence += 30;
            reasons.push(`✅ Sufficient liquidity (${liquidityOk.amount.toFixed(2)} SOL)`);
        } else {
            confidence -= 20;
            reasons.push(`❌ Low liquidity (${liquidityOk.amount.toFixed(2)} SOL)`);
            riskLevel = 'HIGH';
        }

        // Creator history (20 points)
        if (creatorOk.passed) {
            confidence += 20;
            reasons.push('✅ Creator has good history');
        } else if (creatorOk.suspicious) {
            confidence -= 30;
            reasons.push('❌ Creator has suspicious history');
            riskLevel = 'HIGH';
        }

        // Risk check (20 points)
        if (riskOk.passed) {
            confidence += 20;
            reasons.push('✅ Token metrics look good');
            if (riskLevel !== 'HIGH') riskLevel = 'LOW';
        } else {
            confidence -= 10;
            reasons.push('⚠️ Some risk indicators present');
            if (riskLevel !== 'HIGH') riskLevel = 'MEDIUM';
        }

        // Calculate suggested buy amount based on confidence
        const suggestedAmount = this.calculateBuyAmount(confidence, riskLevel);

        return {
            shouldBuy: confidence >= this.config.aiConfidenceThreshold && riskLevel !== 'HIGH',
            confidence: Math.max(0, Math.min(100, confidence)),
            reasons,
            suggestedAmount,
            riskLevel
        };
    }

    /**
     * Check liquidity
     */
    private async checkLiquidity(
        opportunity: TokenOpportunity
    ): Promise<{ passed: boolean; amount: number }> {
        // Liquidity already provided in opportunity
        const liquiditySOL = opportunity.liquidity / 1e9; // lamports to SOL

        return {
            passed: liquiditySOL >= this.config.minLiquidity,
            amount: liquiditySOL
        };
    }

    /**
     * Check creator history
     */
    private async checkCreatorHistory(
        creatorAddress: PublicKey
    ): Promise<{ passed: boolean; suspicious: boolean }> {
        try {
            // Get creator's recent transactions
            const signatures = await this.connection.getSignaturesForAddress(
                creatorAddress,
                { limit: 20 }
            );

            // Simple heuristic: if creator has many recent transactions, might be spammer
            const recentTxCount = signatures.filter(sig =>
                Date.now() - (sig.blockTime || 0) * 1000 < 24 * 60 * 60 * 1000 // Last 24h
            ).length;

            // Too many transactions in 24h = suspicious
            if (recentTxCount > 50) {
                return { passed: false, suspicious: true };
            }

            // Has some history = good
            if (signatures.length > 5) {
                return { passed: true, suspicious: false };
            }

            // New wallet = neutral
            return { passed: true, suspicious: false };

        } catch (error) {
            logger.warn('Could not check creator history:', error);
            return { passed: true, suspicious: false };
        }
    }

    /**
     * Quick risk check
     */
    private async quickRiskCheck(
        mint: PublicKey
    ): Promise<{ passed: boolean }> {
        try {
            // Use existing risk scorer but with quick mode
            const riskScore = await this.riskScorer.quickScore(mint.toBase58());

            // Risk score 0-100, lower is better
            return { passed: riskScore < 70 };

        } catch (error) {
            logger.warn('Could not perform risk check:', error);
            return { passed: true }; // Assume ok if can't check
        }
    }

    /**
     * Calculate buy amount based on AI confidence
     */
    private calculateBuyAmount(confidence: number, riskLevel: string): number {
        let amount = this.config.maxBuyAmount;

        // Reduce based on confidence
        const confidenceMultiplier = confidence / 100;
        amount *= confidenceMultiplier;

        // Reduce based on risk
        if (riskLevel === 'HIGH') {
            amount *= 0.3; // Only 30% of calculated amount
        } else if (riskLevel === 'MEDIUM') {
            amount *= 0.7; // 70% of calculated amount
        }

        // Ensure minimum and maximum
        amount = Math.max(0.0001, Math.min(this.config.maxBuyAmount, amount));

        return amount;
    }
}
