// src/backtesting/runBacktest.ts
// Example script to run a backtest

import { Connection } from "@solana/web3.js";
import { StrategySimulator } from "./strategySimulator";
import { ReportGenerator } from "./reportGenerator";
import { BacktestConfig } from "./dataReplay";
import { logger } from "../logger";

async function runBacktest() {
    logger.info("=".repeat(60));
    logger.info("Starting Backtest Simulation");
    logger.info("=".repeat(60));

    // Configuration
    const config: BacktestConfig = {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        endDate: new Date(),
        initialCapital: 1.0, // 1 SOL
        dataSource: 'generated', // Use generated sample data
    };

    // Setup
    const connection = new Connection(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
    const simulator = new StrategySimulator(connection, config);

    try {
        // Run simulation
        const results = await simulator.runSimulation(config);

        // Display results
        ReportGenerator.displayReport(results);

        // Save reports
        await ReportGenerator.saveJsonReport(results);
        await ReportGenerator.saveMarkdownReport(results);

        // Show recommendations
        const recommendations = ReportGenerator.generateRecommendations(results);
        if (recommendations.length > 0) {
            console.log("\n💡 RECOMMENDATIONS:");
            recommendations.forEach(rec => console.log(`   ${rec}`));
            console.log("");
        }

        logger.info("Backtest complete! Reports saved.");
    } catch (error: any) {
        logger.error(`Backtest failed: ${error.message}`);
        throw error;
    }
}

// Run if executed directly
if (require.main === module) {
    runBacktest().catch(error => {
        logger.error(`Fatal error: ${error}`);
        process.exit(1);
    });
}

export { runBacktest };
