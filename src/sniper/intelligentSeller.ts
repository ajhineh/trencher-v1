// src/sniper/intelligentSeller.ts

/**
 * Intelligent Seller
 * Uses spot trading strategies for optimized exits
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { MultiAgentSystem } from '../agents/multiAgentSystem';

import { RiskScorer } from '../risk/riskScorer';
import { logger } from '../logger';
import { JitoEmergencySell } from './jitoEmergencySell';
import { ExitStrategyManager, ExitConfig } from './exitStrategyManager';

interface PositionInfo {
    mint: PublicKey;
    poolKey: PublicKey;
    quoteMint: PublicKey;
    entryPrice: number;
    currentPrice: number;
    highestPrice: number;  // Track highest price for trailing stop
    tokenAmount: number;
    profitPercent: number;
    holdingTime: number; // seconds
}

interface SellDecision {
    action: 'HOLD' | 'SELL_PARTIAL' | 'SELL_ALL' | 'TRAILING_STOP';
    percentage?: number;
    reasoning: string[];
    confidence: number;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface TrailingStopInfo {
    highestPrice: number;
    stopPercent: number;
    activated: boolean;
}

export class IntelligentSeller {
    private connection: Connection;
    private keypair: Keypair;
    private multiAgent: MultiAgentSystem;
    private riskScorer: RiskScorer;
    private jitoSell: JitoEmergencySell;
    private exitStrategy: ExitStrategyManager;

    // Track highest prices for trailing stop
    private highestPrices: Map<string, number> = new Map();

    // Track trailing stops
    private trailingStops: Map<string, TrailingStopInfo> = new Map();

    constructor(connection: Connection, keypair: Keypair, exitConfig: ExitConfig) {
        this.connection = connection;
        this.keypair = keypair;
        this.multiAgent = new MultiAgentSystem();
        this.riskScorer = new RiskScorer();
        this.jitoSell = new JitoEmergencySell(connection, keypair);
        this.exitStrategy = new ExitStrategyManager(exitConfig);

        logger.info('💎 Intelligent Seller initialized with exit strategy');
    }

    /**
     * Analyze position and decide on selling
     */
    async analyzePosition(position: PositionInfo): Promise<SellDecision> {
        logger.info('📊 Analyzing position for intelligent exit...');
        logger.info(`   Entry: $${position.entryPrice.toFixed(6)}`);
        logger.info(`   Current: $${position.currentPrice.toFixed(6)}`);
        logger.info(`   Profit: ${position.profitPercent.toFixed(2)}%`);
        logger.info(`   Holding: ${Math.floor(position.holdingTime / 60)}m ${position.holdingTime % 60}s`);

        // Update highest price for trailing stop
        const mintStr = position.mint.toBase58();
        const currentHighest = this.highestPrices.get(mintStr) || position.entryPrice;
        if (position.currentPrice > currentHighest) {
            this.highestPrices.set(mintStr, position.currentPrice);
        }

        // Use ExitStrategyManager for decision
        const decision = await this.exitStrategy.evaluateExit({
            mint: mintStr,
            entryPrice: position.entryPrice,
            currentPrice: position.currentPrice,
            highestPrice: this.highestPrices.get(mintStr) || position.currentPrice,
            profitPercent: position.profitPercent,
            holdingTime: position.holdingTime
        });

        logger.info(`\n🎯 Decision: ${decision.action}`);
        logger.info(`   Confidence: ${decision.confidence}%`);
        logger.info(`   Urgency: ${decision.urgency}`);
        decision.reasoning.forEach(r => logger.info(`   - ${r}`));

        return decision;
    }

    /**
     * Execute sell decision
     */
    async executeSell(
        position: PositionInfo,
        decision: SellDecision
    ): Promise<string | null> {
        if (decision.action === 'HOLD') {
            logger.info('💎 Holding position');
            return null;
        }

        if (decision.action === 'TRAILING_STOP') {
            logger.info('📈 Activating trailing stop');
            this.activateTrailingStop(position);
            return null;
        }

        // Calculate sell amount
        const sellPercentage = decision.action === 'SELL_ALL' ? 100 : (decision.percentage || 50);

        logger.info(`\n💰 Executing ${decision.action}`);
        logger.info(`   Selling: ${sellPercentage}% of position`);
        logger.info(`   Urgency: ${decision.urgency}`);

        // Use Jito if high urgency
        if (decision.urgency === 'HIGH') {
            logger.info('   Using Jito for priority execution');

            return await this.jitoSell.emergencySell(
                position.mint,
                position.poolKey,
                position.quoteMint,
                0.0005 // Lower tip for normal sells
            );
        }

        // Regular sell for lower urgency
        logger.info('   Using regular execution');
        // TODO: Implement regular sell
        return null;
    }

    /**
     * Get AI analysis
     */
    private async getAIAnalysis(position: PositionInfo): Promise<any> {
        // Use multi-agent system for analysis
        const analysis = {
            sentiment: this.analyzeSentiment(position),
            momentum: this.analyzeMomentum(position),
            recommendation: 'HOLD' as 'BUY' | 'SELL' | 'HOLD'
        };

        // Determine recommendation
        if (position.profitPercent > 100) {
            analysis.recommendation = 'SELL';
        } else if (position.profitPercent < -20) {
            analysis.recommendation = 'SELL';
        }

        return analysis;
    }

    /**
     * Analyze sentiment
     */
    private analyzeSentiment(position: PositionInfo): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
        // Simple momentum-based sentiment
        if (position.profitPercent > 20) return 'BULLISH';
        if (position.profitPercent < -10) return 'BEARISH';
        return 'NEUTRAL';
    }

    /**
     * Analyze momentum
     */
    private analyzeMomentum(position: PositionInfo): 'STRONG' | 'WEAK' | 'NEUTRAL' {
        // Based on profit and time
        const profitPerHour = (position.profitPercent / position.holdingTime) * 3600;

        if (profitPerHour > 50) return 'STRONG';
        if (profitPerHour < -20) return 'WEAK';
        return 'NEUTRAL';
    }

    /**
     * Make selling decision
     */
    private makeSellingDecision(data: any): SellDecision {
        const { position, aiAnalysis, riskScore, trailingStopTriggered } = data;
        const reasons: string[] = [];
        let confidence = 50;

        // Trailing stop triggered
        if (trailingStopTriggered) {
            return {
                action: 'SELL_ALL',
                reasoning: ['Trailing stop triggered'],
                confidence: 95,
                urgency: 'HIGH'
            };
        }

        // Extreme profit - take profits
        if (position.profitPercent > 200) {
            reasons.push('🚀 Extreme profit achieved (>200%)');
            reasons.push('💰 Taking profits to secure gains');
            confidence = 90;

            return {
                action: 'SELL_PARTIAL',
                percentage: 75,
                reasoning: reasons,
                confidence,
                urgency: 'MEDIUM'
            };
        }

        // High profit - activate trailing stop
        if (position.profitPercent > 100) {
            reasons.push('📈 High profit (>100%)');
            reasons.push('🎯 Activating trailing stop to protect gains');
            confidence = 85;

            return {
                action: 'TRAILING_STOP',
                reasoning: reasons,
                confidence,
                urgency: 'LOW'
            };
        }

        // Good profit + high risk - sell partial
        if (position.profitPercent > 50 && riskScore > 70) {
            reasons.push('✅ Good profit (>50%)');
            reasons.push('⚠️ Risk increasing');
            reasons.push('💡 Selling half to reduce exposure');
            confidence = 80;

            return {
                action: 'SELL_PARTIAL',
                percentage: 50,
                reasoning: reasons,
                confidence,
                urgency: 'MEDIUM'
            };
        }

        // Medium profit + AI says sell
        if (position.profitPercent > 30 && aiAnalysis.recommendation === 'SELL') {
            reasons.push('💰 Decent profit (>30%)');
            reasons.push('🤖 AI suggests selling');
            confidence = 75;

            return {
                action: 'SELL_PARTIAL',
                percentage: 50,
                reasoning: reasons,
                confidence,
                urgency: 'LOW'
            };
        }

        // Stop loss - sell all
        if (position.profitPercent < -20) {
            reasons.push('❌ Stop loss hit (-20%)');
            reasons.push('🛡️ Cutting losses');
            confidence = 95;

            return {
                action: 'SELL_ALL',
                reasoning: reasons,
                confidence,
                urgency: 'HIGH'
            };
        }

        // Small loss + high risk - exit
        if (position.profitPercent < -10 && riskScore > 80) {
            reasons.push('⚠️ Small loss + high risk');
            reasons.push('🚪 Better to exit now');
            confidence = 85;

            return {
                action: 'SELL_ALL',
                reasoning: reasons,
                confidence,
                urgency: 'MEDIUM'
            };
        }

        // Default: hold
        reasons.push('💎 Conditions not met for selling');
        reasons.push('📊 Continuing to monitor');

        if (position.profitPercent > 10) {
            reasons.push('✅ In profit, letting it run');
        }

        return {
            action: 'HOLD',
            reasoning: reasons,
            confidence: 60,
            urgency: 'LOW'
        };
    }

    /**
     * Check trailing stop
     */
    private checkTrailingStop(position: PositionInfo): boolean {
        const mintStr = position.mint.toBase58();
        const stop = this.trailingStops.get(mintStr);

        if (!stop || !stop.activated) return false;

        // Update highest price
        if (position.currentPrice > stop.highestPrice) {
            stop.highestPrice = position.currentPrice;
            logger.info(`📈 Trailing stop updated: $${stop.highestPrice.toFixed(6)}`);
        }

        // Check if stop triggered
        const dropPercent = ((stop.highestPrice - position.currentPrice) / stop.highestPrice) * 100;

        if (dropPercent >= stop.stopPercent) {
            logger.warn(`🚨 Trailing stop triggered! Drop: ${dropPercent.toFixed(2)}%`);
            return true;
        }

        return false;
    }

    /**
     * Activate trailing stop
     */
    private activateTrailingStop(position: PositionInfo): void {
        const mintStr = position.mint.toBase58();

        this.trailingStops.set(mintStr, {
            highestPrice: position.currentPrice,
            stopPercent: 15, // 15% trailing stop
            activated: true
        });

        logger.info('✅ Trailing stop activated (15%)');
    }

    /**
     * Remove trailing stop
     */
    removeTrailingStop(mint: PublicKey): void {
        this.trailingStops.delete(mint.toBase58());
    }
}
