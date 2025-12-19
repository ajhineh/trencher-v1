// src/futures/orderflow/largeOrderTracker.ts

/**
 * Large Order Tracker
 * Tracks and analyzes large orders (institutional activity)
 */

import { Trade } from './types';

export interface LargeOrder {
    price: number;
    quantity: number;
    side: 'BUY' | 'SELL';
    timestamp: number;
    impact: 'ABSORBED' | 'MOVED_PRICE';
    priceChangePercent: number;
}

export class LargeOrderTracker {
    private largeOrders: LargeOrder[] = [];  // Fixed: changed from Map to array
    private maxHistory = 100;

    // Threshold: orders larger than this are considered "large"
    private sizeThreshold: number = 10;  // 10x average

    /**
     * Track large orders from trades
     */
    trackLargeOrders(
        trades: Trade[],
        averageOrderSize: number
    ): LargeOrder[] {
        const largeOrders: LargeOrder[] = [];
        const threshold = averageOrderSize * this.sizeThreshold;

        for (let i = 0; i < trades.length; i++) {
            const trade = trades[i];

            // Check if order is large
            if (trade.quantity >= threshold) {
                // Analyze impact
                const impact = this.analyzeImpact(trade, trades, i);

                largeOrders.push({
                    price: trade.price,
                    quantity: trade.quantity,
                    side: trade.side,
                    timestamp: trade.timestamp,
                    impact: impact.type,
                    priceChangePercent: impact.priceChange
                });
            }
        }

        return largeOrders;
    }

    /**
     * Analyze impact of large order
     */
    private analyzeImpact(
        order: Trade,
        allTrades: Trade[],
        orderIndex: number
    ): { type: 'ABSORBED' | 'MOVED_PRICE'; priceChange: number } {
        // Look at trades after this order (next 10 trades or 5 seconds)
        const afterTrades = allTrades.slice(orderIndex + 1, orderIndex + 11)
            .filter(t => t.timestamp - order.timestamp < 5000);

        if (afterTrades.length === 0) {
            return { type: 'ABSORBED', priceChange: 0 };
        }

        // Calculate price change
        const avgPriceAfter = afterTrades.reduce((sum, t) => sum + t.price, 0) / afterTrades.length;
        const priceChange = ((avgPriceAfter - order.price) / order.price) * 100;

        // If price moved significantly = order moved the market
        // If price didn't move much = order was absorbed
        const movedPrice = Math.abs(priceChange) > 0.05;  // 0.05% threshold

        return {
            type: movedPrice ? 'MOVED_PRICE' : 'ABSORBED',
            priceChange
        };
    }

    /**
     * Get large order summary
     */
    getLargeOrderSummary(orders: LargeOrder[]): {
        buyOrders: number;
        sellOrders: number;
        totalBuyVolume: number;
        totalSellVolume: number;
        absorbedCount: number;
        movedPriceCount: number;
        avgImpact: number;
    } {
        const buyOrders = orders.filter(o => o.side === 'BUY');
        const sellOrders = orders.filter(o => o.side === 'SELL');

        return {
            buyOrders: buyOrders.length,
            sellOrders: sellOrders.length,
            totalBuyVolume: buyOrders.reduce((sum, o) => sum + o.quantity, 0),
            totalSellVolume: sellOrders.reduce((sum, o) => sum + o.quantity, 0),
            absorbedCount: orders.filter(o => o.impact === 'ABSORBED').length,
            movedPriceCount: orders.filter(o => o.impact === 'MOVED_PRICE').length,
            avgImpact: orders.length > 0
                ? orders.reduce((sum, o) => sum + Math.abs(o.priceChangePercent), 0) / orders.length
                : 0
        };
    }

    /**
     * Detect absorption at price level
     */
    detectAbsorptionLevel(orders: LargeOrder[], price: number, tolerance: number = 0.001): boolean {
        const ordersAtLevel = orders.filter(o =>
            Math.abs(o.price - price) / price < tolerance &&
            o.impact === 'ABSORBED'
        );

        return ordersAtLevel.length >= 2;  // At least 2 absorbed orders
    }

    /**
     * Get institutional activity signal
     */
    getInstitutionalSignal(orders: LargeOrder[]): 'BUY' | 'SELL' | 'NEUTRAL' {
        if (orders.length === 0) return 'NEUTRAL';

        const summary = this.getLargeOrderSummary(orders);

        // More buy volume = institutional buying
        if (summary.totalBuyVolume > summary.totalSellVolume * 1.5) {
            return 'BUY';
        }

        // More sell volume = institutional selling
        if (summary.totalSellVolume > summary.totalBuyVolume * 1.5) {
            return 'SELL';
        }

        return 'NEUTRAL';
    }
}
