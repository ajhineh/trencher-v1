import ccxt from 'ccxt';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';
import { OrderManager } from '../execution/orderManager';
import { SignalBroadcaster } from '../services/signalBroadcaster';
import { TradeMemory, TradeContext } from '../learning/tradeMemory';
import { AutoTuner } from '../learning/autoTuner';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface SwingPoint {
    index: number;
    price: number;
    type: 'HIGH' | 'LOW';
    timestamp: number;
    confirmed: boolean;
}

export interface DynamicChannel {
    upperLine: {
        point1: SwingPoint;
        point2: SwingPoint;
        slope: number;
    };
    lowerLine: {
        point1: SwingPoint;
        point2: SwingPoint;
        slope: number;
    };
    width: number;
    midpoint: number;
    currentSupport?: number;
    currentResistance?: number;
}

export enum TrendType {
    BULLISH = 'BULLISH',
    BEARISH = 'BEARISH',
    SIDEWAYS_NORMAL = 'SIDEWAYS_NORMAL',
    SIDEWAYS_EXPANDING = 'SIDEWAYS_EXPANDING',
    SIDEWAYS_CONTRACTING = 'SIDEWAYS_CONTRACTING'
}

export interface Candle {
    time: number; // UNIX timestamp in seconds
    open: number;
    high: number;
    low: number;
    close: number;
}

interface ActiveAmiroPosition {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    totalAmount: number;
    remainingAmount: number;
    leverage: number;
    exitStrategy: AmiroExitStrategy;
    tradeId?: string; // trade identifier for self-learning memory tracking
}

// ============================================================================
// AMIRO EXIT STRATEGY CLASS (ATR-based SL & trailing exit management)
// ============================================================================

class AmiroExitStrategy {
    public entry: number;
    public channel: DynamicChannel;
    public trend: 'BULLISH' | 'BEARISH';
    public riskLevel: 'VERY_LOW' | 'LOW' | 'MEDIUM';
    public currentSL: number;
    public targets: { price: number; percentage: number }[];
    public targetsHit: number = 0;
    public atr: number;
    public atrSlMult: number;

    constructor(
        entry: number,
        channel: DynamicChannel,
        trend: 'BULLISH' | 'BEARISH',
        riskLevel: 'VERY_LOW' | 'LOW' | 'MEDIUM' = 'VERY_LOW',
        atr: number,
        atrSlMult: number = 1.5
    ) {
        this.entry = entry;
        this.channel = channel;
        this.trend = trend;
        this.riskLevel = riskLevel;
        this.atr = atr;
        this.atrSlMult = atrSlMult;
        this.currentSL = this.calculateInitialSL();
        this.targets = this.calculateTargets();
    }

    private calculateInitialSL(): number {
        // ATR-based Stop Loss provides a much better proxy for true noise/volatility
        const stopDistance = this.atr * this.atrSlMult;

        if (this.trend === 'BULLISH') {
            return this.entry - stopDistance;
        } else {
            return this.entry + stopDistance;
        }
    }

    private calculateTargets(): { price: number; percentage: number }[] {
        const channelHeight = this.channel.width;

        // Load TP multipliers from .env with default fallbacks
        const tp1Mult = Number(process.env.AMIRO_TP1_MULT || 0.5);
        const tp2Mult = Number(process.env.AMIRO_TP2_MULT || 0.75);
        const tp3Mult = Number(process.env.AMIRO_TP3_MULT || 1.0);

        // Load TP percentages from .env with default fallbacks
        const tp1Pct = Number(process.env.AMIRO_TP1_PCT || 50);
        const tp2Pct = Number(process.env.AMIRO_TP2_PCT || 25);
        const tp3Pct = Number(process.env.AMIRO_TP3_PCT || 25);

        if (this.trend === 'BULLISH') {
            if (this.riskLevel === 'VERY_LOW') {
                return [
                    { price: this.entry + (channelHeight * tp1Mult), percentage: tp1Pct },
                    { price: this.entry + (channelHeight * tp2Mult), percentage: tp2Pct },
                    { price: this.entry + (channelHeight * tp3Mult), percentage: tp3Pct }
                ];
            } else if (this.riskLevel === 'LOW') {
                return [
                    { price: this.entry + (channelHeight * tp1Mult), percentage: tp1Pct + tp2Pct },
                    { price: this.entry + (channelHeight * tp2Mult), percentage: tp3Pct }
                ];
            } else {
                return [
                    { price: this.entry + (channelHeight * tp1Mult), percentage: 100 }
                ];
            }
        } else {
            if (this.riskLevel === 'VERY_LOW') {
                return [
                    { price: this.entry - (channelHeight * tp1Mult), percentage: tp1Pct },
                    { price: this.entry - (channelHeight * tp2Mult), percentage: tp2Pct },
                    { price: this.entry - (channelHeight * tp3Mult), percentage: tp3Pct }
                ];
            } else if (this.riskLevel === 'LOW') {
                return [
                    { price: this.entry - (channelHeight * tp1Mult), percentage: tp1Pct + tp2Pct },
                    { price: this.entry - (channelHeight * tp2Mult), percentage: tp3Pct }
                ];
            } else {
                return [
                    { price: this.entry - (channelHeight * tp1Mult), percentage: 100 }
                ];
            }
        }
    }

    onTargetHit(targetNumber: number): void {
        this.targetsHit = targetNumber;

        if (this.riskLevel === 'VERY_LOW') {
            if (targetNumber === 1) {
                this.currentSL = this.entry; // Move SL to Breakeven
            } else if (targetNumber === 2) {
                this.currentSL = this.targets[0].price; // Move SL to Target 1
            } else if (targetNumber === 3) {
                this.currentSL = this.targets[1].price; // Move SL to Target 2
            }
        } else if (this.riskLevel === 'LOW') {
            if (targetNumber === 1 || targetNumber === 2) {
                this.currentSL = this.entry; // Move to Breakeven
            }
        }
    }

    getCurrentSL(): number {
        return this.currentSL;
    }

    getTargets(): { price: number; percentage: number }[] {
        return this.targets;
    }
}

// ============================================================================
// MAIN AMIRO STRATEGY CLASS
// ============================================================================

export class AmiroStrategy {
    private exchange: any;
    private orderManager: OrderManager;
    private signalBroadcaster: SignalBroadcaster;
    private dashboardUrl: string;

    private symbols: string[] = [];
    private solPrice: number = 150.0;

    // Timeframes & Candle memories
    private timeframes = {
        TRADING: '1m',     // 1m candles
        STRUCTURAL: '3m',  // 3m candles
        MACRO: '15m'       // 15m candles
    };

    private candlesMap: Map<string, Map<string, Candle[]>> = new Map(); // Maps symbol -> (timeframe -> candles)
    private activePositions: Map<string, ActiveAmiroPosition> = new Map();
    private lastExitTimes: Map<string, number> = new Map();
    private lastExitReasons: Map<string, 'SL' | 'TP'> = new Map(); // Maps symbol -> exit reason for dynamic cooldowns
    private lastDigestLog: Map<string, number> = new Map();
    private recentlyExitedTrades: Map<string, { symbol: string; exitTime: number }> = new Map();

