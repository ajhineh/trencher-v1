// src/futures/scanner/marketScanner.ts

import { CoinExExecutor } from '../execution/coinexExecutor';
import { logger } from '../../logger';
import { IntelligentTradingSystem } from '../intelligentTradingSystem';

export class MarketScanner {
    private executor: CoinExExecutor;
    private tradingSystem: IntelligentTradingSystem;
    private isScanning: boolean = false;
    private scanIntervalMs: number = 5 * 60 * 1000; // Scan every 5 minutes by default

    private whitelist: string[] = [];

    constructor(executor: CoinExExecutor, tradingSystem: IntelligentTradingSystem, whitelist: string[] = []) {
        this.executor = executor;
        this.tradingSystem = tradingSystem;
        this.whitelist = whitelist;
    }

    /**
     * Start the scanning loop
     */
    start(intervalMs: number = 300000): void {
        if (this.isScanning) return;

        this.isScanning = true;
        this.scanIntervalMs = intervalMs;

        logger.info(`🔍 Market Scanner Started (Interval: ${intervalMs / 1000}s)`);
        if (this.whitelist.length > 0) {
            logger.info(`📝 Whitelist active: ${this.whitelist.join(', ')}`);
        }

        this.scanLoop();
    }

    /**
     * Stop scanning
     */
    stop(): void {
        this.isScanning = false;
        logger.info('🛑 Market Scanner Stopped');
    }

    /**
     * Main Scan Loop
     */
    private async scanLoop(): Promise<void> {
        while (this.isScanning) {
            try {
                await this.scanAndTrade();
            } catch (error) {
                logger.error(`❌ Scan Loop Error: ${error}`);
            }

            // Wait for next interval
            await new Promise(resolve => setTimeout(resolve, this.scanIntervalMs));
        }
    }

    /**
     * Scan markets and trigger analysis
     */
    async scanAndTrade(): Promise<void> {
        logger.info('📡 Scanning for opportunities...');

        // 1. Get Top Markets (e.g. Top 10 Volatile/Liquid)
        const topSymbols = await this.executor.getTopMarkets(10);

        // 2. Merge with Whitelist (remove duplicates)
        const combinedSymbols = Array.from(new Set([...this.whitelist, ...topSymbols]));

        logger.info(`📋 Targets (${combinedSymbols.length}): ${combinedSymbols.join(', ')}`);

        // 3. Iterate and Analyze
        for (const symbol of combinedSymbols) {
            if (!this.isScanning) break;

            try {
                logger.info(`🧐 Analyzing Target: ${symbol}`);

                // We delegate analysis to the main system
                // Note: analyzeAndDecide handles OrderFlow, AI, and Execution internally
                const result = await this.tradingSystem.analyzeAndDecide(symbol);

                if (result.finalDecision === 'EXECUTE') {
                    logger.info(`✅ Opportunity Found & Executed on ${symbol}`);
                    // Optional: cooldown or break to avoid over-trading?
                }

            } catch (err) {
                logger.warn(`⚠️ Failed to analyze ${symbol}: ${err}`);
            }

            // Brief pause between symbols to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        logger.info('💤 Scan cycle complete. Sleeping...');
    }
}
