// src/futures/ai/riskAssessor.ts

/**
 * Risk Assessor
 * Assesses trading risks
 */

import { RiskAssessment, MarketContext, Portfolio } from './types';
import { OrderFlowSignal } from '../orderflow/types';

export class RiskAssessor {
    /**
     * Assess overall risk
     */
    async assessRisk(
        signal: OrderFlowSignal,
        context: MarketContext,
        portfolio: Portfolio
    ): Promise<RiskAssessment> {
        // 1. Calculate individual risks
        const liquidationRisk = this.calculateLiquidationRisk(
            signal.entry,
            signal.leverage || 5
        );

        const portfolioRisk = this.calculatePortfolioRisk(
            signal,
            portfolio
        );

        const marketRisk = this.calculateMarketRisk(context);

        // 2. Determine overall risk
        const overallRisk = this.determineOverallRisk({
            liquidationRisk,
            portfolioRisk,
            marketRisk
        });

        // 3. Make recommendations
        const recommendation = this.makeRecommendation(overallRisk, context);
        const maxLeverage = this.calculateMaxLeverage(overallRisk, context);
        const maxPositionSize = this.calculateMaxPosition(overallRisk, portfolio);

        // 4. Generate reasoning
        const reasoning = this.generateReasoning({
            liquidationRisk,
            portfolioRisk,
            marketRisk,
            overallRisk,
            context
        });

        return {
            overallRisk,
            liquidationRisk,
            portfolioRisk,
            marketRisk,
            recommendation,
            maxLeverage,
            maxPositionSize,
            reasoning
        };
    }

    /**
     * Calculate liquidation risk
     */
    private calculateLiquidationRisk(entry: number, leverage: number): number {
        // Distance to liquidation = 1 / leverage
        const liquidationDistance = (1 / leverage) * 100;

        // Risk score: closer to liquidation = higher risk
        // 5x leverage = 20% distance = 80 risk score
        // 3x leverage = 33% distance = 67 risk score
        // 2x leverage = 50% distance = 50 risk score

        return Math.min(100, 100 - liquidationDistance);
    }

    /**
     * Calculate portfolio risk
     */
    private calculatePortfolioRisk(
        signal: OrderFlowSignal,
        portfolio: Portfolio
    ): number {
        const positionValue = signal.entry * (signal.positionSize || 0.5);
        const leverage = signal.leverage || 5;
        const exposure = positionValue * leverage;

        // Risk based on portfolio exposure
        const exposureRatio = (portfolio.totalExposure + exposure) / portfolio.totalValue;

        // 0-50% exposure = low risk (0-30)
        // 50-100% exposure = medium risk (30-60)
        // 100-200% exposure = high risk (60-90)
        // >200% exposure = extreme risk (90-100)

        if (exposureRatio < 0.5) return exposureRatio * 60;
        if (exposureRatio < 1.0) return 30 + (exposureRatio - 0.5) * 60;
        if (exposureRatio < 2.0) return 60 + (exposureRatio - 1.0) * 30;
        return Math.min(100, 90 + (exposureRatio - 2.0) * 10);
    }

    /**
     * Calculate market risk
     */
    private calculateMarketRisk(context: MarketContext): number {
        let risk = 30; // Base risk

        // Volatility impact
        if (context.volatility === 'EXTREME') risk += 40;
        else if (context.volatility === 'HIGH') risk += 25;
        else if (context.volatility === 'MEDIUM') risk += 10;

        // Market phase impact
        if (context.marketPhase === 'DISTRIBUTION') risk += 15;
        else if (context.marketPhase === 'MARKDOWN') risk += 20;

        // Volume impact
        if (context.volume === 'LOW') risk += 10;

        return Math.min(100, risk);
    }

    /**
     * Determine overall risk level
     */
    private determineOverallRisk(risks: {
        liquidationRisk: number;
        portfolioRisk: number;
        marketRisk: number;
    }): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
        // Weighted average
        const overall = (
            risks.liquidationRisk * 0.4 +
            risks.portfolioRisk * 0.3 +
            risks.marketRisk * 0.3
        );

        if (overall < 30) return 'LOW';
        if (overall < 60) return 'MEDIUM';
        if (overall < 80) return 'HIGH';
        return 'EXTREME';
    }

    /**
     * Make recommendation
     */
    private makeRecommendation(
        risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME',
        context: MarketContext
    ): 'PROCEED' | 'REDUCE_SIZE' | 'SKIP' {
        if (risk === 'EXTREME') return 'SKIP';
        if (risk === 'HIGH') return 'REDUCE_SIZE';

        // Additional checks
        if (context.volatility === 'EXTREME') return 'SKIP';
        if (context.marketPhase === 'MARKDOWN' && risk === 'MEDIUM') return 'REDUCE_SIZE';

        return 'PROCEED';
    }

    /**
     * Calculate maximum safe leverage
     */
    private calculateMaxLeverage(
        risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME',
        context: MarketContext
    ): number {
        let maxLeverage = 5;

        // Reduce based on risk
        if (risk === 'EXTREME') maxLeverage = 1;
        else if (risk === 'HIGH') maxLeverage = 2;
        else if (risk === 'MEDIUM') maxLeverage = 3;

        // Further reduce based on volatility
        if (context.volatility === 'EXTREME') maxLeverage = Math.min(maxLeverage, 2);
        else if (context.volatility === 'HIGH') maxLeverage = Math.min(maxLeverage, 3);

        return maxLeverage;
    }

    /**
     * Calculate maximum position size
     */
    private calculateMaxPosition(
        risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME',
        portfolio: Portfolio
    ): number {
        const baseSize = portfolio.availableBalance * 0.02; // 2% of balance

        if (risk === 'LOW') return baseSize * 2;
        if (risk === 'MEDIUM') return baseSize;
        if (risk === 'HIGH') return baseSize * 0.5;
        return baseSize * 0.25;
    }

    /**
     * Generate reasoning
     */
    private generateReasoning(data: any): string[] {
        const reasons: string[] = [];

        // Liquidation risk
        if (data.liquidationRisk > 80) {
            reasons.push('⚠️ Very high liquidation risk - reduce leverage');
        } else if (data.liquidationRisk > 60) {
            reasons.push('⚠️ High liquidation risk - use caution');
        }

        // Portfolio risk
        if (data.portfolioRisk > 70) {
            reasons.push('⚠️ Portfolio overexposed - reduce position size');
        }

        // Market risk
        if (data.marketRisk > 70) {
            reasons.push('⚠️ High market risk - volatile conditions');
        }

        // Context-based
        if (data.context.volatility === 'EXTREME') {
            reasons.push('⚠️ Extreme volatility detected');
        }

        if (data.context.volume === 'LOW') {
            reasons.push('⚠️ Low volume - potential slippage');
        }

        if (reasons.length === 0) {
            reasons.push('✅ Risk levels acceptable');
        }

        return reasons;
    }
}
