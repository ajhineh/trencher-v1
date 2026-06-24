// src/trading/smartExit.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';
import { quickWhaleCheck } from '../analysis/whaleAnalyzer';
import { quickPumpDumpCheck } from '../analysis/pumpDumpDetector';
import { getTrailingStopLoss } from './trailingStopLoss';
import { getTokenHolders, calculateHolderDistribution } from '../api/heliusHolders';
import { sendTelegram } from '../telegram';

export interface SmartExitDecision {
    shouldExit: boolean;
    reason: string;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    confidence: number; // 0-100
    suggestedAction: 'HOLD' | 'SELL_PARTIAL' | 'SELL_ALL';
}

export interface PositionContext {
    baseMint: string;
    poolAddress: string;
    buyPriceInQuote: number;
    currentPriceInQuote: number;
    tpPercent: number;
    slPercent: number;
    holdTimeMs: number;
    liquiditySol?: number;

    // Security data (از زمان خرید)
    userBin?: string;
    sysBin?: string;
}

/**
 * تحلیل هوشمند برای تصمیم‌گیری خروج
 * این تابع از تحلیل‌های موجود استفاده می‌کند
 */
export async function analyzeSmartExit(
    connection: Connection,
    position: PositionContext
): Promise<SmartExitDecision> {

    const priceChange = ((position.currentPriceInQuote - position.buyPriceInQuote) / position.buyPriceInQuote) * 100;
    const holdTimeMinutes = position.holdTimeMs / (60 * 1000);

    logger.info(
        `[SMART-EXIT] Analyzing ${position.baseMint.slice(0, 8)}... | ` +
        `PnL: ${priceChange.toFixed(1)}% | Hold: ${holdTimeMinutes.toFixed(1)}m`
    );

    // ========================================
    // مرحله 0: بررسی Trailing Stop
    // ========================================

    const trailingSL = getTrailingStopLoss();

    // Initialize trailing if not exists
    if (!trailingSL.getState(position.baseMint)) {
        trailingSL.initializeTrailing({
            id: position.baseMint,
            pool: position.poolAddress,
            baseMint: position.baseMint,
            quoteMint: 'So11111111111111111111111111111111111111112',
            buySignature: '',
            buyAmountLamports: 0,
            buyPriceInQuote: position.buyPriceInQuote,
            tpPercent: position.tpPercent,
            slPercent: position.slPercent,
            openedAt: Date.now() - position.holdTimeMs,
            status: 'OPEN',
            userBin: position.userBin || '',
            sysBin: position.sysBin || '',
            tokenName: '',
            liquiditySol: position.liquiditySol || 0
        });
    }

    // Update trailing stop
    const trailingUpdate = trailingSL.updateTrailing(
        position.baseMint,
        position.currentPriceInQuote,
        position.buyPriceInQuote
    );

    if (trailingUpdate.shouldUpdate) {
        logger.info(
            `[TRAILING-SL] Updated: ${trailingUpdate.newSL.toFixed(6)} | ` +
            `Reason: ${trailingUpdate.reason}`
        );
    }

    // Check if trailing stop triggered
    if (trailingSL.shouldTriggerSL(position.baseMint, position.currentPriceInQuote)) {
        const state = trailingSL.getState(position.baseMint);
        const decision = {
            shouldExit: true,
            reason: `Trailing Stop triggered at ${position.currentPriceInQuote.toFixed(6)} (Peak: ${state?.peakPrice.toFixed(6)})`,
            urgency: 'HIGH' as const,
            confidence: 95,
            suggestedAction: 'SELL_ALL' as const
        };

        // Telegram notification for trailing stop
        await sendTelegram(
            `🎯 *TRAILING STOP TRIGGERED*\n` +
            `Token: ${position.baseMint.slice(0, 8)}...\n` +
            `Current: ${position.currentPriceInQuote.toFixed(6)}\n` +
            `Peak: ${state?.peakPrice.toFixed(6)}\n` +
            `Profit: +${priceChange.toFixed(1)}%`
        ).catch(() => { });

        return decision;
    }

    // ========================================
    // مرحله 1: بررسی TP/SL استاندارد
    // ========================================

    if (priceChange >= position.tpPercent) {
        return {
            shouldExit: true,
            reason: `Take Profit reached: +${priceChange.toFixed(1)}%`,
            urgency: 'MEDIUM',
            confidence: 100,
            suggestedAction: 'SELL_ALL'
        };
    }

    if (priceChange <= -position.slPercent) {
        return {
            shouldExit: true,
            reason: `Stop Loss triggered: ${priceChange.toFixed(1)}%`,
            urgency: 'HIGH',
            confidence: 100,
            suggestedAction: 'SELL_ALL'
        };
    }

    // ========================================
    // مرحله 2: تحلیل‌های پیشرفته
    // ========================================

    // 2.1) بررسی سریع Whale Risk
    // اگر داده‌های holder داشته باشیم
    let whaleRisk = false;
    let holderData: { top5Percent: number; largestPercent: number; totalHolders: number } | null = null;

    try {
        // در اینجا باید holder data واقعی بگیریم
        // برای سرعت، از تخمین استفاده می‌کنیم
        holderData = await getQuickHolderData(connection, position.baseMint);

        if (holderData) {
            whaleRisk = quickWhaleCheck(
                holderData.top5Percent,
                holderData.largestPercent,
                holderData.totalHolders
            );

            if (whaleRisk && priceChange > 10) {
                logger.warn(
                    `[SMART-EXIT] 🐋 Whale risk detected with +${priceChange.toFixed(1)}% profit`
                );
                return {
                    shouldExit: true,
                    reason: `Whale concentration + profit (${priceChange.toFixed(1)}%)`,
                    urgency: 'HIGH',
                    confidence: 80,
                    suggestedAction: 'SELL_ALL'
                };
            }

            if (whaleRisk && priceChange > 5) {
                return {
                    shouldExit: true,
                    reason: `Whale risk + small profit (${priceChange.toFixed(1)}%)`,
                    urgency: 'MEDIUM',
                    confidence: 70,
                    suggestedAction: 'SELL_PARTIAL'
                };
            }
        }
    } catch (error: any) {
        logger.debug(`[SMART-EXIT] Whale check skipped: ${error.message}`);
    }

    // 2.2) بررسی Pump & Dump (با داده واقعی)
    const pumpDumpRisk = await detectAdvancedPumpDump(
        connection,
        position.baseMint,
        position.liquiditySol || 0,
        position.holdTimeMs,
        priceChange,
        holderData
    );

    if (pumpDumpRisk && priceChange > 15) {
        logger.warn(
            `[SMART-EXIT] 🚨 Pump & Dump pattern with +${priceChange.toFixed(1)}% profit`
        );
        return {
            shouldExit: true,
            reason: `Pump & Dump detected + profit (${priceChange.toFixed(1)}%)`,
            urgency: 'CRITICAL',
            confidence: 85,
            suggestedAction: 'SELL_ALL'
        };
    }

    // 2.3) استراتژی زمان‌بندی (Time-based)
    const MAX_TRADE_DURATION = Number(process.env.MAX_TRADE_DURATION_MINUTES ?? 2);
    if (holdTimeMinutes >= MAX_TRADE_DURATION) {
        return {
            shouldExit: true,
            reason: `Hard Time Limit reached: ${holdTimeMinutes.toFixed(1)}m >= ${MAX_TRADE_DURATION}m`,
            urgency: 'HIGH',
            confidence: 100,
            suggestedAction: 'SELL_ALL'
        };
    }

    // اگر > 30 دقیقه نگه داشتیم و سود کمی داریم → بفروش
    if (holdTimeMinutes > 30 && priceChange > 5 && priceChange < position.tpPercent) {
        return {
            shouldExit: true,
            reason: `Long hold (${holdTimeMinutes.toFixed(0)}m) with small profit (${priceChange.toFixed(1)}%)`,
            urgency: 'LOW',
            confidence: 60,
            suggestedAction: 'SELL_ALL'
        };
    }

    // اگر > 60 دقیقه و هنوز سود نکردیم → احتمالاً dead token
    if (holdTimeMinutes > 60 && priceChange < 5) {
        return {
            shouldExit: true,
            reason: `Dead token - no movement after ${holdTimeMinutes.toFixed(0)}m`,
            urgency: 'MEDIUM',
            confidence: 75,
            suggestedAction: 'SELL_ALL'
        };
    }

    // 2.4) استراتژی Partial Exit

    // اگر سود خوبی داریم اما هنوز به TP نرسیدیم → فروش جزئی
    const halfwayToTP = position.tpPercent / 2;
    if (priceChange >= halfwayToTP && priceChange < position.tpPercent) {
        return {
            shouldExit: true,
            reason: `Halfway to TP (${priceChange.toFixed(1)}% of ${position.tpPercent}%) - secure partial profit`,
            urgency: 'LOW',
            confidence: 65,
            suggestedAction: 'SELL_PARTIAL'
        };
    }

    // 2.5) بررسی نوسانات شدید

    // اگر قیمت خیلی سریع بالا رفت → احتمال dump
    if (priceChange > 50 && holdTimeMinutes < 5) {
        logger.warn(
            `[SMART-EXIT] ⚡ Rapid pump detected: +${priceChange.toFixed(1)}% in ${holdTimeMinutes.toFixed(1)}m`
        );
        return {
            shouldExit: true,
            reason: `Rapid pump (+${priceChange.toFixed(1)}% in ${holdTimeMinutes.toFixed(1)}m) - likely dump incoming`,
            urgency: 'CRITICAL',
            confidence: 90,
            suggestedAction: 'SELL_ALL'
        };
    }

    // ========================================
    // مرحله 3: تصمیم نهایی - HOLD
    // ========================================

    // ========================================
    // مرحله نهایی: لاگ و نوتیفیکیشن
    // ========================================

    const decision = {
        shouldExit: false,
        reason: `Holding - PnL: ${priceChange.toFixed(1)}%, Time: ${holdTimeMinutes.toFixed(1)}m`,
        urgency: 'LOW' as const,
        confidence: 50,
        suggestedAction: 'HOLD' as const
    };

    // Log metrics
    logger.info(
        `[SMART-EXIT-METRICS] ` +
        `Decision: ${decision.suggestedAction} | ` +
        `Confidence: ${decision.confidence}% | ` +
        `Urgency: ${decision.urgency} | ` +
        `Reason: ${decision.reason}`
    );

    return decision;
}

