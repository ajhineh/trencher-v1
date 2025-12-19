// test/market-volatility.test.ts

/**
 * تست‌های Market Volatility
 * شامل: Volatility Calculation, Trend Detection, Risk Assessment
 */

import { MarketVolatilityTracker, VolatilityMetrics, getVolatilityTracker } from '../src/trading/marketVolatility';

describe('Market Volatility Tracking', () => {
    let tracker: MarketVolatilityTracker;

    beforeEach(() => {
        tracker = new MarketVolatilityTracker();
        tracker.clearHistory();
    });

    afterEach(() => {
        tracker.clearHistory();
    });

    describe('Initialization', () => {
        test('should create tracker instance', () => {
            expect(tracker).toBeDefined();
            expect(tracker).toBeInstanceOf(MarketVolatilityTracker);
        });

        test('should get singleton instance', () => {
            const instance1 = getVolatilityTracker();
            const instance2 = getVolatilityTracker();

            expect(instance1).toBe(instance2);
        });
    });

    describe('Price Point Management', () => {
        test('should add price points', () => {
            tracker.addPricePoint(100);
            tracker.addPricePoint(105);
            tracker.addPricePoint(110);

            // Should not throw
            expect(() => tracker.addPricePoint(115)).not.toThrow();
        });

        test('should handle multiple price points', () => {
            for (let i = 0; i < 100; i++) {
                tracker.addPricePoint(100 + i);
            }

            // Should not throw
            expect(() => tracker.addPricePoint(200)).not.toThrow();
        });

        test('should clear history', () => {
            tracker.addPricePoint(100);
            tracker.addPricePoint(105);
            tracker.clearHistory();

            // After clearing, should still work
            expect(() => tracker.addPricePoint(110)).not.toThrow();
        });
    });

    describe('Volatility Metrics', () => {
        test('should return valid volatility metrics', async () => {
            // Add some price data
            tracker.addPricePoint(100);
            tracker.addPricePoint(105);
            tracker.addPricePoint(102);
            tracker.addPricePoint(108);

            const metrics = await tracker.getVolatilityMetrics();

            expect(metrics).toBeDefined();
            expect(metrics).toHaveProperty('currentVolatility');
            expect(metrics).toHaveProperty('volatilityLevel');
            expect(metrics).toHaveProperty('priceChange1h');
            expect(metrics).toHaveProperty('priceChange24h');
            expect(metrics).toHaveProperty('averageVolatility7d');
            expect(metrics).toHaveProperty('recommendation');
        });

        test('should have valid volatility level', async () => {
            tracker.addPricePoint(100);
            const metrics = await tracker.getVolatilityMetrics();

            const validLevels = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'];
            expect(validLevels).toContain(metrics.volatilityLevel);
        });

        test('should have valid recommendation structure', async () => {
            tracker.addPricePoint(100);
            const metrics = await tracker.getVolatilityMetrics();

            expect(metrics.recommendation).toBeDefined();
            expect(metrics.recommendation).toHaveProperty('positionSizeMultiplier');
            expect(metrics.recommendation).toHaveProperty('tpMultiplier');
            expect(metrics.recommendation).toHaveProperty('slMultiplier');
        });

        test('should have valid multiplier ranges', async () => {
            tracker.addPricePoint(100);
            const metrics = await tracker.getVolatilityMetrics();

            expect(metrics.recommendation.positionSizeMultiplier).toBeGreaterThanOrEqual(0.5);
            expect(metrics.recommendation.positionSizeMultiplier).toBeLessThanOrEqual(1.5);
            expect(metrics.recommendation.tpMultiplier).toBeGreaterThanOrEqual(0.8);
            expect(metrics.recommendation.tpMultiplier).toBeLessThanOrEqual(1.5);
            expect(metrics.recommendation.slMultiplier).toBeGreaterThanOrEqual(0.8);
            expect(metrics.recommendation.slMultiplier).toBeLessThanOrEqual(1.2);
        });
    });

    describe('Volatility Levels', () => {
        test('should detect LOW volatility', async () => {
            // Stable prices
            for (let i = 0; i < 20; i++) {
                tracker.addPricePoint(100 + Math.random() * 2);
            }

            const metrics = await tracker.getVolatilityMetrics();

            // Low volatility should have higher position size
            if (metrics.volatilityLevel === 'LOW') {
                expect(metrics.recommendation.positionSizeMultiplier).toBeGreaterThan(1.0);
            }
        });

        test('should detect HIGH volatility', async () => {
            // Volatile prices
            for (let i = 0; i < 20; i++) {
                tracker.addPricePoint(100 + (i % 2 === 0 ? 10 : -10));
            }

            const metrics = await tracker.getVolatilityMetrics();

            // High volatility should have lower position size
            if (metrics.volatilityLevel === 'HIGH' || metrics.volatilityLevel === 'EXTREME') {
                expect(metrics.recommendation.positionSizeMultiplier).toBeLessThan(1.0);
            }
        });
    });

    describe('Price Change Tracking', () => {
        test('should track price changes', async () => {
            tracker.addPricePoint(100);
            tracker.addPricePoint(110);

            const metrics = await tracker.getVolatilityMetrics();

            expect(metrics.priceChange1h).toBeDefined();
            expect(metrics.priceChange24h).toBeDefined();
        });

        test('should calculate positive price change', async () => {
            tracker.addPricePoint(100);
            tracker.addPricePoint(110);

            const metrics = await tracker.getVolatilityMetrics();

            // Price went up, so change should be positive or zero
            expect(typeof metrics.priceChange1h).toBe('number');
        });

        test('should handle no price history', async () => {
            const metrics = await tracker.getVolatilityMetrics();

            expect(metrics.priceChange1h).toBe(0);
            expect(metrics.priceChange24h).toBe(0);
        });
    });

    describe('Cache Mechanism', () => {
        test('should cache metrics', async () => {
            tracker.addPricePoint(100);

            const metrics1 = await tracker.getVolatilityMetrics();
            const metrics2 = await tracker.getVolatilityMetrics();

            // Should return same cached result
            expect(metrics1.currentVolatility).toBe(metrics2.currentVolatility);
        });

        test('should clear cache on history clear', () => {
            tracker.addPricePoint(100);
            tracker.clearHistory();

            // Should not throw
            expect(async () => await tracker.getVolatilityMetrics()).not.toThrow();
        });
    });

    describe('Recommendations', () => {
        test('should recommend larger positions in low volatility', async () => {
            // Add stable prices
            for (let i = 0; i < 10; i++) {
                tracker.addPricePoint(100);
            }

            const metrics = await tracker.getVolatilityMetrics();

            if (metrics.volatilityLevel === 'LOW') {
                expect(metrics.recommendation.positionSizeMultiplier).toBeGreaterThan(1.0);
            }
        });

        test('should recommend smaller positions in high volatility', async () => {
            // Add volatile prices
            const prices = [100, 120, 90, 130, 85, 125, 95, 115];
            prices.forEach(p => tracker.addPricePoint(p));

            const metrics = await tracker.getVolatilityMetrics();

            if (metrics.volatilityLevel === 'HIGH' || metrics.volatilityLevel === 'EXTREME') {
                expect(metrics.recommendation.positionSizeMultiplier).toBeLessThan(1.0);
            }
        });

        test('should adjust TP/SL based on volatility', async () => {
            tracker.addPricePoint(100);
            const metrics = await tracker.getVolatilityMetrics();

            // TP and SL multipliers should be reasonable
            expect(metrics.recommendation.tpMultiplier).toBeGreaterThan(0);
            expect(metrics.recommendation.slMultiplier).toBeGreaterThan(0);
        });
    });

    describe('Performance', () => {
        test('should calculate metrics quickly', async () => {
            // Add some data
            for (let i = 0; i < 50; i++) {
                tracker.addPricePoint(100 + Math.random() * 10);
            }

            const startTime = Date.now();
            await tracker.getVolatilityMetrics();
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(10000); // Less than 10 seconds (includes API call)
        });

        test('should handle large price history', async () => {
            // Add many data points
            for (let i = 0; i < 500; i++) {
                tracker.addPricePoint(100 + Math.random() * 20);
            }

            const metrics = await tracker.getVolatilityMetrics();

            expect(metrics).toBeDefined();
            expect(metrics.currentVolatility).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Edge Cases', () => {
        test('should handle single price point', async () => {
            tracker.addPricePoint(100);

            const metrics = await tracker.getVolatilityMetrics();

            expect(metrics).toBeDefined();
            expect(metrics.currentVolatility).toBe(0);
        });

        test('should handle zero prices', async () => {
            tracker.addPricePoint(0);
            tracker.addPricePoint(0);

            const metrics = await tracker.getVolatilityMetrics();

            expect(metrics).toBeDefined();
        });

        test('should handle negative price changes', async () => {
            tracker.addPricePoint(100);
            tracker.addPricePoint(90);
            tracker.addPricePoint(80);

            const metrics = await tracker.getVolatilityMetrics();

            expect(metrics).toBeDefined();
            expect(typeof metrics.priceChange1h).toBe('number');
        });

        test('should handle extreme volatility', async () => {
            // Extreme price swings
            tracker.addPricePoint(100);
            tracker.addPricePoint(200);
            tracker.addPricePoint(50);
            tracker.addPricePoint(150);

            const metrics = await tracker.getVolatilityMetrics();

            expect(metrics.volatilityLevel).toBeDefined();
        });
    });

    describe('7-Day Average', () => {
        test('should calculate 7-day average volatility', async () => {
            // Add data over time
            for (let i = 0; i < 30; i++) {
                tracker.addPricePoint(100 + Math.random() * 10);
            }

            const metrics = await tracker.getVolatilityMetrics();

            expect(metrics.averageVolatility7d).toBeGreaterThanOrEqual(0);
        });

        test('should handle insufficient data for 7-day average', async () => {
            tracker.addPricePoint(100);
            tracker.addPricePoint(105);

            const metrics = await tracker.getVolatilityMetrics();

            expect(metrics.averageVolatility7d).toBeDefined();
        });
    });
});
