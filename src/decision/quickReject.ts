// src/decision/quickReject.ts

/**
 * Quick Reject Optimizer
 * بهینه‌سازی برای rejection سریع tokens با ریسک بالا
 * 
 * هدف: <10ms latency برای 70-80% tokens
 * 
 * تکنیک‌ها:
 * - In-memory cache با Map (O(1) lookup)
 * - Critical thresholds برای fast-fail
 * - Early rejection logic
 */

import { PublicKey } from '@solana/web3.js';
import { logger } from '../logger';
import { isTokenBlacklisted, checkCreatorReputation, CreatorReputation } from '../risk/rugPullBlacklist';

export interface QuickRejectContext {
    mintAddress: string;
    creatorAddress: string;
    liquidityUSD?: number;
    slippage?: number;
    topHolderPercent?: number;
    buyerCount?: number;
    tokenAge?: number; // in milliseconds
}

export interface QuickRejectResult {
    shouldReject: boolean;
    reason?: string;
    latency: number;
    checksPassed: string[];
    checksFailed: string[];
}

export class QuickRejectOptimizer {
    // In-memory caches
    private blacklistCache: Map<string, boolean> = new Map();
    private creatorCache: Map<string, CreatorReputation> = new Map();

    // Cache TTL (5 minutes)
    private cacheTTL = 5 * 60 * 1000;
    private cacheTimestamps: Map<string, number> = new Map();

    // Critical thresholds برای rejection فوری
    private readonly CRITICAL_THRESHOLDS = {
        minLiquidity: 1000,        // USD
        maxSlippage: 99,           // %
        maxTopHolderPercent: 95,   // %
        minBuyerCount: 1,
        minTokenAge: 0             // ms (0 = no minimum)
    };

    // آمار
    private stats = {
        totalChecks: 0,
        rejections: 0,
        cacheHits: 0,
        totalLatency: 0
    };

    /**
     * بررسی سریع برای rejection
     */
    async quickReject(context: QuickRejectContext): Promise<QuickRejectResult> {
        const startTime = Date.now();
        this.stats.totalChecks++;

        const checksPassed: string[] = [];
        const checksFailed: string[] = [];

        try {
            // CHECK 1: Blacklist (cached, ~1ms)
            const blacklistResult = this.isBlacklistedCached(context.mintAddress);
            if (blacklistResult) {
                this.stats.rejections++;
                const latency = Date.now() - startTime;
                this.stats.totalLatency += latency;

                logger.debug(`[QuickReject] Token blacklisted (${latency}ms)`);

                return {
                    shouldReject: true,
                    reason: 'Token in blacklist',
                    latency,
                    checksPassed,
                    checksFailed: ['Blacklist check']
                };
            }
            checksPassed.push('Blacklist check');

            // CHECK 2: Creator blacklist (cached, ~1ms)
            const creatorResult = this.isCreatorBlacklistedCached(context.creatorAddress);
            if (creatorResult.isBlacklisted) {
                this.stats.rejections++;
                const latency = Date.now() - startTime;
                this.stats.totalLatency += latency;

                logger.debug(
                    `[QuickReject] Creator blacklisted ` +
                    `(${creatorResult.rugCount} rugs, ${latency}ms)`
                );

                return {
                    shouldReject: true,
                    reason: `Creator with ${creatorResult.rugCount} previous rug pulls`,
                    latency,
                    checksPassed,
                    checksFailed: ['Creator check']
                };
            }
            checksPassed.push('Creator check');

            // CHECK 3: Critical thresholds (~1ms)
            const thresholdResult = this.checkCriticalThresholds(context);
            if (thresholdResult.failed) {
                this.stats.rejections++;
                const latency = Date.now() - startTime;
                this.stats.totalLatency += latency;

                logger.debug(`[QuickReject] ${thresholdResult.reason} (${latency}ms)`);

                return {
                    shouldReject: true,
                    reason: thresholdResult.reason,
                    latency,
                    checksPassed,
                    checksFailed: [thresholdResult.failedCheck!]
                };
            }
            checksPassed.push('Critical thresholds');

            // همه checks passed
            const latency = Date.now() - startTime;
            this.stats.totalLatency += latency;

            logger.debug(`[QuickReject] All checks passed (${latency}ms)`);

            return {
                shouldReject: false,
                latency,
                checksPassed,
                checksFailed: []
            };

        } catch (error: any) {
            const latency = Date.now() - startTime;
            this.stats.totalLatency += latency;

            logger.error(`[QuickReject] Error: ${error.message}`);

            // در صورت خطا، conservative approach = reject
            return {
                shouldReject: true,
                reason: `Error during quick reject: ${error.message}`,
                latency,
                checksPassed,
                checksFailed: ['Error']
            };
        }
    }

    /**
     * بررسی blacklist با cache
     */
    private isBlacklistedCached(mintAddress: string): boolean {
        // بررسی cache
        if (this.isCacheValid(mintAddress)) {
            this.stats.cacheHits++;
            return this.blacklistCache.get(mintAddress)!;
        }

        // اگر cache expired یا وجود ندارد
        const result = isTokenBlacklisted(mintAddress);

        // ذخیره در cache
        this.blacklistCache.set(mintAddress, result.isBlacklisted);
        this.cacheTimestamps.set(mintAddress, Date.now());

        return result.isBlacklisted;
    }

