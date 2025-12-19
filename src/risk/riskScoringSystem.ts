// src/risk/riskScoringSystem.ts

/**
 * Comprehensive Risk Scoring System
 * Combines all risk factors into unified risk assessment
 */

import { Connection } from "@solana/web3.js";
import { logger } from "../logger";
import { getSmartContractAnalyzer } from "../security/smartContractAnalyzer";
import { getLiquidityPoolAnalyzer } from "../analysis/liquidityPoolAnalysis";
import { getPumpDumpDetector } from "../analysis/pumpDumpDetector";
import { getWhaleAnalyzer } from "../analysis/whaleAnalyzer";
import { getCoordinatedBuyingDetector } from "../analysis/coordinatedBuyingDetector";
import { PortfolioAnalyzer, PortfolioRiskReport } from "../portfolio/portfolioAnalyzer";
import { MultiWalletManager } from "../sniper/multiWalletManager";

export type RiskCategory = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface TechnicalRisk {
    contractSecurity: number; // 0-100
    liquidityRisk: number; // 0-100
    volatilityRisk: number; // 0-100
    overall: number; // 0-100
}

export interface MarketRisk {
    sentimentRisk: number; // 0-100
    volumeRisk: number; // 0-100
    priceRisk: number; // 0-100
    overall: number; // 0-100
}

export interface PatternRisk {
    pumpDumpRisk: number; // 0-100
    whaleRisk: number; // 0-100
    coordinatedRisk: number; // 0-100
    overall: number; // 0-100
}

export interface PortfolioRisk {
    concentrationRisk: number; // 0-100
    correlationRisk: number; // 0-100
    exposureRisk: number; // 0-100
    overall: number; // 0-100
}

export interface RiskFactors {
    technical: TechnicalRisk;
    market: MarketRisk;
    pattern: PatternRisk;
    portfolio: PortfolioRisk;
}

export interface TradingRecommendation {
    shouldTrade: boolean;
    maxPosition: number; // Maximum position size in SOL
    suggestedTP: number; // Suggested take profit %
    suggestedSL: number; // Suggested stop loss %
    timeHorizon: 'SHORT' | 'MEDIUM' | 'LONG'; // Recommended holding period
    urgency: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface RiskScore {
    overall: number; // 0-100 (0 = no risk, 100 = extreme risk)
    category: RiskCategory;
    // Backwards-compatible alias used by some tests/consumers
    overallScore: number;
    factors: RiskFactors;
    recommendation: TradingRecommendation;
    explanation: string;
    warnings: string[];
    timestamp: number;
    // NEW: Confidence metrics
    confidence?: {
        overall: number;
        layerAgreement: number;
        dataQuality: number;
        historicalAccuracy: number;
    };
}

export class RiskScoringSystem {
    private connection: Connection;
    private cache: Map<string, { score: RiskScore; timestamp: number }> = new Map();
    private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes

    private portfolioAnalyzer: PortfolioAnalyzer | null = null;

    // Risk weights (must sum to 1.0)
    private weights = {
        technical: 0.35,
        market: 0.25,
        pattern: 0.30,
        portfolio: 0.10,
    };

    constructor(connection: Connection, portfolioAnalyzer?: PortfolioAnalyzer) {
        this.connection = connection;
        this.portfolioAnalyzer = portfolioAnalyzer || null;
    }

    /**
     * Set portfolio analyzer
     */
    setPortfolioAnalyzer(analyzer: PortfolioAnalyzer) {
        this.portfolioAnalyzer = analyzer;
    }

    /**
     * Calculate comprehensive risk score
     */
    async calculateRisk(
        tokenAddress: string,
        poolAddress?: string,
        currentPrice?: number
    ): Promise<RiskScore> {
        // Check cache
        const cached = this.cache.get(tokenAddress);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.score;
        }

        logger.info(`[RiskScoring] Calculating risk for ${tokenAddress.slice(0, 8)}...`);

