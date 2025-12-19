// src/futures/orderflow/icebergDetector.ts

/**
 * Iceberg Order Detector
 * Detects hidden large orders (iceberg orders)
 */

import { OrderBookLevel, OrderBookSnapshot } from './types';

export interface IcebergOrder {
    price: number;
    side: 'BID' | 'ASK';
    estimatedSize: number;
    confidence: number;  // 0-100
    detectedAt: number;
    pattern: 'REPEATED_SMALL' | 'INSTANT_REFILL' | 'LARGE_EXECUTION';
}

interface OrderHistory {
    price: number;
    quantity: number;
    timestamp: number;
    action: 'ADD' | 'REMOVE' | 'UPDATE';
}

export class IcebergDetector {
    private orderHistory: Map<string, OrderHistory[]> = new Map();
    private maxHistorySize = 100;
    private detectionThreshold = 3;  // Minimum occurrences to detect

    /**
     * Detect iceberg orders in order book
     */
    detectIcebergs(
        symbol: string,
        orderBook: OrderBookSnapshot
    ): IcebergOrder[] {
        const icebergs: IcebergOrder[] = [];

        // Check bid side
        for (const level of orderBook.bids.slice(0, 20)) {
            const iceberg = this.checkLevel(symbol, level, 'BID');
            if (iceberg) {
                icebergs.push(iceberg);
            }
        }

        // Check ask side
        for (const level of orderBook.asks.slice(0, 20)) {
            const iceberg = this.checkLevel(symbol, level, 'ASK');
            if (iceberg) {
                icebergs.push(iceberg);
            }
        }

        return icebergs;
    }

    /**
     * Check if a level shows iceberg pattern
     */
    private checkLevel(
        symbol: string,
        level: OrderBookLevel,
        side: 'BID' | 'ASK'
    ): IcebergOrder | null {
        const key = `${symbol}-${level.price}`;
        const history = this.orderHistory.get(key) || [];

        // Store current state
        history.push({
            price: level.price,
            quantity: level.quantity,
            timestamp: level.timestamp,
            action: 'UPDATE'
        });

        // Keep only recent history
        if (history.length > this.maxHistorySize) {
            history.shift();
        }

        this.orderHistory.set(key, history);

        // Need enough history to detect
        if (history.length < this.detectionThreshold) {
            return null;
        }

        // Pattern 1: Repeated small orders
        const repeatedSmall = this.detectRepeatedSmall(history);
        if (repeatedSmall) {
            return {
                price: level.price,
                side,
                estimatedSize: repeatedSmall.estimatedSize,
                confidence: repeatedSmall.confidence,
                detectedAt: Date.now(),
                pattern: 'REPEATED_SMALL'
            };
        }

        // Pattern 2: Instant refill
        const instantRefill = this.detectInstantRefill(history);
        if (instantRefill) {
            return {
                price: level.price,
                side,
                estimatedSize: instantRefill.estimatedSize,
                confidence: instantRefill.confidence,
                detectedAt: Date.now(),
                pattern: 'INSTANT_REFILL'
            };
        }

        return null;
    }

    /**
     * Detect repeated small orders pattern
     * Same small size appearing repeatedly at same price
     */
    private detectRepeatedSmall(
        history: OrderHistory[]
    ): { estimatedSize: number; confidence: number } | null {
        if (history.length < 5) return null;

        const recent = history.slice(-10);
        const quantities = recent.map(h => h.quantity);

        // Check if quantities are similar (within 10%)
        const avgQty = quantities.reduce((a, b) => a + b, 0) / quantities.length;
        const isSimilar = quantities.every(q =>
            Math.abs(q - avgQty) / avgQty < 0.1
        );

        if (!isSimilar) return null;

        // Check if size is small (less than 2x average)
        const isSmall = avgQty < this.getAverageOrderSize() * 2;

        if (!isSmall) return null;

        // Estimate total size
        const estimatedSize = avgQty * quantities.length;
        const confidence = Math.min(100, (quantities.length / 10) * 100);

        return { estimatedSize, confidence };
    }

    /**
     * Detect instant refill pattern
     * Order gets filled and immediately replaced
     */
    private detectInstantRefill(
        history: OrderHistory[]
    ): { estimatedSize: number; confidence: number } | null {
        if (history.length < 3) return null;

        let refillCount = 0;
        let totalSize = 0;

        for (let i = 1; i < history.length; i++) {
            const prev = history[i - 1];
            const curr = history[i];

            // Check if quantity dropped then immediately restored
            const dropped = curr.quantity < prev.quantity * 0.5;
            const timeDiff = curr.timestamp - prev.timestamp;
            const quickRefill = timeDiff < 1000;  // Within 1 second

            if (dropped && i + 1 < history.length) {
                const next = history[i + 1];
                const restored = next.quantity >= prev.quantity * 0.8;
                const quickRestore = next.timestamp - curr.timestamp < 1000;

                if (restored && quickRestore) {
                    refillCount++;
                    totalSize += prev.quantity;
                }
            }
        }

        if (refillCount < 2) return null;

        const estimatedSize = totalSize;
        const confidence = Math.min(100, (refillCount / 5) * 100);

        return { estimatedSize, confidence };
    }

    /**
     * Get average order size (mock - should be calculated from market data)
     */
    private getAverageOrderSize(): number {
        return 1.0;  // Default value, should be dynamic
    }

    /**
     * Clear old history
     */
    clearOldHistory(olderThanMs: number): void {
        const cutoffTime = Date.now() - olderThanMs;

        for (const [key, history] of this.orderHistory) {
            const recentHistory = history.filter(h => h.timestamp >= cutoffTime);

            if (recentHistory.length === 0) {
                this.orderHistory.delete(key);
            } else {
                this.orderHistory.set(key, recentHistory);
            }
        }
    }

    /**
     * Get iceberg summary
     */
    getIcebergSummary(icebergs: IcebergOrder[]): {
        totalBidSize: number;
        totalAskSize: number;
        bidCount: number;
        askCount: number;
        avgConfidence: number;
    } {
        const bidIcebergs = icebergs.filter(i => i.side === 'BID');
        const askIcebergs = icebergs.filter(i => i.side === 'ASK');

        return {
            totalBidSize: bidIcebergs.reduce((sum, i) => sum + i.estimatedSize, 0),
            totalAskSize: askIcebergs.reduce((sum, i) => sum + i.estimatedSize, 0),
            bidCount: bidIcebergs.length,
            askCount: askIcebergs.length,
            avgConfidence: icebergs.length > 0
                ? icebergs.reduce((sum, i) => sum + i.confidence, 0) / icebergs.length
                : 0
        };
    }
}
