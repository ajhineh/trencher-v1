// src/futures/execution/coinexExecutor.ts

import * as ccxt from 'ccxt';
import { logger } from '../../logger';
import * as dotenv from 'dotenv';
import { FuturePosition } from './binanceExecutor'; // Reusing type or we define new one

dotenv.config();

export interface CoinExPosition {
    symbol: string;
    positionAmt: number;
    entryPrice: number;
    unRealizedProfit: number;
    leverage: number;
    liquidationPrice: number;
}

export class CoinExExecutor {
    private client: ccxt.coinex;
    private isDryRun: boolean = false;

    constructor(apiKey?: string, apiSecret?: string, dryRun: boolean = false) {
        const key = apiKey || process.env.COINEX_API_KEY;
        const secret = apiSecret || process.env.COINEX_API_SECRET;

        // Ensure we handle API key presence
        if (!key || !secret) {
            logger.warn('[CoinExExecutor] API Key/Secret missing. Running in DRY-RUN mode.');
            this.isDryRun = true;
        } else {
            this.isDryRun = dryRun;
        }

        // Initialize CCXT CoinEx Client for Futures
        const config: any = {
            apiKey: key,
            secret: secret,
            options: {
                'defaultType': 'swap', // 'swap' for Futures/Perpetual
            }
        };

        // Add Proxy support (useful for testing from US/Restricted regions)
        if (process.env.HTTP_PROXY) {
            config.httpsProxy = process.env.HTTP_PROXY; // e.g. 'http://127.0.0.1:1087'
            logger.info(`[CoinExExecutor] Using Proxy: ${process.env.HTTP_PROXY}`);
        }

        this.client = new ccxt.coinex(config);

        if (this.isDryRun) {
            logger.info('[CoinExExecutor] Initialized in START_UP_DRY_RUN mode 🛡️');
        } else {
            logger.info('[CoinExExecutor] Initialized in REAL_TRADING mode (CoinEx) 🚀');
        }
    }