    private tradeMemory: TradeMemory;
    private autoTuner: AutoTuner;

    private readonly COOLDOWN_MS = Number(process.env.AMIRO_COOLDOWN_SEC || 60) * 1000; // Entry cooldown in MS

    constructor(orderManager: OrderManager, signalBroadcaster: SignalBroadcaster) {
        this.orderManager = orderManager;
        this.signalBroadcaster = signalBroadcaster;
        this.dashboardUrl = `http://localhost:${process.env.DASHBOARD_PORT || 3000}`;

        const defaultSymbolsStr = '1000BONK/USDT:USDT,WIF/USDT:USDT,POPCAT/USDT:USDT,BOME/USDT:USDT';
        const symbolsStr = process.env.TARGET_SYMBOLS || defaultSymbolsStr;
        this.symbols = symbolsStr.split(',').map(s => s.trim());

        const exchangeId = process.env.EXCHANGE_ID || 'binance';
        const exchangeClass = ccxt.pro[exchangeId as keyof typeof ccxt.pro] as any;
        this.exchange = new exchangeClass({
            enableRateLimit: true,
            options: { defaultType: 'future' }
        });

        // Initialize maps
        this.symbols.forEach(sym => {
            const tfMap = new Map<string, Candle[]>();
            tfMap.set('1m', []);
            tfMap.set('3m', []);
            tfMap.set('15m', []);
            this.candlesMap.set(sym, tfMap);
        });

        // Initialize self-learning memory and auto-tuner
        this.tradeMemory = new TradeMemory();
        this.autoTuner = new AutoTuner(this.tradeMemory);

        // Restore active positions from trade memory on startup
        this.restoreActivePositions();
    }

    public async start() {
        logger.info('[AmiroStrategy] 🎯 Seeding historical candles from exchange to bypass Cold-Start latency...');

        // Parallel fetch to pre-seed 100 historical candles for all active symbols and timeframes
        await Promise.all(
            this.symbols.map(async (symbol) => {
                try {
                    await this.seedSymbolCandles(symbol, '1m');
                    await this.seedSymbolCandles(symbol, '3m');
                    await this.seedSymbolCandles(symbol, '15m');
                } catch (e: any) {
                    logger.error(`[AmiroStrategy] Error seeding historical candles for ${symbol}: ${e.message}`);
                }
            })
        );

        logger.info('[AmiroStrategy] 🚀 Seeding complete! Starting live websocket ticker stream...');

        // Start watching websockets in parallel
        await Promise.all(this.symbols.map(symbol => this.watchSymbol(symbol)));
    }

    private async seedSymbolCandles(symbol: string, timeframe: string) {
        // Fetch 100 historical candles using fetchOHLCV API
        const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        const candleList: Candle[] = ohlcv.map((candle: any) => ({
            time: Math.floor(candle[0] / 1000),
            open: candle[1],
            high: candle[2],
            low: candle[3],
            close: candle[4]
        }));
        this.candlesMap.get(symbol)!.set(timeframe, candleList);
    }

    private async watchSymbol(symbol: string) {
        logger.info(`[AmiroStrategy] 👀 Subscribing to ${symbol} ticker stream...`);
        while (true) {
            try {
                const ticker = await this.exchange.watchTicker(symbol);
                if (ticker && ticker.last) {
                    const timestamp = ticker.timestamp || Date.now();

                    // Feed price into high-frequency candlestick engines
                    this.feedPriceToTimeframe(symbol, ticker.last, timestamp, '1m');
                    this.feedPriceToTimeframe(symbol, ticker.last, timestamp, '3m');
                    this.feedPriceToTimeframe(symbol, ticker.last, timestamp, '15m');

                    // Run evaluation on tick
                    await this.onTick(symbol, ticker.last);
                }
            } catch (e: any) {
                logger.error(`[AmiroStrategy] WebSocket error for ${symbol}: ${e.message}. Reconnecting...`);
                await new Promise(res => setTimeout(res, 5000));
            }
        }
    }

    private feedPriceToTimeframe(symbol: string, price: number, timestamp: number, timeframe: string) {
        const tfMap = this.candlesMap.get(symbol)!;
        const candleList = tfMap.get(timeframe)!;

        const intervalSec = timeframe === '1m' ? 60 : timeframe === '3m' ? 180 : 900;
        const timestampSec = Math.floor(timestamp / 1000);
        const candleTime = timestampSec - (timestampSec % intervalSec);

        let lastCandle = candleList[candleList.length - 1];
        let newCandleClosed = false;

        if (!lastCandle || lastCandle.time !== candleTime) {
            newCandleClosed = true;
            // Push new candle
            candleList.push({
                time: candleTime,
                open: price,
                high: price,
                low: price,
                close: price
            });
            if (candleList.length > 200) {
                candleList.shift();
            }
        } else {
            // Update current candle
            lastCandle.high = Math.max(lastCandle.high, price);
            lastCandle.low = Math.min(lastCandle.low, price);
            lastCandle.close = price;
        }

        // Post trading 1m candle to dashboard for charting
        if (timeframe === '1m') {
            const currentCandle = {
                time: candleTime,
                open: lastCandle ? lastCandle.open : price,
                high: lastCandle ? lastCandle.high : price,
                low: lastCandle ? lastCandle.low : price,
                close: price
            };

            axios.post(`${this.dashboardUrl}/api/internal/candle`, {
                symbol,
                candle: currentCandle
            }).catch(() => { });
        }

        // Update debug snapshot candles if a position is active or recently exited
        if (newCandleClosed) {
            const activePos = this.activePositions.get(symbol);
            if (activePos && activePos.tradeId) {
                this.updateDebugSnapshotCandles(activePos.tradeId, symbol);
            }

            // Also update recently exited trades for post-exit candle sync
            for (const [tradeId, info] of Array.from(this.recentlyExitedTrades.entries())) {
                if (info.symbol === symbol) {
                    this.updateDebugSnapshotCandles(tradeId, symbol);
                    // Cleanup after 20 minutes to prevent memory leaks
                    if (Date.now() - info.exitTime > 20 * 60 * 1000) {
                        this.recentlyExitedTrades.delete(tradeId);
                    }
                }
            }
        }
    }

    private async onTick(symbol: string, currentPriceUsdt: number) {
        const activePos = this.activePositions.get(symbol);

        if (activePos) {
            // Active position tracking: evaluate split TP/SL targets sub-second
            await this.monitorPosition(activePos, currentPriceUsdt);
        } else {
            // Evaluate entry conditions
            await this.evaluateEntry(symbol, currentPriceUsdt);
        }
    }

