// src/agents/analystAgent.ts

import OpenAI from "openai";
import { logger } from "../logger";

function makeOpenAIClient() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    return new OpenAI({ apiKey: key });
}

export interface AnalystDecision {
    shouldBuy: boolean;
    reason: string;
    confidence: number; // 0-100
    suggestedAmount: number; // in SOL
    analysis: {
        fundamentals: string;
        technicals: string;
        sentiment: string;
    };
}

/**
 * Analyst Agent - Deep token analysis
 * Purpose: Comprehensive analysis of tokens that passed scout filter
 */
export async function analystAgent(ctx: {
    baseMint: string;
    coinCreator: string;
    liquidityUsd: number;
    recentBuyers: number;
    ageMs: number;
    fdv: number;
    holderAnalysis: any;
    marketContext: any;
    historicalData: string;
}): Promise<AnalystDecision> {
    const prompt = `You are an ANALYST AGENT for a trading bot. Perform DEEP ANALYSIS.

Token Details:
- Mint: ${ctx.baseMint.slice(0, 8)}...
- Creator: ${ctx.coinCreator.slice(0, 8)}...
- Liquidity: $${ctx.liquidityUsd}
- Recent Buyers: ${ctx.recentBuyers}
- Age: ${(ctx.ageMs / 60000).toFixed(1)} minutes
- FDV: $${ctx.fdv}

Holder Analysis:
- Total Holders: ${ctx.holderAnalysis.totalHolders}
- Top 5: ${ctx.holderAnalysis.top5HoldersPercent.toFixed(1)}%
- Concentration: ${ctx.holderAnalysis.riskLevel}

Market Context:
- SOL Price: $${ctx.marketContext.solPrice}
- Trend: ${ctx.marketContext.marketTrend}
- Volatility: ${ctx.marketContext.volatility}

${ctx.historicalData}

Your Analysis Must Cover:
1. FUNDAMENTALS: Liquidity depth, holder distribution, creator history
2. TECHNICALS: Price action, volume, momentum
3. SENTIMENT: Market conditions, buyer interest

Provide:
- shouldBuy: true/false
- confidence: 0-100 (how confident in this decision)
- suggestedAmount: recommended position size in SOL (0.05-0.25)
- analysis: { fundamentals, technicals, sentiment }

Output JSON format.`;

    try {
        const client = makeOpenAIClient();
        if (!client) {
            logger.warn('[Analyst] OPENAI_API_KEY not set — using fallback heuristic');
            // Simple fallback analysis for tests/local runs
            const shouldBuy = ctx.liquidityUsd > 1000 && ctx.recentBuyers > 2 && (ctx.ageMs / 60000) > 2;
            const confidence = shouldBuy ? 70 : 20;
            const suggestedAmount = shouldBuy ? Math.min(0.25, ctx.fdv > 0 ? 0.05 : 0.05) : 0;
            return {
                shouldBuy,
                reason: shouldBuy ? 'Fallback heuristic: indicative buy' : 'Fallback heuristic: do not buy',
                confidence,
                suggestedAmount,
                analysis: {
                    fundamentals: 'Fallback fundamentals summary',
                    technicals: 'Fallback technicals summary',
                    sentiment: 'Fallback sentiment summary',
                },
            };
        }

        const response = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a professional crypto analyst. Be thorough and analytical." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.5,
        });

        const result = JSON.parse(response.choices[0].message.content || "{}") as AnalystDecision;

        logger.info(
            `[Analyst] ${result.shouldBuy ? '✅ BUY' : '❌ PASS'} | ` +
            `Confidence: ${result.confidence}% | Amount: ${result.suggestedAmount} SOL`
        );

        return result;
    } catch (error: any) {
        logger.error(`[Analyst] Error: ${error?.message}`);
        return {
            shouldBuy: false,
            reason: "Analyst error, defaulting to PASS",
            confidence: 0,
            suggestedAmount: 0,
            analysis: {
                fundamentals: "Error",
                technicals: "Error",
                sentiment: "Error",
            },
        };
    }
}