        try {
            // Gather all risk factors
            const technical = await this.assessTechnicalRisk(tokenAddress, poolAddress);
            const market = await this.assessMarketRisk(tokenAddress, currentPrice);
            const pattern = await this.assessPatternRisk(tokenAddress);
            const portfolio = await this.assessPortfolioRisk(tokenAddress);

            // Calculate weighted overall score
            const overall = this.calculateWeightedScore({
                technical,
                market,
                pattern,
                portfolio,
            });

            // Determine risk category
            const category = this.getRiskCategory(overall);

            // Generate recommendation
            const recommendation = this.generateRecommendation(overall, {
                technical,
                market,
                pattern,
                portfolio,
            });

            // Generate explanation
            const explanation = this.explainRisk(overall, {
                technical,
                market,
                pattern,
                portfolio,
            });

            // Collect warnings
            const warnings = this.collectWarnings({
                technical,
                market,
                pattern,
                portfolio,
            });

            const score: RiskScore = {
                overall,
                overallScore: overall,
                category,
                factors: { technical, market, pattern, portfolio },
                recommendation,
                explanation,
                warnings,
                timestamp: Date.now(),
            };

            // Cache result
            this.cache.set(tokenAddress, { score, timestamp: Date.now() });

            logger.info(
                `[RiskScoring] ${tokenAddress.slice(0, 8)}... ` +
                `Overall: ${overall.toFixed(1)}, ` +
                `Category: ${category}, ` +
                `Trade: ${recommendation.shouldTrade}`
            );

            return score;
        } catch (error) {
            logger.error(`[RiskScoring] Error: ${error}`);
            throw error;
        }
    }

    /**
     * Assess technical risk
     */
    private async assessTechnicalRisk(
        tokenAddress: string,
        poolAddress?: string
    ): Promise<TechnicalRisk> {
        let contractSecurity = 50;
        let liquidityRisk = 50;
        let volatilityRisk = 50;

        try {
            // Contract security analysis
            const contractAnalyzer = getSmartContractAnalyzer(this.connection);
            const contractAnalysis = await contractAnalyzer.analyzeContract(tokenAddress);
            contractSecurity = 100 - contractAnalysis.securityScore; // Invert (higher score = lower risk)

            // Liquidity analysis
            if (poolAddress) {
                const poolAnalyzer = getLiquidityPoolAnalyzer(this.connection);
                const poolAnalysis = await poolAnalyzer.analyzePool(poolAddress, tokenAddress);
                liquidityRisk = 100 - poolAnalysis.healthScore; // Invert
            }

            // Volatility analysis (simplified)
            volatilityRisk = 40; // Placeholder
        } catch (error) {
            logger.error(`[RiskScoring] Technical risk error: ${error}`);
        }

        const overall = (contractSecurity + liquidityRisk + volatilityRisk) / 3;

        return {
            contractSecurity,
            liquidityRisk,
            volatilityRisk,
            overall,
        };
    }

    /**
     * Assess market risk
     */
    private async assessMarketRisk(
        tokenAddress: string,
        currentPrice?: number
    ): Promise<MarketRisk> {
        let sentimentRisk = 50;
        let volumeRisk = 50;
        let priceRisk = 50;

        try {
            // Sentiment risk (would integrate with social sentiment)
            sentimentRisk = 45; // Placeholder

            // Volume risk (low volume = high risk)
            volumeRisk = 40; // Placeholder

            // Price risk (high volatility = high risk)
            priceRisk = 35; // Placeholder
        } catch (error) {
            logger.error(`[RiskScoring] Market risk error: ${error}`);
        }

        const overall = (sentimentRisk + volumeRisk + priceRisk) / 3;

        return {
            sentimentRisk,
            volumeRisk,
            priceRisk,
            overall,
        };
    }

    /**
     * Assess pattern risk
     */
    private async assessPatternRisk(tokenAddress: string): Promise<PatternRisk> {
        let pumpDumpRisk = 0;
        let whaleRisk = 0;
        let coordinatedRisk = 0;

        try {
            // Pump & dump detection
            const pumpDumpDetector = getPumpDumpDetector();
            const pumpDumpAnalysis = await pumpDumpDetector.analyze(tokenAddress);
            pumpDumpRisk = pumpDumpAnalysis.riskScore;

            // Whale activity
            const whaleAnalyzer = getWhaleAnalyzer(this.connection);
            const whaleAnalysis = await whaleAnalyzer.analyze(tokenAddress);
            whaleRisk = whaleAnalysis.riskScore;

            // Coordinated buying
            const coordinatedDetector = getCoordinatedBuyingDetector();
            const coordinatedAnalysis = await coordinatedDetector.analyze(tokenAddress);
            coordinatedRisk = coordinatedAnalysis.riskScore;
        } catch (error) {
            logger.error(`[RiskScoring] Pattern risk error: ${error}`);
        }

        const overall = (pumpDumpRisk + whaleRisk + coordinatedRisk) / 3;

        return {
            pumpDumpRisk,
            whaleRisk,
            coordinatedRisk,
            overall,
        };
    }