    private restoreActivePositions(): void {
        try {
            const allTrades = this.tradeMemory.getAll();
            const openTrades = allTrades.filter(t => t.closed === false);
            
            if (openTrades.length > 0) {
                logger.info(`[AmiroStrategy] 🔄 Found ${openTrades.length} open trades in memory. Restoring active positions...`);
                
                for (const t of openTrades) {
                    const symbol = t.context.symbol;
                    const side = t.context.side;
                    const entryPrice = t.context.entryPrice;
                    const leverage = t.context.leverage;
                    const riskLevel = t.context.riskLevel;
                    const atr = t.context.atr;
                    const channelWidth = t.context.channelWidth;
                    const slPrice = t.context.slPrice;
                    
                    // Determine how many targets were hit from exits list
                    let targetsHit = 0;
                    let tp1Fraction = Number(process.env.AMIRO_TP1_PCT || 50) / 100;
                    let tp2Fraction = Number(process.env.AMIRO_TP2_PCT || 25) / 100;
                    let tp3Fraction = Number(process.env.AMIRO_TP3_PCT || 25) / 100;

                    let remainingPct = 1.0;
                    if (t.exits && Array.isArray(t.exits)) {
                        t.exits.forEach(ex => {
                            if (ex.reason.includes('TP1')) {
                                targetsHit = Math.max(targetsHit, 1);
                                remainingPct -= (riskLevel === 'LOW' ? (tp1Fraction + tp2Fraction) : tp1Fraction);
                            } else if (ex.reason.includes('TP2')) {
                                targetsHit = Math.max(targetsHit, 2);
                                remainingPct -= (riskLevel === 'LOW' ? tp3Fraction : tp2Fraction);
                            } else if (ex.reason.includes('TP3')) {
                                targetsHit = Math.max(targetsHit, 3);
                                remainingPct -= tp3Fraction;
                            }
                        });
                    }
                    if (remainingPct < 0) remainingPct = 0;

                    // Reconstruct exit strategy
                    const mockChannel: DynamicChannel = {
                        width: channelWidth,
                        midpoint: entryPrice,
                        upperLine: { point1: {} as any, point2: {} as any, slope: 0 },
                        lowerLine: { point1: {} as any, point2: {} as any, slope: 0 }
                    };
                    
                    const exitStrategy = new AmiroExitStrategy(
                        entryPrice,
                        mockChannel,
                        side === 'long' ? 'BULLISH' : 'BEARISH',
                        riskLevel,
                        atr,
                        Number(process.env.AMIRO_ATR_SL_MULT || 1.5)
                    );
                    
                    // Restore actual SL price and targetsHit
                    exitStrategy.currentSL = slPrice;
                    exitStrategy.targetsHit = targetsHit;
                    
                    // Calculate token sizes
                    const tradeSizeUsdt = Number(process.env.AMIRO_TRADE_SIZE_USDT || 50.0);
                    const totalAmount = Number((tradeSizeUsdt / entryPrice).toFixed(4));
                    const remainingAmount = Number((totalAmount * remainingPct).toFixed(4));
                    
                    const restoredPos: ActiveAmiroPosition = {
                        symbol,
                        side,
                        entryPrice,
                        totalAmount,
                        remainingAmount,
                        leverage,
                        exitStrategy,
                        tradeId: t.id
                    };
                    
                    this.activePositions.set(symbol, restoredPos);
                    logger.info(`[AmiroStrategy] 🎯 Restored active position for ${symbol} | Side: ${side.toUpperCase()} | Entry: ${entryPrice} | Remaining size: ${remainingAmount} SOL | SL: ${slPrice} | Targets hit: ${targetsHit}`);
                }
            } else {
                logger.info(`[AmiroStrategy] ℹ️ No open trades found in memory to restore.`);
            }
        } catch (e: any) {
            logger.error(`[AmiroStrategy] ❌ Failed to restore active positions: ${e.message}`);
        }
    }

    private calculateATR(candles: Candle[], period: number = 14): number {
        if (candles.length < period + 1) return 0;

        let trSum = 0;
        for (let i = 1; i <= period; i++) {
            const current = candles[candles.length - i];
            const prev = candles[candles.length - i - 1];

            const tr1 = current.high - current.low;
            const tr2 = Math.abs(current.high - prev.close);
            const tr3 = Math.abs(current.low - prev.close);
            const tr = Math.max(tr1, tr2, tr3);
            trSum += tr;
        }
        return trSum / period;
    }

    private checkMomentum(trend: TrendType, candles: Candle[]): boolean {
        if (candles.length < 5) return false;

        // Verify that at least 3 out of the last 5 candles close in the trend direction
        const last5 = candles.slice(-5);
        let count = 0;

        for (const c of last5) {
            if (trend === TrendType.BULLISH) {
                if (c.close > c.open) count++;
            } else if (trend === TrendType.BEARISH) {
                if (c.close < c.open) count++;
            }
        }
        return count >= 3;
    }

