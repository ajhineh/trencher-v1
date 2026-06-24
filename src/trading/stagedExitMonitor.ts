// src/trading/stagedExitMonitor.ts
/**
 * Staged Exit Monitor
 * Replaces startStrategyMonitor with staged exit logic
 * 
 * Strategy:
 * - +20% → Sell 30%
 * - +50% → Sell 30%
 * - +100% → Activate trailing 12%
 * - Buyer drop → Emergency exit
 */

import { Connection, Keypair } from "@solana/web3.js";
import { logger } from "../logger";
import { executeSell } from "../executesell";
import { getStagedExitManager } from "./stagedExit";
import { getKillSwitch } from "../safety/killSwitch";

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function startStagedExitMonitor(
    mint: string,
    entryPrice: number,
    tokenAmount: number,
    symbol: string,
    decimals: number,
    buySig: string,
    connection: Connection,
    keypair: Keypair,
    priceMonitor: any,
    activePositions: any,
    config: {
        SLIPPAGE_BPS: number;
        SKIP_PREFLIGHT: boolean;
        BUYER_MONITOR_WINDOW_SEC: number;
        MIN_BUYERS_IN_WINDOW: number;
        BUYER_MONITOR_POLL_MS: number;
        PROFIT_TRANSFER_THRESHOLD: number;
    },
    helpers: {
        getRecentBuyersCount: (mint: string, window: number) => Promise<number>;
        checkAndTransferProfitsIfNeeded: (threshold: number) => Promise<void>;
    }
): Promise<void> {
    logger.info(`[STAGED-EXIT-MONITOR] 🎯 Started for ${symbol} (${mint.slice(0, 8)}...)`);

    const startTime = Date.now();
    let lastPriceChange = Date.now();
    let pollMs = 1500;
    let currentTokenAmount = tokenAmount;

    // Track position
    activePositions[mint] = {
        mint,
        symbol,
        decimals,
        purchasePrice: entryPrice,
        buyTxSignature: buySig,
        highestPrice: entryPrice,
        tokenAmount,
    };

    // Initialize managers
    const killSwitch = getKillSwitch();
    const stagedExit = getStagedExitManager();
    stagedExit.initializePosition(buySig, entryPrice, tokenAmount);

    // Initialize Dynamic SL (Phase D)
    const { getDynamicSLCalculator } = await import('./dynamicStopLoss');
    const { getBuyerMonitorConnector } = await import('../dataSources/buyerMonitorConnector');
    const { getLiquidityTracker } = await import('../monitoring/liquidityTracker');
    const { getPriceHistoryTracker } = await import('../monitoring/priceHistoryTracker');

    const dynSL = getDynamicSLCalculator();
    const buyerMonitor = getBuyerMonitorConnector();
    const liqTracker = getLiquidityTracker(connection);
    const priceHistory = getPriceHistoryTracker();

    // Track initial state for Dynamic SL
    const initialLiquiditySol = await liqTracker.getCurrentLiquidity(mint) / 1e9;
    const initialBuyersPerSec = await buyerMonitor.getBuyersPerSecond(mint, 1);

    logger.debug(
        `[DYNAMIC-SL] Initial state | Liq: ${initialLiquiditySol.toFixed(2)} SOL | ` +
        `Buyers: ${initialBuyersPerSec.toFixed(2)}/sec`
    );

    // Helper: Execute sell and record
    const executeSellAndRecord = async (
        amount: number,
        currentPrice: number,
        reason: string
    ) => {
        logger.info(
            `[STAGED-EXIT] 💸 Selling ${amount.toFixed(2)} ${symbol} | ` +
            `Reason: ${reason} | Price: ${currentPrice.toFixed(6)}`
        );

        await executeSell(
            mint,
            amount,
            connection,
            keypair,
            config.SLIPPAGE_BPS,
            config.SKIP_PREFLIGHT
        );

        currentTokenAmount -= amount;

        // If fully sold, record for kill switch AND A/B testing
        if (currentTokenAmount <= 0.001) {
            const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
            const holdTimeSeconds = (Date.now() - startTime) / 1000;

            // Kill switch recording
            const { shouldKill } = killSwitch.recordTrade({
                tradeId: buySig,
                profitPercent,
                timestamp: Date.now(),
            });

            if (shouldKill) {
                logger.error(`[KILL-SWITCH] 🚨 ACTIVATED! AUTO_BUY disabled.`);
            }

            // A/B Test recording (Phase B)
            try {
                const { getABTestManager } = await import('../testing/abTestManager');
                const { getAllPositions } = await import('../state/positions');

                const abTest = getABTestManager();

                // Find position to get abTestPath
                const allPositions = getAllPositions();
                const position = allPositions.find(p => p.buySignature === buySig);

                if (position?.abTestPath) {
                    abTest.recordTrade({
                        tradeId: buySig,
                        path: position.abTestPath,
                        entryPrice,
                        exitPrice: currentPrice,
                        profitPercent,
                        holdTimeSeconds,
                        timestamp: Date.now(),
                        reason,
                    });

                    logger.info(
                        `[AB-TEST] Recorded ${position.abTestPath} trade | ` +
                        `P/L: ${profitPercent.toFixed(2)}% | ` +
                        `Hold: ${holdTimeSeconds.toFixed(0)}s`
                    );
                } else {
                    logger.debug(`[AB-TEST] No abTestPath found for ${buySig.slice(0, 8)}...`);
                }
            } catch (error: any) {
                logger.warn(`[AB-TEST] Recording failed: ${error.message}`);
            }

            logger.info(
                `[STAGED-EXIT] ✅ Position fully closed | ` +
                `Final P/L: ${profitPercent.toFixed(2)}% | ` +
                `Hold time: ${holdTimeSeconds.toFixed(0)}s`
            );
        } else {
            logger.info(
                `[STAGED-EXIT] 📊 Partial sell | Remaining: ${currentTokenAmount.toFixed(2)} ` +
                `(${((currentTokenAmount / tokenAmount) * 100).toFixed(1)}%)`
            );
        }

        await helpers.checkAndTransferProfitsIfNeeded(config.PROFIT_TRANSFER_THRESHOLD);
    };

    // Buyer activity monitor (emergency exit)
    const buyerCheckInterval = setInterval(async () => {
        try {
            const recentBuyers = await helpers.getRecentBuyersCount(
                mint,
                config.BUYER_MONITOR_WINDOW_SEC
            );

            if (recentBuyers < config.MIN_BUYERS_IN_WINDOW) {
                logger.warn(
                    `[STAGED-EXIT] ⚠️ Buyer drop! Emergency exit | ` +
                    `Buyers: ${recentBuyers} < ${config.MIN_BUYERS_IN_WINDOW}`
                );

                const exitPrice = await priceMonitor.getCurrentPrice(mint) ?? entryPrice;
                await executeSellAndRecord(currentTokenAmount, exitPrice, 'BUYER_ACTIVITY_DROP');
                clearInterval(buyerCheckInterval);
            }
        } catch (error: any) {
            logger.warn(`[STAGED-EXIT] Buyer monitor error: ${error?.message ?? error}`);
        }
    }, config.BUYER_MONITOR_POLL_MS);

    // Main monitoring loop
    try {
        while (true) {
            await sleep(pollMs);

            // Check if fully closed
            if (currentTokenAmount <= 0.001) {
                logger.info(`[STAGED-EXIT] Position fully exited`);
                break;
            }

            const currentPrice = await priceMonitor.getCurrentPrice(mint);
            if (!currentPrice) continue;

            // Dynamic polling
            const priceChange = Math.abs(currentPrice - activePositions[mint].highestPrice);
            if (priceChange > 0.01 * entryPrice) {
                pollMs = 500;
                lastPriceChange = Date.now();
            } else if (Date.now() - lastPriceChange > 5000) {
                pollMs = 2000;
            }

            // Update highest price
            activePositions[mint].highestPrice = Math.max(
                activePositions[mint].highestPrice,
                currentPrice
            );

            // Record price for volatility calculation
            priceHistory.recordPrice(mint, currentPrice);

            // === Dynamic SL Check (Phase D) ===
            // Only apply before staged exit takes profits
            const stats = stagedExit.getStatistics(buySig);
            const enableDynamicSL = process.env.ENABLE_DYNAMIC_SL !== 'false'; // Default enabled

            if (enableDynamicSL && (!stats?.tp1Done || !stats?.tp2Done)) {
                try {
                    // Get real-time data
                    const currentLiquiditySol = await liqTracker.getCurrentLiquidity(mint) / 1e9;
                    const currentBuyersPerSec = await buyerMonitor.getBuyersPerSecond(mint, 1);
                    const priceHistoryData = priceHistory.getHistory(mint, 10);

                    // Calculate Dynamic SL
                    const slResult = dynSL.calculate({
                        currentLiquiditySol,
                        initialLiquiditySol,
                        currentBuyersPerSec,
                        initialBuyersPerSec,
                        priceHistory: priceHistoryData,
                        entryPrice,
                        currentPrice,
                        holdTimeSeconds: (Date.now() - startTime) / 1000,
                    });

                    // Log only on changes or high urgency
                    if (slResult.urgency === 'CRITICAL' || slResult.urgency === 'HIGH') {
                        logger.warn(
                            `[DYNAMIC-SL] ${dynSL.getUrgencyEmoji(slResult.urgency)} ` +
                            `SL: ${slResult.stopLossPercent}% (${slResult.stopLossPrice.toFixed(6)}) | ` +
                            `Reason: ${slResult.reason}`
                        );
                    }

                    // CRITICAL urgency = immediate exit (overrides everything)
                    if (slResult.urgency === 'CRITICAL') {
                        logger.error(
                            `[DYNAMIC-SL] 🚨 CRITICAL urgency detected - Emergency exit! | ` +
                            `Reason: ${slResult.reason}`
                        );
                        await executeSellAndRecord(currentTokenAmount, currentPrice, 'CRITICAL_DYNAMIC_SL');
                        break; // Exit loop
                    }

                    // Check if SL hit
                    if (dynSL.shouldTriggerStopLoss(currentPrice, slResult.stopLossPrice)) {
                        logger.warn(
                            `[DYNAMIC-SL] Stop loss triggered at ${currentPrice.toFixed(6)} | ` +
                            `SL Price: ${slResult.stopLossPrice.toFixed(6)} (${slResult.stopLossPercent}%)`
                        );
                        await executeSellAndRecord(currentTokenAmount, currentPrice, 'DYNAMIC_SL');
                        break; // Exit loop
                    }
                } catch (error: any) {
                    logger.warn(`[DYNAMIC-SL] Calculation error: ${error.message}`);
                    // Continue to staged exit on error
                }
            }

            // Check staged exit conditions
            const action = stagedExit.update(buySig, currentPrice);

            if (action.action === 'SELL_PARTIAL') {
                // TP1 (+20%) or TP2 (+50%)
                await executeSellAndRecord(action.amount!, currentPrice, action.reason);
            } else if (action.action === 'SELL_ALL') {
                // Trailing stop hit
                await executeSellAndRecord(currentTokenAmount, currentPrice, action.reason);
                break;
            } else if (action.action === 'TRAILING_ACTIVATED') {
                logger.info(
                    `[STAGED-EXIT] 🚀 Trailing activated! ` +
                    `Peak: ${activePositions[mint].highestPrice.toFixed(6)} | ` +
                    `Remaining: ${currentTokenAmount.toFixed(2)} ${symbol}`
                );
            }
        }
    } finally {
        logger.info(`[STAGED-EXIT] Monitor finished for ${mint.slice(0, 8)}...`);
        clearInterval(buyerCheckInterval);
        stagedExit.removePosition(buySig);
        delete activePositions[mint];
    }
}
