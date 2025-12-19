// src/futures/execution/binanceExecutor.ts

import Binance from 'binance-api-node';
import { logger } from '../../logger';
import * as dotenv from 'dotenv';

dotenv.config();

export interface FuturePosition {
    symbol: string;
    positionAmt: number;
    entryPrice: number;
    unRealizedProfit: number;
    leverage: number;
    liquidationPrice: number;
}

export class BinanceExecutor {
    private client: any;
    private isDryRun: boolean = false; // Safety flag

    constructor(apiKey?: string, apiSecret?: string, dryRun: boolean = false) {
        const key = apiKey || process.env.BINANCE_API_KEY;
        const secret = apiSecret || process.env.BINANCE_API_SECRET;

        if (!key || !secret) {
            logger.warn('[BinanceExecutor] API Key/Secret missing. Running in DRY-RUN mode.');
            this.isDryRun = true;
        } else {
            this.isDryRun = dryRun;
        }

        this.client = Binance({
            apiKey: key,
            apiSecret: secret,
            // standard proxy if needed, or direct
        });

        if (this.isDryRun) {
            logger.info('[BinanceExecutor] Initialized in START_UP_DRY_RUN mode 🛡️');
        } else {
            logger.info('[BinanceExecutor] Initialized in REAL_TRADING mode 🚀');
        }
    }

    /**
     * Open a position (Long/Short)
     */
    async openPosition(symbol: string, side: 'BUY' | 'SELL', quantity: number, leverage: number = 1): Promise<any> {
        const typeStr = side === 'BUY' ? 'LONG' : 'SHORT';
        logger.info(`[BinanceExecutor] Opening ${typeStr} on ${symbol} | Qty: ${quantity} | Lev: ${leverage}x`);

        if (this.isDryRun) {
            return { msg: 'DRY_RUN_SUCCESS', symbol, side, quantity, price: 'MARKET_PRICE' };
        }

        try {
            // 1. Set Leverage
            await this.client.futuresLeverage({
                symbol,
                leverage,
            });

            // 2. Place Order (Market)
            const order: any = {
                symbol,
                side,
                type: 'MARKET',
                quantity: quantity.toString(),
            };

            const response = await this.client.futuresOrder(order);
            logger.info(`[BinanceExecutor] Order Filled: ${response.orderId}`);
            return response;

        } catch (error) {
            logger.error(`[BinanceExecutor] Failed to open position: ${error}`);
            throw error;
        }
    }

    /**
     * Open Long
     */
    async openLong(symbol: string, quantity: number, leverage: number): Promise<any> {
        return this.openPosition(symbol, 'BUY', quantity, leverage);
    }

    /**
     * Open Short
     */
    async openShort(symbol: string, quantity: number, leverage: number): Promise<any> {
        return this.openPosition(symbol, 'SELL', quantity, leverage);
    }

    /**
     * Close All Positions for Symbol
     */
    async closePosition(symbol: string): Promise<any> {
        logger.info(`[BinanceExecutor] Closing all positions for ${symbol}`);

        if (this.isDryRun) {
            return { msg: 'DRY_RUN_CLOSED', symbol };
        }

        try {
            // Get current position size
            const positions = await this.getPositions();
            const pos = positions.find(p => p.symbol === symbol);

            if (!pos || pos.positionAmt === 0) {
                logger.warn(`[BinanceExecutor] No open position found for ${symbol}`);
                return null;
            }

            // If long (positive amt), sell. If short (negative amt), buy.
            const side = pos.positionAmt > 0 ? 'SELL' : 'BUY';
            const quantity = Math.abs(pos.positionAmt);

            const order: any = {
                symbol,
                side,
                type: 'MARKET',
                quantity: quantity.toString(),
                reduceOnly: 'true' // Important for closing
            };

            return await this.client.futuresOrder(order);

        } catch (error) {
            logger.error(`[BinanceExecutor] Failed to close position: ${error}`);
            throw error;
        }
    }

