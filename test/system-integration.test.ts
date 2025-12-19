// test/system-integration.test.ts

/**
 * تست‌های Integration ساده
 * شامل: System Coordination, Component Integration
 */

import { getRiskScoringSystem } from '../src/risk/riskScoringSystem';
import { getPortfolioRebalancer } from '../src/portfolio/rebalancing';
import { detectPumpDump } from '../src/analysis/pumpDumpDetector';
import { analyzeWhaleActivity } from '../src/analysis/whaleAnalyzer';
import { getLiquidityPoolAnalyzer } from '../src/analysis/liquidityPoolAnalysis';
import { getVolatilityTracker } from '../src/trading/marketVolatility';
import { Connection, PublicKey } from '@solana/web3.js';

// Mock connection
const mockConnection = {
    rpcEndpoint: 'https://api.mainnet-beta.solana.com',
    getAccountInfo: jest.fn().mockResolvedValue({
        data: Buffer.from('mock data'),
    }),
} as unknown as Connection;

describe('System Integration Tests', () => {
    describe('Component Integration', () => {
        test('should integrate risk scoring with pattern detection', async () => {
            // Risk Scoring
            const riskSystem = getRiskScoringSystem(mockConnection);
            const riskScore = await riskSystem.calculateRisk('test-token');

            // Pattern Detection
            const poolMetrics = {
                currentLiquidity: 15000,
                initialLiquidity: 10000,
                liquidityGrowthRate: 1.5,
                holderCount: 50,
                tokenAgeMs: 10 * 60 * 1000,
                recentBuyers: 25,
                creatorAddress: 'test-creator',
            };
            const pumpDumpResult = await detectPumpDump(mockConnection, poolMetrics);

            // Both should return valid results
            expect(riskScore).toBeDefined();
            expect(riskScore.overallScore).toBeGreaterThanOrEqual(0);
            expect(pumpDumpResult).toBeDefined();
            expect(pumpDumpResult.score).toBeGreaterThanOrEqual(0);

            // Combined risk
            const combinedRisk = (riskScore.overallScore + pumpDumpResult.score) / 2;
            expect(combinedRisk).toBeGreaterThanOrEqual(0);
            expect(combinedRisk).toBeLessThanOrEqual(100);
        });

        test('should integrate whale analysis with liquidity analysis', async () => {
            // Whale Analysis
            const holderData = [
                { address: 'holder1', balance: 300000, percentOfSupply: 30 },
                { address: 'holder2', balance: 500000, percentOfSupply: 50 },
                { address: 'holder3', balance: 200000, percentOfSupply: 20 },
            ];
            const whaleResult = await analyzeWhaleActivity(
                mockConnection,
                new PublicKey('11111111111111111111111111111111'),
                holderData,
                1000000
            );

            // Liquidity Analysis
            const liquidityAnalyzer = getLiquidityPoolAnalyzer(mockConnection);
            const liquidityResult = await liquidityAnalyzer.analyzePool(
                'pool-address',
                'token-address'
            );

            // Both should return valid results
            expect(whaleResult).toBeDefined();
            expect(whaleResult.score).toBeGreaterThanOrEqual(0);
            expect(liquidityResult).toBeDefined();
            expect(liquidityResult.healthScore).toBeGreaterThanOrEqual(0);
        });

        test('should integrate volatility tracking with risk scoring', async () => {
            // Volatility Tracking
            const volatilityTracker = getVolatilityTracker();
            volatilityTracker.addPricePoint(100);
            volatilityTracker.addPricePoint(105);
            volatilityTracker.addPricePoint(102);
            const volatilityMetrics = await volatilityTracker.getVolatilityMetrics();

            // Risk Scoring
            const riskSystem = getRiskScoringSystem(mockConnection);
            const riskScore = await riskSystem.calculateRisk('volatile-token');

            // Both should return valid results
            expect(volatilityMetrics).toBeDefined();
            expect(volatilityMetrics.currentVolatility).toBeGreaterThanOrEqual(0);
            expect(riskScore).toBeDefined();
            expect(riskScore.overallScore).toBeGreaterThanOrEqual(0);

            // Volatility should affect recommendations
            expect(volatilityMetrics.recommendation).toBeDefined();
            expect(volatilityMetrics.recommendation.positionSizeMultiplier).toBeGreaterThan(0);
        });
    });

    describe('Multi-System Coordination', () => {
        test('should coordinate all analysis systems', async () => {
            const tokenAddress = 'integration-test-token';

            // 1. Risk Scoring
            const riskSystem = getRiskScoringSystem(mockConnection);
            const riskScore = await riskSystem.calculateRisk(tokenAddress);

            // 2. Pattern Detection
            const poolMetrics = {
                currentLiquidity: 20000,
                initialLiquidity: 15000,
                liquidityGrowthRate: 1.33,
                holderCount: 75,
                tokenAgeMs: 30 * 60 * 1000,
                recentBuyers: 40,
                creatorAddress: 'creator',
            };
            const pumpDumpResult = await detectPumpDump(mockConnection, poolMetrics);

            // 3. Liquidity Analysis
            const liquidityAnalyzer = getLiquidityPoolAnalyzer(mockConnection);
            const liquidityResult = await liquidityAnalyzer.analyzePool(
                'pool-address',
                tokenAddress
            );

            // 4. Volatility Tracking
            const volatilityTracker = getVolatilityTracker();
            volatilityTracker.clearHistory();
            volatilityTracker.addPricePoint(100);
            const volatilityMetrics = await volatilityTracker.getVolatilityMetrics();

            // All systems should return valid results
            expect(riskScore).toBeDefined();
            expect(pumpDumpResult).toBeDefined();
            expect(liquidityResult).toBeDefined();
            expect(volatilityMetrics).toBeDefined();

            // Results should be consistent
            expect(riskScore.overallScore).toBeGreaterThanOrEqual(0);
            expect(pumpDumpResult.score).toBeGreaterThanOrEqual(0);
            expect(liquidityResult.healthScore).toBeGreaterThanOrEqual(0);
            expect(volatilityMetrics.currentVolatility).toBeGreaterThanOrEqual(0);
        });

        test('should handle concurrent operations', async () => {
            const operations = [
                getRiskScoringSystem(mockConnection).calculateRisk('token1'),
                getRiskScoringSystem(mockConnection).calculateRisk('token2'),
                getPortfolioRebalancer().analyzeRebalancing(),
                getLiquidityPoolAnalyzer(mockConnection).analyzePool('pool1', 'token1'),
            ];

            const results = await Promise.all(operations);

            expect(results).toHaveLength(4);
            results.forEach(result => {
                expect(result).toBeDefined();
            });
        });
    });

    describe('Portfolio Management Integration', () => {
        test('should integrate rebalancing with risk assessment', async () => {
            // Get risk scores for multiple tokens
            const riskSystem = getRiskScoringSystem(mockConnection);
            const risks = await Promise.all([
                riskSystem.calculateRisk('token1'),
                riskSystem.calculateRisk('token2'),
                riskSystem.calculateRisk('token3'),
            ]);

            // Analyze portfolio rebalancing
            const rebalancer = getPortfolioRebalancer();
            const rebalanceRecommendation = await rebalancer.analyzeRebalancing();

            // All should be valid
            expect(risks).toHaveLength(3);
            risks.forEach(risk => {
                expect(risk.overallScore).toBeGreaterThanOrEqual(0);
            });
            expect(rebalanceRecommendation).toBeDefined();
            expect(rebalanceRecommendation.shouldRebalance).toBeDefined();
        });
    });

    describe('Performance', () => {
        test('should handle multiple analyses efficiently', async () => {
            const startTime = Date.now();

            await Promise.all([
                getRiskScoringSystem(mockConnection).calculateRisk('perf-token-1'),
                getRiskScoringSystem(mockConnection).calculateRisk('perf-token-2'),
                getPortfolioRebalancer().analyzeRebalancing(),
            ]);

            const duration = Date.now() - startTime;

            // Should complete in reasonable time
            expect(duration).toBeLessThan(10000); // 10 seconds
        });

        test('should cache results across systems', async () => {
            const riskSystem = getRiskScoringSystem(mockConnection);
            const tokenAddress = 'cache-test';

            // First call
            const start1 = Date.now();
            await riskSystem.calculateRisk(tokenAddress);
            const duration1 = Date.now() - start1;

            // Second call (cached)
            const start2 = Date.now();
            await riskSystem.calculateRisk(tokenAddress);
            const duration2 = Date.now() - start2;

            // Cached should be faster
            expect(duration2).toBeLessThan(duration1);
        });
    });

    describe('Data Consistency', () => {
        test('should maintain consistent results', async () => {
            const riskSystem = getRiskScoringSystem(mockConnection);
            const tokenAddress = 'consistency-test';

            const result1 = await riskSystem.calculateRisk(tokenAddress);
            const result2 = await riskSystem.calculateRisk(tokenAddress);

            // Same token should get same score (from cache)
            expect(result1.overallScore).toBe(result2.overallScore);
            expect(result1.category).toBe(result2.category);
        });
    });
});
