// src/agents/scoutAgent.ts

import OpenAI from "openai";
import { logger } from "../logger";

function makeOpenAIClient() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    return new OpenAI({ apiKey: key });
}

export interface ScoutDecision {
    shouldAnalyze: boolean;
    reason: string;
    quickScore: number; // 0-100
    redFlags: string[];
}

/**
 * Scout Agent - Quick filter for new tokens
 * Purpose: Fast initial screening to filter out obvious bad tokens
 */
export async function scoutAgent(ctx: {
    baseMint: string;
    coinCreator: string;
    liquidityUsd: number;
    recentBuyers: number;
    ageMs: number;
    fdv: number;
}): Promise<ScoutDecision> {
    const ageMinutes = ctx.ageMs / (60 * 1000);

    const prompt = `You are a SCOUT AGENT for a trading bot. Your job is QUICK FILTERING.

Token Info:
- Liquidity: $${ctx.liquidityUsd}
- Recent Buyers: ${ctx.recentBuyers}
- Age: ${ageMinutes.toFixed(1)} minutes
- FDV: $${ctx.fdv}

Quick Red Flags to Check:
1. Too new (<2 minutes) = suspicious
2. Too low liquidity (<$1000) = risky
3. Too few buyers (<3) = no interest
4. Abnormal buyer rate (>20/minute) = bot activity

Your Task: QUICK PASS/FAIL decision
- shouldAnalyze: true = pass to Analyst for deep analysis
- shouldAnalyze: false = reject immediately

Output JSON: { shouldAnalyze: boolean, reason: string, quickScore: number (0-100), redFlags: string[] }`;

    try {
        const client = makeOpenAIClient();
        if (!client) {
            logger.warn('[Scout] OPENAI_API_KEY not set — using local quick heuristic');
            // Simple heuristic fallback for tests/local runs
            const redFlags: string[] = [];
            if (ageMinutes < 2) redFlags.push('Too new');
            if (ctx.liquidityUsd < 1000) redFlags.push('Low liquidity');
            if (ctx.recentBuyers < 3) redFlags.push('Low buyer count');
            const quickScore = Math.max(0, 100 - (redFlags.length * 30));
            return {
                shouldAnalyze: redFlags.length === 0,
                reason: redFlags.length === 0 ? 'No quick red flags' : redFlags.join(', '),
                quickScore,
                redFlags,
            };
        }

        const response = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a quick-filter scout agent. Be decisive and fast." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
        });

        const result = JSON.parse(response.choices[0].message.content || "{}") as ScoutDecision;

        logger.info(
            `[Scout] ${result.shouldAnalyze ? '✅ PASS' : '❌ REJECT'} | ` +
            `Score: ${result.quickScore}/100 | ${result.reason}`
        );

        return result;
    } catch (error: any) {
        logger.error(`[Scout] Error: ${error?.message}`);
        // Default to pass on error (let analyst decide)
        return {
            shouldAnalyze: true,
            reason: "Scout error, passing to analyst",
            quickScore: 50,
            redFlags: [],
        };
    }
}
