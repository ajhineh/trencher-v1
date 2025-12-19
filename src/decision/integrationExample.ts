// src/decision/integrationExample.ts

/**
 * Integration Example: نحوه استفاده از Confidence Router در Sniper Bot
 * 
 * این فایل نمونه‌ای از نحوه integration است.
 * برای استفاده واقعی، این منطق را در sniper-bot.ts پیاده‌سازی کنید.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';
import { getConfidenceRouter, TokenContext } from './confidenceRouter';
import { getQuickRejectOptimizer } from './quickReject';

/**
 * مثال: Integration در handleLogNotification
 * 
 * این تابع نشان می‌دهد چگونه می‌توانید سیستم جدید را
 * در جریان فعلی sniper-bot ادغام کنید.
 */
export async function handleTokenDetectionWithConfidenceRouter(
    connection: Connection,
    tokenMint: string,
    creatorAddress: string,
    metadata: any,
    poolInfo: {
        liquidityUSD: number;
        solAmount: number;
        tokenAmount: number;
    }
): Promise<{
    shouldBuy: boolean;
    reason: string;
    confidence: number;
    latency: number;
}> {
    const totalStartTime = Date.now();

    try {
        // STEP 1: Quick Reject (target: <10ms)
        // این بررسی‌های سریع را قبل از هر چیز دیگری انجام دهید
        const quickReject = getQuickRejectOptimizer();

        const rejectResult = await quickReject.quickReject({
            mintAddress: tokenMint,
            creatorAddress: creatorAddress,
            liquidityUSD: poolInfo.liquidityUSD,
            slippage: undefined, // محاسبه می‌شود در مراحل بعد
            topHolderPercent: undefined,
            buyerCount: undefined
        });

        if (rejectResult.shouldReject) {
            logger.info(
                `[QUICK-REJECT] ${rejectResult.reason} ` +
                `(latency: ${rejectResult.latency}ms)`
            );

            return {
                shouldBuy: false,
                reason: rejectResult.reason!,
                confidence: 1.0, // high confidence rejection
                latency: Date.now() - totalStartTime
            };
        }

        logger.info(
            `[QUICK-REJECT] Passed all checks ` +
            `(latency: ${rejectResult.latency}ms)`
        );

        // STEP 2: Build Token Context
        // جمع‌آوری اطلاعات کامل برای Confidence Router
        const context: TokenContext = {
            mintAddress: tokenMint,
            creatorAddress: creatorAddress,
            createdAtMs: Date.now(), // در واقعیت از blockTime استفاده کنید
            liquidityUSD: poolInfo.liquidityUSD,
            topHolderPercent: undefined, // باید محاسبه شود
            top5HolderPercent: undefined,
            buyerCountLast5Min: undefined,
            slippagePercent: undefined,
            metadata: metadata,
            topHolders: undefined
        };

        // STEP 3: Confidence-Based Routing
        const router = getConfidenceRouter(connection);
        const decision = await router.route(tokenMint, context);

        logger.info(
            `[DECISION] Action: ${decision.action}, ` +
            `Confidence: ${(decision.confidence.overall * 100).toFixed(1)}%, ` +
            `Method: ${decision.method}, ` +
            `Risk: ${decision.riskScore.toFixed(1)}, ` +
            `Latency: ${decision.latency}ms`
        );

        // STEP 4: Execute based on decision
        const totalLatency = Date.now() - totalStartTime;

        if (decision.action === 'ALLOW') {
            return {
                shouldBuy: true,
                reason: decision.reason,
                confidence: decision.confidence.overall,
                latency: totalLatency
            };
        } else if (decision.action === 'PROBE') {
            // PROBE = خرید با مقدار کمتر
            logger.info('[DECISION] PROBE mode - consider smaller position size');
            return {
                shouldBuy: true, // می‌توانید با مقدار کمتر بخرید
                reason: `${decision.reason} (PROBE mode)`,
                confidence: decision.confidence.overall,
                latency: totalLatency
            };
        } else {
            // BLOCK
            return {
                shouldBuy: false,
                reason: decision.reason,
                confidence: decision.confidence.overall,
                latency: totalLatency
            };
        }

    } catch (error: any) {
        logger.error(`[INTEGRATION] Error: ${error.message}`);

        // در صورت خطا، conservative approach
        return {
            shouldBuy: false,
            reason: `Error: ${error.message}`,
            confidence: 0,
            latency: Date.now() - totalStartTime
        };
    }
}

/**
 * مثال استفاده در sniper-bot.ts:
 * 
 * // در handleLogNotification، بعد از extractTransactionInfo:
 * 
 * const decision = await handleTokenDetectionWithConfidenceRouter(
 *   connection,
 *   newPoolTokenMint,
 *   creatorAddress,
 *   tokenMetadata,
 *   {
 *     liquidityUSD: totalLiquidityUSD,
 *     solAmount: solAmount,
 *     tokenAmount: tokenAmount
 *   }
 * );
 * 
 * if (decision.shouldBuy) {
 *   logger.info(`[BUY] Approved by Confidence Router (${decision.latency}ms)`);
 *   
 *   // اجرای خرید
 *   const buySig = await buyWithPumpSdk(mintPubkey, poolInfo);
 *   
 *   // ادامه جریان فعلی...
 * } else {
 *   logger.info(`[SKIP] Rejected: ${decision.reason}`);
 *   return;
 * }
 */

/**
 * Performance Stats Helper
 * برای monitoring عملکرد سیستم جدید
 */
export function logPerformanceStats(connection: Connection): void {
    const router = getConfidenceRouter(connection);
    const quickReject = getQuickRejectOptimizer();

    const routerStats = router.getStats();
    const rejectStats = quickReject.getStats();

    logger.info('=== Performance Stats ===');
    logger.info('Router:');
    logger.info(`  Total Decisions: ${routerStats.totalDecisions}`);
    logger.info(`  Method Distribution:`);
    logger.info(`    Quick Rules: ${routerStats.methodPercentages.quickRules}`);
    logger.info(`    Fast Classifier: ${routerStats.methodPercentages.fastClassifier}`);
    logger.info(`    DQN: ${routerStats.methodPercentages.dqn}`);
    logger.info(`    Conservative: ${routerStats.methodPercentages.conservative}`);
    logger.info(`  Avg Latency: ${routerStats.avgLatency}`);

    logger.info('Quick Reject:');
    logger.info(`  Total Checks: ${rejectStats.totalChecks}`);
    logger.info(`  Rejections: ${rejectStats.rejections} (${rejectStats.rejectionRate})`);
    logger.info(`  Cache Hit Rate: ${rejectStats.cacheHitRate}`);
    logger.info(`  Avg Latency: ${rejectStats.avgLatency}`);
    logger.info('========================');
}