/**
 * دریافت سریع داده‌های holder با Helius API
 */
async function getQuickHolderData(
    connection: Connection,
    mintAddress: string
): Promise<{
    top5Percent: number;
    largestPercent: number;
    totalHolders: number;
} | null> {
    try {
        // Get total supply
        const mintPubkey = new PublicKey(mintAddress);
        const supplyInfo = await connection.getTokenSupply(mintPubkey);
        const totalSupply = parseInt(supplyInfo.value.amount);

        // Get holders from Helius
        const holdersData = await getTokenHolders(mintAddress, 20);

        if (!holdersData || holdersData.result.length === 0) {
            logger.debug(`[SMART-EXIT] No holder data available for ${mintAddress.slice(0, 8)}...`);
            return null;
        }

        // Calculate distribution
        const distribution = calculateHolderDistribution(holdersData.result, totalSupply);

        logger.debug(
            `[SMART-EXIT] Holder data: ${distribution.totalHolders} holders, ` +
            `Top: ${distribution.largestPercent.toFixed(1)}%, ` +
            `Top5: ${distribution.top5Percent.toFixed(1)}%`
        );

        return distribution;

    } catch (error: any) {
        logger.debug(`[SMART-EXIT] Holder data failed: ${error.message}`);
        return null;
    }
}

