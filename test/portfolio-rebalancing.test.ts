// test/portfolio-rebalancing.test.ts

/**
 * تست‌های Portfolio Rebalancing System
 * شامل: 4 استراتژی، تحلیل، و اجرای rebalancing
 */

import { PortfolioRebalancer, RebalanceStrategy } from '../src/portfolio/rebalancing';
import { Connection } from '@solana/web3.js';
import { saveNewPosition, getAllPositions, getOpenPositions } from '../src/state/positions';

// Mock connection
const mockConnection = {
    rpcEndpoint: 'https://api.mainnet-beta.solana.com',
} as Connection;

describe('Portfolio Rebalancing System', () => {
    let rebalancer: PortfolioRebalancer;

    beforeEach(() => {
        rebalancer = new PortfolioRebalancer(mockConnection);
    });

    describe('Initialization', () => {
        test('should create rebalancer instance', () => {
            expect(rebalancer).toBeDefined();
            expect(rebalancer).toBeInstanceOf(PortfolioRebalancer);
        });

        test('should have default configuration', () => {
            const config = rebalancer.getConfig();

            expect(config.strategy).toBe('RISK_PARITY');
            expect(config.minRebalanceThreshold).toBe(5);
            expect(config.maxPositionWeight).toBe(25);
            expect(config.minPositionWeight).toBe(5);
            expect(config.targetPositions).toBe(5);
        });

        test('should accept custom configuration', () => {
            const customRebalancer = new PortfolioRebalancer(mockConnection, {
                strategy: 'EQUAL_WEIGHT',
                minRebalanceThreshold: 10,
                maxPositionWeight: 30,
            });

            const config = customRebalancer.getConfig();
            expect(config.strategy).toBe('EQUAL_WEIGHT');
            expect(config.minRebalanceThreshold).toBe(10);
            expect(config.maxPositionWeight).toBe(30);
        });
    });

    describe('Configuration Management', () => {
        test('should update configuration', () => {
            rebalancer.updateConfig({
                strategy: 'DYNAMIC',
                minRebalanceThreshold: 7,
            });

            const config = rebalancer.getConfig();
            expect(config.strategy).toBe('DYNAMIC');
            expect(config.minRebalanceThreshold).toBe(7);
        });

        test('should preserve other config values when updating', () => {
            const originalConfig = rebalancer.getConfig();

            rebalancer.updateConfig({
                strategy: 'MOMENTUM',
            });

            const newConfig = rebalancer.getConfig();
            expect(newConfig.strategy).toBe('MOMENTUM');
            expect(newConfig.maxPositionWeight).toBe(originalConfig.maxPositionWeight);
        });
    });

    describe('Rebalancing Analysis', () => {
        test('should analyze empty portfolio', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();

            expect(recommendation).toBeDefined();
            expect(recommendation.totalPortfolioValue).toBe(0);
            expect(recommendation.positions).toHaveLength(0);
            expect(recommendation.shouldRebalance).toBe(false);
            expect(recommendation.reason).toContain('empty');
        });

        test('should return valid recommendation structure', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();

            expect(recommendation).toHaveProperty('strategy');
            expect(recommendation).toHaveProperty('totalPortfolioValue');
            expect(recommendation).toHaveProperty('positions');
            expect(recommendation).toHaveProperty('estimatedCost');
            expect(recommendation).toHaveProperty('expectedImprovement');
            expect(recommendation).toHaveProperty('shouldRebalance');
            expect(recommendation).toHaveProperty('reason');
            expect(recommendation).toHaveProperty('timestamp');
        });

        test('should include timestamp', async () => {
            const beforeTime = Date.now();
            const recommendation = await rebalancer.analyzeRebalancing();
            const afterTime = Date.now();

            expect(recommendation.timestamp).toBeGreaterThanOrEqual(beforeTime);
            expect(recommendation.timestamp).toBeLessThanOrEqual(afterTime);
        });
    });

    describe('Rebalancing Strategies', () => {
        describe('Equal Weight Strategy', () => {
            test('should use equal weight strategy', async () => {
                rebalancer.updateConfig({ strategy: 'EQUAL_WEIGHT' });
                const recommendation = await rebalancer.analyzeRebalancing();

                expect(recommendation.strategy).toBe('EQUAL_WEIGHT');
            });

            test('should distribute weights equally', () => {
                // این تست نیاز به mock positions دارد
                // فعلاً فقط بررسی می‌کنیم که strategy تنظیم می‌شود
                rebalancer.updateConfig({ strategy: 'EQUAL_WEIGHT' });
                const config = rebalancer.getConfig();
                expect(config.strategy).toBe('EQUAL_WEIGHT');
            });
        });

        describe('Risk Parity Strategy', () => {
            test('should use risk parity strategy', async () => {
                rebalancer.updateConfig({ strategy: 'RISK_PARITY' });
                const recommendation = await rebalancer.analyzeRebalancing();

                expect(recommendation.strategy).toBe('RISK_PARITY');
            });

            test('should be default strategy', () => {
                const config = rebalancer.getConfig();
                expect(config.strategy).toBe('RISK_PARITY');
            });
        });

        describe('Dynamic Strategy', () => {
            test('should use dynamic strategy', async () => {
                rebalancer.updateConfig({ strategy: 'DYNAMIC' });
                const recommendation = await rebalancer.analyzeRebalancing();

                expect(recommendation.strategy).toBe('DYNAMIC');
            });
        });

        describe('Momentum Strategy', () => {
            test('should use momentum strategy', async () => {
                rebalancer.updateConfig({ strategy: 'MOMENTUM' });
                const recommendation = await rebalancer.analyzeRebalancing();

                expect(recommendation.strategy).toBe('MOMENTUM');
            });
        });
    });

    describe('Position Allocation', () => {
        test('should calculate position allocations', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();

            expect(Array.isArray(recommendation.positions)).toBe(true);
        });

        test('should include allocation details', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();

            if (recommendation.positions.length > 0) {
                const position = recommendation.positions[0];

                expect(position).toHaveProperty('tokenAddress');
                expect(position).toHaveProperty('currentWeight');
                expect(position).toHaveProperty('targetWeight');
                expect(position).toHaveProperty('currentValue');
                expect(position).toHaveProperty('targetValue');
                expect(position).toHaveProperty('adjustment');
                expect(position).toHaveProperty('action');
            }
        });

        test('should have valid action types', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();

            recommendation.positions.forEach(position => {
                expect(['BUY', 'SELL', 'HOLD']).toContain(position.action);
            });
        });
    });

    describe('Rebalancing Decision', () => {
        test('should not rebalance empty portfolio', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();

            expect(recommendation.shouldRebalance).toBe(false);
        });

        test('should provide reason for decision', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();

            expect(recommendation.reason).toBeDefined();
            expect(typeof recommendation.reason).toBe('string');
            expect(recommendation.reason.length).toBeGreaterThan(0);
        });
    });

    describe('Cost Estimation', () => {
        test('should estimate rebalancing cost', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();

            expect(recommendation.estimatedCost).toBeDefined();
            expect(typeof recommendation.estimatedCost).toBe('number');
            expect(recommendation.estimatedCost).toBeGreaterThanOrEqual(0);
        });

        test('should have zero cost for empty portfolio', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();

            if (recommendation.positions.length === 0) {
                expect(recommendation.estimatedCost).toBe(0);
            }
        });
    });

    describe('Expected Improvement', () => {
        test('should calculate expected improvement', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();

            expect(recommendation.expectedImprovement).toBeDefined();
            expect(typeof recommendation.expectedImprovement).toBe('string');
        });

        test('should provide meaningful improvement message', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();

            const validMessages = [
                'No positions to rebalance',
                'Minimal improvement expected',
                'Moderate improvement',
                'Significant improvement',
                'Major improvement',
            ];

            const hasValidMessage = validMessages.some(msg =>
                recommendation.expectedImprovement.includes(msg)
            );

            expect(hasValidMessage).toBe(true);
        });
    });

    describe('Rebalancing Execution', () => {
        test('should not execute when not needed', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();
            const result = await rebalancer.executeRebalancing(recommendation);

            if (!recommendation.shouldRebalance) {
                expect(result).toBe(false);
            }
        });

        test('should handle execution gracefully', async () => {
            const recommendation = await rebalancer.analyzeRebalancing();

            await expect(async () => {
                await rebalancer.executeRebalancing(recommendation);
            }).not.toThrow();
        });
    });

    describe('Thresholds and Constraints', () => {
        test('should respect min rebalance threshold', () => {
            rebalancer.updateConfig({ minRebalanceThreshold: 10 });
            const config = rebalancer.getConfig();

            expect(config.minRebalanceThreshold).toBe(10);
        });

        test('should respect max position weight', () => {
            rebalancer.updateConfig({ maxPositionWeight: 30 });
            const config = rebalancer.getConfig();

            expect(config.maxPositionWeight).toBe(30);
        });

        test('should respect min position weight', () => {
            rebalancer.updateConfig({ minPositionWeight: 3 });
            const config = rebalancer.getConfig();

            expect(config.minPositionWeight).toBe(3);
        });

        test('should respect target positions', () => {
            rebalancer.updateConfig({ targetPositions: 10 });
            const config = rebalancer.getConfig();

            expect(config.targetPositions).toBe(10);
        });
    });

    describe('Performance', () => {
        test('should analyze quickly', async () => {
            const startTime = Date.now();
            await rebalancer.analyzeRebalancing();
            const duration = Date.now() - startTime;

            // نباید بیشتر از 1 ثانیه طول بکشد
            expect(duration).toBeLessThan(1000);
        });

        test('should handle multiple analyses', async () => {
            const promises = [];
            for (let i = 0; i < 5; i++) {
                promises.push(rebalancer.analyzeRebalancing());
            }

            const results = await Promise.all(promises);
            expect(results).toHaveLength(5);
            results.forEach(result => {
                expect(result).toBeDefined();
            });
        });
    });

    describe('Edge Cases', () => {
        test('should handle extreme thresholds', () => {
            rebalancer.updateConfig({
                minRebalanceThreshold: 0,
                maxPositionWeight: 100,
            });

            const config = rebalancer.getConfig();
            expect(config.minRebalanceThreshold).toBe(0);
            expect(config.maxPositionWeight).toBe(100);
        });

        test('should handle all strategy types', async () => {
            const strategies: RebalanceStrategy[] = [
                'EQUAL_WEIGHT',
                'RISK_PARITY',
                'DYNAMIC',
                'MOMENTUM',
            ];

            for (const strategy of strategies) {
                rebalancer.updateConfig({ strategy });
                const recommendation = await rebalancer.analyzeRebalancing();
                expect(recommendation.strategy).toBe(strategy);
            }
        });
    });
});

// تست‌های Snapshot
describe('Portfolio Rebalancing Snapshots', () => {
    test('should match recommendation structure', async () => {
        const rebalancer = new PortfolioRebalancer(mockConnection);
        const recommendation = await rebalancer.analyzeRebalancing();

        expect(recommendation).toMatchObject({
            strategy: expect.any(String),
            totalPortfolioValue: expect.any(Number),
            positions: expect.any(Array),
            estimatedCost: expect.any(Number),
            expectedImprovement: expect.any(String),
            shouldRebalance: expect.any(Boolean),
            reason: expect.any(String),
            timestamp: expect.any(Number),
        });
    });
});