    private async evaluateEntry(symbol: string, currentPriceUsdt: number) {
        const now = Date.now();
        const lastExit = this.lastExitTimes.get(symbol) || 0;
        const lastReason = this.lastExitReasons.get(symbol);

        // Dynamic cooldown: 3x penalty for SL stopouts, 0.5x reward for TP exits
        let cooldownMs = this.COOLDOWN_MS;
        if (lastReason === 'SL') {
            cooldownMs = this.COOLDOWN_MS * 3;
        } else if (lastReason === 'TP') {
            cooldownMs = this.COOLDOWN_MS * 0.5;
        }

        if (now - lastExit < cooldownMs) {
            return;
        }

        const symbolDigestTime = this.lastDigestLog.get(symbol) || 0;
        const shouldLogDigest = now - symbolDigestTime > 30000; // Log status digest once every 30 seconds per symbol
        if (shouldLogDigest) {
            this.lastDigestLog.set(symbol, now);
        }

        const tfMap = this.candlesMap.get(symbol)!;
        const tradingCandles = tfMap.get('1m')!;
        const structuralCandles = tfMap.get('3m')!;
        const macroCandles = tfMap.get('15m')!;

        if (tradingCandles.length < 15 || structuralCandles.length < 15 || macroCandles.length < 15) {
            if (shouldLogDigest) {
                logger.info(`[AmiroStrategy] 🔍 [${symbol}] Status: ❌ Cold Start (Insuff candles: 1m=${tradingCandles.length}, 3m=${structuralCandles.length}, 15m=${macroCandles.length})`);
            }
            return;
        }

        // Calculate swings across timeframes
        const tradingSwings = this.identifySwings(tradingCandles);
        const structuralSwings = this.identifySwings(structuralCandles);
        const macroSwings = this.identifySwings(macroCandles);

        if (tradingSwings.length < 4 || structuralSwings.length < 4 || macroSwings.length < 4) {
            if (shouldLogDigest) {
                logger.info(`[AmiroStrategy] 🔍 [${symbol}] Status: ❌ Insufficient Swings (Swings: 1m=${tradingSwings.length}, 3m=${structuralSwings.length}, 15m=${macroSwings.length})`);
            }
            return;
        }

        // Algorithm 1: Trend Filter (Structural)
        const structuralTrend = this.detectTrend(structuralSwings);
        if (structuralTrend === TrendType.SIDEWAYS_NORMAL ||
            structuralTrend === TrendType.SIDEWAYS_EXPANDING ||
            structuralTrend === TrendType.SIDEWAYS_CONTRACTING) {
            if (shouldLogDigest) {
                logger.info(`[AmiroStrategy] 🔍 [${symbol}] Status: ❌ Blocked (Structural Trend is Sideways: ${structuralTrend})`);
            }
            return;
        }

        // Determine Market Scenario & Risk Level based on Macro and Trading Alignment
        const macroTrend = this.detectTrend(macroSwings);
        const tradingTrend = this.detectTrend(tradingSwings);

        let riskLevel: 'VERY_LOW' | 'LOW' | 'MEDIUM';
        let tradeable = false;

        if (macroTrend === structuralTrend && tradingTrend === structuralTrend) {
            riskLevel = 'VERY_LOW';
            tradeable = true;
        } else if (macroTrend === TrendType.SIDEWAYS_NORMAL ||
            macroTrend === TrendType.SIDEWAYS_EXPANDING ||
            macroTrend === TrendType.SIDEWAYS_CONTRACTING) {
            riskLevel = 'LOW';
            tradeable = true;
        } else if ((macroTrend === TrendType.BULLISH && structuralTrend === TrendType.BEARISH) ||
            (macroTrend === TrendType.BEARISH && structuralTrend === TrendType.BULLISH)) {
            riskLevel = 'MEDIUM';
            tradeable = true;
        } else {
            if (shouldLogDigest) {
                logger.info(`[AmiroStrategy] 🔍 [${symbol}] Status: ❌ Blocked (Scenario Mismatch. Macro: ${macroTrend}, Structural: ${structuralTrend}, Trading: ${tradingTrend})`);
            }
            return; // Non-tradeable scenario
        }

        // Algorithm 2: Momentum Filter (Check that last 5 structural candles match trend + slope momentum + structural range wave size)
        const rangeMomentum = this.checkMomentum(structuralTrend, structuralCandles);
        const slopeMomentum = this.checkSlopeMomentum(structuralTrend, structuralSwings);
        const waveRangeMomentum = this.checkStructuralRangeMomentum(structuralTrend, structuralSwings);

        if (!rangeMomentum || !slopeMomentum.pass || !waveRangeMomentum) {
            if (shouldLogDigest) {
                logger.info(`[AmiroStrategy] 🔍 [${symbol}] Status: ❌ Blocked (Momentum check failed. RangeCandleCount: ${rangeMomentum}, Slope: ${slopeMomentum.pass}, WaveRangeSize: ${waveRangeMomentum})`);
            }
            return;
        }

        // Algorithm 3: HPTA (Alignment of Structural and Trading)
        if (structuralTrend !== tradingTrend) {
            if (shouldLogDigest) {
                logger.info(`[AmiroStrategy] 🔍 [${symbol}] Status: ❌ Blocked (HPTA Trend Mismatch. Structural: ${structuralTrend}, Trading: ${tradingTrend})`);
            }
            return;
        }

        // Build Dynamic Channel for Trading timeframe (in Usdt)
        const channel = this.buildDynamicChannel(tradingSwings, tradingCandles.length - 1);
        if (!channel || channel.width <= 0) {
            if (shouldLogDigest) {
                logger.info(`[AmiroStrategy] 🔍 [${symbol}] Status: ❌ Blocked (Failed to build Dynamic Channel)`);
            }
            return;
        }

        // Channel Width Filter: prevents entry on overly compressed or hyper-volatile widths
        const channelWidthPct = channel.width / currentPriceUsdt;
        const minChannelWidthPct = this.getSymbolParam(symbol, 'AMIRO_MIN_CHANNEL_WIDTH_PCT', 0.0003);
        const maxChannelWidthPct = this.getSymbolParam(symbol, 'AMIRO_MAX_CHANNEL_WIDTH_PCT', 0.015);
        if (channelWidthPct < minChannelWidthPct || channelWidthPct > maxChannelWidthPct) {
            if (shouldLogDigest) {
                logger.info(`[AmiroStrategy] 🔍 [${symbol}] Status: ❌ Blocked (Channel width out of bounds: ${(channelWidthPct * 100).toFixed(4)}% | Range: ${minChannelWidthPct * 100}% - ${maxChannelWidthPct * 100}%)`);
            }
            return;
        }

        // Algorithm 4: OB/OS Zone
        const zone = this.checkZone(currentPriceUsdt, channel, tradingTrend);
        if (!zone.inZone) {
            if (shouldLogDigest) {
                logger.info(`[AmiroStrategy] 🔍 [${symbol}] Status: ❌ Blocked (Not in OB/OS zone. Trend: ${tradingTrend}, Price: ${currentPriceUsdt.toFixed(6)}, Midpoint: ${channel.midpoint.toFixed(6)}, Zone: ${zone.zone})`);
            }
            return;
        }

        // Algorithm 5: Risk/Reward
        const rr = this.checkRiskReward(currentPriceUsdt, channel, tradingTrend);
        if (!rr.pass) {
            if (shouldLogDigest) {
                logger.info(`[AmiroStrategy] 🔍 [${symbol}] Status: ❌ Blocked (Risk/Reward or Quarter entry zone failed. R/R Ratio: ${rr.rr.toFixed(2)}, In Golden Quarter: ${rr.pass})`);
            }
            return;
        }

        // 14-period ATR calculation for precision Stop Loss placement
        const atr = this.calculateATR(tradingCandles, 14);
        const atrPct = atr / currentPriceUsdt;

        // All checks passed! Calculate dynamic confidence score (weighted out of 100)
        let confidenceScore = 0;

        // 1. Risk Level (up to 30pt)
        if (riskLevel === 'VERY_LOW') confidenceScore += 30;
        else if (riskLevel === 'LOW') confidenceScore += 20;
        else confidenceScore += 10;

        // 2. Momentum (up to 25pt)
        const last5Structural = structuralCandles.slice(-5);
        let structuralTrendCandles = 0;
        for (const c of last5Structural) {
            if (tradingTrend === TrendType.BULLISH && c.close > c.open) structuralTrendCandles++;
            else if (tradingTrend === TrendType.BEARISH && c.close < c.open) structuralTrendCandles++;
        }
        confidenceScore += structuralTrendCandles === 5 ? 25 : structuralTrendCandles === 4 ? 20 : 15;

        // 3. Zone Depth (up to 25pt) - how deep is it in OB/OS zone
        let zoneDepthPct = 0;
        if (tradingTrend === TrendType.BULLISH) {
            const lowerEdge = channel.lowerLine.point2.price;
            zoneDepthPct = Math.max(0, Math.min(1, (channel.midpoint - currentPriceUsdt) / Math.max(0.000001, channel.midpoint - lowerEdge)));
        } else {
            const upperEdge = channel.upperLine.point2.price;
            zoneDepthPct = Math.max(0, Math.min(1, (currentPriceUsdt - channel.midpoint) / Math.max(0.000001, upperEdge - channel.midpoint)));
        }
        confidenceScore += Math.round(zoneDepthPct * 25);

        // 4. Risk-Reward Ratio quality (up to 20pt)
        let rrScore = 5;
        if (rr.rr <= 1.0) rrScore = 20;
        else if (rr.rr <= 1.5) rrScore = 15;
        else if (rr.rr <= 2.0) rrScore = 10;
        confidenceScore += rrScore;

        const finalConfidence = Math.round(Math.min(100, Math.max(0, confidenceScore)));

        // AMIRO_MIN_CONFIDENCE gate
        const minConfidence = this.getSymbolParam(symbol, 'AMIRO_MIN_CONFIDENCE', 60);
        if (finalConfidence < minConfidence) {
            if (shouldLogDigest) {
                logger.info(`[AmiroStrategy] 🔍 [${symbol}] Status: ❌ Blocked (Confidence too low: ${finalConfidence}% | Min Required: ${minConfidence}%)`);
            }
            return;
        }

        // Calculate dynamic leverage & position size
        const dynamicLeverage = this.calculateDynamicLeverage(symbol, riskLevel, finalConfidence);

        // Execute trade in SOL terms
        const side = tradingTrend === TrendType.BULLISH ? 'long' : 'short';

        let atrSlMult = this.getSymbolParam(symbol, 'AMIRO_ATR_SL_MULT', 1.5);
        if (this.isNYSessionActive()) {
            const slMult = Number(process.env.NY_FILTER_SL_MULTIPLIER || 1.5);
            atrSlMult = atrSlMult * slMult;
            logger.info(`[NY Filter] 🛡️ Widening Stop-Loss distance multiplier for ${symbol} due to peak volatility: original=${this.getSymbolParam(symbol, 'AMIRO_ATR_SL_MULT', 1.5)}, widened=${atrSlMult}`);
        }

        const exitStrategy = new AmiroExitStrategy(
            currentPriceUsdt,
            channel,
            side === 'long' ? 'BULLISH' : 'BEARISH',
            riskLevel,
            atr,
            atrSlMult
        );

        // Dynamic Position Sizing: calculate token contracts equivalent to the configured USDT trade size
        const tradeSizeUsdt = Number(process.env.AMIRO_TRADE_SIZE_USDT || 50.0);
        const totalAmount = Number((tradeSizeUsdt / currentPriceUsdt).toFixed(4));

        // Open self-learning trade context memory
        const tradeContext: TradeContext = {
            symbol,
            side,
            entryPrice: currentPriceUsdt,
            leverage: dynamicLeverage,
            riskLevel,
            confidence: finalConfidence,
            channelWidth: channel.width,
            channelWidthPct,
            macroTrend: macroTrend.toString(),
            structuralTrend: structuralTrend.toString(),
            tradingTrend: tradingTrend.toString(),
            atr,
            atrPct,
            slPrice: exitStrategy.getCurrentSL(),
            slDistancePct: Math.abs(exitStrategy.getCurrentSL() - currentPriceUsdt) / currentPriceUsdt,
            tp1Price: exitStrategy.getTargets()[0].price,
            tp1DistancePct: Math.abs(exitStrategy.getTargets()[0].price - currentPriceUsdt) / currentPriceUsdt
        };

        const debugSnapshot = {
            symbol,
            side,
            entryPrice: currentPriceUsdt,
            leverage: dynamicLeverage,
            riskLevel,
            confidence: finalConfidence,
            atr,
            atrPct,
            atrSlMult,
            channel: {
                width: channel.width,
                widthPct: channelWidthPct,
                midpoint: channel.midpoint,
                upperLine: {
                    point1: channel.upperLine.point1,
                    point2: channel.upperLine.point2
                },
                lowerLine: {
                    point1: channel.lowerLine.point1,
                    point2: channel.lowerLine.point2
                }
            },
            riskReward: {
                rr: rr.rr,
                pass: rr.pass
            },
            zone: {
                zone: zone.zone,
                inZone: zone.inZone,
                depthPct: zoneDepthPct
            },
            trends: {
                macro: macroTrend.toString(),
                structural: structuralTrend.toString(),
                trading: tradingTrend.toString()
            },
            momentum: {
                rangeMomentum,
                slopeMomentumPass: slopeMomentum.pass,
                slopeMomentumRatio: slopeMomentum.slopeRatio
            },
            exitTargets: {
                sl: exitStrategy.getCurrentSL(),
                targets: exitStrategy.getTargets()
            },
            candles: {
                '1m': tradingCandles.slice(-100),
                '3m': structuralCandles.slice(-100),
                '15m': macroCandles.slice(-100)
            }
        };

        const tradeId = this.tradeMemory.openTrade(tradeContext, debugSnapshot);

        const newPos: ActiveAmiroPosition = {
            symbol,
            side,
            entryPrice: currentPriceUsdt,
            totalAmount,
            remainingAmount: totalAmount,
            leverage: dynamicLeverage,
            exitStrategy,
            tradeId
        };

        this.activePositions.set(symbol, newPos);

        logger.info(`[AmiroStrategy] 🎯 ENTRY: ${side.toUpperCase()} for ${symbol} at ${currentPriceUsdt.toFixed(6)} USDT with ${dynamicLeverage}x Leverage (Risk: ${riskLevel}, Conf: ${finalConfidence}%)`);

        // 1. Broadcast Signal
        await this.signalBroadcaster.broadcastSignal({
            symbol,
            side,
            entryPrice: currentPriceUsdt,
            leverage: dynamicLeverage,
            takeProfit: exitStrategy.getTargets()[0].price, // T1
            stopLoss: exitStrategy.getCurrentSL(),
            timestamp: Date.now()
        });

        // 2. Post Marker to Dashboard
        axios.post(`${this.dashboardUrl}/api/internal/signal`, {
            symbol,
            type: side === 'long' ? 'BUY' : 'SELL',
            price: currentPriceUsdt,
            leverage: dynamicLeverage,
            time: Math.floor(Date.now() / 1000),
            strategy: 'Amiro',
            tp: exitStrategy.getTargets()[0].price,
            sl: exitStrategy.getCurrentSL()
        }).catch(() => { });

        // 3. Execute Market Entry
        const orderSide = side === 'long' ? 'buy' : 'sell';
        await this.orderManager.executeMarketOrder(symbol, orderSide, totalAmount);
    }

