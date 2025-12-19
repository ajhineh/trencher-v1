// src/sniper/types.ts

/**
 * AI Sniper - Type Definitions
 */

import { PublicKey } from '@solana/web3.js';

export type SniperMode = 'CONSERVATIVE' | 'NORMAL';

export interface SniperConfig {
    maxBuyAmount: number;           // SOL
    minLiquidity: number;            // SOL
    maxSlippage: number;             // bps
    aiConfidenceThreshold: number;   // 0-100
    enableRugPullProtection: boolean;
    jitoTipAmount: number;           // SOL for emergency exits

    // Sniper Mode
    mode: SniperMode;

    // Conservative Mode Thresholds
    conservativeThresholds: {
        minConfidence: number;      // 85
        minLiquidity: number;       // 20 SOL
        maxRiskLevel: 'LOW';
    };

    // Normal Mode Thresholds
    normalThresholds: {
        minConfidence: number;      // 60
        minLiquidity: number;       // 10 SOL
        maxRiskLevel: 'LOW' | 'MEDIUM';
        minActiveBuyers: number;    // 5 (in last 60s)
        buyerWindowSeconds: number; // 60
    };

    // Duplicate Buy
    enableDuplicateBuy: boolean;
    duplicateBuyWalletCount: number;  // 1-10
    duplicateBuyAmount: number;       // SOL per wallet

    // Exit Strategy
    exitStrategy: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'HYBRID';
    takeProfitPercent: number;
    stopLossPercent: number;
    trailingStopPercent: number;
    trailingActivationPercent: number;

    // Smart Fees
    enableSmartFees: boolean;
    feeUrgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    maxFeeMicroLamports: number;
    fallbackFeeMicroLamports: number;
}

export interface TokenOpportunity {
    mint: PublicKey;
    poolKey: PublicKey;
    liquidity: number;
    creatorAddress: PublicKey;
    timestamp: number;
    metadata?: {
        name: string;
        symbol: string;
        decimals: number;
    };
    marketCap?: number;
    initialBuyAmount?: number;
}

export interface AIAnalysisResult {
    shouldBuy: boolean;
    confidence: number;
    reasons: string[];
    suggestedAmount: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface SniperResult {
    success: boolean;
    txSignature?: string;
    aiDecision: AIAnalysisResult;
    error?: string;
}

export interface MonitoringState {
    mint: PublicKey;
    creatorAddress: PublicKey;
    poolKey: PublicKey;
    topHolders: TopHolder[];
    initialBuyerCount: number;
    lastCheck: number;
    purchasePrice: number;
    tokenAmount: number;
}

export interface TopHolder {
    address: PublicKey;
    balance: number;
    percentage: number;
}

export interface RugPullSignal {
    type: 'CREATOR_REMOVE' | 'WHALE_REMOVE' | 'BUYER_DROP' | 'LIQUIDITY_DROP';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    confidence: number;
    action: 'MONITOR' | 'REDUCE' | 'EXIT_IMMEDIATELY';
    details: string;
}
