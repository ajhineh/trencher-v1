// src/backtesting/strategySimulator.ts

import { Connection } from "@solana/web3.js";
import { logger } from "../logger";
import { orchestrateDecision } from "../agents/agentOrchestrator";
import { DataReplay, HistoricalToken, BacktestConfig } from "./dataReplay";

export interface SimulatedTrade {
    token: HistoricalToken;
    decision: 'BUY' | 'IGNORE';
    reason: string;
    amountSol: number;
    tpPercent: number;
    slPercent: number;
    entryTime: number;
    exitTime?: number;
    exitReason?: 'TP' | 'SL' | 'TIME';
    pnl?: number;
    pnlPercent?: number;
}

export interface SimulationResults {
    totalTrades: number;
    buyDecisions: number;
    ignoreDecisions: number;
    profitableTrades: number;
    losingTrades: number;
    totalPnL: number;
    winRate: number;
    avgPnL: number;
    bestTrade: number;
    worstTrade: number;
    finalCapital: number;
    roi: number;
    trades: SimulatedTrade[];
}

export class StrategySimulator {
    private connection: Connection;
    private dataReplay: DataReplay;
    private capital: number;
    private initialCapital: number;
    private trades: SimulatedTrade[] = [];

    constructor(connection: Connection, config: BacktestConfig) {
        this.connection = connection;
        this.dataReplay = new DataReplay();
        this.capital = config.initialCapital;
        this.initialCapital = config.initialCapital;
    }

    /**
     * Run backtest simulation
     */
    async runSimulation(config: BacktestConfig): Promise<SimulationResults> {
        logger.info('[Backtest] Starting simulation...');
        logger.info(`[Backtest] Initial capital: ${this.initialCapital} SOL`);

        // Load historical data
        await this.dataReplay.loadData(config);

        // Process each token
        let token: HistoricalToken | null;
        while ((token = this.dataReplay.getNextToken()) !== null) {
            await this.processToken(token);

            // Log progress every 10 tokens
            const progress = this.dataReplay.getProgress();
            if (progress.current % 10 === 0) {
                logger.info(`[Backtest] Progress: ${progress.percent.toFixed(1)}% (${progress.current}/${progress.total})`);
            }
        }

        // Calculate results
        const results = this.calculateResults();

        logger.info('[Backtest] Simulation complete!');
        logger.info(`[Backtest] Final capital: ${results.finalCapital.toFixed(4)} SOL`);
        logger.info(`[Backtest] ROI: ${results.roi.toFixed(2)}%`);
        logger.info(`[Backtest] Win rate: ${results.winRate.toFixed(1)}%`);

        return results;
    }

    /**
     * Process a single token
     */
    private async processToken(token: HistoricalToken): Promise<void> {
        // Check if we have capital
        if (this.capital < 0.05) {
            logger.warn('[Backtest] Insufficient capital, skipping token');
            return;
        }

        try {
            // Get AI decision using multi-agent system
            const decision = await orchestrateDecision(this.connection, {
                type: "NEW_POOL",
                pool: `pool_${token.baseMint}`,
                baseMint: token.baseMint,
                quoteMint: token.quoteMint,
                coinCreator: token.coinCreator,
                liquidityUsd: token.liquidityUsd,
                recentBuyers: token.recentBuyers,
                ageMs: token.ageMs,
                fdv: token.fdv,
            });

            if (decision.action === 'BUY') {
                // Simulate buy
                const amountSol = decision.amountInLamports / 1e9;

                // Check if we have enough capital
                if (amountSol > this.capital) {
                    logger.warn(`[Backtest] Insufficient capital for trade (need ${amountSol}, have ${this.capital})`);
                    return;
                }

                // Deduct capital
                this.capital -= amountSol;

                // Simulate outcome based on actual data
                const outcome = token.actualOutcome!;
                let exitReason: 'TP' | 'SL' | 'TIME';
                let pnlPercent: number;

                if (outcome.priceChange24h >= decision.tpPercent) {
                    exitReason = 'TP';
                    pnlPercent = decision.tpPercent;
                } else if (outcome.priceChange24h <= -decision.slPercent) {
                    exitReason = 'SL';
                    pnlPercent = -decision.slPercent;
                } else {
                    exitReason = 'TIME';
                    pnlPercent = outcome.priceChange24h;
                }

                const pnl = (pnlPercent / 100) * amountSol;
                this.capital += amountSol + pnl;

                // Record trade
                this.trades.push({
                    token,
                    decision: 'BUY',
                    reason: decision.reason,
                    amountSol,
                    tpPercent: decision.tpPercent,
                    slPercent: decision.slPercent,
                    entryTime: token.timestamp,
                    exitTime: token.timestamp + 86400000, // +24h
                    exitReason,
                    pnl,
                    pnlPercent,
                });
            } else {
                // Record ignore decision
                this.trades.push({
                    token,
                    decision: 'IGNORE',
                    reason: decision.reason,
                    amountSol: 0,
                    tpPercent: 0,
                    slPercent: 0,
                    entryTime: token.timestamp,
                });
            }
        } catch (error: any) {
            logger.error(`[Backtest] Error processing token: ${error.message}`);
        }
    }

    /**
     * Calculate simulation results
     */
    private calculateResults(): SimulationResults {
        const buyTrades = this.trades.filter(t => t.decision === 'BUY');
        const profitableTrades = buyTrades.filter(t => (t.pnl || 0) > 0);
        const losingTrades = buyTrades.filter(t => (t.pnl || 0) < 0);

        const totalPnL = buyTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const avgPnL = buyTrades.length > 0 ? totalPnL / buyTrades.length : 0;
        const winRate = buyTrades.length > 0 ? (profitableTrades.length / buyTrades.length) * 100 : 0;
        const bestTrade = Math.max(...buyTrades.map(t => t.pnl || 0), 0);
        const worstTrade = Math.min(...buyTrades.map(t => t.pnl || 0), 0);
        const roi = ((this.capital - this.initialCapital) / this.initialCapital) * 100;

        return {
            totalTrades: this.trades.length,
            buyDecisions: buyTrades.length,
            ignoreDecisions: this.trades.filter(t => t.decision === 'IGNORE').length,
            profitableTrades: profitableTrades.length,
            losingTrades: losingTrades.length,
            totalPnL,
            winRate,
            avgPnL,
            bestTrade,
            worstTrade,
            finalCapital: this.capital,
            roi,
            trades: this.trades,
        };
    }
}
