// src/sniper/config/loadSniperConfig.ts

/**
 * Load Sniper Configuration from Environment Variables
 */

import { SniperConfig, SniperMode } from '../types';
import { logger } from '../../logger';

export function loadSniperConfig(): SniperConfig {
    const config: SniperConfig = {
        // Basic settings
        maxBuyAmount: Number(process.env.MAX_BUY_AMOUNT || '0.1'),
        minLiquidity: Number(process.env.MIN_LIQUIDITY || '10'),
        maxSlippage: Number(process.env.MAX_SLIPPAGE || '500'),
        aiConfidenceThreshold: Number(process.env.AI_CONFIDENCE_THRESHOLD || '70'),
        enableRugPullProtection: process.env.ENABLE_RUG_PULL_PROTECTION !== 'false',
        jitoTipAmount: Number(process.env.JITO_TIP_AMOUNT || '0.001'),

        // Sniper Mode
        mode: (process.env.SNIPER_MODE as SniperMode) || 'NORMAL',

        // Conservative Mode Thresholds
        conservativeThresholds: {
            minConfidence: Number(process.env.CONSERVATIVE_MIN_CONFIDENCE || '85'),
            minLiquidity: Number(process.env.CONSERVATIVE_MIN_LIQUIDITY || '20'),
            maxRiskLevel: 'LOW'
        },

        // Normal Mode Thresholds
        normalThresholds: {
            minConfidence: Number(process.env.NORMAL_MIN_CONFIDENCE || '60'),
            minLiquidity: Number(process.env.NORMAL_MIN_LIQUIDITY || '10'),
            maxRiskLevel: 'MEDIUM',
            minActiveBuyers: Number(process.env.NORMAL_MIN_ACTIVE_BUYERS || '5'),
            buyerWindowSeconds: Number(process.env.NORMAL_BUYER_WINDOW_SECONDS || '60')
        },

        // Duplicate Buy
        enableDuplicateBuy: process.env.ENABLE_DUPLICATE_BUY === 'true',
        duplicateBuyWalletCount: Number(process.env.DUPLICATE_BUY_WALLET_COUNT || '3'),
        duplicateBuyAmount: Number(process.env.DUPLICATE_BUY_AMOUNT || '0.01'),

        // Exit Strategy
        exitStrategy: (process.env.EXIT_STRATEGY as any) || 'HYBRID',
        takeProfitPercent: Number(process.env.TAKE_PROFIT_PERCENT || '50'),
        stopLossPercent: Number(process.env.STOP_LOSS_PERCENT || '30'),
        trailingStopPercent: Number(process.env.TRAILING_STOP_PERCENT || '20'),
        trailingActivationPercent: Number(process.env.TRAILING_ACTIVATION_PERCENT || '30'),

        // Smart Fees
        enableSmartFees: process.env.ENABLE_SMART_FEES === 'true',
        feeUrgency: (process.env.FEE_URGENCY as any) || 'VERY_HIGH',
        maxFeeMicroLamports: Number(process.env.MAX_FEE_MICROLAMPORTS || '200000'),
        fallbackFeeMicroLamports: Number(process.env.FALLBACK_FEE_MICROLAMPORTS || '80000')
    };

    // Log configuration
    logger.info('📋 Sniper Configuration Loaded:');
    logger.info(`   Mode: ${config.mode}`);
    logger.info(`   Exit Strategy: ${config.exitStrategy}`);
    logger.info(`   Duplicate Buy: ${config.enableDuplicateBuy ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`   Smart Fees: ${config.enableSmartFees ? 'ENABLED' : 'DISABLED'}`);

    if (config.mode === 'CONSERVATIVE') {
        logger.info(`   Conservative Confidence: ${config.conservativeThresholds.minConfidence}%`);
    } else {
        logger.info(`   Normal Confidence: ${config.normalThresholds.minConfidence}%`);
        logger.info(`   Min Active Buyers: ${config.normalThresholds.minActiveBuyers}`);
    }

    return config;
}