    private async monitorPosition(pos: ActiveAmiroPosition, priceUsdt: number) {
        const strategy = pos.exitStrategy;
        const currentSL = strategy.getCurrentSL();
        const targets = strategy.getTargets();
        const targetsHit = strategy.targetsHit;

        let triggerExit = false;
        let triggerPartial = false;
        let partialPercentage = 0;
        let nextTargetNum = targetsHit + 1;
        let currentTarget = targets[nextTargetNum - 1];

        // 1. Check Stop Loss breach
        if (pos.side === 'long') {
            if (priceUsdt <= currentSL) {
                triggerExit = true;
            }
        } else {
            if (priceUsdt >= currentSL) {
                triggerExit = true;
            }
        }

        if (triggerExit) {
            // Full stopout exit
            const remainingFraction = pos.remainingAmount / pos.totalAmount;
            const tradePnLPercent = pos.side === 'long'
                ? ((priceUsdt - pos.entryPrice) / pos.entryPrice * 100) * pos.leverage
                : ((pos.entryPrice - priceUsdt) / pos.entryPrice * 100) * pos.leverage;
            const tradeSizeUsdt = Number(process.env.AMIRO_TRADE_SIZE_USDT || 50);
            const tradePnLUsdt = tradeSizeUsdt * remainingFraction * (tradePnLPercent / 100);

            // Record exit in memory
            if (pos.tradeId) {
                this.tradeMemory.addExit(pos.tradeId, {
                    reason: 'Stop Loss Triggered',
                    price: priceUsdt,
                    pnlPct: tradePnLPercent * remainingFraction,
                    pnlUsdt: tradePnLUsdt,
                    timestamp: Date.now(),
                    fullyExited: true
                });
                this.recentlyExitedTrades.set(pos.tradeId, { symbol: pos.symbol, exitTime: Date.now() });
                this.updateDebugSnapshotCandles(pos.tradeId, pos.symbol);
            }

            this.activePositions.delete(pos.symbol);
            this.lastExitTimes.set(pos.symbol, Date.now());
            this.lastExitReasons.set(pos.symbol, 'SL');

            logger.info(`[AmiroStrategy] 🚪 STOP OUT for ${pos.symbol} at ${priceUsdt.toFixed(6)} USDT. Entry: ${pos.entryPrice.toFixed(6)} USDT | PnL: ${tradePnLPercent.toFixed(2)}%`);

            // Exit Marker on dashboard
            axios.post(`${this.dashboardUrl}/api/internal/signal`, {
                symbol: pos.symbol,
                type: pos.side === 'long' ? 'SELL_EXIT' : 'BUY_EXIT',
                price: priceUsdt,
                time: Math.floor(Date.now() / 1000),
                exitReason: 'SL',
                fullyExited: true,
                fraction: remainingFraction,
                strategy: 'Amiro'
            }).catch(() => { });

            // Telegram Exit
            this.signalBroadcaster.broadcastExit(pos.symbol, pos.side, priceUsdt, tradePnLPercent, 'Stop Loss Triggered', tradePnLUsdt).catch(() => {});

            const exitOrderSide = pos.side === 'long' ? 'sell' : 'buy';
            await this.orderManager.executeMarketOrder(pos.symbol, exitOrderSide, pos.remainingAmount);

            // Evaluate pattern optimizer suggestions
            if (pos.tradeId) {
                const insights = this.autoTuner.checkAndAnalyze(pos.symbol);
                if (insights && insights.length > 0) {
                    const count = this.tradeMemory.getClosedTrades().filter(t => t.context.symbol === pos.symbol).length;
                    const formatted = this.autoTuner.formatTelegramMessage(pos.symbol, insights, count);
                    await this.signalBroadcaster.sendRawMessage(formatted);
                }
            }
            return;
        }

        // 2. Check Target hits
        if (currentTarget) {
            let hit = false;
            if (pos.side === 'long') {
                if (priceUsdt >= currentTarget.price) hit = true;
            } else {
                if (priceUsdt <= currentTarget.price) hit = true;
            }

            if (hit) {
                triggerPartial = true;
                partialPercentage = currentTarget.percentage;
            }
        }

        if (triggerPartial) {
            // Calculate amount to close based on target percentage
            const origTotal = pos.totalAmount;
            let closeAmount = origTotal * (partialPercentage / 100);

            // Adjust closeAmount to not exceed remainingAmount
            closeAmount = Math.min(closeAmount, pos.remainingAmount);

            // Update SL trailing state
            strategy.onTargetHit(nextTargetNum);
            pos.remainingAmount -= closeAmount;

            logger.info(`[AmiroStrategy] 🎯 TARGET ${nextTargetNum} HIT for ${pos.symbol} at ${priceUsdt.toFixed(6)} USDT. Closing ${partialPercentage}% (Remaining: ${pos.remainingAmount})`);

            // Check if fully exited (T3 hit or remaining amount zero)
            const fullyExited = pos.remainingAmount <= 0.01 || nextTargetNum === targets.length;

            const tradePnLPercent = pos.side === 'long'
                ? ((priceUsdt - pos.entryPrice) / pos.entryPrice * 100) * pos.leverage
                : ((pos.entryPrice - priceUsdt) / pos.entryPrice * 100) * pos.leverage;
            const tradeSizeUsdt = Number(process.env.AMIRO_TRADE_SIZE_USDT || 50);
            const partialPnLUsdt = (tradeSizeUsdt * (closeAmount / pos.totalAmount)) * (tradePnLPercent / 100);
            const tpLabel = fullyExited ? `Full Take Profit (TP3) Hit!` : `Partial Take Profit (TP${nextTargetNum}) Hit!`;

            const exitFraction = closeAmount / pos.totalAmount;

            // Record exit in memory
            if (pos.tradeId) {
                this.tradeMemory.addExit(pos.tradeId, {
                    reason: tpLabel,
                    price: priceUsdt,
                    pnlPct: tradePnLPercent * exitFraction,
                    pnlUsdt: partialPnLUsdt,
                    timestamp: Date.now(),
                    fullyExited: fullyExited
                });
                this.updateDebugSnapshotCandles(pos.tradeId, pos.symbol);
            }

            axios.post(`${this.dashboardUrl}/api/internal/signal`, {
                symbol: pos.symbol,
                type: pos.side === 'long' ? 'SELL_EXIT' : 'BUY_EXIT',
                price: priceUsdt,
                time: Math.floor(Date.now() / 1000),
                exitReason: fullyExited ? 'TP3' : `TP${nextTargetNum}`,
                fullyExited: fullyExited,
                fraction: exitFraction,
                strategy: 'Amiro'
            }).catch(() => { });

            // Telegram Exit
            this.signalBroadcaster.broadcastExit(pos.symbol, pos.side, priceUsdt, tradePnLPercent, tpLabel, partialPnLUsdt).catch(() => {});

            const exitOrderSide = pos.side === 'long' ? 'sell' : 'buy';
            await this.orderManager.executeMarketOrder(pos.symbol, exitOrderSide, closeAmount);

            if (fullyExited) {
                if (pos.tradeId) {
                    this.recentlyExitedTrades.set(pos.tradeId, { symbol: pos.symbol, exitTime: Date.now() });
                }
                this.activePositions.delete(pos.symbol);
                this.lastExitTimes.set(pos.symbol, Date.now());
                this.lastExitReasons.set(pos.symbol, 'TP');
                logger.info(`[AmiroStrategy] 🚪 FULL EXITED for ${pos.symbol} at ${priceUsdt.toFixed(6)} USDT`);

                // Evaluate pattern optimizer suggestions
                if (pos.tradeId) {
                    const insights = this.autoTuner.checkAndAnalyze(pos.symbol);
                    if (insights && insights.length > 0) {
                        const count = this.tradeMemory.getClosedTrades().filter(t => t.context.symbol === pos.symbol).length;
                        const formatted = this.autoTuner.formatTelegramMessage(pos.symbol, insights, count);
                        await this.signalBroadcaster.sendRawMessage(formatted);
                    }
                }
            }
        }
    }

