// test/multi-agent.test.ts

/**
 * تست‌های Multi-Agent System
 * شامل: Scout, Analyst, Risk, Exit Agents و Orchestrator
 */

import { orchestrateDecision, OrchestratorDecision } from '../src/agents/agentOrchestrator';
import { scoutAgent } from '../src/agents/scoutAgent';
import { analystAgent } from '../src/agents/analystAgent';
import { riskAgent } from '../src/agents/riskAgent';
import { exitAgent } from '../src/agents/exitAgent';
import { Connection } from '@solana/web3.js';

// Mock connection
const mockConnection = {
    rpcEndpoint: 'https://api.mainnet-beta.solana.com',
} as Connection;

describe('Multi-Agent System', () => {
    describe('Scout Agent', () => {
        test('should have shouldAnalyze function', () => {
            expect(scoutAgent).toBeDefined();
            expect(typeof scoutAgent).toBe('function');
        });

        test('should return decision structure', async () => {
            const decision = await scoutAgent({
                baseMint: 'test-token',
                coinCreator: 'test-creator',
                liquidityUsd: 10000,
                recentBuyers: 50,
                ageMs: 60000,
                fdv: 100000,
            });

            expect(decision).toHaveProperty('shouldAnalyze');
            expect(decision).toHaveProperty('reason');
            expect(decision).toHaveProperty('quickScore');
            expect(typeof decision.shouldAnalyze).toBe('boolean');
            expect(typeof decision.reason).toBe('string');
            expect(typeof decision.quickScore).toBe('number');
        });

        test('should have valid quick score range', async () => {
            const decision = await scoutAgent({
                baseMint: 'test-token',
                coinCreator: 'test-creator',
                liquidityUsd: 10000,
                recentBuyers: 50,
                ageMs: 60000,
                fdv: 100000,
            });

            expect(decision.quickScore).toBeGreaterThanOrEqual(0);
            expect(decision.quickScore).toBeLessThanOrEqual(100);
        });
    });

    describe('Analyst Agent', () => {
        test('should have analyze function', () => {
            expect(analystAgent).toBeDefined();
            expect(typeof analystAgent).toBe('function');
        });

        test('should return decision structure', async () => {
            const decision = await analystAgent({
                baseMint: 'test-token',
                coinCreator: 'test-creator',
                liquidityUsd: 10000,
                recentBuyers: 50,
                ageMs: 60000,
                fdv: 100000,
                holderAnalysis: {
                    totalHolders: 100,
                    top5HoldersPercent: 30,
                    largestHolderPercent: 15,
                },
                marketContext: 'Normal market conditions',
                historicalData: 'No history',
            });

            expect(decision).toHaveProperty('shouldBuy');
            expect(decision).toHaveProperty('reason');
            expect(decision).toHaveProperty('confidence');
            expect(typeof decision.shouldBuy).toBe('boolean');
        });

        test('should have valid confidence range', async () => {
            const decision = await analystAgent({
                baseMint: 'test-token',
                coinCreator: 'test-creator',
                liquidityUsd: 10000,
                recentBuyers: 50,
                ageMs: 60000,
                fdv: 100000,
                holderAnalysis: {
                    totalHolders: 100,
                    top5HoldersPercent: 30,
                    largestHolderPercent: 15,
                },
                marketContext: 'Normal',
                historicalData: 'None',
            });

            if (decision.confidence !== undefined) {
                expect(decision.confidence).toBeGreaterThanOrEqual(0);
                expect(decision.confidence).toBeLessThanOrEqual(100);
            }
        });
    });

    describe('Risk Agent', () => {
        test('should have assess function', () => {
            expect(riskAgent).toBeDefined();
            expect(typeof riskAgent).toBe('function');
        });

        test('should return decision structure', async () => {
            const decision = await riskAgent({
                baseMint: 'test-token',
                analystDecision: {
                    shouldBuy: true,
                    reason: 'Good opportunity',
                    confidence: 75,
                },
                pumpDumpSignals: {
                    isPumpDump: false,
                    score: 20,
                    riskLevel: 'LOW',
                    signals: [],
                },
                whaleRisk: false,
                portfolioMetrics: {
                    openPositions: 0,
                    performance: { totalProfitLoss: 0, winRate: 0, avgProfitPerTrade: 0 },
                    risk: { maxDrawdown: 0, currentDrawdown: 0, capitalUtilization: 0 },
                    riskMetrics: { capitalUtilization: 0 },
                    diversification: { totalPositions: 0, avgPositionSize: 0 },
                },
                volatilityMetrics: {
                    currentVolatility: 0.5,
                    avgVolatility: 0.5,
                    volatilityTrend: 'stable',
                    volatilityLevel: 'NORMAL',
                    recommendation: { positionSizeMultiplier: 1.0 },
                },
            });

            expect(decision).toHaveProperty('approved');
            expect(decision).toHaveProperty('riskLevel');
            expect(decision).toHaveProperty('adjustedAmount');
            expect(decision).toHaveProperty('tpPercent');
            expect(decision).toHaveProperty('slPercent');
            expect(decision).toHaveProperty('warnings');
            expect(typeof decision.approved).toBe('boolean');
        });

        test('should have valid risk level', async () => {
            const decision = await riskAgent({
                baseMint: 'test-token',
                analystDecision: { shouldBuy: true, reason: 'Test', confidence: 75, suggestedAmount: 0.1 },
                pumpDumpSignals: { isPumpDump: false, score: 20, riskLevel: 'LOW', signals: [] },
                whaleRisk: false,
                portfolioMetrics: {
                    openPositions: 0,
                    performance: { totalProfitLoss: 0, winRate: 0, avgProfitPerTrade: 0 },
                    risk: { maxDrawdown: 0, currentDrawdown: 0, capitalUtilization: 0 },
                    riskMetrics: { capitalUtilization: 0 },
                    diversification: { totalPositions: 0, avgPositionSize: 0 },
                },
                volatilityMetrics: {
                    currentVolatility: 0.5,
                    avgVolatility: 0.5,
                    volatilityTrend: 'stable',
                    volatilityLevel: 'NORMAL',
                    recommendation: { positionSizeMultiplier: 1.0 },
                },
            });

            const validLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
            expect(validLevels).toContain(decision.riskLevel);
        });
    });

    describe('Exit Agent', () => {
        test('should have evaluate function', () => {
            expect(exitAgent).toBeDefined();
            expect(typeof exitAgent).toBe('function');
        });

        test('should return decision structure', async () => {
            const mockPosition = {
                baseMint: 'test-token',
                pool: 'test-pool',
                buyPriceInQuote: 1.0,
                openedAt: Date.now() - 60000,
                tpPercent: 100,
                slPercent: 20,
            } as any;

            const decision = await exitAgent({
                position: mockPosition,
                currentPrice: 1.5,
                marketConditions: { marketTrend: 'bullish', volatility: 'normal', solPriceChange24h: 5 },
                portfolioMetrics: { openPositions: 3, performance: { winRate: 75 } },
            });

            expect(decision).toHaveProperty('shouldExit');
            expect(decision).toHaveProperty('reason');
            expect(decision).toHaveProperty('exitType');
            expect(typeof decision.shouldExit).toBe('boolean');
        });

        test('should have valid exit type', async () => {
            const mockPosition = {
                baseMint: 'test-token',
                pool: 'test-pool',
                buyPriceInQuote: 1.0,
                openedAt: Date.now() - 60000,
                tpPercent: 100,
                slPercent: 20,
            } as any;

            const decision = await exitAgent({
                position: mockPosition,
                currentPrice: 1.5,
                marketConditions: { marketTrend: 'bullish', volatility: 'normal', solPriceChange24h: 5 },
                portfolioMetrics: { openPositions: 3, performance: { winRate: 75 } },
            });

            if (decision.shouldExit) {
                const validTypes = ['TP', 'SL', 'MANUAL', 'HOLD'];
                expect(validTypes).toContain(decision.exitType);
            }
        });
    });

    describe('Agent Orchestrator', () => {
        const mockContext = {
            type: 'NEW_POOL' as const,
            pool: 'test-pool',
            baseMint: 'test-token-123',
            quoteMint: 'SOL',
            coinCreator: 'test-creator',
            liquidityUsd: 10000,
            recentBuyers: 50,
            ageMs: 60000,
            fdv: 100000,
        };

        test('should orchestrate decision', async () => {
            const decision = await orchestrateDecision(mockConnection, mockContext);

            expect(decision).toBeDefined();
            expect(decision).toHaveProperty('action');
            expect(decision).toHaveProperty('reason');
            expect(decision).toHaveProperty('amountInLamports');
            expect(decision).toHaveProperty('tpPercent');
            expect(decision).toHaveProperty('slPercent');
            expect(decision).toHaveProperty('agentDecisions');
        });

        test('should have valid action', async () => {
            const decision = await orchestrateDecision(mockConnection, mockContext);

            expect(['BUY', 'IGNORE']).toContain(decision.action);
        });

        test('should include agent decisions', async () => {
            const decision = await orchestrateDecision(mockConnection, mockContext);

            expect(decision.agentDecisions).toBeDefined();
            expect(typeof decision.agentDecisions).toBe('object');
        });

        test('should have non-negative amounts', async () => {
            const decision = await orchestrateDecision(mockConnection, mockContext);

            expect(decision.amountInLamports).toBeGreaterThanOrEqual(0);
            expect(decision.tpPercent).toBeGreaterThanOrEqual(0);
            expect(decision.slPercent).toBeGreaterThanOrEqual(0);
        });

        test('should provide reason for decision', async () => {
            const decision = await orchestrateDecision(mockConnection, mockContext);

            expect(decision.reason).toBeDefined();
            expect(typeof decision.reason).toBe('string');
            expect(decision.reason.length).toBeGreaterThan(0);
        });

        test('should handle low liquidity', async () => {
            const lowLiqContext = {
                ...mockContext,
                liquidityUsd: 100, // Very low
            };

            const decision = await orchestrateDecision(mockConnection, lowLiqContext);

            expect(decision).toBeDefined();
            // Likely to be rejected by scout
        });

        test('should handle high liquidity', async () => {
            const highLiqContext = {
                ...mockContext,
                liquidityUsd: 100000, // High
            };

            const decision = await orchestrateDecision(mockConnection, highLiqContext);

            expect(decision).toBeDefined();
        });
    });

    describe('Agent Integration', () => {
        test('should coordinate all agents', async () => {
            const context = {
                type: 'NEW_POOL' as const,
                pool: 'integration-test-pool',
                baseMint: 'integration-test-token',
                quoteMint: 'SOL',
                coinCreator: 'integration-test-creator',
                liquidityUsd: 15000,
                recentBuyers: 75,
                ageMs: 120000,
                fdv: 150000,
            };

            const decision = await orchestrateDecision(mockConnection, context);

            expect(decision).toBeDefined();
            expect(decision.agentDecisions).toBeDefined();
        });

        test('should handle decision pipeline', async () => {
            const context = {
                type: 'NEW_POOL' as const,
                pool: 'pipeline-test',
                baseMint: 'pipeline-token',
                quoteMint: 'SOL',
                coinCreator: 'pipeline-creator',
                liquidityUsd: 20000,
                recentBuyers: 100,
                ageMs: 180000,
                fdv: 200000,
            };

            const startTime = Date.now();
            const decision = await orchestrateDecision(mockConnection, context);
            const duration = Date.now() - startTime;

            expect(decision).toBeDefined();
            // Pipeline should complete in reasonable time
            expect(duration).toBeLessThan(10000); // 10 seconds
        });
    });

    describe('Performance', () => {
        test('should make decisions quickly', async () => {
            const context = {
                type: 'NEW_POOL' as const,
                pool: 'perf-test',
                baseMint: 'perf-token',
                quoteMint: 'SOL',
                coinCreator: 'perf-creator',
                liquidityUsd: 12000,
                recentBuyers: 60,
                ageMs: 90000,
                fdv: 120000,
            };

            const startTime = Date.now();
            await orchestrateDecision(mockConnection, context);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(5000); // 5 seconds
        });
    });
});

// Snapshot tests
describe('Multi-Agent Snapshots', () => {
    test('should match orchestrator decision structure', async () => {
        const context = {
            type: 'NEW_POOL' as const,
            pool: 'snapshot-test',
            baseMint: 'snapshot-token',
            quoteMint: 'SOL',
            coinCreator: 'snapshot-creator',
            liquidityUsd: 10000,
            recentBuyers: 50,
            ageMs: 60000,
            fdv: 100000,
        };

        const decision = await orchestrateDecision(mockConnection, context);

        expect(decision).toMatchObject({
            action: expect.any(String),
            reason: expect.any(String),
            amountInLamports: expect.any(Number),
            tpPercent: expect.any(Number),
            slPercent: expect.any(Number),
            agentDecisions: expect.any(Object),
        });
    });
});