    /**
     * Assess portfolio risk
     */
    private async assessPortfolioRisk(tokenAddress: string): Promise<PortfolioRisk> {
        let concentrationRisk = 0;
        let correlationRisk = 25; // Default medium
        let exposureRisk = 20;

        if (!this.portfolioAnalyzer) {
            // Fallback if no analyzer available
            return {
                concentrationRisk: 30, // Default assumption
                correlationRisk: 25,
                exposureRisk: 20,
                overall: 25
            };
        }

        try {
            // Calculate real portfolio risk
            const report = await this.portfolioAnalyzer.analyzePortfolio();

            // 1. Concentration Risk: How much of this token do we already hold?
            const asset = report.assets.find(a => a.mint === tokenAddress);
            if (asset) {
                // If we already hold it, concentration risk is based on current %
                if (asset.pctOfPortfolio > 50) concentrationRisk = 90;
                else if (asset.pctOfPortfolio > 25) concentrationRisk = 70;
                else if (asset.pctOfPortfolio > 10) concentrationRisk = 40;
                else concentrationRisk = 10;
            } else {
                // If we don't hold it, technically 0 concentration risk for *existing* holdings,
                // but we should consider if this NEW trade would over-concentrate us.
                // Since we don't know trade size here, we assume low risk initially.
                concentrationRisk = 0;
            }

            // 2. Exposure Risk: Total exposure to speculative assets
            // Use general portfolio risk score as proxy
            exposureRisk = report.riskScore;

        } catch (error) {
            logger.error(`[RiskScoring] Portfolio risk error: ${error}`);
            // Fallback defaults
            concentrationRisk = 30;
        }

        const overall = (concentrationRisk + correlationRisk + exposureRisk) / 3;

        return {
            concentrationRisk,
            correlationRisk,
            exposureRisk,
            overall,
        };
    }

    /**
     * Calculate weighted overall score
     */
    private calculateWeightedScore(factors: {
        technical: TechnicalRisk;
        market: MarketRisk;
        pattern: PatternRisk;
        portfolio: PortfolioRisk;
    }): number {
        const score =
            factors.technical.overall * this.weights.technical +
            factors.market.overall * this.weights.market +
            factors.pattern.overall * this.weights.pattern +
            factors.portfolio.overall * this.weights.portfolio;

        return Math.round(score * 10) / 10; // Round to 1 decimal
    }

    /**
     * Get risk category
     */
    private getRiskCategory(score: number): RiskCategory {
        if (score <= 25) return 'LOW';
        if (score <= 50) return 'MEDIUM';
        if (score <= 75) return 'HIGH';
        return 'CRITICAL';
    }

    /**
     * Generate trading recommendation
     */
    private generateRecommendation(
        overallRisk: number,
        factors: {
            technical: TechnicalRisk;
            market: MarketRisk;
            pattern: PatternRisk;
            portfolio: PortfolioRisk;
        }
    ): TradingRecommendation {
        let shouldTrade = true;
        let maxPosition = 1.0;
        let suggestedTP = 50;
        let suggestedSL = 10;
        let timeHorizon: 'SHORT' | 'MEDIUM' | 'LONG' = 'MEDIUM';
        let urgency: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';

        // Critical risk - do not trade
        if (overallRisk > 75) {
            shouldTrade = false;
            maxPosition = 0;
            urgency = 'HIGH';
            return { shouldTrade, maxPosition, suggestedTP, suggestedSL, timeHorizon, urgency };
        }

        // High risk - very small position
        if (overallRisk > 50) {
            maxPosition = 0.1; // Max 0.1 SOL
            suggestedTP = 30; // Lower TP
            suggestedSL = 15; // Tighter SL
            timeHorizon = 'SHORT';
            urgency = 'HIGH';
        }
        // Medium risk - moderate position
        else if (overallRisk > 25) {
            maxPosition = 0.5; // Max 0.5 SOL
            suggestedTP = 50;
            suggestedSL = 10;
            timeHorizon = 'MEDIUM';
            urgency = 'MEDIUM';
        }
        // Low risk - normal position
        else {
            maxPosition = 1.0; // Max 1.0 SOL
            suggestedTP = 75; // Higher TP
            suggestedSL = 8; // Wider SL
            timeHorizon = 'LONG';
            urgency = 'LOW';
        }

        // Adjust based on specific factors
        if (factors.technical.contractSecurity > 70) {
            shouldTrade = false; // Contract too risky
        }

        if (factors.pattern.pumpDumpRisk > 80) {
            shouldTrade = false; // Likely pump & dump
        }

        // Block if we are already over-exposed
        if (factors.portfolio.concentrationRisk > 75) {
            shouldTrade = false;
            logger.warn(`[Risk] Trade blocked due to high portfolio concentration`);
        }

        return {
            shouldTrade,
            maxPosition,
            suggestedTP,
            suggestedSL,
            timeHorizon,
            urgency,
        };
    }