    private updateDebugSnapshotCandles(tradeId: string, symbol: string) {
        try {
            const filePath = path.resolve(process.cwd(), 'signal_debug_data', `${tradeId}.json`);
            if (fs.existsSync(filePath)) {
                const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (!snapshot.candles) {
                    snapshot.candles = {};
                }
                const tfMap = this.candlesMap.get(symbol);
                if (tfMap) {
                    for (const timeframe of ['1m', '3m', '15m']) {
                        const currentCandles = tfMap.get(timeframe) || [];
                        const snapshotCandles = snapshot.candles[timeframe] || [];
                        
                        const mergedMap = new Map<number, any>();
                        snapshotCandles.forEach((c: any) => mergedMap.set(c.time, c));
                        currentCandles.forEach((c: any) => {
                            mergedMap.set(c.time, c);
                        });
                        
                        const mergedArray = Array.from(mergedMap.values()).sort((a, b) => a.time - b.time);
                        // Limit to last 300 candles to keep the debug file size reasonable
                        snapshot.candles[timeframe] = mergedArray.slice(-300);
                    }
                }
                fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
            }
        } catch (e: any) {
            logger.error(`[AmiroStrategy] Failed to update debug snapshot candles: ${e.message}`);
        }
    }

    // ============================================================================
    // TECHNICAL swing, trend, and channel math algorithms
    // ============================================================================