/**
 * تشخیص پیشرفته Pump & Dump با داده‌های واقعی
 */
async function detectAdvancedPumpDump(
    connection: Connection,
    mintAddress: string,
    liquiditySol: number,
    holdTimeMs: number,
    priceChange: number,
    holderData: { top5Percent: number; largestPercent: number; totalHolders: number } | null
): Promise<boolean> {
    try {
        const signals: string[] = [];
        const holdTimeMinutes = holdTimeMs / (60 * 1000);

        // Use holder data if available
        if (holderData) {
            // Signal 1: Very few holders
            if (holderData.totalHolders < 10) {
                signals.push('few-holders');
            }

            // Signal 2: High whale concentration
            if (holderData.top5Percent > 70) {
                signals.push('whale-concentration');
            }
        }

        // Signal 3: Rapid price increase
        if (priceChange > 50 && holdTimeMinutes < 10) {
            signals.push('rapid-pump');
        }

        // Signal 4: Low liquidity
        if (liquiditySol < 5) {
            signals.push('low-liquidity');
        }

        // Risk if 3+ signals
        const isPumpDump = signals.length >= 3;

        if (isPumpDump) {
            logger.warn(
                `[PUMP-DUMP] Detected! Signals: ${signals.join(', ')} | ` +
                `Holders: ${holderData?.totalHolders || 'N/A'}, ` +
                `Top5: ${holderData?.top5Percent.toFixed(1) || 'N/A'}%`
            );
        }

        return isPumpDump;

    } catch (error: any) {
        logger.debug(`[PUMP-DUMP] Detection failed: ${error.message}`);
        // Fallback to simple check
        return quickPumpDumpCheck(liquiditySol, 10, holdTimeMs, 5);
    }
}

/**
 * محاسبه مقدار فروش بر اساس suggested action
 */
export function calculateSellAmount(
    totalBalance: number,
    suggestedAction: SmartExitDecision['suggestedAction']
): number {
    switch (suggestedAction) {
        case 'SELL_ALL':
            return totalBalance;

        case 'SELL_PARTIAL':
            // فروش 50% برای secure کردن سود
            return Math.floor(totalBalance * 0.5);

        case 'HOLD':
        default:
            return 0;
    }
}

/**
 * لاگ تصمیم Smart Exit
 */
export function logExitDecision(
    decision: SmartExitDecision,
    position: PositionContext
): void {
    const emoji = {
        'CRITICAL': '🚨',
        'HIGH': '⚠️',
        'MEDIUM': '📊',
        'LOW': 'ℹ️'
    }[decision.urgency];

    const actionEmoji = {
        'SELL_ALL': '💰',
        'SELL_PARTIAL': '📉',
        'HOLD': '🤝'
    }[decision.suggestedAction];

    logger.info(
        `[SMART-EXIT] ${emoji} ${actionEmoji} ${decision.suggestedAction} | ` +
        `${decision.reason} | Confidence: ${decision.confidence}%`
    );
}
