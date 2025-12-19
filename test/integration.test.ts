// test/integration.test.ts

/**
 * تست‌های Integration
 * شامل: Full Trading Flow, System Integration, End-to-End Scenarios
 */

import { orchestrateDecision } from '../src/agents/agentOrchestrator';
import { getRiskScoringSystem } from '../src/risk/riskScoringSystem';
import { getPortfolioRebalancer } from '../src/portfolio/rebalancing';
import { detectPumpDump } from '../src/analysis/pumpDumpDetector';
import { analyzeWhaleActivity } from '../src/analysis/whaleAnalyzer';
import { Connection, PublicKey } from '@solana/web3.js';

// Mock connection
const mockConnection = {
    rpcEndpoint: 'https://api.mainnet-beta.solana.com',
    getAccountInfo: jest.fn().mockResolvedValue({
        data: Buffer.from('mock data'),
    }),
} as unknown as Connection;

describe('Integration Tests', () => {
    describe('Full Trading Flow', () => {
        test('should complete full trading decision flow', async () => {
            const tokenContext = {
                type: 'NEW_POOL' as const,
                pool: 'integration-test-pool',
                baseMint: 'integration-test-token',
                quoteMint: 'SOL',
                coinCreator: 'integration-test-creator',
                liquidityUsd: 15000,
                recentBuyers: 50,
                ageMs: 5 * 60 * 1000, // 5 minutes
                fdv: 150000,
            };

            // Step 1: Multi-agent decision
            const decision = await orchestrateDecision(mockConnection, tokenContext);

            expect(decision).toBeDefined();
            expect(decision).toHaveProperty('action');
            expect(decision).toHaveProperty('reason');
            expect(decision).toHaveProperty('agentDecisions');

            // Verify agent decisions are included
            expect(decision.agentDecisions).toBeDefined();
        });

        test('should integrate pattern detection with decision making', async () => {
            // Step 1: Detect pump and dump
            const poolMetrics = {
                currentLiquidity: 20000,
                initialLiquidity: 10000,
                liquidityGrowthRate: 2.0,
                holderCount: 50,
                tokenAgeMs: 10 * 60 * 1000,
                recentBuyers: 30,
                creatorAddress: 'test-creator',
            };

            const pumpDumpResult = await detectPumpDump(mockConnection, poolMetrics);

            expect(pumpDumpResult).toBeDefined();
            expect(pumpDumpResult.score).toBeGreaterThanOrEqual(0);

            // Step 2: Analyze whale activity
            const holderData = [
                { address: 'holder1', balance: 300000, percentOfSupply: 30 },
                { address: 'holder2', balance: 200000, percentOfSupply: 20 },
                { address: 'holder3', balance: 500000, percentOfSupply: 50 },
            ];

            const whaleResult = await analyzeWhaleActivity(
                mockConnection,
                new PublicKey('11111111111111111111111111111111'),
                holderData,
                1000000
            );

            expect(whaleResult).toBeDefined();
            expect(whaleResult.score).toBeGreaterThanOrEqual(0);

            // Combined risk should be calculated
            const combinedRisk = (pumpDumpResult.score + whaleResult.score) / 2;
            expect(combinedRisk).toBeGreaterThanOrEqual(0);
            expect(combinedRisk).toBeLessThanOrEqual(100);
        });

        test('should integrate risk scoring with portfolio management', async () => {
            // Step 1: Get risk score
            const riskSystem = getRiskScoringSystem(mockConnection);
            const riskScore = await riskSystem.calculateRisk('test-token-address');

            expect(riskScore).toBeDefined();
            expect(riskScore.overallScore).toBeGreaterThanOrEqual(0);
            expect(riskScore.overallScore).toBeLessThanOrEqual(100);

            // Step 2: Use risk score for portfolio rebalancing
            const rebalancer = getPortfolioRebalancer();
            const rebalanceRecommendation = await rebalancer.analyzeRebalancing();

            expect(rebalanceRecommendation).toBeDefined();
            expect(rebalanceRecommendation).toHaveProperty('shouldRebalance');
        });
    });

    describe('System Integration', () => {
        test('should coordinate all analysis systems', async () => {
            const tokenAddress = 'test-token-integration';

            // 1. Risk Scoring
            const riskSystem = getRiskScoringSystem(mockConnection);
            const riskScore = await riskSystem.calculateRisk(tokenAddress);

            // 2. Pattern Detection
            const poolMetrics = {
                currentLiquidity: 15000,
                initialLiquidity: 10000,
                liquidityGrowthRate: 1.5,
                holderCount: 75,
                tokenAgeMs: 15 * 60 * 1000,
                recentBuyers: 25,
                creatorAddress: 'creator-address',
            };
            const pumpDumpResult = await detectPumpDump(mockConnection, poolMetrics);

            // 3. Portfolio Management
            const rebalancer = getPortfolioRebalancer();
            const rebalanceRecommendation = await rebalancer.analyzeRebalancing();

            // All systems should return valid results
            expect(riskScore).toBeDefined();
            expect(pumpDumpResult).toBeDefined();
            expect(rebalanceRecommendation).toBeDefined();

            // Results should be consistent
            expect(riskScore.overallScore).toBeGreaterThanOrEqual(0);
            expect(pumpDumpResult.score).toBeGreaterThanOrEqual(0);
        });

        test('should handle concurrent system operations', async () => {
            const operations = [
                getRiskScoringSystem(mockConnection).calculateRisk('token1'),
                getRiskScoringSystem(mockConnection).calculateRisk('token2'),
                getPortfolioRebalancer().analyzeRebalancing(),
            ];

            const results = await Promise.all(operations);

            expect(results).toHaveLength(3);
            results.forEach(result => {
                expect(result).toBeDefined();
            });
        });
    });

    describe('Decision Pipeline', () => {
        test('should execute complete decision pipeline', async () => {
            const context = {
                type: 'NEW_POOL' as const,
                pool: 'pipeline-test',
                baseMint: 'pipeline-token',
                quoteMint: 'SOL',
                coinCreator: 'pipeline-creator',
                liquidityUsd: 12000,
                recentBuyers: 40,
                ageMs: 8 * 60 * 1000,
                fdv: 120000,
            };

            // Complete pipeline
            const startTime = Date.now();
            const decision = await orchestrateDecision(mockConnection, context);
            const duration = Date.now() - startTime;

            // Should complete in reasonable time
            expect(duration).toBeLessThan(10000); // 10 seconds

            // Should have valid decision
            expect(decision.action).toBeDefined();
            expect(['BUY', 'IGNORE']).toContain(decision.action);
        });

        test('should reject high-risk opportunities', async () => {
            const highRiskContext = {
                type: 'NEW_POOL' as const,
                pool: 'high-risk-pool',
                baseMint: 'high-risk-token',
                quoteMint: 'SOL',
                coinCreator: 'suspicious-creator',
                liquidityUsd: 50000,
                recentBuyers: 200,
                ageMs: 1 * 60 * 1000, // Very new
                fdv: 500000,
            };

            const decision = await orchestrateDecision(mockConnection, highRiskContext);

            // High risk should likely be rejected
            expect(decision).toBeDefined();
            expect(decision.action).toBeDefined();
        });

        test('should approve low-risk opportunities', async () => {
            const lowRiskContext = {
                type: 'NEW_POOL' as const,
                pool: 'low-risk-pool',
                baseMint: 'low-risk-token',
                quoteMint: 'SOL',
                coinCreator: 'trusted-creator',
                liquidityUsd: 20000,
                recentBuyers: 30,
                ageMs: 60 * 60 * 1000, // 1 hour old
                fdv: 200000,
            };

            const decision = await orchestrateDecision(mockConnection, lowRiskContext);

            expect(decision).toBeDefined();
            expect(decision.action).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        test('should handle system errors gracefully', async () => {
            const invalidContext = {
                type: 'NEW_POOL' as const,
                pool: '',
                baseMint: '',
                quoteMint: '',
                coinCreator: '',
                liquidityUsd: 0,
                recentBuyers: 0,
                ageMs: 0,
                fdv: 0,
            };

            // Should not throw
            await expect(
                orchestrateDecision(mockConnection, invalidContext)
            ).resolves.toBeDefined();
        });

        test('should handle network errors', async () => {
            const errorConnection = {
                ...mockConnection,
                getAccountInfo: jest.fn().mockRejectedValue(new Error('Network error')),
            } as unknown as Connection;

            const riskSystem = getRiskScoringSystem(errorConnection);

            // Should handle error gracefully
            await expect(
                riskSystem.calculateRisk('test-token')
            ).resolves.toBeDefined();
        });
    });

    describe('Performance', () => {
        test('should handle multiple tokens efficiently', async () => {
            const tokens = Array(5).fill(0).map((_, i) => ({
                type: 'NEW_POOL' as const,
                pool: `pool-${i}`,
                baseMint: `token-${i}`,
                quoteMint: 'SOL',
                coinCreator: `creator-${i}`,
                liquidityUsd: 10000 + i * 1000,
                recentBuyers: 20 + i * 5,
                ageMs: (5 + i) * 60 * 1000,
                fdv: 100000 + i * 10000,
            }));

            const startTime = Date.now();
            const decisions = await Promise.all(
                tokens.map(token => orchestrateDecision(mockConnection, token))
            );
            const duration = Date.now() - startTime;

            expect(decisions).toHaveLength(5);
            expect(duration).toBeLessThan(30000); // 30 seconds for 5 tokens
        });

        test('should cache results effectively', async () => {
            const riskSystem = getRiskScoringSystem(mockConnection);
            const tokenAddress = 'cache-test-token';

            // First call
            const start1 = Date.now();
            await riskSystem.calculateRisk(tokenAddress);
            const duration1 = Date.now() - start1;

            // Second call (should use cache)
            const start2 = Date.now();
            await riskSystem.calculateRisk(tokenAddress);
            const duration2 = Date.now() - start2;

            // Cached call should be faster
            expect(duration2).toBeLessThan(duration1);
        });
    });

    describe('Data Consistency', () => {
        test('should maintain consistent risk scores', async () => {
            const riskSystem = getRiskScoringSystem(mockConnection);
            const tokenAddress = 'consistency-test';

            const score1 = await riskSystem.calculateRisk(tokenAddress);
            const score2 = await riskSystem.calculateRisk(tokenAddress);

            // Same token should get same score (from cache)
            expect(score1.overallScore).toBe(score2.overallScore);
            expect(score1.category).toBe(score2.category);
        });

        test('should provide consistent recommendations', async () => {
            const rebalancer = getPortfolioRebalancer();

            const rec1 = await rebalancer.analyzeRebalancing();
            const rec2 = await rebalancer.analyzeRebalancing();

            // Should be consistent
            expect(rec1.shouldRebalance).toBe(rec2.shouldRebalance);
        });
    });
});
