// test/orderflow-unit.test.ts

/**
 * Order Flow Analysis - Unit Tests
 */

import { VolumeDeltaCalculator } from '../src/futures/orderflow/volumeDeltaCalculator';
import { BidAskImbalanceAnalyzer } from '../src/futures/orderflow/bidAskImbalanceAnalyzer';
import { FootprintBuilder } from '../src/futures/orderflow/footprintBuilder';
import { Trade, OrderBookSnapshot } from '../src/futures/orderflow/types';

describe('Order Flow Analysis - Unit Tests', () => {

    describe('Volume Delta Calculator', () => {
        let calculator: VolumeDeltaCalculator;

        beforeEach(() => {
            calculator = new VolumeDeltaCalculator();
        });

        test('should calculate positive delta for more buys', () => {
            const trades: Trade[] = [
                { symbol: 'BTCUSDT', price: 43000, quantity: 1.5, side: 'BUY', timestamp: Date.now(), tradeId: '1' },
                { symbol: 'BTCUSDT', price: 43010, quantity: 2.0, side: 'BUY', timestamp: Date.now(), tradeId: '2' },
                { symbol: 'BTCUSDT', price: 43005, quantity: 0.5, side: 'SELL', timestamp: Date.now(), tradeId: '3' }
            ];

            const delta = calculator.calculateDelta('BTCUSDT', trades);

            expect(delta.buyVolume).toBe(3.5);
            expect(delta.sellVolume).toBe(0.5);
            expect(delta.delta).toBe(3.0);
            expect(delta.deltaPercentage).toBeGreaterThan(0);
        });

        test('should calculate negative delta for more sells', () => {
            const trades: Trade[] = [
                { symbol: 'BTCUSDT', price: 43000, quantity: 0.5, side: 'BUY', timestamp: Date.now(), tradeId: '1' },
                { symbol: 'BTCUSDT', price: 43010, quantity: 2.0, side: 'SELL', timestamp: Date.now(), tradeId: '2' },
                { symbol: 'BTCUSDT', price: 43005, quantity: 1.5, side: 'SELL', timestamp: Date.now(), tradeId: '3' }
            ];

            const delta = calculator.calculateDelta('BTCUSDT', trades);

            expect(delta.buyVolume).toBe(0.5);
            expect(delta.sellVolume).toBe(3.5);
            expect(delta.delta).toBe(-3.0);
            expect(delta.deltaPercentage).toBeLessThan(0);
        });

        test('should generate BUY signal for strong buying pressure', () => {
            const delta = {
                timestamp: Date.now(),
                buyVolume: 10,
                sellVolume: 2,
                delta: 8,
                cumulativeDelta: 8,
                deltaPercentage: 66.67
            };

            const signal = calculator.generateSignal(delta);
            expect(signal).toBe('BUY');
        });

        test('should generate SELL signal for strong selling pressure', () => {
            const delta = {
                timestamp: Date.now(),
                buyVolume: 2,
                sellVolume: 10,
                delta: -8,
                cumulativeDelta: -8,
                deltaPercentage: -66.67
            };

            const signal = calculator.generateSignal(delta);
            expect(signal).toBe('SELL');
        });
    });

    describe('Bid/Ask Imbalance Analyzer', () => {
        let analyzer: BidAskImbalanceAnalyzer;

        beforeEach(() => {
            analyzer = new BidAskImbalanceAnalyzer();
        });

        test('should calculate positive imbalance for bid-heavy book', () => {
            const orderBook: OrderBookSnapshot = {
                symbol: 'BTCUSDT',
                timestamp: Date.now(),
                bids: [
                    { price: 43000, quantity: 10, side: 'BID', timestamp: Date.now() },
                    { price: 42999, quantity: 8, side: 'BID', timestamp: Date.now() }
                ],
                asks: [
                    { price: 43001, quantity: 3, side: 'ASK', timestamp: Date.now() },
                    { price: 43002, quantity: 2, side: 'ASK', timestamp: Date.now() }
                ]
            };

            const imbalance = analyzer.calculateImbalance(orderBook, 2);

            expect(imbalance.bidVolume).toBe(18);
            expect(imbalance.askVolume).toBe(5);
            expect(imbalance.imbalance).toBeGreaterThan(0);
        });

        test('should generate BUY signal for strong bid imbalance', () => {
            const imbalance = {
                timestamp: Date.now(),
                bidVolume: 100,
                askVolume: 30,
                imbalance: 0.54,
                imbalanceRatio: 3.33
            };

            const signal = analyzer.generateSignal(imbalance);
            expect(signal).toBe('BUY');
        });
    });

    describe('Footprint Builder', () => {
        let builder: FootprintBuilder;

        beforeEach(() => {
            builder = new FootprintBuilder();
        });

        test('should build footprint from trades', () => {
            const trades: Trade[] = [
                { symbol: 'BTCUSDT', price: 43000, quantity: 1.0, side: 'BUY', timestamp: Date.now(), tradeId: '1' },
                { symbol: 'BTCUSDT', price: 43010, quantity: 2.0, side: 'BUY', timestamp: Date.now(), tradeId: '2' },
                { symbol: 'BTCUSDT', price: 43005, quantity: 1.5, side: 'SELL', timestamp: Date.now(), tradeId: '3' }
            ];

            const footprint = builder.buildFootprint(trades, 60000);

            expect(footprint.open).toBe(43000);
            expect(footprint.high).toBe(43010);
            expect(footprint.low).toBe(43000);
            expect(footprint.totalBuyVolume).toBe(3.0);
            expect(footprint.totalSellVolume).toBe(1.5);
            expect(footprint.poc).toBeGreaterThan(0);
        });

        test('should detect absorption pattern', () => {
            const trades: Trade[] = [];
            const basePrice = 43000;

            // High volume but small price range
            for (let i = 0; i < 100; i++) {
                trades.push({
                    symbol: 'BTCUSDT',
                    price: basePrice + (Math.random() * 2), // Small range
                    quantity: 1.0,
                    side: i % 2 === 0 ? 'BUY' : 'SELL',
                    timestamp: Date.now() + i,
                    tradeId: String(i)
                });
            }

            const footprint = builder.buildFootprint(trades, 60000);
            const analysis = builder.analyzeFootprint(footprint);

            expect(analysis.absorption).toBe(true);
        });
    });
});
