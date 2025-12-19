// src/agent/agentClient.ts
import OpenAI from "openai";
import { tools } from "./tools-def";
import "dotenv/config";
import { getTradeHistory } from "../state/tradeHistory";
import { analyzeHolderDistribution } from "../dataSources/holderAnalysis";
import { getMarketContext } from "../dataSources/marketContext";
import { getVolatilityTracker } from "../trading/marketVolatility";
import { detectPumpDump } from "../analysis/pumpDumpDetector";
import { quickWhaleCheck } from "../analysis/whaleAnalyzer";
import { getPortfolioMetrics, getCapitalAllocation, shouldSkipNewPosition } from "../state/positions";
import { Connection, PublicKey } from "@solana/web3.js";
import { logger } from "../logger";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const RPC_URL = process.env.RPC_URL as string;
const connection = new Connection(RPC_URL, "confirmed");

export async function askAgentForAction(ctx: {
  type: "NEW_POOL";
  pool: string;
  baseMint: string;
  quoteMint: string;
  coinCreator: string;
  liquidityUsd: number;
  recentBuyers: number;
  ageMs: number;
  fdv: number;
}) {
  // Portfolio management: Check if we should skip this position
  const portfolioCheck = shouldSkipNewPosition(ctx.baseMint, ctx.coinCreator);
  if (portfolioCheck.shouldSkip) {
    logger.warn(`[Portfolio] Skipping position: ${portfolioCheck.reason}`);
    return {
      action: "IGNORE" as const,
      reason: `Portfolio constraint: ${portfolioCheck.reason}`,
      amountInLamports: 0,
      tpPercent: 0,
      slPercent: 0,
    };
  }

  // Get portfolio metrics and capital allocation
  const portfolioMetrics = getPortfolioMetrics();
  const capitalAllocation = getCapitalAllocation(0.2); // Base 0.2 SOL

  // Get historical performance data
  const tradeHistory = getTradeHistory();
  const stats = tradeHistory.getStatistics(24);
  const creatorPerf = tradeHistory.getCreatorPerformance(168);
  const thisCreatorPerf = creatorPerf.find(c => c.creator === ctx.coinCreator);

  // Get holder distribution analysis
  const holderAnalysis = await analyzeHolderDistribution(connection, ctx.baseMint);

  // Get market context
  const marketContext = await getMarketContext();

  // Get volatility metrics for dynamic strategy
  const volatilityTracker = getVolatilityTracker();
  const volatilityMetrics = await volatilityTracker.getVolatilityMetrics();

  // Pattern detection: Pump & Dump
  const pumpDumpSignals = await detectPumpDump(connection, {
    currentLiquidity: ctx.liquidityUsd,
    initialLiquidity: ctx.liquidityUsd * 0.5, // Estimate
    liquidityGrowthRate: 1.0, // Will be calculated from historical data
    holderCount: holderAnalysis.totalHolders,
    tokenAgeMs: ctx.ageMs,
    recentBuyers: ctx.recentBuyers,
    creatorAddress: ctx.coinCreator,
  });

  // Pattern detection: Whale concentration (quick check)
  const whaleRisk = quickWhaleCheck(
    holderAnalysis.top5HoldersPercent,
    holderAnalysis.largestHolderPercent,
    holderAnalysis.totalHolders
  );

  // Build historical context
  let historicalContext = `

=== HISTORICAL PERFORMANCE (Last 24h) ===
Total Trades: ${stats.totalTrades}
Win Rate: ${stats.winRate.toFixed(1)}%
Total P/L: ${stats.totalProfitLoss.toFixed(4)} SOL
Average P/L: ${stats.averageProfitLoss.toFixed(4)} SOL
Best Trade: ${stats.bestTrade.toFixed(4)} SOL
Worst Trade: ${stats.worstTrade.toFixed(4)} SOL
`;

  if (thisCreatorPerf) {
    historicalContext += `
=== THIS CREATOR'S HISTORY ===
Creator: ${ctx.coinCreator.slice(0, 8)}...
Past Trades: ${thisCreatorPerf.trades}
Win Rate: ${thisCreatorPerf.winRate.toFixed(1)}%
Total P/L: ${thisCreatorPerf.totalProfitLoss.toFixed(4)} SOL
${thisCreatorPerf.winRate < 30 ? 'WARNING: Poor historical performance!' : thisCreatorPerf.winRate > 70 ? 'Good historical performance' : 'Neutral performance'}
`;
  } else {
    historicalContext += `
=== THIS CREATOR'S HISTORY ===
No previous trades with this creator.
`;
  }

  // Add top/bottom creators
  if (creatorPerf.length > 0) {
    const topCreators = creatorPerf.slice(0, 3);
    const bottomCreators = creatorPerf.slice(-3).reverse();

    historicalContext += `
=== TOP PERFORMING CREATORS ===
`;
    topCreators.forEach((c, i) => {
      historicalContext += `${i + 1}. ${c.creator.slice(0, 8)}... | WR: ${c.winRate.toFixed(1)}% | P/L: ${c.totalProfitLoss.toFixed(4)} SOL
`;
    });

    historicalContext += `
=== WORST PERFORMING CREATORS ===
`;
    bottomCreators.forEach((c, i) => {
      historicalContext += `${i + 1}. ${c.creator.slice(0, 8)}... | WR: ${c.winRate.toFixed(1)}% | P/L: ${c.totalProfitLoss.toFixed(4)} SOL
`;
    });
  }

  // Add holder analysis
  historicalContext += `
=== HOLDER DISTRIBUTION ANALYSIS ===
Total Holders: ${holderAnalysis.totalHolders}
Top 5 Holders: ${holderAnalysis.top5HoldersPercent.toFixed(1)}% of supply
Top 10 Holders: ${holderAnalysis.top10HoldersPercent.toFixed(1)}% of supply
Largest Holder: ${holderAnalysis.largestHolderPercent.toFixed(1)}% of supply
Concentration Risk: ${holderAnalysis.riskLevel}
${holderAnalysis.isConcentrated ? 'WARNING: Highly concentrated ownership!' : 'Reasonable distribution'}
`;

  // Add market context
  historicalContext += `
=== MARKET CONTEXT ===
SOL Price: $${marketContext.solPrice.toFixed(2)}
24h Change: ${marketContext.solPriceChange24h > 0 ? '+' : ''}${marketContext.solPriceChange24h.toFixed(2)}%
Market Trend: ${marketContext.marketTrend}
Volatility: ${marketContext.volatility}
${marketContext.marketTrend === 'BEARISH' ? 'Bearish market - be cautious' : marketContext.marketTrend === 'BULLISH' ? 'Bullish market - favorable conditions' : 'Neutral market'}
`;

  // Add volatility metrics and dynamic strategy recommendations
  historicalContext += `
=== MARKET VOLATILITY & DYNAMIC STRATEGY ===
Current Volatility: ${volatilityMetrics.currentVolatility.toFixed(1)}% (${volatilityMetrics.volatilityLevel})
1h Price Change: ${volatilityMetrics.priceChange1h > 0 ? '+' : ''}${volatilityMetrics.priceChange1h.toFixed(2)}%
24h Price Change: ${volatilityMetrics.priceChange24h > 0 ? '+' : ''}${volatilityMetrics.priceChange24h.toFixed(2)}%
7-day Avg Volatility: ${volatilityMetrics.averageVolatility7d.toFixed(1)}%

DYNAMIC STRATEGY RECOMMENDATIONS:
- Position Size Multiplier: ${volatilityMetrics.recommendation.positionSizeMultiplier.toFixed(2)}x
- Take Profit Multiplier: ${volatilityMetrics.recommendation.tpMultiplier.toFixed(2)}x
- Stop Loss Multiplier: ${volatilityMetrics.recommendation.slMultiplier.toFixed(2)}x

${volatilityMetrics.volatilityLevel === 'EXTREME' ? '⚠️ EXTREME VOLATILITY: Reduce position size significantly!' : volatilityMetrics.volatilityLevel === 'HIGH' ? '⚠️ HIGH VOLATILITY: Use tighter stops and smaller positions' : volatilityMetrics.volatilityLevel === 'LOW' ? '✅ LOW VOLATILITY: Can use wider targets and larger positions' : 'ℹ️ MEDIUM VOLATILITY: Use standard strategy'}
`;

  // Add pattern detection analysis
  historicalContext += `
=== PATTERN DETECTION & RISK ANALYSIS ===

PUMP & DUMP DETECTION:
Risk Score: ${pumpDumpSignals.score}/100 (${pumpDumpSignals.riskLevel})
Status: ${pumpDumpSignals.isPumpDump ? '🚨 PUMP & DUMP DETECTED!' : '✅ No pump & dump signals'}
${pumpDumpSignals.signals.length > 0 ? 'Signals:\n' + pumpDumpSignals.signals.map(s => `  - ${s}`).join('\n') : 'No suspicious patterns detected'}

WHALE CONCENTRATION:
${whaleRisk ? '⚠️ HIGH WHALE RISK: Large holders control significant supply' : '✅ Acceptable whale distribution'}
Top 5 Holders: ${holderAnalysis.top5HoldersPercent.toFixed(1)}%
Largest Holder: ${holderAnalysis.largestHolderPercent.toFixed(1)}%

OVERALL RISK ASSESSMENT:
${pumpDumpSignals.isPumpDump || whaleRisk ? '🚨 HIGH RISK TOKEN - Exercise extreme caution or IGNORE' : pumpDumpSignals.riskLevel === 'MEDIUM' || holderAnalysis.isConcentrated ? '⚠️ MEDIUM RISK - Reduce position size if buying' : '✅ ACCEPTABLE RISK - Can proceed with normal strategy'}
`;

  // Add portfolio management context
  historicalContext += `
=== PORTFOLIO MANAGEMENT ===

CURRENT PORTFOLIO STATUS:
Open Positions: ${portfolioMetrics.openPositions}
Total Capital Deployed: ${portfolioMetrics.totalCapitalDeployed.toFixed(3)} SOL
Capital Utilization: ${portfolioMetrics.riskMetrics.capitalUtilization.toFixed(1)}%
${portfolioMetrics.riskMetrics.capitalUtilization > 80 ? '⚠️ HIGH UTILIZATION - Limited capital available' : portfolioMetrics.riskMetrics.capitalUtilization > 60 ? 'ℹ️ MODERATE UTILIZATION' : '✅ LOW UTILIZATION - Good capital availability'}

DIVERSIFICATION:
Unique Tokens: ${portfolioMetrics.diversification.uniqueTokens}
Unique Creators: ${portfolioMetrics.diversification.uniqueCreators}
Largest Position: ${portfolioMetrics.diversification.largestPositionPercent.toFixed(1)}% of portfolio
Concentration Risk: ${portfolioMetrics.diversification.concentrationRisk}
${portfolioMetrics.diversification.concentrationRisk === 'HIGH' ? '⚠️ HIGH CONCENTRATION - Need more diversification' : portfolioMetrics.diversification.concentrationRisk === 'MEDIUM' ? 'ℹ️ MEDIUM CONCENTRATION' : '✅ WELL DIVERSIFIED'}

CAPITAL ALLOCATION:
Available Capital: ${capitalAllocation.availableCapital.toFixed(3)} SOL
Recommended Position Size: ${capitalAllocation.recommendedPositionSize.toFixed(3)} SOL
Max Single Position: ${capitalAllocation.maxPositionSize.toFixed(3)} SOL
${capitalAllocation.shouldReduceExposure ? '⚠️ REDUCE EXPOSURE: ' + capitalAllocation.reason : '✅ ' + capitalAllocation.reason}

PERFORMANCE METRICS:
Total P/L: ${portfolioMetrics.performance.totalPnL.toFixed(4)} SOL
Win Rate: ${portfolioMetrics.performance.winRate.toFixed(1)}%
Average P/L: ${portfolioMetrics.performance.averagePnL.toFixed(4)} SOL
${portfolioMetrics.performance.winRate < 40 ? '⚠️ LOW WIN RATE - Be more selective' : portfolioMetrics.performance.winRate > 60 ? '✅ GOOD WIN RATE' : 'ℹ️ MODERATE WIN RATE'}
`;

  const messages = [
    {
      role: "system" as const,
      content: `You are a ruthless trader on PumpSwap who learns from past experiences and uses multi-source data.

Rules:
- Base maximum investment: 0.2 SOL per trade
- ADJUST position size using Position Size Multiplier from volatility metrics
- ADJUST TP/SL using multipliers from volatility metrics
- **USE RECOMMENDED POSITION SIZE from capital allocation (overrides base amount)**
- Only buy if risk is acceptable
- Use historical data for better decision-making
- If creator has poor past performance, be more cautious
- If overall win rate is low, be more conservative
- If holder distribution is concentrated (top 5 > 50%), rug pull risk is high
- If market is bearish, take less risk
- If volatility is high, reduce investment amount
- **PATTERN DETECTION RULES:**
  - If PUMP & DUMP is detected (score >= 50), strongly consider IGNORE
  - If whale risk is HIGH, reduce position size significantly or IGNORE
  - If overall risk assessment is HIGH RISK, default to IGNORE unless exceptional opportunity
  - Multiple red flags (pump & dump + whale risk + poor creator) = automatic IGNORE
  - Pattern detection overrides other positive signals
- **PORTFOLIO MANAGEMENT RULES:**
  - NEVER exceed recommended position size from capital allocation
  - If capital utilization >80%, be extremely selective
  - If concentration risk is HIGH, prioritize diversification
  - If portfolio win rate <40%, reduce position sizes
  - Respect available capital limits
  - Consider portfolio diversification in decisions
- Output must always be JSON with fields: action, reason, amountInLamports, tpPercent, slPercent

${historicalContext}
`,
    },
    {
      role: "user" as const,
      content: `pool: ${ctx.pool}
baseMint: ${ctx.baseMint}
quoteMint: ${ctx.quoteMint}
coinCreator: ${ctx.coinCreator}
liquidityUsd: ${ctx.liquidityUsd}
recentBuyers: ${ctx.recentBuyers}
ageMs: ${ctx.ageMs}
fdv: ${ctx.fdv}
type: NEW_POOL
`,
    },
  ];

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    tools,
    messages,
    response_format: { type: "json_object" },
  });

  const msg = res.choices[0].message;
  const content = msg.content ?? "{}";

  const parsed = JSON.parse(content as string) as {
    action: "BUY" | "IGNORE";
    reason: string;
    amountInLamports: number;
    tpPercent: number;
    slPercent: number;
    reasoning?: {
      historicalAnalysis?: string;
      holderAnalysis?: string;
      marketAnalysis?: string;
      riskAssessment?: string;
      conclusion?: string;
    };
    confidence?: number;
  };

  // Log detailed reasoning if available
  if (parsed.reasoning) {
    logger.info(`[AI-REASONING] Decision: ${parsed.action}`);
    if (parsed.reasoning.historicalAnalysis) {
      logger.info(`[AI-REASONING] Historical: ${parsed.reasoning.historicalAnalysis}`);
    }
    if (parsed.reasoning.holderAnalysis) {
      logger.info(`[AI-REASONING] Holders: ${parsed.reasoning.holderAnalysis}`);
    }
    if (parsed.reasoning.marketAnalysis) {
      logger.info(`[AI-REASONING] Market: ${parsed.reasoning.marketAnalysis}`);
    }
    if (parsed.reasoning.riskAssessment) {
      logger.info(`[AI-REASONING] Risk: ${parsed.reasoning.riskAssessment}`);
    }
    if (parsed.reasoning.conclusion) {
      logger.info(`[AI-REASONING] Conclusion: ${parsed.reasoning.conclusion}`);
    }
  }

  if (parsed.confidence !== undefined) {
    logger.info(`[AI-REASONING] Confidence: ${parsed.confidence}%`);
  }

  return parsed;
}
