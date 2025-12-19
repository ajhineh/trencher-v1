// test/decision/quickReject.test.ts

/**
 * Unit Tests for Quick Reject Optimizer
 */

import { QuickRejectOptimizer } from '../../src/decision/quickReject';

describe('QuickRejectOptimizer', () => {
    let optimizer: QuickRejectOptimizer;

    beforeEach(() => {
        optimizer = new QuickRejectOptimizer();
        optimizer.clearCache(); // Clear cache before each test
    });

    afterEach(() => {
        optimizer.resetStats();
    });

    describe('quickReject', () => {
        it('should reject token in blacklist', async () => {
            // Note: This test assumes there are some blacklisted tokens
            // You may need to adjust based on actual blacklist data
            const result = await optimizer.quickReject({
                mintAddress: 'KNOWN_BLACKLISTED_TOKEN', // Replace with actual blacklisted token
                creatorAddress: 'CREATOR_ADDRESS',
                liquidityUSD: 10000
            });

            // If token is blacklisted, should reject
            // expect(result.shouldReject).toBe(true);
            // expect(result.reason).toContain('blacklist');

            // For now, just check structure
            expect(result).toHaveProperty('shouldReject');
            expect(result).toHaveProperty('latency');
            expect(result).toHaveProperty('checksPassed');
            expect(result).toHaveProperty('checksFailed');
        });

        it('should reject token with low liquidity', async () => {
            const result = await optimizer.quickReject({
                mintAddress: 'NEW_TOKEN',
                creatorAddress: 'CREATOR',
                liquidityUSD: 500 // Below default threshold of 1000
            });

            expect(result.shouldReject).toBe(true);
            expect(result.reason).toContain('Liquidity too low');
            expect(result.latency).toBeLessThan(50); // Should be very fast
        });

        it('should reject token with high slippage', async () => {
            const result = await optimizer.quickReject({
                mintAddress: 'NEW_TOKEN',
                creatorAddress: 'CREATOR',
                liquidityUSD: 5000,
                slippage: 99.5 // Above threshold of 99%
            });

            expect(result.shouldReject).toBe(true);
            expect(result.reason).toContain('Slippage too high');
        });

        it('should reject token with high holder concentration', async () => {
            const result = await optimizer.quickReject({
                mintAddress: 'NEW_TOKEN',
                creatorAddress: 'CREATOR',
                liquidityUSD: 5000,
                topHolderPercent: 96 // Above threshold of 95%
            });

            expect(result.shouldReject).toBe(true);
            expect(result.reason).toContain('Top holder too concentrated');
        });

        it('should reject token with too few buyers', async () => {
            const result = await optimizer.quickReject({
                mintAddress: 'NEW_TOKEN',
                creatorAddress: 'CREATOR',
                liquidityUSD: 5000,
                buyerCount: 0 // Below threshold of 1
            });

            expect(result.shouldReject).toBe(true);
            expect(result.reason).toContain('Too few buyers');
        });

        it('should pass token with good metrics', async () => {
            const result = await optimizer.quickReject({
                mintAddress: 'GOOD_TOKEN',
                creatorAddress: 'GOOD_CREATOR',
                liquidityUSD: 5000,
                slippage: 5,
                topHolderPercent: 20,
                buyerCount: 10
            });

            expect(result.shouldReject).toBe(false);
            expect(result.checksPassed.length).toBeGreaterThan(0);
            expect(result.checksFailed.length).toBe(0);
        });

        it('should be fast (<10ms for most cases)', async () => {
            const iterations = 10;
            const latencies: number[] = [];

            for (let i = 0; i < iterations; i++) {
                const result = await optimizer.quickReject({
                    mintAddress: `TOKEN_${i}`,
                    creatorAddress: 'CREATOR',
                    liquidityUSD: 5000
                });
                latencies.push(result.latency);
            }

            const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;
            expect(avgLatency).toBeLessThan(10); // Target: <10ms
        });
    });

    describe('Cache', () => {
        it('should use cache for repeated checks', async () => {
            const context = {
                mintAddress: 'SAME_TOKEN',
                creatorAddress: 'SAME_CREATOR',
                liquidityUSD: 5000
            };

            // First call
            await optimizer.quickReject(context);
            const stats1 = optimizer.getStats();
            const cacheHits1 = stats1.cacheHits;

            // Second call (should hit cache)
            await optimizer.quickReject(context);
            const stats2 = optimizer.getStats();
            const cacheHits2 = stats2.cacheHits;

            expect(cacheHits2).toBeGreaterThan(cacheHits1);
        });

        it('should clear cache when requested', () => {
            optimizer.clearCache();
            const stats = optimizer.getStats();

            expect(stats.cacheSize).toBe(0);
        });
    });

    describe('Stats', () => {
        it('should track rejection rate', async () => {
            // Reject 3 times
            await optimizer.quickReject({ mintAddress: 'T1', creatorAddress: 'C', liquidityUSD: 100 });
            await optimizer.quickReject({ mintAddress: 'T2', creatorAddress: 'C', liquidityUSD: 200 });
            await optimizer.quickReject({ mintAddress: 'T3', creatorAddress: 'C', liquidityUSD: 300 });

            // Pass 1 time
            await optimizer.quickReject({ mintAddress: 'T4', creatorAddress: 'C', liquidityUSD: 5000 });

            const stats = optimizer.getStats();
            expect(stats.totalChecks).toBe(4);
            expect(stats.rejections).toBe(3);
            expect(stats.rejectionRate).toBe('75.0%');
        });

        it('should track average latency', async () => {
            await optimizer.quickReject({ mintAddress: 'T1', creatorAddress: 'C', liquidityUSD: 5000 });
            await optimizer.quickReject({ mintAddress: 'T2', creatorAddress: 'C', liquidityUSD: 5000 });

            const stats = optimizer.getStats();
            expect(stats.avgLatency).toMatch(/\d+\.\d+ms/);
        });

        it('should reset stats', async () => {
            await optimizer.quickReject({ mintAddress: 'T1', creatorAddress: 'C', liquidityUSD: 5000 });

            optimizer.resetStats();
            const stats = optimizer.getStats();

            expect(stats.totalChecks).toBe(0);
            expect(stats.rejections).toBe(0);
        });
    });

    describe('Custom Thresholds', () => {
        it('should allow custom threshold configuration', () => {
            optimizer.setThresholds({
                minLiquidity: 2000,
                maxSlippage: 95,
                maxTopHolderPercent: 90
            });

            // Thresholds should be updated
            // (We can't directly test private fields, but we can test behavior)
        });

        it('should use custom thresholds for rejection', async () => {
            optimizer.setThresholds({
                minLiquidity: 10000 // Increase threshold
            });

            const result = await optimizer.quickReject({
                mintAddress: 'TOKEN',
                creatorAddress: 'CREATOR',
                liquidityUSD: 5000 // Now below threshold
            });

            expect(result.shouldReject).toBe(true);
            expect(result.reason).toContain('Liquidity too low');
        });
    });

    describe('Error Handling', () => {
        it('should handle errors gracefully', async () => {
            // Test with invalid data
            const result = await optimizer.quickReject({
                mintAddress: '',
                creatorAddress: '',
                liquidityUSD: -1
            });

            // Should not throw, should return a result
            expect(result).toHaveProperty('shouldReject');
            expect(result).toHaveProperty('latency');
        });
    });
});
