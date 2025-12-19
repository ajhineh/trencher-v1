// src/decision/confidenceMetrics.ts

/**
 * Confidence Metrics Calculator
 * محاسبه میزان اطمینان تصمیم بر اساس توافق بین layers و کیفیت داده
 */

import { RiskScore, RiskFactors } from '../risk/riskScoringSystem';
import { EnhancedSecurityCheckResult } from '../analysis/enhancedSecurityIntegration';

export interface ConfidenceMetrics {
    overall: number; // 0-1 (میزان اطمینان کلی)
    layerAgreement: number; // 0-1 (میزان توافق بین security layers)
    dataQuality: number; // 0-1 (کیفیت داده‌های ورودی)
    historicalAccuracy: number; // 0-1 (دقت تاریخی برای این دسته)
    breakdown: {
        securityLayersAgreement: number;
        riskFactorsConsistency: number;
        dataCompleteness: number;
        categoryConfidence: number;
    };
}

/**
 * محاسبه confidence metrics برای یک تصمیم
 */
export function calculateConfidence(
    riskScore: RiskScore,
    securityChecks?: EnhancedSecurityCheckResult
): ConfidenceMetrics {
    // 1. محاسبه توافق بین security layers
    const layerAgreement = calculateLayerAgreement(securityChecks);

    // 2. محاسبه کیفیت داده
    const dataQuality = calculateDataQuality(riskScore);

    // 3. دقت تاریخی بر اساس category
    const historicalAccuracy = getHistoricalAccuracy(riskScore.category);

    // 4. محاسبه consistency بین risk factors
    const riskFactorsConsistency = calculateRiskFactorsConsistency(riskScore.factors);

    // 5. محاسبه data completeness
    const dataCompleteness = calculateDataCompleteness(riskScore, securityChecks);

    // 6. confidence بر اساس category
    const categoryConfidence = getCategoryConfidence(riskScore.category, riskScore.overall);

    // محاسبه overall confidence (weighted average)
    const overall = (
        layerAgreement * 0.35 +
        dataQuality * 0.25 +
        historicalAccuracy * 0.20 +
        riskFactorsConsistency * 0.20
    );

    return {
        overall: Math.min(1, Math.max(0, overall)),
        layerAgreement,
        dataQuality,
        historicalAccuracy,
        breakdown: {
            securityLayersAgreement: layerAgreement,
            riskFactorsConsistency,
            dataCompleteness,
            categoryConfidence
        }
    };
}

/**
 * محاسبه میزان توافق بین security layers
 */
function calculateLayerAgreement(securityChecks?: EnhancedSecurityCheckResult): number {
    if (!securityChecks || !securityChecks.detailedAnalysis) {
        return 0.5; // default medium confidence
    }

    const { detailedAnalysis } = securityChecks;
    const checks = [
        detailedAnalysis.blacklistCheck,
        detailedAnalysis.honeypotCheck,
        detailedAnalysis.lockCheck,
        detailedAnalysis.holderActivityCheck,
        detailedAnalysis.dynamicThresholdEvaluation
    ];

    // تعداد checks که نتیجه قطعی دارند
    const decisiveChecks = checks.filter(check => {
        if (!check) return false;
        // اگر risk score خیلی بالا یا خیلی پایین باشد = decisive
        const riskScore = check.riskScore || check.overallRisk || 50;
        return riskScore < 20 || riskScore > 80;
    });

    // اگر همه checks موافق باشند = high agreement
    const allAgree = decisiveChecks.length >= 3;

    if (allAgree) {
        return 0.9; // high agreement
    } else if (decisiveChecks.length >= 2) {
        return 0.7; // medium agreement
    } else {
        return 0.5; // low agreement
    }
}

/**
 * محاسبه کیفیت داده‌های ورودی
 */
