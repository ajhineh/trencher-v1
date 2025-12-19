// src/futures/intelligentTradingSystem.ts

/**
 * Intelligent Trading System
 * Combines Order Flow Analysis with AI Agent
 */

import { OrderFlowAnalyzer } from './orderflow/orderFlowAnalyzer';
import { AITradingAgent } from './ai/aiTradingAgent';
import { RecentMarketData, Portfolio } from './ai/types';
import { MarketScanner } from './scanner/marketScanner';
import { CoinExExecutor } from './execution/coinexExecutor';
import { logger } from '../logger';
import { MarketRegimeDetector } from '../strategies/hybrid/marketRegimeDetector';

export class IntelligentTradingSystem {
    private orderFlowAnalyzer: OrderFlowAnalyzer;
    private aiAgent: AITradingAgent;
    private executor: CoinExExecutor;
    private regimeDetector: MarketRegimeDetector;
    private scanner: MarketScanner; // New
    private isDryRun: boolean;

    constructor(openaiApiKey?: string, dryRun: boolean = true, whitelist: string[] = []) {
        this.orderFlowAnalyzer = new OrderFlowAnalyzer();
        this.aiAgent = new AITradingAgent(openaiApiKey);
        this.executor = new CoinExExecutor(undefined, undefined, dryRun);
        this.regimeDetector = new MarketRegimeDetector(this.executor as any);
        this.scanner = new MarketScanner(this.executor, this, whitelist); // Pass whitelist
        this.isDryRun = dryRun;
    }

    /**
     * Start Autonomous Scanning Mode
     */
    startAutonmousMode(intervalMs: number = 300000): void {
        logger.info('🤖 Starting Autonomous Scanning Mode...');
        this.scanner.start(intervalMs);
    }

    /**
     * Stop Autonomous Scanning Mode
     */
    stopAutonomousMode(): void {
        this.scanner.stop();
    }

    /**
     * Initialize system
     */
    async initialize(): Promise<void> {
        logger.info('🚀 Initializing Intelligent Trading System (Personal Alpha Mode - CoinEx)...');
        await this.orderFlowAnalyzer.initialize();
        await this.regimeDetector.detectRegime(); // Warmup
        logger.info('✅ System initialized');
    }

    /**
     * Subscribe to symbol
     */
    async subscribeToSymbol(symbol: string): Promise<void> {
        await this.orderFlowAnalyzer.subscribeToSymbol(symbol);
    }

