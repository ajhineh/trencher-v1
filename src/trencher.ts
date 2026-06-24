import dotenv from 'dotenv';
dotenv.config();

import { logger } from './logger';
import { OrderManager } from './execution/orderManager';
import { SignalBroadcaster } from './services/signalBroadcaster';
import { MicroTickScalper } from './strategies/microTickScalper';
import { AmiroStrategy } from './strategies/amiroStrategy';
import { startDashboard } from './dashboard/server';
import { connectDashboardToLogger } from './dashboard/dashboardBridge';

// Handle unhandled exceptions gracefully
process.on('uncaughtException', (err) => {
    logger.error(`[SYSTEM] Uncaught Exception: ${err.message}`, err);
});

process.on('unhandledRejection', (reason: any, promise) => {
    logger.error(`[SYSTEM] Unhandled Rejection at: ${promise}, reason: ${reason?.message || reason}`);
});

async function main() {
    logger.info("==================================================");
    logger.info("🚀 Starting Trencher V2 Execution Engine 🚀");
    logger.info("==================================================");

    try {
        // Start Dashboard Server & connect logger
        startDashboard();
        connectDashboardToLogger();

        // 1. Initialize Signal Broadcaster
        const signalBroadcaster = new SignalBroadcaster();

        // 2. Initialize Order Manager
        const orderManager = new OrderManager();
        const isConnected = await orderManager.checkConnection();
        
        if (!isConnected && process.env.PAPER_TRADING_MODE !== 'true') {
            logger.error("❌ Could not connect to exchange. Exiting...");
            process.exit(1);
        }

        // 3. Configure Leverage for Target Tokens
        const defaultSymbolsStr = '1000BONK/USDT:USDT,WIF/USDT:USDT,POPCAT/USDT:USDT,BOME/USDT:USDT';
        const symbolsStr = process.env.TARGET_SYMBOLS || defaultSymbolsStr;
        const symbols = symbolsStr.split(',').map(s => s.trim());
        const defaultLeverage = Number(process.env.DEFAULT_LEVERAGE || 10);
        
        for (const sym of symbols) {
            await orderManager.setLeverage(sym, defaultLeverage);
        }

        // 4. Start Strategy
        const useAmiro = process.env.USE_AMIRO_STRATEGY === 'true';
        
        if (useAmiro) {
            logger.info(`[SYSTEM] Initializing AMIRO Futures Strategy in parallel...`);
            const amiro = new AmiroStrategy(orderManager, signalBroadcaster);
            await amiro.start();
        } else {
            logger.info(`[SYSTEM] Initializing DEFAULT Micro-Tick Scalper Strategy...`);
            const scalper = new MicroTickScalper(orderManager, signalBroadcaster);
            await scalper.start();
        }

    } catch (error: any) {
        logger.error(`[Main] Fatal Error: ${error.message}`);
        process.exit(1);
    }
}

main().catch(err => {
    logger.error("Unhandled rejection in main:", err);
});
