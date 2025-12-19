// src/agents/exitAgent.ts

import OpenAI from "openai";
import { logger } from "../logger";
import { Position } from "../state/positions";

function makeOpenAIClient() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    return new OpenAI({ apiKey: key });
}

export interface ExitDecision {
    shouldExit: boolean;
    reason: string;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE';
    exitType: 'TP' | 'SL' | 'MANUAL' | 'HOLD';
}

/**
 * Exit Agent - Manages position exits
 * Purpose: Monitors open positions and suggests exits
 */
export async function exitAgent(ctx: {
    position: Position;
    currentPrice: number;
    marketConditions: any;
    portfolioMetrics: any;
}): Promise<ExitDecision> {
    const entryPrice = ctx.position.buyPriceInQuote;
    const priceChange = ((ctx.currentPrice - entryPrice) / entryPrice) * 100;
    const holdingTimeMs = Date.now() - ctx.position.openedAt;
    const holdingMinutes = holdingTimeMs / (60 * 1000);

    const prompt = `You are an EXIT AGENT for a trading bot. Manage position exits.

Position Details:
- Entry Price: ${entryPrice.toFixed(6)}
- Current Price: ${ctx.currentPrice.toFixed(6)}
- P/L: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%
- Holding Time: ${holdingMinutes.toFixed(1)} minutes
- TP Target: ${ctx.position.tpPercent}%
- SL Target: -${ctx.position.slPercent}%

Market Conditions:
- Trend: ${ctx.marketConditions.marketTrend}
- Volatility: ${ctx.marketConditions.volatility}
- SOL Change 1h: ${ctx.marketConditions.solPriceChange24h > 0 ? '+' : ''}${ctx.marketConditions.solPriceChange24h.toFixed(2)}%

Portfolio Context:
- Open Positions: ${ctx.portfolioMetrics.openPositions}
- Portfolio Win Rate: ${ctx.portfolioMetrics.performance.winRate.toFixed(1)}%

Exit Scenarios:
1. TP HIT: P/L >= ${ctx.position.tpPercent}% → EXIT
2. SL HIT: P/L <= -${ctx.position.slPercent}% → EXIT
3. TRAILING: Price up >20%, protect profits
4. TIME DECAY: Holding >60 min with no movement → consider exit
5. MARKET SHIFT: Bearish turn → protect capital
6. PORTFOLIO REBALANCE: Need to free capital

Your Decision:
- shouldExit: true/false
- exitType: TP/SL/MANUAL/HOLD
- urgency: LOW/MEDIUM/HIGH/IMMEDIATE
- reason: clear explanation

Output JSON format.`;

    try {
        const client = makeOpenAIClient();
        if (!client) {
            logger.warn('[Exit] OPENAI_API_KEY not set — using simple exit heuristic');

            const result: ExitDecision = (() => {
                // TP/SL checks first
                if (priceChange >= ctx.position.tpPercent) {
                    return {
                        shouldExit: true,
                        reason: 'Take profit target reached',
                        urgency: 'HIGH',
                        exitType: 'TP',
                    };
                }

                if (priceChange <= -ctx.position.slPercent) {
                    return {
                        shouldExit: true,
                        reason: 'Stop loss triggered',
                        urgency: 'IMMEDIATE',
                        exitType: 'SL',
                    };
                }

                // Time decay
                if (holdingMinutes > 60 && Math.abs(priceChange) < 0.5) {
                    return {
                        shouldExit: true,
                        reason: 'Time decay with little movement',
                        urgency: 'MEDIUM',
                        exitType: 'MANUAL',
                    };
                }

                // Market shift heuristic
                const trend = ctx.marketConditions?.marketTrend || 'NEUTRAL';
                if (trend === 'BEARISH' && priceChange < 2) {
                    return {
                        shouldExit: true,
                        reason: 'Market turned bearish',
                        urgency: 'HIGH',
                        exitType: 'MANUAL',
                    };
                }

                return {
                    shouldExit: false,
                    reason: 'Hold — no exit conditions met',
                    urgency: 'LOW',
                    exitType: 'HOLD',
                };
            })();

            if (result.shouldExit) {
                logger.info(`[Exit] 🚪 EXIT SIGNAL | ${result.exitType} | Urgency: ${result.urgency} | ${result.reason}`);
            }

            return result;
        }

        const response = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are an exit manager. Protect profits and cut losses." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
        });

        const result = JSON.parse(response.choices[0].message.content || "{}") as ExitDecision;

        if (result.shouldExit) {
            logger.info(
                `[Exit] 🚪 EXIT SIGNAL | ${result.exitType} | ` +
                `Urgency: ${result.urgency} | ${result.reason}`
            );
        }

        return result;
    } catch (error: any) {
        logger.error(`[Exit] Error: ${error?.message}`);
        return {
            shouldExit: false,
            reason: "Exit agent error, holding position",
            urgency: 'LOW',
            exitType: 'HOLD',
        };
    }
}