    /**
     * Open a position (Long/Short)
     */
    async openPosition(symbol: string, side: 'BUY' | 'SELL', quantity: number, leverage: number = 1): Promise<any> {
        const typeStr = side === 'BUY' ? 'LONG' : 'SHORT';
        logger.info(`[CoinExExecutor] Opening ${typeStr} on ${symbol} | Qty: ${quantity} | Lev: ${leverage}x`);

        if (this.isDryRun) {
            return { msg: 'DRY_RUN_SUCCESS', symbol, side, quantity, price: 'MARKET_PRICE' };
        }

        try {
            // 1. Set Leverage
            try {
                await this.client.setLeverage(leverage, symbol);
            } catch (e) {
                logger.warn(`[CoinExExecutor] Failed to set leverage (might be already set): ${e}`);
            }

            // 2. Place Order (Market)
            const sideStr = side === 'BUY' ? 'buy' : 'sell';
            const order = await this.client.createOrder(symbol, 'market', sideStr, quantity);

            logger.info(`[CoinExExecutor] Order Filled: ${order.id}`);
            return order;

        } catch (error) {
            logger.error(`[CoinExExecutor] Failed to open position: ${error}`);
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
        logger.info(`[CoinExExecutor] Closing all positions for ${symbol}`);

        if (this.isDryRun) {
            return { msg: 'DRY_RUN_CLOSED', symbol };
        }

        try {
            const positions = await this.getPositions();
            const pos = positions.find(p => p.symbol === symbol);

            if (!pos || pos.positionAmt === 0) {
                logger.warn(`[CoinExExecutor] No open position found for ${symbol}`);
                return null;
            }

            // CCXT doesn't always have "closePosition", so we do opposite order
            const side = pos.positionAmt > 0 ? 'sell' : 'buy';
            const quantity = Math.abs(pos.positionAmt);

            // Using reduceOnly if supported, otherwise just opposite order
            const params = { 'reduceOnly': true };
            return await this.client.createOrder(symbol, 'market', side, quantity, undefined, params);

        } catch (error) {
            logger.error(`[CoinExExecutor] Failed to close position: ${error}`);
            throw error;
        }
    }

    /**
     * Set Stop Loss
     */
    async setStopLoss(symbol: string, side: 'BUY' | 'SELL', stopPrice: number): Promise<any> {
        logger.info(`[CoinExExecutor] Setting STOP_LOSS for ${symbol} at ${stopPrice}`);

        if (this.isDryRun) return { msg: 'DRY_RUN_SL_SET', symbol, stopPrice };

        try {
            const slSide = side === 'BUY' ? 'sell' : 'buy';
            const params = {
                'stopPrice': stopPrice,
                'triggerPrice': stopPrice, // Some exchanges use triggerPrice
                'reduceOnly': true
            };
            // CoinEx/CCXT specific trigger logic might vary, usually 'stop' type
            // Using standard CCXT params for stop market if supported
            return await this.client.createOrder(symbol, 'market', slSide, 0, undefined, params);
        } catch (error) {
            // Fallback: If immediate fail, ignore for now in mvp
            logger.error(`[CoinExExecutor] Failed to set Stop Loss (CCXT Generic): ${error}`);
            // Note: Stop orders vary heavily by exchange in CCXT. 
            // CoinEx supports trigger orders. We might need specific params:
            // 'stop_price': stopPrice (Snake Case often needed for manual overrides)
            return null;
        }
    }

    /**
     * Set Take Profit
     */
    async setTakeProfit(symbol: string, side: 'BUY' | 'SELL', price: number): Promise<any> {
        logger.info(`[CoinExExecutor] Setting TAKE_PROFIT for ${symbol} at ${price}`);
        if (this.isDryRun) return { msg: 'DRY_RUN_TP_SET', symbol, price };

        // Similar complexity with TP as SL in CCXT
        return null;
    }

    /**
     * Get Open Positions
     */
    async getPositions(): Promise<CoinExPosition[]> {
        if (this.isDryRun) return [];

        try {
            const positions = await this.client.fetchPositions();
            // Map CCXT position structure to our interface
            // CCXT returns Unified Position structure
            return positions
                .filter((p: any) => (p.contracts || 0) > 0) // Active positions
                .map((p: any) => ({
                    symbol: p.symbol,
                    positionAmt: p.side === 'long' ? (p.contracts || 0) : -(p.contracts || 0),
                    entryPrice: p.entryPrice || 0,
                    unRealizedProfit: p.unrealizedPnl || 0,
                    leverage: p.leverage || 1,
                    liquidationPrice: p.liquidationPrice || 0
                }));
        } catch (error) {
            logger.error(`[CoinExExecutor] Failed to fetch positions: ${error}`);
            return [];
        }
    }

    /**
     * Get Recent Candles
     */
    async getCandles(symbol: string, interval: string = '1m', limit: number = 100): Promise<{ prices: number[], volumes: number[], timestamps: number[] }> {
        if (this.isDryRun) {
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
            const ohlcv = await this.client.fetchOHLCV(symbol, interval, undefined, limit);
            // ohlcv: [timestamp, open, high, low, close, volume]
            const prices = ohlcv.map(c => c[4] as number); // Close
            const volumes = ohlcv.map(c => c[5] as number); // Volume
            const timestamps = ohlcv.map(c => c[0] as number); // Time

            return { prices, volumes, timestamps };
        } catch (error) {
            logger.error(`[CoinExExecutor] Failed to fetch candles: ${error}`);
            return { prices: [], volumes: [], timestamps: [] };
        }
    }

    /**
     * Get Balance
     */
    async getBalance(): Promise<number> {
        if (this.isDryRun) return 10000;

        try {
            const balance = await this.client.fetchBalance();
            return balance['USDT'] ? (balance['USDT'].free as number) : 0;
        } catch (error) {
            logger.error(`[CoinExExecutor] Failed to fetch balance: ${error}`);
            return 0;
        }
    }

    /**
     * Get Top Markets by Volume
     * Filters for USDT linear futures and high volume.
     */
    async getTopMarkets(limit: number = 20): Promise<string[]> {
        if (this.isDryRun) {
            // Return mock list
            return ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT', 'ADA/USDT', 'LINK/USDT', 'AVAX/USDT'];
        }

        try {
            // 1. Fetch all tickers
            // Note: CoinEx might return thousands.
            const tickers = await this.client.fetchTickers();

            // 2. Filter & Sort
            const sortedTickers = Object.values(tickers)
                .filter(t => t.symbol.endsWith('/USDT:USDT') || t.symbol.endsWith('/USDT')) // Logic depends on CCXT symbol handling for swap
                // Usually CCXT normalization for CoinEx Futures Swap is 'BTC/USDT:USDT'
                // Let's filter generally for USDT quote and high volume
                .filter(t => t.symbol.includes('USDT') && t.quoteVolume && t.quoteVolume > 1000000) // Min $1M volume
                .sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));

            // 3. Extract symbols
            // We want the 'slash' format compatible with our system
            return sortedTickers.slice(0, limit).map(t => t.symbol);

        } catch (error) {
            logger.error(`[CoinExExecutor] Failed to fetch markets: ${error}`);
            return ['BTC/USDT', 'ETH/USDT']; // Fallback
        }
    }
}