function calculateDataQuality(riskScore: RiskScore): number {
    const { factors, warnings } = riskScore;

    // اگر warnings زیاد باشد = data quality پایین
    const warningPenalty = Math.min(0.3, warnings.length * 0.05);

    // بررسی completeness of risk factors
    const factorScores = [
        factors.technical.overall,
        factors.market.overall,
        factors.pattern.overall,
        factors.portfolio.overall
    ];

    // اگر همه factors محاسبه شده باشند = high quality
    const allFactorsCalculated = factorScores.every(score => score > 0);
    const qualityBonus = allFactorsCalculated ? 0.2 : 0;

    // base quality
    let quality = 0.7 - warningPenalty + qualityBonus;

    return Math.min(1, Math.max(0, quality));
}

/**
 * دقت تاریخی بر اساس risk category
 */
function getHistoricalAccuracy(category: string): number {
    // این مقادیر بر اساس تست‌های واقعی تنظیم می‌شوند
    const accuracyMap: Record<string, number> = {
        'LOW': 0.95,      // دقت بالا برای low risk
        'MEDIUM': 0.85,   // دقت خوب برای medium risk
        'HIGH': 0.75,     // دقت متوسط برای high risk
        'CRITICAL': 0.90  // دقت بالا برای critical (معمولاً reject می‌شوند)
    };

    return accuracyMap[category] || 0.80;
}

/**
 * محاسبه consistency بین risk factors
 */
function calculateRiskFactorsConsistency(factors: RiskFactors): number {
    const scores = [
        factors.technical.overall,
        factors.market.overall,
        factors.pattern.overall,
        factors.portfolio.overall
    ];

    // محاسبه standard deviation
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    // اگر std dev پایین باشد = high consistency
    // std dev بین 0-50 را map می‌کنیم به 1-0
    const consistency = Math.max(0, 1 - (stdDev / 50));

    return consistency;
}

/**
 * محاسبه data completeness
 */
function calculateDataCompleteness(
    riskScore: RiskScore,
    securityChecks?: EnhancedSecurityCheckResult
): number {
    let completeness = 0;
    let totalChecks = 0;

    // Risk score factors
    if (riskScore.factors.technical.overall > 0) completeness++;
    totalChecks++;

    if (riskScore.factors.market.overall > 0) completeness++;
    totalChecks++;

    if (riskScore.factors.pattern.overall > 0) completeness++;
    totalChecks++;

    if (riskScore.factors.portfolio.overall > 0) completeness++;
    totalChecks++;

    // Security checks
    if (securityChecks) {
        if (securityChecks.detailedAnalysis.blacklistCheck) completeness++;
        totalChecks++;

        if (securityChecks.detailedAnalysis.honeypotCheck) completeness++;
        totalChecks++;

        if (securityChecks.detailedAnalysis.lockCheck) completeness++;
        totalChecks++;
    }

    return totalChecks > 0 ? completeness / totalChecks : 0.5;
}

/**
 * confidence بر اساس category و score
 */
function getCategoryConfidence(category: string, overallScore: number): number {
    // برای extreme scores (خیلی پایین یا خیلی بالا) = high confidence
    if (overallScore < 15 || overallScore > 85) {
        return 0.95;
    }

    // برای scores متوسط = lower confidence
    if (overallScore >= 40 && overallScore <= 60) {
        return 0.60;
    }

    // default
    return 0.75;
}

/**
 * تعیین آیا confidence برای تصمیم سریع کافی است
 */
export function isHighConfidence(confidence: ConfidenceMetrics): boolean {
    return confidence.overall >= 0.85;
}

/**
 * تعیین آیا confidence برای استفاده از classifier کافی است
 */
export function isMediumConfidence(confidence: ConfidenceMetrics): boolean {
    return confidence.overall >= 0.60 && confidence.overall < 0.85;
}

/**
 * تعیین آیا نیاز به DQN یا تحلیل عمیق‌تر است
 */
export function isLowConfidence(confidence: ConfidenceMetrics): boolean {
    return confidence.overall < 0.60;
}
