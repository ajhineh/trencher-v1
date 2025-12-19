// src/monitoring/performanceMetrics.ts

import { getAllPositions, getPortfolioMetrics } from "../state/positions";
import { getTradeHistory } from "../state/tradeHistory";
import { logger } from "../logger";

export interface PerformanceSnapshot {
    timestamp: number;
    totalPnL: number;
    totalPnLUsd: number;
    winRate: number;
    totalTrades: number;
    openPositions: number;
    capitalUtilization: number;
    avgTradeDuration: number;
    bestTrade: number;
    worstTrade: number;
    currentDrawdown: number;
    sharpeRatio: number;
}

export class PerformanceMetrics {
    private snapshots: PerformanceSnapshot[] = [];
    private solPriceUsd: number = 0;

    constructor() {
        this.updateSolPrice();
    }

    private async updateSolPrice() {
        try {
            const response = await fetch(
                "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
            );
            const data = await response.json();
            this.solPriceUsd = data.solana?.usd || 0;
        } catch (error) {
            logger.error(`[Metrics] Failed to fetch SOL price: ${error}`);
        }
    }

    /**
     * Get current performance snapshot
     */
    async getSnapshot(): Promise<PerformanceSnapshot> {
        await this.updateSolPrice();

        const tradeHistory = getTradeHistory();
        const stats = tradeHistory.getStatistics(24 * 7); // 7 days
        const portfolioMetrics = getPortfolioMetrics();
        const allPositions = getAllPositions();

        // Calculate average trade duration
        const closedPositions = allPositions.filter(p => p.status === "CLOSED" && p.closedAt);
        const avgDuration = closedPositions.length > 0
            ? closedPositions.reduce((sum, p) => sum + ((p.closedAt! - p.openedAt) / 1000 / 60), 0) / closedPositions.length
            : 0;

        // Calculate current drawdown
        const peakPnL = Math.max(...this.snapshots.map(s => s.totalPnL), portfolioMetrics.performance.totalPnL);
        const currentDrawdown = peakPnL > 0
            ? ((peakPnL - portfolioMetrics.performance.totalPnL) / peakPnL) * 100
            : 0;

        // Calculate Sharpe ratio (simplified)
        const returns = this.snapshots.slice(-30).map(s => s.totalPnL);
        const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
        const stdDev = returns.length > 1
            ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
            : 1;
        const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) : 0;

        const snapshot: PerformanceSnapshot = {
            timestamp: Date.now(),
            totalPnL: portfolioMetrics.performance.totalPnL,
            totalPnLUsd: portfolioMetrics.performance.totalPnL * this.solPriceUsd,
            winRate: portfolioMetrics.performance.winRate,
            totalTrades: portfolioMetrics.totalPositions,
            openPositions: portfolioMetrics.openPositions,
            capitalUtilization: portfolioMetrics.riskMetrics.capitalUtilization,
            avgTradeDuration: avgDuration,
            bestTrade: portfolioMetrics.performance.bestPosition,
            worstTrade: portfolioMetrics.performance.worstPosition,
            currentDrawdown,
            sharpeRatio,
        };

        this.snapshots.push(snapshot);
        // Keep only last 1000 snapshots
        if (this.snapshots.length > 1000) {
            this.snapshots = this.snapshots.slice(-1000);
        }

        return snapshot;
    }

    /**
     * Display performance dashboard in console
     */
    async displayDashboard() {
        const snapshot = await this.getSnapshot();

        console.log("\n" + "=".repeat(60));
        console.log("📊 PERFORMANCE DASHBOARD");
        console.log("=".repeat(60));
        console.log(`⏰ Time: ${new Date(snapshot.timestamp).toLocaleString()}`);
        console.log("");
        console.log("💰 PROFIT & LOSS:");
        console.log(`   Total P/L: ${snapshot.totalPnL.toFixed(4)} SOL ($${snapshot.totalPnLUsd.toFixed(2)})`);
        console.log(`   Win Rate: ${snapshot.winRate.toFixed(1)}%`);
        console.log(`   Best Trade: ${snapshot.bestTrade.toFixed(4)} SOL`);
        console.log(`   Worst Trade: ${snapshot.worstTrade.toFixed(4)} SOL`);
        console.log("");
        console.log("📈 TRADING ACTIVITY:");
        console.log(`   Total Trades: ${snapshot.totalTrades}`);
        console.log(`   Open Positions: ${snapshot.openPositions}`);
        console.log(`   Avg Duration: ${snapshot.avgTradeDuration.toFixed(1)} minutes`);
        console.log("");
        console.log("⚠️ RISK METRICS:");
        console.log(`   Capital Utilization: ${snapshot.capitalUtilization.toFixed(1)}%`);
        console.log(`   Current Drawdown: ${snapshot.currentDrawdown.toFixed(2)}%`);
        console.log(`   Sharpe Ratio: ${snapshot.sharpeRatio.toFixed(2)}`);
        console.log("=".repeat(60) + "\n");
    }

    /**
     * Get performance summary for logging
     */
    async getSummary(): Promise<string> {
        const snapshot = await this.getSnapshot();
        return `P/L: ${snapshot.totalPnL.toFixed(4)} SOL | Win Rate: ${snapshot.winRate.toFixed(1)}% | Open: ${snapshot.openPositions} | Drawdown: ${snapshot.currentDrawdown.toFixed(1)}%`;
    }

    /**
     * Get historical snapshots
     */
    getHistory(count: number = 100): PerformanceSnapshot[] {
        return this.snapshots.slice(-count);
    }
}

// Singleton instance
let metricsInstance: PerformanceMetrics | null = null;

export function getPerformanceMetrics(): PerformanceMetrics {
    if (!metricsInstance) {
        metricsInstance = new PerformanceMetrics();
    }
    return metricsInstance;
}