    /**
     * Explain risk score
     */
    private explainRisk(
        overall: number,
        factors: {
            technical: TechnicalRisk;
            market: MarketRisk;
            pattern: PatternRisk;
            portfolio: PortfolioRisk;
        }
    ): string {
        const parts: string[] = [];

        parts.push(`Overall risk: ${overall.toFixed(1)}/100`);

        // Identify highest risk factor
        const risks = [
            { name: 'Technical', value: factors.technical.overall },
            { name: 'Market', value: factors.market.overall },
            { name: 'Pattern', value: factors.pattern.overall },
            { name: 'Portfolio', value: factors.portfolio.overall },
        ];

        const highest = risks.reduce((max, r) => (r.value > max.value ? r : max));
        parts.push(`Highest risk: ${highest.name} (${highest.value.toFixed(1)})`);

        // Add specific concerns
        if (factors.technical.contractSecurity > 60) {
            parts.push('Contract security concerns');
        }
        if (factors.pattern.pumpDumpRisk > 60) {
            parts.push('Pump & dump indicators detected');
        }
        if (factors.market.volumeRisk > 60) {
            parts.push('Low volume risk');
        }

        return parts.join('. ');
    }

    /**
     * Collect warnings
     */
    private collectWarnings(factors: {
        technical: TechnicalRisk;
        market: MarketRisk;
        pattern: PatternRisk;
        portfolio: PortfolioRisk;
    }): string[] {
        const warnings: string[] = [];

        if (factors.technical.contractSecurity > 70) {
            warnings.push('⚠️ High contract security risk');
        }

        if (factors.technical.liquidityRisk > 70) {
            warnings.push('⚠️ Low liquidity detected');
        }

        if (factors.pattern.pumpDumpRisk > 70) {
            warnings.push('🚨 Pump & dump pattern detected');
        }

        if (factors.pattern.whaleRisk > 70) {
            warnings.push('🐋 High whale concentration');
        }

        if (factors.market.volumeRisk > 70) {
            warnings.push('📉 Very low trading volume');
        }

        if (factors.portfolio.concentrationRisk > 70) {
            warnings.push('⚖️ High portfolio concentration');
        }

        return warnings;
    }

    /**
     * Update risk weights
     */
    updateWeights(weights: {
        technical?: number;
        market?: number;
        pattern?: number;
        portfolio?: number;
    }): void {
        this.weights = { ...this.weights, ...weights };

        // Normalize to sum to 1.0
        const sum = Object.values(this.weights).reduce((a, b) => a + b, 0);
        this.weights.technical /= sum;
        this.weights.market /= sum;
        this.weights.pattern /= sum;
        this.weights.portfolio /= sum;

        logger.info('[RiskScoring] Weights updated:', this.weights);
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
    }
}

// Singleton instance
let riskScoringInstance: RiskScoringSystem | null = null;

export function getRiskScoringSystem(
    connection: Connection,
    walletManager?: MultiWalletManager
): RiskScoringSystem {
    if (!riskScoringInstance) {
        let portfolioAnalyzer;
        if (walletManager) {
            portfolioAnalyzer = new PortfolioAnalyzer(connection, walletManager);
        }
        riskScoringInstance = new RiskScoringSystem(connection, portfolioAnalyzer);
    }
    // Inject dependencies if provided later
    else {
        if (walletManager && !(riskScoringInstance as any).portfolioAnalyzer) {
            const pa = new PortfolioAnalyzer(connection, walletManager);
            riskScoringInstance.setPortfolioAnalyzer(pa);
        }
    }
    return riskScoringInstance;
}
