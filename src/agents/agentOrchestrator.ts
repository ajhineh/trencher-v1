// src/agents/agentOrchestrator.ts

import { Connection } from "@solana/web3.js";
import { logger } from "../logger";
// Load fetch at runtime to avoid Jest parsing ESM node_modules (node-fetch)
async function getFetch(): Promise<any> {
    if (typeof (globalThis as any).fetch === 'function') return (globalThis as any).fetch;
    try {
        // dynamic import works with ESM-only node-fetch without breaking Jest
        const mod = await import('node-fetch');
        return mod.default || mod;
    } catch (err: any) {
        logger.debug?.(`[Orchestrator] fetch loader error: ${err?.message || err}`);
        return null;
    }
}
import { scoutAgent } from "./scoutAgent";
import { analystAgent } from "./analystAgent";
import { riskAgent } from "./riskAgent";
import { getTradeHistory } from "../state/tradeHistory";
import { analyzeHolderDistribution } from "../dataSources/holderAnalysis";
import { getMarketContext } from "../dataSources/marketContext";
import { getVolatilityTracker } from "../trading/marketVolatility";
import { detectPumpDump } from "../analysis/pumpDumpDetector";
import { quickWhaleCheck } from "../analysis/whaleAnalyzer";
import { getPortfolioMetrics, shouldSkipNewPosition } from "../state/positions";

export interface OrchestratorDecision {
    action: "BUY" | "IGNORE";
    reason: string;
    amountInLamports: number;
    tpPercent: number;
    slPercent: number;
    agentDecisions: {
        scout?: any;
        analyst?: any;
        risk?: any;
    };
}