    /**
     * Analyze and decide with AI
     */
    async analyzeAndDecide(
        symbol: string,
        timeframeMs: number = 60000
    ): Promise<{
        orderFlowSignal: any;
        aiDecision: any;
        finalDecision: 'EXECUTE' | 'SKIP';
        executionResult?: any;
    }> {
        logger.info('\n═══════════════════════════════════════════════════');
        logger.info('📊 INTELLIGENT TRADING ANALYSIS');
        logger.info('═══════════════════════════════════════════════════\n');

        // 0. CHECK REGIME
        const regime = await this.regimeDetector.detectRegime();
        logger.info(`0️⃣ Global Regime: ${regime.regime} (BTC: ${regime.btcTrend})`);

        // 1. Get Order Flow signal
        logger.info('1️⃣ Order Flow Analysis...');
        const orderFlowSignal = await this.orderFlowAnalyzer.analyze(symbol, timeframeMs);

        logger.info(`   Direction: ${orderFlowSignal.direction}`);
        logger.info(`   Confidence: ${orderFlowSignal.confidence.toFixed(2)}%`);

        // 2. Get recent market data (Real via Executor client or fallbacks)
        // For now, we assume OrderFlow provides sufficient immediate context, but ideally we add Candle data here.
        const recentData = await this.getRecentMarketData(symbol);

        // 3. Get portfolio state (Real via Executor)
        const portfolio = await this.getPortfolio();
        logger.info(`   Portrait Stats: Balance=${portfolio.availableBalance} USDT, Exposure=${portfolio.totalExposure}`);

        // 4. AI evaluation
        logger.info('\n2️⃣ AI Agent Evaluation...');
        const aiDecision = await this.aiAgent.evaluateSignal(
            orderFlowSignal,
            recentData,
            portfolio
        );

        logger.info(`\n   AI Decision: ${aiDecision.shouldTrade ? '✅ TRADE' : '❌ SKIP'}`);
        logger.info(`   AI Confidence: ${aiDecision.confidence}%`);
        logger.info(`   Reasoning: ${aiDecision.reasoning[0]}`);

        // 5. Final decision & Execution
        let finalDecision: 'EXECUTE' | 'SKIP' = 'SKIP';
        let executionResult = undefined;

        // Threshold: High confidence for real money
        // UNIFIED AI FILTER
        // If Regime is BEAR and Signal is LONG -> Require Higher Confidence (90%)
        let confidenceThreshold = 80;
        const isCounterTrend = (regime.regime === 'BEAR' && orderFlowSignal.direction === 'LONG') ||
            (regime.regime === 'BULL' && orderFlowSignal.direction === 'SHORT');

        if (isCounterTrend) {
            confidenceThreshold = 90;
            logger.warn(`⚠️ Counter-Trend Signal Detected! Raising confidence requirement to ${confidenceThreshold}%`);
        }

        // Threshold: High confidence for real money
        if (aiDecision.shouldTrade && aiDecision.confidence > confidenceThreshold) {
            finalDecision = 'EXECUTE';

            // Execute!
            try {
                const side = orderFlowSignal.direction === 'LONG' ? 'BUY' : 'SELL';

                // Unified AI: Leverage Boost
                let leverage = aiDecision.adjustedParams.leverage || 1;
                if (!isCounterTrend && regime.regime !== 'SIDEWAYS') {
                    leverage = Math.min(leverage + 1, 5);
                    logger.info(`🔥 Regime Align Boost: Leverage increased to ${leverage}x`);
                }
                const quantity = aiDecision.adjustedParams.positionSize; // This needs to be calibrated to lot size

                // Determine quantity logic:
                // If positionSize is USDT value, convert to token amount roughly
                // For simplicity, let's assume positionSize is raw quantity for now or handle safe min.
                // In production, we need a "Quote to Quantity" calculator. 
                // Let's assume the AI returns a "Risk Amount in USDT" and we calculate qty.
                const price = orderFlowSignal.entry;
                const safeQty = parseFloat((quantity / price).toFixed(3)); // Crude rounding

                logger.info(`🚀 EXECUTING ${side} ${symbol} | Qty: ${safeQty} | Lev: ${leverage}x`);

                if (side === 'BUY') {
                    executionResult = await this.executor.openLong(symbol, safeQty, leverage);

                    // Risk Management: 1.5% SL, 3% TP (Example)
                    const slPrice = parseFloat((price * 0.985).toFixed(2));
                    const tpPrice = parseFloat((price * 1.03).toFixed(2));

                    await this.executor.setStopLoss(symbol, 'BUY', slPrice);
                    await this.executor.setTakeProfit(symbol, 'BUY', tpPrice);
                    logger.info(`🛡️ SL set at ${slPrice}, 🎯 TP set at ${tpPrice}`);

                } else {
                    executionResult = await this.executor.openShort(symbol, safeQty, leverage);

                    // Risk Management: 1.5% SL, 3% TP
                    const slPrice = parseFloat((price * 1.015).toFixed(2));
                    const tpPrice = parseFloat((price * 0.97).toFixed(2));

                    await this.executor.setStopLoss(symbol, 'SELL', slPrice);
                    await this.executor.setTakeProfit(symbol, 'SELL', tpPrice);
                    logger.info(`🛡️ SL set at ${slPrice}, 🎯 TP set at ${tpPrice}`);
                }
            } catch (err) {
                logger.error(`❌ Execution Failed: ${err}`);
                finalDecision = 'SKIP';
            }
        }

        logger.info('\n═══════════════════════════════════════════════════');
        logger.info(`🎯 FINAL STATUS: ${finalDecision}`);
        logger.info('═══════════════════════════════════════════════════\n');

        return {
            orderFlowSignal,
            aiDecision,
            finalDecision,
            executionResult
        };
    }

    /**
     * Get recent market data (Real via Executor)
     */
    private async getRecentMarketData(symbol: string): Promise<RecentMarketData> {
        try {
            // Fetch real candles (1m timeframe, last 100 candles)
            return await this.executor.getCandles(symbol, '1m', 100);
        } catch (error) {
            logger.error(`Failed to fetch market data: ${error}`);
            // Fallback for robustness
            return { prices: [], volumes: [], timestamps: [] };
        }
    }

    /**
     * Get portfolio state (Real Implementation)
     */
    private async getPortfolio(): Promise<Portfolio> {
        try {
            const balance = await this.executor.getBalance();
            const positions = await this.executor.getPositions();

            const totalExposure = positions.reduce((sum, p) => sum + (Math.abs(p.positionAmt) * p.entryPrice), 0);
            const totalUnrealizedPnL = positions.reduce((sum, p) => sum + p.unRealizedProfit, 0);

            return {
                totalValue: balance + totalUnrealizedPnL,
                availableBalance: balance, // simplified
                openPositions: positions.length,
                totalExposure: totalExposure
            };
        } catch (error) {
            logger.error(`Failed to fetch portfolio: ${error}`);
            return {
                totalValue: 0,
                availableBalance: 0,
                openPositions: 0,
                totalExposure: 0
            };
        }
    }

    /**
     * Disconnect
     */
    disconnect(): void {
        this.orderFlowAnalyzer.disconnect();
    }
}

