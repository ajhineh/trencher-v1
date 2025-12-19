// test/decision/confidenceMetrics.test.ts

/**
 * Unit Tests for Confidence Metrics Calculator
 */

import { calculateConfidence, isHighConfidence, isMediumConfidence, isLowConfidence } from '../../src/decision/confidenceMetrics';
import { RiskScore, RiskCategory } from '../../src/risk/riskScoringSystem';

describe('ConfidenceMetrics', () => {
    // Mock RiskScore helper
    const createMockRiskScore = (
        overall: number,
        category: RiskCategory,
        factorScores: number[] = [40, 40, 40, 40]
    ): RiskScore => ({
        overall,
        category,
        overallScore: overall,
        factors: {
            technical: { overall: factorScores[0], contractSecurity: 40, liquidityRisk: 40, volatilityRisk: 40 },
            market: { overall: factorScores[1], sentimentRisk: 40, volumeRisk: 40, priceRisk: 40 },
            pattern: { overall: factorScores[2], pumpDumpRisk: 40, whaleRisk: 40, coordinatedRisk: 40 },
            portfolio: { overall: factorScores[3], concentrationRisk: 40, correlationRisk: 40, exposureRisk: 40 }
        },
        recommendation: {
            shouldTrade: true,
            maxPosition: 1.0,
            suggestedTP: 50,
            suggestedSL: 10,
            timeHorizon: 'MEDIUM',
            urgency: 'MEDIUM'
        },
        explanation: 'Test risk score',
        warnings: [],
        timestamp: Date.now()
    });

    describe('calculateConfidence', () => {
        it('should calculate high confidence for low risk with consistent factors', () => {
            const riskScore = createMockRiskScore(15, 'LOW', [10, 15, 12, 13]);
            const confidence = calculateConfidence(riskScore);

            expect(confidence.overall).toBeGreaterThan(0.7);
            expect(confidence.overall).toBeLessThanOrEqual(1.0);
            expect(confidence.layerAgreement).toBeGreaterThan(0);
            expect(confidence.dataQuality).toBeGreaterThan(0);
            expect(confidence.historicalAccuracy).toBeGreaterThan(0);
        });

        it('should calculate lower confidence for medium risk', () => {
            const riskScore = createMockRiskScore(50, 'MEDIUM', [45, 50, 55, 48]);
            const confidence = calculateConfidence(riskScore);

            expect(confidence.overall).toBeGreaterThan(0.4);
            expect(confidence.overall).toBeLessThan(0.9);
        });

        it('should calculate high confidence for critical risk', () => {
            const riskScore = createMockRiskScore(90, 'CRITICAL', [85, 90, 95, 88]);
            const confidence = calculateConfidence(riskScore);

            // Critical risk should have high confidence (we're confident it's bad)
            expect(confidence.overall).toBeGreaterThan(0.6);
        });

        it('should penalize confidence for many warnings', () => {
            const riskScoreNoWarnings = createMockRiskScore(40, 'MEDIUM');
            const riskScoreWithWarnings = {
                ...createMockRiskScore(40, 'MEDIUM'),
                warnings: ['Warning 1', 'Warning 2', 'Warning 3', 'Warning 4', 'Warning 5']
            };

            const confidenceNoWarnings = calculateConfidence(riskScoreNoWarnings);
            const confidenceWithWarnings = calculateConfidence(riskScoreWithWarnings);

            expect(confidenceWithWarnings.dataQuality).toBeLessThan(confidenceNoWarnings.dataQuality);
        });

        it('should handle inconsistent risk factors', () => {
            // Very inconsistent factors (0, 100, 50, 25)
            const riskScore = createMockRiskScore(43, 'MEDIUM', [0, 100, 50, 25]);
            const confidence = calculateConfidence(riskScore);

            // Should have lower consistency score
            expect(confidence.breakdown.riskFactorsConsistency).toBeLessThan(0.7);
        });

        it('should return valid confidence range (0-1)', () => {
            const testCases = [
                createMockRiskScore(0, 'LOW'),
                createMockRiskScore(25, 'MEDIUM'),
                createMockRiskScore(50, 'MEDIUM'),
                createMockRiskScore(75, 'HIGH'),
                createMockRiskScore(100, 'CRITICAL')
            ];

            testCases.forEach(riskScore => {
                const confidence = calculateConfidence(riskScore);
                expect(confidence.overall).toBeGreaterThanOrEqual(0);
                expect(confidence.overall).toBeLessThanOrEqual(1);
                expect(confidence.layerAgreement).toBeGreaterThanOrEqual(0);
                expect(confidence.layerAgreement).toBeLessThanOrEqual(1);
                expect(confidence.dataQuality).toBeGreaterThanOrEqual(0);
                expect(confidence.dataQuality).toBeLessThanOrEqual(1);
                expect(confidence.historicalAccuracy).toBeGreaterThanOrEqual(0);
                expect(confidence.historicalAccuracy).toBeLessThanOrEqual(1);
            });
        });
    });

    describe('isHighConfidence', () => {
        it('should return true for confidence >= 0.85', () => {
            const confidence = { overall: 0.85, layerAgreement: 0.9, dataQuality: 0.8, historicalAccuracy: 0.85, breakdown: {} as any };
            expect(isHighConfidence(confidence)).toBe(true);
        });

        it('should return true for confidence > 0.85', () => {
            const confidence = { overall: 0.92, layerAgreement: 0.95, dataQuality: 0.9, historicalAccuracy: 0.9, breakdown: {} as any };
            expect(isHighConfidence(confidence)).toBe(true);
        });

        it('should return false for confidence < 0.85', () => {
            const confidence = { overall: 0.84, layerAgreement: 0.8, dataQuality: 0.85, historicalAccuracy: 0.87, breakdown: {} as any };
            expect(isHighConfidence(confidence)).toBe(false);
        });
    });

    describe('isMediumConfidence', () => {
        it('should return true for confidence between 0.60 and 0.85', () => {
            const confidence = { overall: 0.70, layerAgreement: 0.7, dataQuality: 0.7, historicalAccuracy: 0.7, breakdown: {} as any };
            expect(isMediumConfidence(confidence)).toBe(true);
        });

        it('should return false for confidence >= 0.85', () => {
            const confidence = { overall: 0.85, layerAgreement: 0.85, dataQuality: 0.85, historicalAccuracy: 0.85, breakdown: {} as any };
            expect(isMediumConfidence(confidence)).toBe(false);
        });

        it('should return false for confidence < 0.60', () => {
            const confidence = { overall: 0.59, layerAgreement: 0.6, dataQuality: 0.58, historicalAccuracy: 0.6, breakdown: {} as any };
            expect(isMediumConfidence(confidence)).toBe(false);
        });
    });

    describe('isLowConfidence', () => {
        it('should return true for confidence < 0.60', () => {
            const confidence = { overall: 0.50, layerAgreement: 0.5, dataQuality: 0.5, historicalAccuracy: 0.5, breakdown: {} as any };
            expect(isLowConfidence(confidence)).toBe(true);
        });

        it('should return false for confidence >= 0.60', () => {
            const confidence = { overall: 0.60, layerAgreement: 0.6, dataQuality: 0.6, historicalAccuracy: 0.6, breakdown: {} as any };
            expect(isLowConfidence(confidence)).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        it('should handle zero risk score', () => {
            const riskScore = createMockRiskScore(0, 'LOW', [0, 0, 0, 0]);
            const confidence = calculateConfidence(riskScore);

            expect(confidence.overall).toBeGreaterThanOrEqual(0);
            expect(confidence.overall).toBeLessThanOrEqual(1);
        });

        it('should handle maximum risk score', () => {
            const riskScore = createMockRiskScore(100, 'CRITICAL', [100, 100, 100, 100]);
            const confidence = calculateConfidence(riskScore);

            expect(confidence.overall).toBeGreaterThanOrEqual(0);
            expect(confidence.overall).toBeLessThanOrEqual(1);
        });

        it('should handle missing security checks', () => {
            const riskScore = createMockRiskScore(50, 'MEDIUM');
            const confidence = calculateConfidence(riskScore, undefined);

            // Should still work with default values
            expect(confidence.overall).toBeGreaterThanOrEqual(0);
            expect(confidence.overall).toBeLessThanOrEqual(1);
        });
    });
});