    private identifySwings(candles: Candle[]): SwingPoint[] {
        const rawSwings: SwingPoint[] = [];
        if (candles.length < 5) return [];

        const useOptimistic = process.env.USE_OPTIMISTIC_SWINGS === 'true';

        // Gather all raw high and low swings
        if (useOptimistic) {
            for (let i = 2; i < candles.length - 1; i++) {
                const minus2 = candles[i - 2];
                const minus1 = candles[i - 1];
                const zero = candles[i];
                const plus1 = candles[i + 1];

                // Optimistic Swing High: higher than left, higher than right, and right is a bearish reversal candle
                const isHigh = zero.high > minus2.high &&
                    zero.high > minus1.high &&
                    zero.high > plus1.high &&
                    plus1.close < plus1.open; // Reversal close

                // Optimistic Swing Low: lower than left, lower than right, and right is a bullish reversal candle
                const isLow = zero.low < minus2.low &&
                    zero.low < minus1.low &&
                    zero.low < plus1.low &&
                    plus1.close > plus1.open; // Reversal close

                if (isHigh) {
                    rawSwings.push({ index: i, price: zero.high, type: 'HIGH', timestamp: zero.time * 1000, confirmed: true });
                } else if (isLow) {
                    rawSwings.push({ index: i, price: zero.low, type: 'LOW', timestamp: zero.time * 1000, confirmed: true });
                }
            }
        } else {
            // Strict 5-candle model (2 future candles confirmation)
            for (let i = 2; i < candles.length - 2; i++) {
                const minus2 = candles[i - 2];
                const minus1 = candles[i - 1];
                const zero = candles[i];
                const plus1 = candles[i + 1];
                const plus2 = candles[i + 2];

                const isHigh = zero.high > minus2.high && zero.high > minus1.high && zero.high > plus1.high && zero.high > plus2.high;
                const isLow = zero.low < minus2.low && zero.low < minus1.low && zero.low < plus1.low && zero.low < plus2.low;

                if (isHigh) {
                    rawSwings.push({ index: i, price: zero.high, type: 'HIGH', timestamp: zero.time * 1000, confirmed: true });
                } else if (isLow) {
                    rawSwings.push({ index: i, price: zero.low, type: 'LOW', timestamp: zero.time * 1000, confirmed: true });
                }
            }
        }

        // Apply strict consecutive override where the newer/extreme swing takes precedence if it occurs before the opposite swing
        const filtered: SwingPoint[] = [];
        let lastSwing: SwingPoint | null = null;

        for (const swing of rawSwings) {
            if (!lastSwing) {
                lastSwing = swing;
                filtered.push(swing);
                continue;
            }

            if (swing.type === lastSwing.type) {
                // Same type consecutive: pop the older one and replace it with the newer one
                filtered.pop();
                filtered.push(swing);
                lastSwing = swing;
            } else {
                filtered.push(swing);
                lastSwing = swing;
            }
        }

        return filtered;
    }

    private isNYSessionActive(): boolean {
        if (process.env.ENABLE_NY_SESSION_FILTER !== 'true') {
            return false;
        }

        try {
            const tz = process.env.NY_SESSION_TIMEZONE || 'Europe/Sofia';
            const options = { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false } as const;
            const formatter = new Intl.DateTimeFormat('en-US', options);
            const parts = formatter.formatToParts(new Date());

            let hour = 0;
            let minute = 0;
            for (const part of parts) {
                if (part.type === 'hour') hour = parseInt(part.value, 10);
                if (part.type === 'minute') minute = parseInt(part.value, 10);
            }

            const startHour = Number(process.env.NY_SESSION_START_HOUR || 16);
            const startMin = Number(process.env.NY_SESSION_START_MINUTE || 20);
            const endHour = Number(process.env.NY_SESSION_END_HOUR || 17);
            const endMin = Number(process.env.NY_SESSION_END_MINUTE || 40);

            const currentMinutes = hour * 60 + minute;
            const startMinutes = startHour * 60 + startMin;
            const endMinutes = endHour * 60 + endMin;

            return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
        } catch (e: any) {
            logger.warn(`[NY Session Filter] Error parsing timezone/time: ${e.message}`);
            return false;
        }
    }

    private detectTrend(swings: SwingPoint[]): TrendType {
        const highs = swings.filter(s => s.type === 'HIGH').sort((a, b) => b.index - a.index);
        const lows = swings.filter(s => s.type === 'LOW').sort((a, b) => b.index - a.index);

        if (highs.length < 2 || lows.length < 2) {
            return TrendType.SIDEWAYS_NORMAL;
        }

        const newHigh = highs[0];
        const oldHigh = highs[1];
        const newLow = lows[0];
        const oldLow = lows[1];

        if (newHigh.price > oldHigh.price && newLow.price > oldLow.price) {
            return TrendType.BULLISH;
        }
        if (newHigh.price < oldHigh.price && newLow.price < oldLow.price) {
            return TrendType.BEARISH;
        }
        if (newHigh.price > oldHigh.price && newLow.price < oldLow.price) {
            return TrendType.SIDEWAYS_EXPANDING;
        }
        if (newHigh.price < oldHigh.price && newLow.price > oldLow.price) {
            return TrendType.SIDEWAYS_CONTRACTING;
        }

        return TrendType.SIDEWAYS_NORMAL;
    }

    private checkSlopeMomentum(trend: TrendType, swings: SwingPoint[]): { pass: boolean; slopeRatio: number } {
        const highs = swings.filter(s => s.type === 'HIGH');
        const lows = swings.filter(s => s.type === 'LOW');

        if (highs.length < 2 || lows.length < 2) {
            return { pass: true, slopeRatio: 1.0 };
        }

        const h1 = highs[highs.length - 2];
        const h2 = highs[highs.length - 1];
        const l1 = lows[lows.length - 2];
        const l2 = lows[lows.length - 1];

        // Safe check slope
        const slopeHigh = (h2.price - h1.price) / Math.max(1, h2.index - h1.index);
        const slopeLow = (l2.price - l1.price) / Math.max(1, l2.index - l1.index);

        if (trend === TrendType.BULLISH) {
            return { pass: slopeLow >= 0, slopeRatio: 1.0 };
        } else {
            return { pass: slopeHigh <= 0, slopeRatio: 1.0 };
        }
    }

