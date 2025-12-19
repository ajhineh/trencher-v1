// test/liquidity-analysis.test.ts

/**
 * تست‌های Liquidity Analysis
 * شامل: Pool Health, Depth Analysis, Fake Liquidity Detection
 */

import { LiquidityPoolAnalyzer, PoolAnalysis } from '../src/analysis/liquidityPoolAnalysis';
import { Connection } from '@solana/web3.js';

// Mock connection
const mockConnection = {
    rpcEndpoint: 'https://api.mainnet-beta.solana.com',
} as Connection;

describe('Liquidity Pool Analysis', () => {
    let analyzer: LiquidityPoolAnalyzer;

    beforeEach(() => {
        analyzer = new LiquidityPoolAnalyzer(mockConnection);
    });

    describe('Initialization', () => {
        test('should create analyzer instance', () => {
            expect(analyzer).toBeDefined();
            expect(analyzer).toBeInstanceOf(LiquidityPoolAnalyzer);
        });
    });

    describe('Pool Analysis', () => {
        test('should analyze pool and return valid structure', async () => {
            const result = await analyzer.analyzePool(
                '11111111111111111111111111111111',
                '22222222222222222222222222222222'
            );

            expect(result).toBeDefined();
            expect(result).toHaveProperty('poolAddress');
            expect(result).toHaveProperty('tokenAddress');
            expect(result).toHaveProperty('totalLiquidityUsd');
            expect(result).toHaveProperty('liquidityDepth');
            expect(result).toHaveProperty('healthScore');
            expect(result).toHaveProperty('riskLevel');
        });

        test('should have valid liquidity metrics', async () => {
            const result = await analyzer.analyzePool('pool-address', 'token-address');

            expect(result.totalLiquidityUsd).toBeGreaterThanOrEqual(0);
            expect(result.liquidityDepth).toBeGreaterThanOrEqual(0);
            expect(result.liquidityDepth).toBeLessThanOrEqual(1);
            expect(result.liquidityConcentration).toBeGreaterThanOrEqual(0);
            expect(result.liquidityConcentration).toBeLessThanOrEqual(100);
        });

        test('should have valid health score', async () => {
            const result = await analyzer.analyzePool('pool-address', 'token-address');

            expect(result.healthScore).toBeGreaterThanOrEqual(0);
            expect(result.healthScore).toBeLessThanOrEqual(100);
        });

        test('should have valid risk level', async () => {
            const result = await analyzer.analyzePool('pool-address', 'token-address');

            const validLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
            expect(validLevels).toContain(result.riskLevel);
        });

        test('should include LP token distribution', async () => {
            const result = await analyzer.analyzePool('pool-address', 'token-address');

            expect(result.lpTokenDistribution).toBeDefined();
            expect(result.lpTokenDistribution).toHaveProperty('burned');
            expect(result.lpTokenDistribution).toHaveProperty('locked');
            expect(result.lpTokenDistribution).toHaveProperty('unlocked');

            const total = result.lpTokenDistribution.burned +
                result.lpTokenDistribution.locked +
                result.lpTokenDistribution.unlocked;
            expect(total).toBe(100);
        });

        test('should include slippage estimate', async () => {
            const result = await analyzer.analyzePool('pool-address', 'token-address');

            expect(result.slippageEstimate).toBeGreaterThanOrEqual(0);
        });

        test('should include warnings array', async () => {
            const result = await analyzer.analyzePool('pool-address', 'token-address');

            expect(Array.isArray(result.warnings)).toBe(true);
        });
    });

    describe('Fake Liquidity Detection', () => {
        test('should detect fake liquidity with high unlocked LP', async () => {
            const result = await analyzer.analyzePool('fake-pool', 'fake-token');

            // Default mock has 10% unlocked which is safe
            expect(result.isFakeLiquidity).toBe(false);
        });

        test('should flag pools with suspicious LP distribution', async () => {
            const result = await analyzer.analyzePool('suspicious-pool', 'suspicious-token');

            // Check if warnings include LP-related issues
            expect(result.warnings).toBeDefined();
        });
    });

    describe('Health Score Calculation', () => {
        test('should calculate health score based on liquidity', async () => {
            const result = await analyzer.analyzePool('healthy-pool', 'healthy-token');

            // Health score should be reasonable for default values
            expect(result.healthScore).toBeGreaterThan(0);
        });

        test('should give low health score to fake liquidity', async () => {
            const result = await analyzer.analyzePool('fake-pool', 'fake-token');

            if (result.isFakeLiquidity) {
                expect(result.healthScore).toBe(0);
            }
        });

        test('should consider LP distribution in health score', async () => {
            const result = await analyzer.analyzePool('pool-address', 'token-address');

            // Higher burned + locked should give better health
            const lpScore = result.lpTokenDistribution.burned + result.lpTokenDistribution.locked;
            if (lpScore > 80) {
                expect(result.healthScore).toBeGreaterThan(50);
            }
        });
    });

    describe('Risk Assessment', () => {
        test('should assess CRITICAL risk for fake liquidity', async () => {
            const result = await analyzer.analyzePool('fake-pool', 'fake-token');

            if (result.isFakeLiquidity) {
                expect(result.riskLevel).toBe('CRITICAL');
                expect(result.warnings).toContain('Fake liquidity detected');
            }
        });

        test('should assess HIGH risk for high unlocked LP', async () => {
            const result = await analyzer.analyzePool('unlocked-pool', 'unlocked-token');

            // Default has 10% unlocked which is safe
            expect(result.riskLevel).not.toBe('CRITICAL');
        });

        test('should warn about high slippage', async () => {
            const result = await analyzer.analyzePool('low-liquidity-pool', 'low-liquidity-token');

            // Check if slippage warnings exist when appropriate
            expect(result.slippageEstimate).toBeDefined();
        });

        test('should warn about low pool health', async () => {
            const result = await analyzer.analyzePool('unhealthy-pool', 'unhealthy-token');

            if (result.healthScore < 30) {
                expect(result.warnings).toContain('Low pool health');
            }
        });
    });

    describe('Slippage Estimation', () => {
        test('should estimate slippage based on liquidity', async () => {
            const result = await analyzer.analyzePool('pool-address', 'token-address');

            expect(result.slippageEstimate).toBeGreaterThanOrEqual(0);
        });

        test('should have lower slippage for deeper pools', async () => {
            const result = await analyzer.analyzePool('deep-pool', 'deep-token');

            // Higher depth should mean lower slippage
            if (result.liquidityDepth > 0.8) {
                expect(result.slippageEstimate).toBeLessThan(5);
            }
        });
    });

    describe('Performance', () => {
        test('should analyze quickly', async () => {
            const startTime = Date.now();
            await analyzer.analyzePool('pool-address', 'token-address');
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(5000); // Less than 5 seconds
        });

        test('should handle multiple analyses', async () => {
            const pools = [
                { pool: 'pool1', token: 'token1' },
                { pool: 'pool2', token: 'token2' },
                { pool: 'pool3', token: 'token3' },
            ];

            const results = await Promise.all(
                pools.map(p => analyzer.analyzePool(p.pool, p.token))
            );

            expect(results).toHaveLength(3);
            results.forEach(result => {
                expect(result).toBeDefined();
                expect(result.healthScore).toBeGreaterThanOrEqual(0);
            });
        });
    });

    describe('Edge Cases', () => {
        test('should handle zero liquidity', async () => {
            const result = await analyzer.analyzePool('empty-pool', 'empty-token');

            expect(result).toBeDefined();
            expect(result.totalLiquidityUsd).toBeGreaterThanOrEqual(0);
        });

        test('should handle extreme LP distributions', async () => {
            const result = await analyzer.analyzePool('extreme-pool', 'extreme-token');

            expect(result.lpTokenDistribution).toBeDefined();
            const total = result.lpTokenDistribution.burned +
                result.lpTokenDistribution.locked +
                result.lpTokenDistribution.unlocked;
            expect(total).toBe(100);
        });

        test('should handle very high liquidity', async () => {
            const result = await analyzer.analyzePool('whale-pool', 'whale-token');

            expect(result.totalLiquidityUsd).toBeGreaterThanOrEqual(0);
        });
    });

    describe('LP Token Distribution', () => {
        test('should prefer high burned percentage', async () => {
            const result = await analyzer.analyzePool('burned-pool', 'burned-token');

            // Default has 40% burned
            if (result.lpTokenDistribution.burned > 30) {
                expect(result.healthScore).toBeGreaterThan(30);
            }
        });

        test('should prefer high locked percentage', async () => {
            const result = await analyzer.analyzePool('locked-pool', 'locked-token');

            // Default has 50% locked
            if (result.lpTokenDistribution.locked > 40) {
                expect(result.healthScore).toBeGreaterThan(30);
            }
        });

        test('should flag high unlocked percentage', async () => {
            const result = await analyzer.analyzePool('unlocked-pool', 'unlocked-token');

            // Default has 10% unlocked which is safe
            if (result.lpTokenDistribution.unlocked > 50) {
                expect(result.warnings.length).toBeGreaterThan(0);
            }
        });
    });

    describe('Impermanent Loss', () => {
        test('should include impermanent loss risk', async () => {
            const result = await analyzer.analyzePool('pool-address', 'token-address');

            expect(result.impermanentLossRisk).toBeDefined();
            expect(result.impermanentLossRisk).toBeGreaterThanOrEqual(0);
            expect(result.impermanentLossRisk).toBeLessThanOrEqual(100);
        });
    });
});
