// src/futures/orderflow/tradeCollector.ts

/**
 * Trade Collector
 * Collects real-time trade data via WebSocket
 */

import WebSocket from 'ws';
import { Trade } from './types';

interface BinanceTrade {
    e: string;  // event type
    E: number;  // event time
    s: string;  // symbol
    t: number;  // trade ID
    p: string;  // price
    q: string;  // quantity
    T: number;  // trade time
    m: boolean; // is buyer maker
}

export class TradeCollector {
    private ws: WebSocket | null = null;
    private trades: Map<string, Trade[]> = new Map();
    private maxTradesPerSymbol = 1000;

    constructor(private exchange: string = 'binance') { }

    /**
     * Connect to exchange WebSocket
     */
    async connect(): Promise<void> {
        if (process.env.TEST_MODE === 'true') {
            console.log('🛡️ [TEST_MODE] Mocking Trade WebSocket Connection');
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            try {
                const wsUrl = 'wss://fstream.binance.com/ws';
                this.ws = new WebSocket(wsUrl);

                this.ws.on('open', () => {
                    console.log('✅ Trade WebSocket connected');
                    resolve();
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    this.handleMessage(data);
                });

                this.ws.on('error', (error) => {
                    console.error('❌ Trade WebSocket error:', error);
                    // reject(error); // Optional: relax rejection for robustness
                    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Subscribe to symbol's trades
     */
    async subscribeToSymbol(symbol: string): Promise<void> {
        if (process.env.TEST_MODE === 'true') {
            console.log(`🛡️ [TEST_MODE] Mocking subscription to ${symbol} trades`);
            // Initialize empty trade list if not exists
            if (!this.trades.has(symbol)) {
                this.trades.set(symbol, [{
                    symbol,
                    price: 50000,
                    quantity: 0.1,
                    side: 'BUY',
                    timestamp: Date.now(),
                    tradeId: 'mock-1'
                }]);
            }
            return;
        }

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }

        // Binance format: btcusdt@aggTrade
        const stream = `${symbol.toLowerCase()}@aggTrade`;

        const subscribeMsg = {
            method: 'SUBSCRIBE',
            params: [stream],
            id: Date.now()
        };

        this.ws.send(JSON.stringify(subscribeMsg));
        console.log(`📊 Subscribed to ${symbol} trades`);

        // Initialize trades array
        if (!this.trades.has(symbol)) {
            this.trades.set(symbol, []);
        }
    }

    /**
     * Handle WebSocket message
     */
    private handleMessage(data: WebSocket.Data): void {
        try {
            const message = JSON.parse(data.toString());

            // Skip subscription confirmation messages
            if (message.result === null || message.id) {
                return;
            }

            // Skip non-trade messages
            if (!message.e || message.e !== 'aggTrade') {
                return;
            }

            this.storeTrade(message as BinanceTrade);

        } catch (error) {
            // Silently ignore parse errors
        }
    }

    /**
     * Store trade
     */
    private storeTrade(binanceTrade: BinanceTrade): void {
        const symbol = binanceTrade.s;

        const trade: Trade = {
            symbol,
            price: parseFloat(binanceTrade.p),
            quantity: parseFloat(binanceTrade.q),
            side: binanceTrade.m ? 'SELL' : 'BUY',  // if buyer is maker, then seller is aggressor
            timestamp: binanceTrade.T,
            tradeId: String(binanceTrade.t)  // Safely convert to string
        };

        const symbolTrades = this.trades.get(symbol) || [];
        symbolTrades.push(trade);

        // Keep only recent trades
        if (symbolTrades.length > this.maxTradesPerSymbol) {
            symbolTrades.shift();
        }

        this.trades.set(symbol, symbolTrades);
    }

    /**
     * Get trades within timeframe
     */
    getTrades(symbol: string, timeframeMs: number): Trade[] {
        const allTrades = this.trades.get(symbol) || [];
        const cutoffTime = Date.now() - timeframeMs;

        return allTrades.filter(trade => trade.timestamp >= cutoffTime);
    }

    /**
     * Get all trades for symbol
     */
    getAllTrades(symbol: string): Trade[] {
        return this.trades.get(symbol) || [];
    }

    /**
     * Clear old trades
     */
    clearOldTrades(symbol: string, olderThanMs: number): void {
        const allTrades = this.trades.get(symbol) || [];
        const cutoffTime = Date.now() - olderThanMs;

        const recentTrades = allTrades.filter(trade => trade.timestamp >= cutoffTime);
        this.trades.set(symbol, recentTrades);
    }

    /**
     * Disconnect WebSocket
     */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
