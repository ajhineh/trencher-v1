// src/futures/orderflow/types.ts

/**
 * Order Flow Analysis - Type Definitions
 */

export interface OrderBookLevel {
    price: number;
    quantity: number;
    side: 'BID' | 'ASK';
    timestamp: number;
}

export interface OrderBookSnapshot {
    symbol: string;
    timestamp: number;
    bids: OrderBookLevel[];  // sorted by price descending
    asks: OrderBookLevel[];  // sorted by price ascending
}

export interface Trade {
    symbol: string;
    price: number;
    quantity: number;
    side: 'BUY' | 'SELL';  // aggressor side
    timestamp: number;
    tradeId: string;
}

export interface VolumeDelta {
    timestamp: number;
    buyVolume: number;
    sellVolume: number;
    delta: number;              // buy - sell
    cumulativeDelta: number;
    deltaPercentage: number;    // (delta / total) * 100
}

export interface BidAskImbalance {
    timestamp: number;
    bidVolume: number;
    askVolume: number;
    imbalance: number;          // (bid - ask) / (bid + ask)
    imbalanceRatio: number;     // bid / ask
}

export interface OrderFlowSignal {
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    confidence: number;         // 0-100
    reasons: string[];

    // Component signals
    volumeDelta: number;
    bidAskImbalance: number;

    // Entry/Exit
    entry: number;
    stopLoss: number;
    takeProfit: number;

    timestamp: number;

    // Optional fields for risk assessment
    leverage?: number;
    positionSize?: number; // size relative to portfolio or base size (e.g. 0.5 = half size)
}
