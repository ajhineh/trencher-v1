// src/futures/ai/types.ts

/**
 * AI Trading Agent - Type Definitions
 */

export interface MarketContext {
    trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
    volatility: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    volume: 'LOW' | 'MEDIUM' | 'HIGH';
    marketPhase: 'ACCUMULATION' | 'DISTRIBUTION' | 'MARKUP' | 'MARKDOWN' | 'CONSOLIDATION';
    sentiment: 'FEAR' | 'GREED' | 'NEUTRAL';
    newsImpact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

export interface RiskAssessment {
    overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    liquidationRisk: number;  // 0-100
    portfolioRisk: number;    // 0-100
    marketRisk: number;       // 0-100
    recommendation: 'PROCEED' | 'REDUCE_SIZE' | 'SKIP';
    maxLeverage: number;
    maxPositionSize: number;
    reasoning: string[];
}

export interface AnomalyDetection {
    detected: boolean;
    type: 'MANIPULATION' | 'FLASH_CRASH' | 'UNUSUAL_VOLUME' | 'NONE';
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    recommendation: 'WAIT' | 'PROCEED_CAUTIOUSLY' | 'ABORT';
    details: string[];
}

export interface AIDecision {
    shouldTrade: boolean;
    confidence: number;  // 0-100
    reasoning: string[];
    adjustedParams: {
        leverage: number;
        positionSize: number;
        stopLoss: number;
        takeProfit: number[];
    };
    warnings: string[];
    context: MarketContext;
    riskAssessment: RiskAssessment;
    anomalies: AnomalyDetection;
}

export interface RecentMarketData {
    prices: number[];
    volumes: number[];
    timestamps: number[];
}

export interface Portfolio {
    totalValue: number;
    availableBalance: number;
    openPositions: number;
    totalExposure: number;
}