    private checkStructuralRangeMomentum(trend: TrendType, swings: SwingPoint[]): boolean {
        const highs = swings.filter(s => s.type === 'HIGH').sort((a, b) => a.index - b.index);
        const lows = swings.filter(s => s.type === 'LOW').sort((a, b) => a.index - b.index);

        if (highs.length < 2 || lows.length < 2) {
            return false;
        }

        const hOld = highs[highs.length - 2].price;
        const hNew = highs[highs.length - 1].price;
        const lOld = lows[lows.length - 2].price;
        const lNew = lows[lows.length - 1].price;

        let wave1 = 0;
        let wave2 = 0;

        if (trend === TrendType.BULLISH) {
            wave1 = hOld - lOld;
            wave2 = hNew - lNew;
        } else if (trend === TrendType.BEARISH) {
            wave1 = lOld - hOld;
            wave2 = lNew - hNew;
        } else {
            return false;
        }

        return wave2 >= wave1;
    }

    private buildDynamicChannel(swings: SwingPoint[], currentIndex: number): DynamicChannel | null {
        const highs = swings.filter(s => s.type === 'HIGH').sort((a, b) => b.index - a.index);
        const lows = swings.filter(s => s.type === 'LOW').sort((a, b) => b.index - a.index);

        if (highs.length < 2 || lows.length < 2) return null;

        const h1 = highs[1]; // Old High
        const h2 = highs[0]; // New High
        const l1 = lows[1]; // Old Low
        const l2 = lows[0]; // New Low

        // Calculate slopes
        const slopeHigh = (h2.price - h1.price) / Math.max(1, h2.index - h1.index);
        const slopeLow = (l2.price - l1.price) / Math.max(1, l2.index - l1.index);

        // Stabilizer: average slope to keep lines parallel and mathematically stable
        const avgSlope = (slopeHigh + slopeLow) / 2;

        const upperLine = { point1: h1, point2: h2, slope: avgSlope };
        const lowerLine = { point1: l1, point2: l2, slope: avgSlope };

        // Calculate support and resistance price at current evaluation index
        const currentResistance = avgSlope * (currentIndex - h2.index) + h2.price;
        const currentSupport = avgSlope * (currentIndex - l2.index) + l2.price;

        // Dynamic vertical width and midpoint at current evaluation index
        const width = currentResistance - currentSupport;
        const midpoint = (currentResistance + currentSupport) / 2;

        return { upperLine, lowerLine, width, midpoint, currentSupport, currentResistance };
    }

    private checkZone(price: number, channel: DynamicChannel, trend: TrendType): { inZone: boolean; zone: 'OB' | 'OS' | 'NEUTRAL' } {
        const support = channel.currentSupport ?? channel.lowerLine.point2.price;
        const resistance = channel.currentResistance ?? channel.upperLine.point2.price;

        if (trend === TrendType.BULLISH) {
            const isOversold = price < channel.midpoint && price >= support;
            return { inZone: isOversold, zone: isOversold ? 'OS' : 'OB' };
        } else {
            const isOverbought = price > channel.midpoint && price <= resistance;
            return { inZone: isOverbought, zone: isOverbought ? 'OB' : 'OS' };
        }
    }

    private checkRiskReward(entry: number, channel: DynamicChannel, trend: TrendType): { pass: boolean; rr: number } {
        const stopOffsetWidth = Number(process.env.AMIRO_SL_OFFSET_WIDTH || 0.25);
        const stopDistance = channel.width * stopOffsetWidth;
        let stopLoss: number;
        let target: number;

        const maxRR = Number(process.env.AMIRO_MAX_RR_RATIO || 2.0);
        const goldenZoneWidth = Number(process.env.AMIRO_GOLDEN_ZONE_WIDTH || 0.25);

        const support = channel.currentSupport ?? channel.lowerLine.point2.price;
        const resistance = channel.currentResistance ?? channel.upperLine.point2.price;

        if (trend === TrendType.BULLISH) {
            stopLoss = support - stopDistance;
            target = entry + channel.width;

            const risk = entry - stopLoss;
            const reward = target - entry;
            const rr = risk / Math.max(0.00000001, reward);

            // Entry zone: lower fraction of channel (above dynamic support)
            const lowerQuarter = support + (channel.width * goldenZoneWidth);
            const inEntryZone = entry >= support && entry <= lowerQuarter;

            return { pass: rr <= maxRR && inEntryZone, rr };
        } else {
            stopLoss = resistance + stopDistance;
            target = entry - channel.width;

            const risk = stopLoss - entry;
            const reward = entry - target;
            const rr = risk / Math.max(0.00000001, reward);

            // Entry zone: upper fraction of channel (below dynamic resistance)
            const upperQuarter = resistance - (channel.width * goldenZoneWidth);
            const inEntryZone = entry <= resistance && entry >= upperQuarter;

            return { pass: rr <= maxRR && inEntryZone, rr };
        }
    }

    private calculateDynamicLeverage(symbol: string, riskLevel: 'VERY_LOW' | 'LOW' | 'MEDIUM', confidence: number): number {
        const leverageMatrix = {
            'VERY_LOW': {
                base: this.getSymbolParam(symbol, 'AMIRO_LEV_VERY_LOW_BASE', 12),
                max: this.getSymbolParam(symbol, 'AMIRO_LEV_VERY_LOW_MAX', 15)
            },
            'LOW': {
                base: this.getSymbolParam(symbol, 'AMIRO_LEV_LOW_BASE', 7),
                max: this.getSymbolParam(symbol, 'AMIRO_LEV_LOW_MAX', 10)
            },
            'MEDIUM': {
                base: this.getSymbolParam(symbol, 'AMIRO_LEV_MEDIUM_BASE', 4),
                max: this.getSymbolParam(symbol, 'AMIRO_LEV_MEDIUM_MAX', 6)
            }
        };

        const config = leverageMatrix[riskLevel];
        const range = config.max - config.base;
        const confidenceBonus = ((confidence - 60) / 40) * range;
        const finalLeverage = config.base + confidenceBonus;

        let calculated = Math.round(Math.min(config.max, Math.max(3, finalLeverage)));
        if (this.isNYSessionActive()) {
            const leverageMult = Number(process.env.NY_FILTER_LEVERAGE_MULTIPLIER || 0.5);
            calculated = Math.round(calculated * leverageMult);
            calculated = Math.max(3, calculated); // Floor it to at least 3x leverage
            logger.info(`[NY Filter] 📉 Reducing leverage for ${symbol} due to peak volatility window: original=${Math.round(finalLeverage)}x, reduced=${calculated}x`);
        }

        return calculated;
    }

    private getSymbolParam(symbol: string, paramKey: string, defaultValue: number): number {
        try {
            const cleanName = symbol.replace(/[\/:]/g, '_');
            const configsDir = path.resolve(process.cwd(), 'configs');
            const configPath = path.resolve(configsDir, `${cleanName}.json`);
            
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                if (config[paramKey] !== undefined) {
                    return Number(config[paramKey]);
                }
            }
        } catch (e: any) {
            // Silently fall back to process.env
        }
        
        return Number(process.env[paramKey] || defaultValue);
    }
}
