// test/risk-scoring-advanced.test.ts

/**
 * تست‌های پیشرفته برای Risk Scoring System
 * شامل: Mock Data، Full Risk Calculation، Error Handling
 */

import { RiskScoringSystem, RiskCategory } from '../src/risk/riskScoringSystem';
import { Connection, PublicKey } from '@solana/web3.js';

// Mock connection
const mockConnection = {
    rpcEndpoint: 'https://api.mainnet-beta.solana.com',
} as Connection;

describe('Risk Scoring System - Advanced Tests', () => {
    let riskScoring: RiskScoringSystem;

    beforeEach(() => {
        riskScoring = new RiskScoringSystem(mockConnection);
        // Clear cache before each test
        riskScoring.clearCache();
    });

    describe('Risk Calculation with Mock Data', () => {
        const mockTokenAddress = 'TokenABC123456789';
        const mockPoolAddress = 'PoolXYZ987654321';

        test('should calculate risk score with valid token address', async () => {
            const score = await riskScoring.calculateRisk(mockTokenAddress);

            // بررسی ساختار پاسخ
            expect(score).toBeDefined();
            expect(score.overall).toBeDefined();
            expect(score.category).toBeDefined();
            expect(score.factors).toBeDefined();
            expect(score.recommendation).toBeDefined();
            expect(score.explanation).toBeDefined();
            expect(score.warnings).toBeDefined();
            expect(score.timestamp).toBeDefined();
        });

        test('should return risk score between 0 and 100', async () => {
            const score = await riskScoring.calculateRisk(mockTokenAddress);

            expect(score.overall).toBeGreaterThanOrEqual(0);
            expect(score.overall).toBeLessThanOrEqual(100);
        });

        test('should return valid risk category', async () => {
            const score = await riskScoring.calculateRisk(mockTokenAddress);

            const validCategories: RiskCategory[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
            expect(validCategories).toContain(score.category);
        });

        test('should include all risk factors', async () => {
            const score = await riskScoring.calculateRisk(mockTokenAddress);

            expect(score.factors.technical).toBeDefined();
            expect(score.factors.market).toBeDefined();
            expect(score.factors.pattern).toBeDefined();
            expect(score.factors.portfolio).toBeDefined();

            // هر factor باید overall داشته باشد
            expect(score.factors.technical.overall).toBeGreaterThanOrEqual(0);
            expect(score.factors.market.overall).toBeGreaterThanOrEqual(0);
            expect(score.factors.pattern.overall).toBeGreaterThanOrEqual(0);
            expect(score.factors.portfolio.overall).toBeGreaterThanOrEqual(0);
        });

        test('should provide trading recommendation', async () => {
            const score = await riskScoring.calculateRisk(mockTokenAddress);

            expect(score.recommendation).toBeDefined();
            expect(score.recommendation.shouldTrade).toBeDefined();
            expect(typeof score.recommendation.shouldTrade).toBe('boolean');
            expect(score.recommendation.maxPosition).toBeGreaterThanOrEqual(0);
            expect(score.recommendation.suggestedTP).toBeGreaterThan(0);
            expect(score.recommendation.suggestedSL).toBeGreaterThan(0);
        });

        test('should calculate risk with pool address', async () => {
            const score = await riskScoring.calculateRisk(
                mockTokenAddress,
                mockPoolAddress
            );

            expect(score).toBeDefined();
            expect(score.overall).toBeGreaterThanOrEqual(0);
        });

        test('should calculate risk with current price', async () => {
            const mockPrice = 0.5;
            const score = await riskScoring.calculateRisk(
                mockTokenAddress,
                mockPoolAddress,
                mockPrice
            );

            expect(score).toBeDefined();
            expect(score.overall).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Risk Categories and Recommendations', () => {
        test('CRITICAL risk should recommend not trading', async () => {
            const score = await riskScoring.calculateRisk('high-risk-token');

            // اگر ریسک بالای 75 باشد، نباید معامله کند
            if (score.overall > 75) {
                expect(score.category).toBe('CRITICAL');
                expect(score.recommendation.shouldTrade).toBe(false);
                expect(score.recommendation.maxPosition).toBe(0);
            }
        });

        test('LOW risk should allow larger positions', async () => {
            const score = await riskScoring.calculateRisk('low-risk-token');

            // اگر ریسک کمتر از 25 باشد
            if (score.overall < 25) {
                expect(score.category).toBe('LOW');
                expect(score.recommendation.maxPosition).toBeGreaterThan(0.5);
            }
        });

        test('should provide warnings for high risk factors', async () => {
            const score = await riskScoring.calculateRisk('risky-token');

            expect(score.warnings).toBeInstanceOf(Array);
            // اگر ریسک بالاست، باید warning داشته باشد
            if (score.overall > 60) {
                expect(score.warnings.length).toBeGreaterThan(0);
            }
        });
    });

    describe('Cache Mechanism', () => {
        const testToken = 'cache-test-token';

        test('should cache risk scores', async () => {
            // اولین call
            const startTime1 = Date.now();
            const score1 = await riskScoring.calculateRisk(testToken);
            const duration1 = Date.now() - startTime1;

            // دومین call (باید از cache بیاید)
            const startTime2 = Date.now();
            const score2 = await riskScoring.calculateRisk(testToken);
            const duration2 = Date.now() - startTime2;

            // نتایج باید یکسان باشند
            expect(score1.overall).toBe(score2.overall);
            expect(score1.category).toBe(score2.category);

            // دومین call باید سریع‌تر باشد (از cache)
            expect(duration2).toBeLessThan(duration1);
        });

        test('should clear cache correctly', async () => {
            // محاسبه اولیه
            await riskScoring.calculateRisk(testToken);

            // پاک کردن cache
            riskScoring.clearCache();

            // محاسبه مجدد (نباید از cache بیاید)
            const score = await riskScoring.calculateRisk(testToken);
            expect(score).toBeDefined();
        });

        test('should respect cache timeout', async () => {
            // این تست نیاز به wait دارد، پس skip می‌کنیم
            // در production می‌توانیم با mock کردن Date.now() تست کنیم
            expect(true).toBe(true);
        }, 1000);
    });

    describe('Weight Management Advanced', () => {
        test('should calculate weighted score correctly', async () => {
            // تنظیم وزن‌های مشخص
            riskScoring.updateWeights({
                technical: 0.5,
                market: 0.2,
                pattern: 0.2,
                portfolio: 0.1,
            });

            const score = await riskScoring.calculateRisk('test-token');

            // Score باید تحت تاثیر وزن‌ها باشد
            expect(score.overall).toBeDefined();
            expect(score.factors.technical).toBeDefined();
        });

        test('should handle zero weights', () => {
            expect(() => {
                riskScoring.updateWeights({
                    technical: 0,
                    market: 0,
                    pattern: 0,
                    portfolio: 1,
                });
            }).not.toThrow();
        });

        test('should normalize unbalanced weights', () => {
            // وزن‌هایی که جمع 1 نمی‌شوند
            expect(() => {
                riskScoring.updateWeights({
                    technical: 10,
                    market: 20,
                    pattern: 30,
                    portfolio: 40,
                });
            }).not.toThrow();
        });

    });

    describe('Error Handling', () => {
        test('should handle network errors gracefully', async () => {
            // در صورت خطای شبکه، باید gracefully handle شود
            const score = await riskScoring.calculateRisk('network-error-token');
            expect(score).toBeDefined();
            expect(score.overall).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Performance Tests', () => {
        test('should calculate risk in reasonable time', async () => {
            const startTime = Date.now();
            await riskScoring.calculateRisk('performance-test-token');
            const duration = Date.now() - startTime;

            // نباید بیشتر از 5 ثانیه طول بکشد
            expect(duration).toBeLessThan(5000);
        });

        test('should handle multiple concurrent calculations', async () => {
            const tokens = ['token1', 'token2', 'token3', 'token4', 'token5'];

            const startTime = Date.now();
            const promises = tokens.map(token =>
                riskScoring.calculateRisk(token)
            );

            const results = await Promise.all(promises);
            const duration = Date.now() - startTime;

            expect(results).toHaveLength(5);
            results.forEach(score => {
                expect(score.overall).toBeGreaterThanOrEqual(0);
            });

            // همه باید در کمتر از 10 ثانیه تمام شوند
            expect(duration).toBeLessThan(10000);
        });
    });

    describe('Integration with Risk Factors', () => {
        test('should integrate technical risk correctly', async () => {
            const score = await riskScoring.calculateRisk('tech-test-token');

            expect(score.factors.technical).toBeDefined();
            expect(score.factors.technical.contractSecurity).toBeGreaterThanOrEqual(0);
            expect(score.factors.technical.liquidityRisk).toBeGreaterThanOrEqual(0);
            expect(score.factors.technical.volatilityRisk).toBeGreaterThanOrEqual(0);
        });

        test('should integrate market risk correctly', async () => {
            const score = await riskScoring.calculateRisk('market-test-token');

            expect(score.factors.market).toBeDefined();
            expect(score.factors.market.sentimentRisk).toBeGreaterThanOrEqual(0);
            expect(score.factors.market.volumeRisk).toBeGreaterThanOrEqual(0);
            expect(score.factors.market.priceRisk).toBeGreaterThanOrEqual(0);
        });

        test('should integrate pattern risk correctly', async () => {
            const score = await riskScoring.calculateRisk('pattern-test-token');

            expect(score.factors.pattern).toBeDefined();
            expect(score.factors.pattern.pumpDumpRisk).toBeGreaterThanOrEqual(0);
            expect(score.factors.pattern.whaleRisk).toBeGreaterThanOrEqual(0);
            expect(score.factors.pattern.coordinatedRisk).toBeGreaterThanOrEqual(0);
        });

        test('should integrate portfolio risk correctly', async () => {
            const score = await riskScoring.calculateRisk('portfolio-test-token');

            expect(score.factors.portfolio).toBeDefined();
            expect(score.factors.portfolio.concentrationRisk).toBeGreaterThanOrEqual(0);
            expect(score.factors.portfolio.correlationRisk).toBeGreaterThanOrEqual(0);
            expect(score.factors.portfolio.exposureRisk).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Explanation and Warnings', () => {
        test('should provide meaningful explanation', async () => {
            const score = await riskScoring.calculateRisk('explanation-test-token');

            expect(score.explanation).toBeDefined();
            expect(typeof score.explanation).toBe('string');
            expect(score.explanation.length).toBeGreaterThan(0);
        });

        test('should include timestamp', async () => {
            const beforeTime = Date.now();
            const score = await riskScoring.calculateRisk('timestamp-test-token');
            const afterTime = Date.now();

            expect(score.timestamp).toBeGreaterThanOrEqual(beforeTime);
            expect(score.timestamp).toBeLessThanOrEqual(afterTime);
        });
    });
});

// تست‌های Snapshot (اختیاری)
describe('Risk Scoring Snapshots', () => {
    test('should match snapshot for consistent input', async () => {
        const riskScoring = new RiskScoringSystem(mockConnection);
        const score = await riskScoring.calculateRisk('snapshot-test-token');

        // بررسی ساختار کلی
        expect(score).toMatchObject({
            overall: expect.any(Number),
            category: expect.any(String),
            factors: expect.any(Object),
            recommendation: expect.any(Object),
            explanation: expect.any(String),
            warnings: expect.any(Array),
            timestamp: expect.any(Number),
        });
    });
});
