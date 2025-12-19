// src/backtesting/reportGenerator.ts

import { SimulationResults, SimulatedTrade } from "./strategySimulator";
import { logger } from "../logger";
import fs from "fs";
import path from "path";

export class ReportGenerator {
    /**
     * Generate console report
     */
    static displayReport(results: SimulationResults): void {
        console.log("\n" + "=".repeat(80));
        console.log("📊 BACKTEST RESULTS");
        console.log("=".repeat(80));

        console.log("\n💰 PERFORMANCE:");
        console.log(`   Initial Capital: ${results.finalCapital - results.totalPnL} SOL`);
        console.log(`   Final Capital: ${results.finalCapital.toFixed(4)} SOL`);
        console.log(`   Total P/L: ${results.totalPnL > 0 ? '+' : ''}${results.totalPnL.toFixed(4)} SOL`);
        console.log(`   ROI: ${results.roi > 0 ? '+' : ''}${results.roi.toFixed(2)}%`);

        console.log("\n📈 TRADING ACTIVITY:");
        console.log(`   Total Decisions: ${results.totalTrades}`);
        console.log(`   Buy Decisions: ${results.buyDecisions} (${((results.buyDecisions / results.totalTrades) * 100).toFixed(1)}%)`);
        console.log(`   Ignore Decisions: ${results.ignoreDecisions} (${((results.ignoreDecisions / results.totalTrades) * 100).toFixed(1)}%)`);

        console.log("\n🎯 WIN/LOSS:");
        console.log(`   Profitable Trades: ${results.profitableTrades}`);
        console.log(`   Losing Trades: ${results.losingTrades}`);
        console.log(`   Win Rate: ${results.winRate.toFixed(1)}%`);
        console.log(`   Average P/L: ${results.avgPnL > 0 ? '+' : ''}${results.avgPnL.toFixed(4)} SOL`);

        console.log("\n🏆 BEST/WORST:");
        console.log(`   Best Trade: +${results.bestTrade.toFixed(4)} SOL`);
        console.log(`   Worst Trade: ${results.worstTrade.toFixed(4)} SOL`);

        console.log("\n" + "=".repeat(80));

        // Show sample trades
        console.log("\n📋 SAMPLE TRADES (Last 5 BUY decisions):");
        const buyTrades = results.trades.filter(t => t.decision === 'BUY').slice(-5);
        for (const trade of buyTrades) {
            const icon = (trade.pnl || 0) > 0 ? '🟢' : '🔴';
            console.log(`\n${icon} ${trade.token.baseMint.slice(0, 12)}...`);
            console.log(`   Amount: ${trade.amountSol.toFixed(4)} SOL`);
            console.log(`   Exit: ${trade.exitReason} | P/L: ${trade.pnl! > 0 ? '+' : ''}${trade.pnl!.toFixed(4)} SOL (${trade.pnlPercent! > 0 ? '+' : ''}${trade.pnlPercent!.toFixed(2)}%)`);
            console.log(`   Reason: ${trade.reason.slice(0, 60)}...`);
        }

        console.log("\n" + "=".repeat(80) + "\n");
    }

    /**
     * Generate detailed JSON report
     */
    static async saveJsonReport(results: SimulationResults, filename: string = 'backtest-results.json'): Promise<void> {
        const reportPath = path.join(process.cwd(), filename);

        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                initialCapital: results.finalCapital - results.totalPnL,
                finalCapital: results.finalCapital,
                totalPnL: results.totalPnL,
                roi: results.roi,
                totalTrades: results.totalTrades,
                buyDecisions: results.buyDecisions,
                ignoreDecisions: results.ignoreDecisions,
                winRate: results.winRate,
                avgPnL: results.avgPnL,
                bestTrade: results.bestTrade,
                worstTrade: results.worstTrade,
            },
            trades: results.trades.map(t => ({
                token: t.token.baseMint,
                creator: t.token.coinCreator,
                decision: t.decision,
                reason: t.reason,
                amount: t.amountSol,
                pnl: t.pnl,
                pnlPercent: t.pnlPercent,
                exitReason: t.exitReason,
            })),
        };

        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        logger.info(`[Backtest] Report saved to ${reportPath}`);
    }

    /**
     * Generate markdown report
     */
    static async saveMarkdownReport(results: SimulationResults, filename: string = 'backtest-report.md'): Promise<void> {
        const reportPath = path.join(process.cwd(), filename);

        let markdown = `# Backtest Report\n\n`;
        markdown += `**Generated**: ${new Date().toLocaleString()}\n\n`;

        markdown += `## Summary\n\n`;
        markdown += `| Metric | Value |\n`;
        markdown += `|--------|-------|\n`;
        markdown += `| Initial Capital | ${(results.finalCapital - results.totalPnL).toFixed(4)} SOL |\n`;
        markdown += `| Final Capital | ${results.finalCapital.toFixed(4)} SOL |\n`;
        markdown += `| Total P/L | ${results.totalPnL > 0 ? '+' : ''}${results.totalPnL.toFixed(4)} SOL |\n`;
        markdown += `| ROI | ${results.roi > 0 ? '+' : ''}${results.roi.toFixed(2)}% |\n`;
        markdown += `| Win Rate | ${results.winRate.toFixed(1)}% |\n`;
        markdown += `| Total Trades | ${results.totalTrades} |\n`;
        markdown += `| Buy Decisions | ${results.buyDecisions} |\n`;
        markdown += `| Ignore Decisions | ${results.ignoreDecisions} |\n\n`;

        markdown += `## Trade Breakdown\n\n`;
        markdown += `| Token | Decision | Amount | P/L | Exit |\n`;
        markdown += `|-------|----------|--------|-----|------|\n`;

        const buyTrades = results.trades.filter(t => t.decision === 'BUY').slice(-20);
        for (const trade of buyTrades) {
            const pnlStr = trade.pnl ? `${trade.pnl > 0 ? '+' : ''}${trade.pnl.toFixed(4)} SOL` : '-';
            markdown += `| ${trade.token.baseMint.slice(0, 8)}... | ${trade.decision} | ${trade.amountSol.toFixed(4)} | ${pnlStr} | ${trade.exitReason || '-'} |\n`;
        }

        fs.writeFileSync(reportPath, markdown);
        logger.info(`[Backtest] Markdown report saved to ${reportPath}`);
    }

    /**
     * Generate recommendations based on results
     */
    static generateRecommendations(results: SimulationResults): string[] {
        const recommendations: string[] = [];

        if (results.roi < 0) {
            recommendations.push("⚠️ Strategy is losing money. Consider adjusting parameters or risk management.");
        }

        if (results.winRate < 40) {
            recommendations.push("⚠️ Low win rate (<40%). Review decision criteria and pattern detection.");
        }

        if (results.buyDecisions < results.totalTrades * 0.1) {
            recommendations.push("ℹ️ Very selective strategy (<10% buy rate). May miss opportunities.");
        }

        if (results.buyDecisions > results.totalTrades * 0.5) {
            recommendations.push("⚠️ High buy rate (>50%). May be too aggressive.");
        }

        if (Math.abs(results.worstTrade) > results.bestTrade * 2) {
            recommendations.push("⚠️ Worst trade is much larger than best trade. Improve stop loss management.");
        }

        if (results.roi > 20) {
            recommendations.push("✅ Excellent performance! Strategy shows strong potential.");
        } else if (results.roi > 0) {
            recommendations.push("✅ Profitable strategy. Consider optimizing for better returns.");
        }

        return recommendations;
    }
}