    /**
     * Set Stop Loss for a position
     */
    async setStopLoss(symbol: string, side: 'BUY' | 'SELL', stopPrice: number): Promise<any> {
        logger.info(`[BinanceExecutor] Setting STOP_LOSS for ${symbol} at ${stopPrice}`);

        if (this.isDryRun) {
            return { msg: 'DRY_RUN_SL_SET', symbol, stopPrice };
        }

        try {
            // STOP_MARKET order to close position
            // If we are LONG (BUY), SL is a SELL order.
            // If we are SHORT (SELL), SL is a BUY order.
            const slSide = side === 'BUY' ? 'SELL' : 'BUY';

            const order: any = {
                symbol,
                side: slSide,
                type: 'STOP_MARKET',
                stopPrice: stopPrice.toString(),
                closePosition: 'true', // Closes the entire position
                timeInForce: 'GTC'
            };

            return await this.client.futuresOrder(order);
        } catch (error) {
            logger.error(`[BinanceExecutor] Failed to set Stop Loss: ${error}`);
            throw error;
        }
    }

    /**
     * Set Take Profit for a position
     */
    async setTakeProfit(symbol: string, side: 'BUY' | 'SELL', price: number): Promise<any> {
        logger.info(`[BinanceExecutor] Setting TAKE_PROFIT for ${symbol} at ${price}`);

        if (this.isDryRun) {
            return { msg: 'DRY_RUN_TP_SET', symbol, price };
        }

        try {
            const tpSide = side === 'BUY' ? 'SELL' : 'BUY';

            const order: any = {
                symbol,
                side: tpSide,
                type: 'TAKE_PROFIT_MARKET',
                stopPrice: price.toString(), // For TP Market, stopPrice is the trigger
                closePosition: 'true',
                timeInForce: 'GTC'
            };

            return await this.client.futuresOrder(order);
        } catch (error) {
            logger.error(`[BinanceExecutor] Failed to set Take Profit: ${error}`);
            throw error;
        }
    }

    /**
     * Get Open Positions
     */
    async getPositions(): Promise<FuturePosition[]> {
        if (this.isDryRun) {
            return []; // Mock return empty
        }

        try {
            const risk = await this.client.futuresPositionRisk();
            // Filter only active positions
            return risk.filter((p: any) => parseFloat(p.positionAmt) !== 0).map((p: any) => ({
                symbol: p.symbol,
                positionAmt: parseFloat(p.positionAmt),
                entryPrice: parseFloat(p.entryPrice),
                unRealizedProfit: parseFloat(p.unRealizedProfit),
                leverage: parseFloat(p.leverage),
                liquidationPrice: parseFloat(p.liquidationPrice),
            }));
        } catch (error) {
            logger.error(`[BinanceExecutor] Failed to fetch positions: ${error}`);
            return [];
        }
    }

    /**
     * Get Account Balance (USDT)
     */
    async getBalance(): Promise<number> {
        if (this.isDryRun) return 10000; // Mock balance

        try {
            const balances = await this.client.futuresAccountBalance();
            const usdt = balances.find((b: any) => b.asset === 'USDT');
            return usdt ? parseFloat(usdt.balance) : 0;
        } catch (error) {
            logger.error(`[BinanceExecutor] Failed to fetch balance: ${error}`);
            return 0;
        }
    }

    /**
     * Get Recent Candles (Klines)
     */
    async getCandles(symbol: string, interval: any = '1m', limit: number = 100): Promise<{ prices: number[], volumes: number[], timestamps: number[] }> {
        if (this.isDryRun) {
            // Mock data generator for dry run verification without API
            const prices = [], volumes = [], timestamps = [];
            const now = Date.now();
            for (let i = 0; i < limit; i++) {
                prices.push(50000 + Math.random() * 100);
                volumes.push(100 + Math.random() * 10);
                timestamps.push(now - (limit - i) * 60000);
            }
            return { prices, volumes, timestamps };
        }

        try {
            const candles = await this.client.futuresCandles({ symbol, interval, limit });
            const prices = candles.map((c: any) => parseFloat(c.close));
            const volumes = candles.map((c: any) => parseFloat(c.volume));
            const timestamps = candles.map((c: any) => c.closeTime);

            return { prices, volumes, timestamps };
        } catch (error) {
            logger.error(`[BinanceExecutor] Failed to fetch candles: ${error}`);
            return { prices: [], volumes: [], timestamps: [] };
        }
    }
}
