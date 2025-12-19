// test/pattern-recognition.test.ts

/**
 * تست‌های Pattern Recognition
 * شامل: Pump & Dump Detection, Whale Analysis, Coordinated Buying
 */

import { detectPumpDump, quickPumpDumpCheck, PumpDumpSignals } from '../src/analysis/pumpDumpDetector';
import { analyzeWhaleActivity, quickWhaleCheck, WhaleActivitySignals } from '../src/analysis/whaleAnalyzer';
import { detectCoordinatedBuying } from '../src/analysis/coordinatedBuyingDetector';
import { Connection, PublicKey } from '@solana/web3.js';

// Mock connection
const mockConnection = {
    rpcEndpoint: 'https://api.mainnet-beta.solana.com',
} as Connection;

describe('Pattern Recognition Systems', () => {
    describe('Pump & Dump Detection', () => {
        test('should detect pump and dump with high risk signals', async () => {
            const poolMetrics = {
                currentLiquidity: 50000,
                initialLiquidity: 5000,
                liquidityGrowthRate: 10.0, // 1000% growth
                holderCount: 5,
                tokenAgeMs: 2 * 60 * 1000, // 2 minutes
                recentBuyers: 50,
                creatorAddress: 'test-creator',
            };

            const result = await detectPumpDump(mockConnection, poolMetrics);

            expect(result).toBeDefined();
            expect(result.isPumpDump).toBe(true);
            expect(result.riskLevel).toBe('CRITICAL');
            expect(result.score).toBeGreaterThan(70);
            expect(result.signals.length).toBeGreaterThan(0);
        });

        test('should not detect pump and dump with normal signals', async () => {
            const poolMetrics = {
                currentLiquidity: 10000,
                initialLiquidity: 8000,
                liquidityGrowthRate: 1.25,
                holderCount: 100,
                tokenAgeMs: 60 * 60 * 1000, // 1 hour
                recentBuyers: 20,
                creatorAddress: 'test-creator',
            };

            const result = await detectPumpDump(mockConnection, poolMetrics);

            expect(result).toBeDefined();
            expect(result.isPumpDump).toBe(false);
            expect(result.riskLevel).toBe('LOW');
            expect(result.score).toBeLessThan(50);
        });

        test('should return valid risk levels', async () => {
            const poolMetrics = {
                currentLiquidity: 15000,
                initialLiquidity: 10000,
                liquidityGrowthRate: 1.5,
                holderCount: 50,
                tokenAgeMs: 30 * 60 * 1000,
                recentBuyers: 15,
                creatorAddress: 'test-creator',
            };

            const result = await detectPumpDump(mockConnection, poolMetrics);

            const validLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
            expect(validLevels).toContain(result.riskLevel);
        });

        test('should include signal details', async () => {
            const poolMetrics = {
                currentLiquidity: 20000,
                initialLiquidity: 2000,
                liquidityGrowthRate: 10.0,
                holderCount: 3,
                tokenAgeMs: 1 * 60 * 1000,
                recentBuyers: 100,
                creatorAddress: 'test-creator',
            };

            const result = await detectPumpDump(mockConnection, poolMetrics);

            expect(result.details).toBeDefined();
            expect(result.details.rapidLiquidityIncrease).toBe(true);
            expect(result.details.newTokenAge).toBe(true);
            expect(result.details.lowHolderCount).toBe(true);
        });

        test('quick check should detect suspicious patterns', () => {
            const isSuspicious = quickPumpDumpCheck(
                15000, // high liquidity
                3,     // low holders
                2 * 60 * 1000, // very new
                30     // many buyers
            );

            expect(isSuspicious).toBe(true);
        });

        test('quick check should pass normal patterns', () => {
            const isSuspicious = quickPumpDumpCheck(
                5000,
                50,
                60 * 60 * 1000,
                10
            );

            expect(isSuspicious).toBe(false);
        });
    });

    describe('Whale Analysis', () => {
        test('should detect high whale concentration', async () => {
            const holderData = [
                { address: 'whale1', balance: 500000, percentOfSupply: 50 },
                { address: 'whale2', balance: 200000, percentOfSupply: 20 },
                { address: 'holder3', balance: 100000, percentOfSupply: 10 },
                { address: 'holder4', balance: 50000, percentOfSupply: 5 },
            ];

            const result = await analyzeWhaleActivity(
                mockConnection,
                new PublicKey('11111111111111111111111111111111'),
                holderData,
                1000000
            );

            expect(result).toBeDefined();
            expect(result.hasWhaleActivity).toBe(true);
            expect(result.riskLevel).toBe('HIGH');
            expect(result.score).toBeGreaterThan(60);
        });

        test('should not detect whale activity with distributed holdings', async () => {
            const holderData = Array(50).fill(0).map((_, i) => ({
                address: `holder${i}`,
                balance: 20000,
                percentOfSupply: 2,
            }));

            const result = await analyzeWhaleActivity(
                mockConnection,
                new PublicKey('11111111111111111111111111111111'),
                holderData,
                1000000
            );

            expect(result).toBeDefined();
            expect(result.hasWhaleActivity).toBe(false);
            expect(result.riskLevel).toBe('LOW');
            expect(result.score).toBeLessThan(50);
        });

        test('should handle empty holder data', async () => {
            const result = await analyzeWhaleActivity(
                mockConnection,
                new PublicKey('11111111111111111111111111111111'),
                [],
                1000000
            );

            expect(result).toBeDefined();
            expect(result.hasWhaleActivity).toBe(false);
            expect(result.score).toBe(0);
        });

        test('should detect large single holder', async () => {
            const holderData = [
                { address: 'whale', balance: 800000, percentOfSupply: 80 },
                { address: 'holder2', balance: 100000, percentOfSupply: 10 },
                { address: 'holder3', balance: 100000, percentOfSupply: 10 },
            ];

            const result = await analyzeWhaleActivity(
                mockConnection,
                new PublicKey('11111111111111111111111111111111'),
                holderData,
                1000000
            );

            expect(result.details.topHolderPercent).toBeGreaterThan(20);
            expect(result.signals.length).toBeGreaterThan(0);
        });

        test('quick whale check should detect high concentration', () => {
            const isHighRisk = quickWhaleCheck(
                70, // top 5 holders: 70%
                30, // largest holder: 30%
                10  // total holders
            );

            expect(isHighRisk).toBe(true);
        });

        test('quick whale check should pass normal distribution', () => {
            const isHighRisk = quickWhaleCheck(
                40, // top 5 holders: 40%
                15, // largest holder: 15%
                100 // total holders
            );

            expect(isHighRisk).toBe(false);
        });
    });

    describe('Coordinated Buying Detection', () => {
        test('should detect coordinated buying pattern', async () => {
            const buyerData = Array(20).fill(0).map((_, i) => ({
                signature: `sig${i}`,
                buyer: `buyer${i}`,
                amount: 1000,
                timestamp: Date.now() - i * 1000, // Within 20 seconds
            }));

            const result = await detectCoordinatedBuying(
                mockConnection,
                new PublicKey('11111111111111111111111111111111'),
                buyerData
            );

            expect(result).toBeDefined();
            expect(result.isCoordinated).toBe(true);
            expect(result.score).toBeGreaterThan(50);
        });

        test('should not detect coordinated buying with normal pattern', async () => {
            const buyerData = Array(10).fill(0).map((_, i) => ({
                signature: `sig${i}`,
                buyer: `buyer${i}`,
                amount: 500,
                timestamp: Date.now() - i * 60000, // Spread over minutes
            }));

            const result = await detectCoordinatedBuying(
                mockConnection,
                new PublicKey('11111111111111111111111111111111'),
                buyerData
            );

            expect(result).toBeDefined();
            expect(result.isCoordinated).toBe(false);
            expect(result.score).toBeLessThan(50);
        });
    });

    describe('Integration Tests', () => {
        test('should combine all pattern detection', async () => {
            // Simulate a suspicious token
            const poolMetrics = {
                currentLiquidity: 30000,
                initialLiquidity: 3000,
                liquidityGrowthRate: 10.0,
                holderCount: 5,
                tokenAgeMs: 3 * 60 * 1000,
                recentBuyers: 40,
                creatorAddress: 'suspicious-creator',
            };

            const holderData = [
                { address: 'whale1', balance: 600000, percentOfSupply: 60 },
                { address: 'whale2', balance: 300000, percentOfSupply: 30 },
                { address: 'holder3', balance: 100000, percentOfSupply: 10 },
            ];

            const buyerData = Array(15).fill(0).map((_, i) => ({
                signature: `sig${i}`,
                buyer: `buyer${i}`,
                amount: 2000,
                timestamp: Date.now() - i * 2000,
            }));

            const pumpDumpResult = await detectPumpDump(mockConnection, poolMetrics);
            const whaleResult = await analyzeWhaleActivity(
                mockConnection,
                new PublicKey('11111111111111111111111111111111'),
                holderData,
                1000000
            );
            const coordinatedResult = await detectCoordinatedBuying(
                mockConnection,
                new PublicKey('11111111111111111111111111111111'),
                buyerData
            );

            // All should detect high risk
            expect(pumpDumpResult.isPumpDump).toBe(true);
            expect(whaleResult.hasWhaleActivity).toBe(true);
            expect(coordinatedResult.isCoordinated).toBe(true);

            // Combined risk score
            const totalRisk = (pumpDumpResult.score + whaleResult.score + coordinatedResult.score) / 3;
            expect(totalRisk).toBeGreaterThan(50);
        });
    });

    describe('Edge Cases', () => {
        test('should handle zero liquidity', async () => {
            const poolMetrics = {
                currentLiquidity: 0,
                initialLiquidity: 0,
                liquidityGrowthRate: 0,
                holderCount: 0,
                tokenAgeMs: 0,
                recentBuyers: 0,
                creatorAddress: 'test',
            };

            const result = await detectPumpDump(mockConnection, poolMetrics);
            expect(result).toBeDefined();
        });

        test('should handle very old tokens', async () => {
            const poolMetrics = {
                currentLiquidity: 10000,
                initialLiquidity: 10000,
                liquidityGrowthRate: 1.0,
                holderCount: 1000,
                tokenAgeMs: 365 * 24 * 60 * 60 * 1000, // 1 year
                recentBuyers: 5,
                creatorAddress: 'test',
            };

            const result = await detectPumpDump(mockConnection, poolMetrics);
            expect(result.riskLevel).toBe('LOW');
        });

        test('should handle single holder', async () => {
            const holderData = [
                { address: 'only-holder', balance: 1000000, percentOfSupply: 100 },
            ];

            const result = await analyzeWhaleActivity(
                mockConnection,
                new PublicKey('11111111111111111111111111111111'),
                holderData,
                1000000
            );

            expect(result.hasWhaleActivity).toBe(true);
            expect(result.score).toBeGreaterThan(60);
        });
    });

    describe('Performance', () => {
        test('should analyze patterns quickly', async () => {
            const poolMetrics = {
                currentLiquidity: 10000,
                initialLiquidity: 8000,
                liquidityGrowthRate: 1.25,
                holderCount: 50,
                tokenAgeMs: 30 * 60 * 1000,
                recentBuyers: 10,
                creatorAddress: 'test',
            };

            const startTime = Date.now();
            await detectPumpDump(mockConnection, poolMetrics);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(100); // Should be very fast
        });

        test('should handle large holder datasets', async () => {
            const holderData = Array(1000).fill(0).map((_, i) => ({
                address: `holder${i}`,
                balance: 1000,
                percentOfSupply: 0.1,
            }));

            const startTime = Date.now();
            await analyzeWhaleActivity(
                mockConnection,
                new PublicKey('11111111111111111111111111111111'),
                holderData,
                1000000
            );
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(500);
        });
    });
});