async function postDashboardMetrics(payload: any) {
    const url = process.env.DASHBOARD_URL || 'http://localhost:3005/api/metrics';
    const fetchFn = await getFetch();
    if (!fetchFn) {
        logger.debug?.('[Dashboard] fetch not available; skipping post');
        return;
    }
    try {
        await fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (err: any) {
        logger.debug?.(`[Dashboard] post error: ${err?.message || err}`);
    }
}

/**
 * Agent Orchestrator - Coordinates all specialized agents
 * 
 * Pipeline:
 * 1. Portfolio Check (pre-filter)
 * 2. Scout Agent (quick filter)
 * 3. Analyst Agent (deep analysis)
 * 4. Risk Agent (final risk check)
 * 5. Final Decision
 */
export async function orchestrateDecision(
    connection: Connection,
    ctx: {
        type: "NEW_POOL";
        pool: string;
        baseMint: string;
        quoteMint: string;
        coinCreator: string;
        liquidityUsd: number;
        recentBuyers: number;
        ageMs: number;
        fdv: number;
    }
): Promise<OrchestratorDecision> {
    logger.info(`[Orchestrator] Starting multi-agent analysis for ${ctx.baseMint.slice(0, 8)}...`);

    const agentDecisions: any = {};

    // ===== STAGE 0: Portfolio Pre-Check =====
    const portfolioCheck = shouldSkipNewPosition(ctx.baseMint, ctx.coinCreator);
    if (portfolioCheck.shouldSkip) {
        logger.warn(`[Orchestrator] ❌ Portfolio constraint: ${portfolioCheck.reason}`);
        postDashboardMetrics({ baseMint: ctx.baseMint, action: 'IGNORE', reason: `Portfolio: ${portfolioCheck.reason}`, activeTokens: 0 }).catch(() => {});
        return {
            action: "IGNORE",
            reason: `Portfolio: ${portfolioCheck.reason}`,
            amountInLamports: 0,
            tpPercent: 0,
            slPercent: 0,
            agentDecisions: {},
        };
    }

    // ===== STAGE 1: Scout Agent (Quick Filter) =====
    logger.info(`[Orchestrator] Stage 1: Scout Agent`);
    const scoutDecision = await scoutAgent({
        baseMint: ctx.baseMint,
        coinCreator: ctx.coinCreator,
        liquidityUsd: ctx.liquidityUsd,
        recentBuyers: ctx.recentBuyers,
        ageMs: ctx.ageMs,
        fdv: ctx.fdv,
    });
    agentDecisions.scout = scoutDecision;

    if (!scoutDecision.shouldAnalyze) {
        logger.info(`[Orchestrator] ❌ Scout rejected: ${scoutDecision.reason}`);
        postDashboardMetrics({ baseMint: ctx.baseMint, action: 'IGNORE', reason: `Scout: ${scoutDecision.reason}`, scout: { quickScore: scoutDecision.quickScore, reason: scoutDecision.reason } }).catch(() => {});
        return {
            action: "IGNORE",
            reason: `Scout: ${scoutDecision.reason}`,
            amountInLamports: 0,
            tpPercent: 0,
            slPercent: 0,
            agentDecisions,
        };
    }

    // ===== STAGE 2: Gather Data for Analyst =====
    logger.info(`[Orchestrator] Stage 2: Gathering data for Analyst`);

    const [holderAnalysis, marketContext, volatilityMetrics] = await Promise.all([
        analyzeHolderDistribution(connection, ctx.baseMint),
        getMarketContext(),
        getVolatilityTracker().getVolatilityMetrics(),
    ]);

    const tradeHistory = getTradeHistory();
    const stats = tradeHistory.getStatistics(24);
    const creatorPerf = tradeHistory.getCreatorPerformance(168);
    const thisCreatorPerf = creatorPerf.find(c => c.creator === ctx.coinCreator);

    const historicalData = `
Historical Performance (24h):
- Total Trades: ${stats.totalTrades}
- Win Rate: ${stats.winRate.toFixed(1)}%
- Total P/L: ${stats.totalProfitLoss.toFixed(4)} SOL

${thisCreatorPerf ? `Creator History:
- Past Trades: ${thisCreatorPerf.trades}
- Win Rate: ${thisCreatorPerf.winRate.toFixed(1)}%
- Total P/L: ${thisCreatorPerf.totalProfitLoss.toFixed(4)} SOL` : 'No creator history'}
`;

    // ===== STAGE 3: Analyst Agent (Deep Analysis) =====
    logger.info(`[Orchestrator] Stage 3: Analyst Agent`);
    const analystDecision = await analystAgent({
        baseMint: ctx.baseMint,
        coinCreator: ctx.coinCreator,
        liquidityUsd: ctx.liquidityUsd,
        recentBuyers: ctx.recentBuyers,
        ageMs: ctx.ageMs,
        fdv: ctx.fdv,
        holderAnalysis,
        marketContext,
        historicalData,
    });
    agentDecisions.analyst = analystDecision;

    if (!analystDecision.shouldBuy) {
        logger.info(`[Orchestrator] ❌ Analyst rejected: ${analystDecision.reason}`);
        postDashboardMetrics({ baseMint: ctx.baseMint, action: 'IGNORE', reason: `Analyst: ${analystDecision.reason}`, analyst: { confidence: analystDecision.confidence, reason: analystDecision.reason } }).catch(() => {});
        return {
            action: "IGNORE",
            reason: `Analyst: ${analystDecision.reason}`,
            amountInLamports: 0,
            tpPercent: 0,
            slPercent: 0,
            agentDecisions,
        };
    }

    // ===== STAGE 4: Pattern Detection =====
    logger.info(`[Orchestrator] Stage 4: Pattern Detection`);
    const pumpDumpSignals = await detectPumpDump(connection, {
        currentLiquidity: ctx.liquidityUsd,
        initialLiquidity: ctx.liquidityUsd * 0.5,
        liquidityGrowthRate: 1.0,
        holderCount: holderAnalysis.totalHolders,
        tokenAgeMs: ctx.ageMs,
        recentBuyers: ctx.recentBuyers,
        creatorAddress: ctx.coinCreator,
    });

    const whaleRisk = quickWhaleCheck(
        holderAnalysis.top5HoldersPercent,
        holderAnalysis.largestHolderPercent,
        holderAnalysis.totalHolders
    );

    // ===== STAGE 5: Risk Agent (Final Check) =====
    logger.info(`[Orchestrator] Stage 5: Risk Agent`);
    const portfolioMetrics = getPortfolioMetrics();

    const riskDecision = await riskAgent({
        baseMint: ctx.baseMint,
        analystDecision,
        pumpDumpSignals,
        whaleRisk,
        portfolioMetrics,
        volatilityMetrics,
    });
    agentDecisions.risk = riskDecision;

    if (!riskDecision.approved) {
        logger.warn(`[Orchestrator] ❌ Risk agent VETOED: ${riskDecision.warnings.join(', ')}`);
        postDashboardMetrics({ baseMint: ctx.baseMint, action: 'IGNORE', reason: `Risk: ${riskDecision.warnings[0] || 'Risk too high'}`, risk: { level: riskDecision.riskLevel, score: riskDecision.riskScore, warnings: riskDecision.warnings } }).catch(() => {});
        return {
            action: "IGNORE",
            reason: `Risk: ${riskDecision.warnings[0] || 'Risk too high'}`,
            amountInLamports: 0,
            tpPercent: 0,
            slPercent: 0,
            agentDecisions,
        };
    }

    // ===== FINAL DECISION: BUY =====
    const finalAmount = riskDecision.adjustedAmount;
    const amountInLamports = Math.floor(finalAmount * 1e9);

    logger.info(
        `[Orchestrator] ✅ FINAL DECISION: BUY | ` +
        `Amount: ${finalAmount.toFixed(3)} SOL | ` +
        `TP: ${riskDecision.tpPercent}% | SL: ${riskDecision.slPercent}%`
    );
    postDashboardMetrics({ baseMint: ctx.baseMint, action: 'BUY', amountSol: finalAmount, tpPercent: riskDecision.tpPercent, slPercent: riskDecision.slPercent, agentDecisions }).catch(() => {});

    return {
        action: "BUY",
        reason: `Multi-agent consensus: Scout(${scoutDecision.quickScore}/100) + Analyst(${analystDecision.confidence}%) + Risk(${riskDecision.riskLevel})`,
        amountInLamports,
        tpPercent: riskDecision.tpPercent,
        slPercent: riskDecision.slPercent,
        agentDecisions,
    };
}