    /**
     * بررسی creator blacklist با cache
     */
    private isCreatorBlacklistedCached(creatorAddress: string): CreatorReputation {
        const cacheKey = `creator_${creatorAddress}`;

        // بررسی cache
        if (this.isCacheValid(cacheKey)) {
            this.stats.cacheHits++;
            return this.creatorCache.get(cacheKey)!;
        }

        // اگر cache expired یا وجود ندارد
        const result = checkCreatorReputation(creatorAddress);

        // ذخیره در cache
        this.creatorCache.set(cacheKey, result);
        this.cacheTimestamps.set(cacheKey, Date.now());

        return result;
    }

    /**
     * بررسی اعتبار cache
     */
    private isCacheValid(key: string): boolean {
        const timestamp = this.cacheTimestamps.get(key);
        if (!timestamp) return false;

        return (Date.now() - timestamp) < this.cacheTTL;
    }

    /**
     * بررسی critical thresholds
     */
    private checkCriticalThresholds(context: QuickRejectContext): {
        failed: boolean;
        reason?: string;
        failedCheck?: string;
    } {
        // Liquidity check
        if (context.liquidityUSD !== undefined &&
            context.liquidityUSD < this.CRITICAL_THRESHOLDS.minLiquidity) {
            return {
                failed: true,
                reason: `Liquidity too low: $${context.liquidityUSD} (min: $${this.CRITICAL_THRESHOLDS.minLiquidity})`,
                failedCheck: 'Liquidity threshold'
            };
        }

        // Slippage check
        if (context.slippage !== undefined &&
            context.slippage > this.CRITICAL_THRESHOLDS.maxSlippage) {
            return {
                failed: true,
                reason: `Slippage too high: ${context.slippage}% (max: ${this.CRITICAL_THRESHOLDS.maxSlippage}%)`,
                failedCheck: 'Slippage threshold'
            };
        }

        // Top holder check
        if (context.topHolderPercent !== undefined &&
            context.topHolderPercent > this.CRITICAL_THRESHOLDS.maxTopHolderPercent) {
            return {
                failed: true,
                reason: `Top holder too concentrated: ${context.topHolderPercent}% (max: ${this.CRITICAL_THRESHOLDS.maxTopHolderPercent}%)`,
                failedCheck: 'Holder concentration'
            };
        }

        // Buyer count check
        if (context.buyerCount !== undefined &&
            context.buyerCount < this.CRITICAL_THRESHOLDS.minBuyerCount) {
            return {
                failed: true,
                reason: `Too few buyers: ${context.buyerCount} (min: ${this.CRITICAL_THRESHOLDS.minBuyerCount})`,
                failedCheck: 'Buyer count'
            };
        }

        return { failed: false };
    }

    /**
     * دریافت آمار
     */
    getStats() {
        const avgLatency = this.stats.totalChecks > 0
            ? this.stats.totalLatency / this.stats.totalChecks
            : 0;

        const rejectionRate = this.stats.totalChecks > 0
            ? this.stats.rejections / this.stats.totalChecks
            : 0;

        const cacheHitRate = this.stats.totalChecks > 0
            ? this.stats.cacheHits / this.stats.totalChecks
            : 0;

        return {
            totalChecks: this.stats.totalChecks,
            rejections: this.stats.rejections,
            rejectionRate: (rejectionRate * 100).toFixed(1) + '%',
            cacheHits: this.stats.cacheHits,
            cacheHitRate: (cacheHitRate * 100).toFixed(1) + '%',
            avgLatency: avgLatency.toFixed(2) + 'ms',
            cacheSize: this.blacklistCache.size + this.creatorCache.size
        };
    }

    /**
     * پاک کردن cache
     */
    clearCache(): void {
        this.blacklistCache.clear();
        this.creatorCache.clear();
        this.cacheTimestamps.clear();
        logger.info('[QuickReject] Cache cleared');
    }

    /**
     * ریست آمار
     */
    resetStats(): void {
        this.stats = {
            totalChecks: 0,
            rejections: 0,
            cacheHits: 0,
            totalLatency: 0
        };
        logger.info('[QuickReject] Stats reset');
    }

    /**
     * تنظیم critical thresholds
     */
    setThresholds(thresholds: Partial<typeof this.CRITICAL_THRESHOLDS>): void {
        Object.assign(this.CRITICAL_THRESHOLDS, thresholds);
        logger.info('[QuickReject] Thresholds updated:', this.CRITICAL_THRESHOLDS);
    }
}

// Singleton instance
let quickRejectInstance: QuickRejectOptimizer | null = null;

export function getQuickRejectOptimizer(): QuickRejectOptimizer {
    if (!quickRejectInstance) {
        quickRejectInstance = new QuickRejectOptimizer();
    }
    return quickRejectInstance;
}
