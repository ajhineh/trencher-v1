// src/futures/orderflow/orderBookCollector.ts

/**
 * Order Book Collector
 * Collects real-time order book data via WebSocket
 */

import WebSocket from 'ws';
import { OrderBookSnapshot, OrderBookLevel } from './types';

interface BinanceOrderBookUpdate {
  e: string;  // event type
  E: number;  // event time
  s: string;  // symbol
  U: number;  // first update ID
  u: number;  // final update ID
  b: [string, string][]; // bids [price, quantity]
  a: [string, string][]; // asks [price, quantity]
}

export class OrderBookCollector {
  private ws: WebSocket | null = null;
  private orderBooks: Map<string, OrderBookSnapshot> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(private exchange: string = 'binance') { }

  /**
   * Connect to exchange WebSocket
   */
  async connect(): Promise<void> {
    if (process.env.TEST_MODE === 'true') {
      console.log('🛡️ [TEST_MODE] Mocking OrderBook WebSocket Connection');
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        // Binance Futures WebSocket
        const wsUrl = 'wss://fstream.binance.com/ws';
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
          console.log('✅ Order Book WebSocket connected');
          this.reconnectAttempts = 0;
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          console.error('❌ WebSocket error:', error);
          // Don't reject if just strictly testing logic, but usually we want to know.
          // In production loop, we might want retry.
          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            reject(error);
          }
        });

        this.ws.on('close', () => {
          console.log('⚠️  WebSocket closed');
          this.handleReconnect();
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Subscribe to symbol's order book
   */
  async subscribeToSymbol(symbol: string): Promise<void> {
    if (process.env.TEST_MODE === 'true') {
      console.log(`🛡️ [TEST_MODE] Mocking subscription to ${symbol} order book`);
      // Initialize mock snapshot
      const snapshot: OrderBookSnapshot = {
        symbol,
        timestamp: Date.now(),
        bids: [{ price: 50000, quantity: 1, side: 'BID', timestamp: Date.now() }],
        asks: [{ price: 50001, quantity: 1, side: 'ASK', timestamp: Date.now() }]
      };
      this.orderBooks.set(symbol, snapshot);
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    // Binance format: btcusdt@depth@100ms
    const stream = `${symbol.toLowerCase()}@depth@100ms`;

    const subscribeMsg = {
      method: 'SUBSCRIBE',
      params: [stream],
      id: Date.now()
    };

    this.ws.send(JSON.stringify(subscribeMsg));
    console.log(`📊 Subscribed to ${symbol} order book`);

    // Initialize order book
    await this.initializeOrderBook(symbol);
  }

  /**
   * Initialize order book with snapshot
   */
  private async initializeOrderBook(symbol: string): Promise<void> {
    try {
      // Get initial snapshot from REST API
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=100`
      );

      const data = await response.json();

      const snapshot: OrderBookSnapshot = {
        symbol,
        timestamp: Date.now(),
        bids: data.bids.map(([price, quantity]: [string, string]) => ({
          price: parseFloat(price),
          quantity: parseFloat(quantity),
          side: 'BID' as const,
          timestamp: Date.now()
        })),
        asks: data.asks.map(([price, quantity]: [string, string]) => ({
          price: parseFloat(price),
          quantity: parseFloat(quantity),
          side: 'ASK' as const,
          timestamp: Date.now()
        }))
      };

      this.orderBooks.set(symbol, snapshot);
      console.log(`✅ Initialized ${symbol} order book`);

    } catch (error) {
      console.error(`❌ Failed to initialize ${symbol} order book:`, error);
    }
  }

  /**
   * Handle WebSocket message
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // Skip non-depth updates
      if (message.e !== 'depthUpdate') return;

      this.updateOrderBook(message as BinanceOrderBookUpdate);

    } catch (error) {
      console.error('❌ Error handling message:', error);
    }
  }

  /**
   * Update order book with new data
   */
  private updateOrderBook(update: BinanceOrderBookUpdate): void {
    const symbol = update.s;
    const orderBook = this.orderBooks.get(symbol);

    if (!orderBook) return;

    // Update bids
    for (const [price, quantity] of update.b) {
      const priceNum = parseFloat(price);
      const quantityNum = parseFloat(quantity);

      if (quantityNum === 0) {
        // Remove level
        orderBook.bids = orderBook.bids.filter(b => b.price !== priceNum);
      } else {
        // Update or add level
        const existingIndex = orderBook.bids.findIndex(b => b.price === priceNum);

        if (existingIndex >= 0) {
          orderBook.bids[existingIndex].quantity = quantityNum;
          orderBook.bids[existingIndex].timestamp = update.E;
        } else {
          orderBook.bids.push({
            price: priceNum,
            quantity: quantityNum,
            side: 'BID',
            timestamp: update.E
          });
        }
      }
    }

    // Update asks
    for (const [price, quantity] of update.a) {
      const priceNum = parseFloat(price);
      const quantityNum = parseFloat(quantity);

      if (quantityNum === 0) {
        // Remove level
        orderBook.asks = orderBook.asks.filter(a => a.price !== priceNum);
      } else {
        // Update or add level
        const existingIndex = orderBook.asks.findIndex(a => a.price === priceNum);

        if (existingIndex >= 0) {
          orderBook.asks[existingIndex].quantity = quantityNum;
          orderBook.asks[existingIndex].timestamp = update.E;
        } else {
          orderBook.asks.push({
            price: priceNum,
            quantity: quantityNum,
            side: 'ASK',
            timestamp: update.E
          });
        }
      }
    }

    // Sort bids descending, asks ascending
    orderBook.bids.sort((a, b) => b.price - a.price);
    orderBook.asks.sort((a, b) => a.price - b.price);

    // Update timestamp
    orderBook.timestamp = update.E;
  }

  /**
   * Get current order book snapshot
   */
  getOrderBook(symbol: string): OrderBookSnapshot | null {
    return this.orderBooks.get(symbol) || null;
  }

  /**
   * Get top N levels of order book
   */
  getTopLevels(symbol: string, levels: number = 10): {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
  } {
    const orderBook = this.orderBooks.get(symbol);

    if (!orderBook) {
      return { bids: [], asks: [] };
    }

    return {
      bids: orderBook.bids.slice(0, levels),
      asks: orderBook.asks.slice(0, levels)
    };
  }

  /**
   * Handle reconnection
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(console.error);
    }, delay);
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
