// src/validation/types.ts

/**
 * Validation layer types
 */

export interface ValidationScores {
    security: number;    // 0-100
    risk: number;        // 0-100
    ai: number;          // 0-100
    liquidity: number;   // 0-100
}

export type ValidationRecommendation = 'BUY' | 'SKIP' | 'WATCH';

export interface ValidationResult {
    approved: boolean;
    reason?: string;
    scores: ValidationScores;
    recommendation: ValidationRecommendation;
    details?: {
        securityIssues?: string[];
        riskFactors?: string[];
        aiReasoning?: string;
        liquidityInfo?: string;
    };
}

export interface ValidationConfig {
    minLiquidityUsd: number;
    minSecurityScore: number;
    minRiskScore: number;
    minAiScore: number;
    enableSecurityChecks: boolean;
    enableRiskFilter: boolean;
    enableAiValidation: boolean;
}
