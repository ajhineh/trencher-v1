// src/futures/orderflow/orderFlowAnalyzer.ts

/**
 * Order Flow Analyzer
 * Main analyzer that combines all components
 */

import { OrderBookCollector } from './orderBookCollector';
import { TradeCollector } from './tradeCollector';
import { VolumeDeltaCalculator } from './volumeDeltaCalculator';
import { BidAskImbalanceAnalyzer } from './bidAskImbalanceAnalyzer';
import { OrderFlowSignal } from './types';

export class OrderFlowAnalyzer {
  private orderBookCollector: OrderBookCollector;
  private tradeCollector: TradeCollector;
  private volumeDeltaCalc: VolumeDeltaCalculator;
  private bidAskAnalyzer: BidAskImbalanceAnalyzer;
  
  constructor() {
    this.orderBookCollector = new OrderBookCollector();
    this.tradeCollector = new TradeCollector();
    this.volumeDeltaCalc = new VolumeDeltaCalculator();
    this.bidAskAnalyzer = new BidAskImbalanceAnalyzer();
  }
  
  /**
   * Initialize and connect to exchange
   */
  async initialize(): Promise<void> {
    console.log('🚀 Initializing Order Flow Analyzer...');
    
    await Promise.all([
      this.orderBookCollector.connect(),
      this.tradeCollector.connect()
    ]);
    
    console.log('✅ Order Flow Analyzer initialized');
  }
  
  /**
   * Subscribe to symbol
   */
  async subscribeToSymbol(symbol: string): Promise<void> {
    await Promise.all([
      this.orderBookCollector.subscribeToSymbol(symbol),
      this.tradeCollector.subscribeToSymbol(symbol)
    ]);
    
    console.log(`✅ Subscribed to ${symbol}`);
  }
  
  /**
   * Analyze order flow for symbol
   */
  async analyze(
    symbol: string,
    timeframeMs: number = 60000  // 1 minute default
  ): Promise<OrderFlowSignal> {
    // 1. Get real-time data
    const orderBook = this.orderBookCollector.getOrderBook(symbol);
    const trades = this.tradeCollector.getTrades(symbol, timeframeMs);
    
    if (!orderBook) {
      throw new Error(`No order book data for ${symbol}`);
    }
    
    if (trades.length === 0) {
      throw new Error(`No trade data for ${symbol}`);
    }
    
    // 2. Calculate metrics
    const volumeDelta = this.volumeDeltaCalc.calculateDelta(symbol, trades);
    const bidAskImbalance = this.bidAskAnalyzer.calculateImbalance(orderBook, 10);
    
    // 3. Generate signal
    return this.generateSignal(symbol, volumeDelta, bidAskImbalance, orderBook);
  }
  
  /**
   * Generate combined signal
   */
  private generateSignal(
    symbol: string,
    volumeDelta: any,
    bidAskImbalance: any,
    orderBook: any
  ): OrderFlowSignal {
    let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0;
    const reasons: string[] = [];
    
    // 1. Volume Delta (40% weight)
    const deltaSignal = this.volumeDeltaCalc.generateSignal(volumeDelta);
    const deltaStrength = this.volumeDeltaCalc.getSignalStrength(volumeDelta);
    
    if (deltaSignal === 'BUY') {
      confidence += deltaStrength * 0.4;
      reasons.push(`Strong buying pressure (delta: ${volumeDelta.deltaPercentage.toFixed(2)}%)`);
      direction = 'LONG';
    } else if (deltaSignal === 'SELL') {
      confidence += deltaStrength * 0.4;
      reasons.push(`Strong selling pressure (delta: ${volumeDelta.deltaPercentage.toFixed(2)}%)`);
      direction = 'SHORT';
    }
    
    // 2. Bid/Ask Imbalance (60% weight)
    const imbalanceSignal = this.bidAskAnalyzer.generateSignal(bidAskImbalance);
    const imbalanceStrength = this.bidAskAnalyzer.getSignalStrength(bidAskImbalance);
    
    if (imbalanceSignal === 'BUY') {
      confidence += imbalanceStrength * 0.6;
      reasons.push(`Bid side heavy (imbalance: ${(bidAskImbalance.imbalance * 100).toFixed(2)}%)`);
      if (direction === 'NEUTRAL') direction = 'LONG';
    } else if (imbalanceSignal === 'SELL') {
      confidence += imbalanceStrength * 0.6;
      reasons.push(`Ask side heavy (imbalance: ${(bidAskImbalance.imbalance * 100).toFixed(2)}%)`);
      if (direction === 'NEUTRAL') direction = 'SHORT';
    }
    
    // 3. Calculate entry/exit
    const currentPrice = orderBook.asks[0]?.price || 0;
    const stopLoss = direction === 'LONG' 
      ? currentPrice * 0.995  // 0.5% below
      : currentPrice * 1.005; // 0.5% above
    const takeProfit = direction === 'LONG'
      ? currentPrice * 1.02   // 2% above
      : currentPrice * 0.98;  // 2% below
    
    return {
      direction,
      confidence: Math.min(100, confidence),
      reasons,
      volumeDelta: volumeDelta.delta,
      bidAskImbalance: bidAskImbalance.imbalance,
      entry: currentPrice,
      stopLoss,
      takeProfit,
      timestamp: Date.now()
    };
  }
  
  /**
   * Disconnect from exchange
   */
  disconnect(): void {
    this.orderBookCollector.disconnect();
    this.tradeCollector.disconnect();
    console.log('👋 Order Flow Analyzer disconnected');
  }
}
