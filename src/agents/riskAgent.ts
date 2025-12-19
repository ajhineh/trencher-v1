// src/agents/riskAgent.ts

import OpenAI from "openai";
import { logger } from "../logger";

function makeOpenAIClient() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    return new OpenAI({ apiKey: key });
}

export interface RiskAssessment {
    approved: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    riskScore: number; // 0-100, higher = more risky
    adjustedAmount: number; // risk-adjusted position size
    tpPercent: number;
    slPercent: number;
    warnings: string[];
}

/**
 * Risk Agent - Specialized risk assessment
 * Purpose: Final risk check and position sizing
 */
export async function riskAgent(ctx: {
    baseMint: string;
    analystDecision: any;
    pumpDumpSignals: any;
    whaleRisk: boolean;
    portfolioMetrics: any;
    volatilityMetrics: any;
}): Promise<RiskAssessment> {
    const prompt = `You are a RISK AGENT for a trading bot. Your job is RISK ASSESSMENT.

Analyst Recommendation:
- Should Buy: ${ctx.analystDecision.shouldBuy}
- Confidence: ${ctx.analystDecision.confidence}%
- Suggested Amount: ${ctx.analystDecision.suggestedAmount} SOL

Risk Signals:
- Pump & Dump Score: ${ctx.pumpDumpSignals.score}/100 (${ctx.pumpDumpSignals.riskLevel})
- Whale Risk: ${ctx.whaleRisk ? 'HIGH' : 'LOW'}
- Pattern Signals: ${ctx.pumpDumpSignals.signals.join(', ') || 'None'}

Portfolio Status:
- Open Positions: ${ctx.portfolioMetrics.openPositions}
- Capital Utilization: ${ctx.portfolioMetrics.riskMetrics.capitalUtilization.toFixed(1)}%
- Win Rate: ${ctx.portfolioMetrics.performance.winRate.toFixed(1)}%

Market Volatility:
- Current: ${ctx.volatilityMetrics.currentVolatility.toFixed(1)}% (${ctx.volatilityMetrics.volatilityLevel})
- Position Multiplier: ${ctx.volatilityMetrics.recommendation.positionSizeMultiplier}x

Your Task:
1. Calculate overall risk score (0-100)
2. Determine risk level (LOW/MEDIUM/HIGH/CRITICAL)
3. Adjust position size based on ALL risk factors
4. Set appropriate TP/SL based on risk
5. VETO if risk is unacceptable (approved: false)

Risk Rules:
- Pump & Dump >70 = CRITICAL, VETO
- Whale Risk + Pump & Dump >50 = HIGH, reduce 50%
- Portfolio utilization >80% = reduce 30%
- Volatility EXTREME = reduce 50%
- Multiple red flags = VETO

Output JSON: { approved, riskLevel, riskScore, adjustedAmount, tpPercent, slPercent, warnings }`;

    try {
        const client = makeOpenAIClient();
        if (!client) {
            logger.warn('[Risk] OPENAI_API_KEY not set — using local deterministic risk heuristic');

            const warnings: string[] = [];
            let score = 50;

            // Pump & Dump carries heavy weight
            const pd = ctx.pumpDumpSignals?.score ?? 0;
            score += Math.min(50, pd / 2);
            if (pd > 70) warnings.push('Pump & Dump high');

            // Whale risk
            if (ctx.whaleRisk) {
                score += 20;
                warnings.push('Whale risk');
            }

            // Portfolio utilization penalty
            const util = ctx.portfolioMetrics?.riskMetrics?.capitalUtilization ?? 0;
            if (util > 80) {
                score += 20;
                warnings.push('High capital utilization');
            }

            // Volatility
            const volLevel = ctx.volatilityMetrics?.volatilityLevel || 'NORMAL';
            if (volLevel === 'EXTREME') {
                score += 30;
                warnings.push('Extreme volatility');
            } else if (volLevel === 'HIGH') {
                score += 10;
            }

            // Multiple red flags escalate to VETO
            const approved = !(pd > 70 || (ctx.whaleRisk && pd > 50) || (util > 95));

            // Adjusted amount heuristic: reduce based on score
            const suggested = ctx.analystDecision?.suggestedAmount ?? 0;
            const reductionFactor = Math.min(1, score / 100);
            const adjustedAmount = Math.max(0, Math.round(suggested * (1 - reductionFactor))); // integer SOL

            const riskLevel = score > 80 ? 'CRITICAL' : score > 60 ? 'HIGH' : score > 40 ? 'MEDIUM' : 'LOW';

            const tp = score > 80 ? 2 : score > 60 ? 5 : 8;
            const sl = score > 80 ? 0 : score > 60 ? 10 : 15;

            const result: RiskAssessment = {
                approved,
                riskLevel: riskLevel as any,
                riskScore: Math.min(100, Math.round(score)),
                adjustedAmount,
                tpPercent: tp,
                slPercent: sl,
                warnings,
            };

            logger.info(
                `[Risk] ${result.approved ? '✅ APPROVED' : '❌ VETOED'} | ` +
                `Risk: ${result.riskLevel} (${result.riskScore}/100) | ` +
                `Amount: ${result.adjustedAmount} SOL`
            );

            if (result.warnings.length > 0) logger.warn(`[Risk] Warnings: ${result.warnings.join(', ')}`);

            return result;
        }

        const response = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a conservative risk manager. Protect capital above all." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
        });

        const result = JSON.parse(response.choices[0].message.content || "{}") as RiskAssessment;

        logger.info(
            `[Risk] ${result.approved ? '✅ APPROVED' : '❌ VETOED'} | ` +
            `Risk: ${result.riskLevel} (${result.riskScore}/100) | ` +
            `Amount: ${result.adjustedAmount} SOL`
        );

        if (result.warnings && result.warnings.length > 0) {
            logger.warn(`[Risk] Warnings: ${result.warnings.join(', ')}`);
        }

        return result;
    } catch (error: any) {
        logger.error(`[Risk] Error: ${error?.message}`);
        return {
            approved: false,
            riskLevel: 'CRITICAL',
            riskScore: 100,
            adjustedAmount: 0,
            tpPercent: 0,
            slPercent: 0,
            warnings: ['Risk agent error'],
        };
    }
}
