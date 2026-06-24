import ccxt from "ccxt";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { logger } from "../logger";
import { OrderManager } from "../execution/orderManager";
import { SignalBroadcaster } from "../services/signalBroadcaster";

export interface TickData {
    symbol: string;
    price: number;
    timestamp: number;
}

export interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

interface PricePoint {
    price: number;
    timestamp: number;
}

interface ActiveTrade {
    symbol: string;
    side: "long" | "short";
    entryPrice: number;       // stored in SOL
    entryPriceUsdt: number;   // stored in USDT (for logging)
    amount: number;
    leverage: number;
    takeProfit: number;
    stopLoss: number;
    timestamp: number;
}

export class MicroTickScalper {
    private exchange: any;
    private orderManager: OrderManager;
    private signalBroadcaster: SignalBroadcaster;
    private dashboardUrl: string;

    // Config: Added SOL/USDT:USDT to symbols stream to dynamically convert everything to SOL!
    private symbols: string[] = ["1000BONK/USDT:USDT", "WIF/USDT:USDT", "POPCAT/USDT:USDT", "BOME/USDT:USDT", "SOL/USDT:USDT"];
    private prices: Map<string, PricePoint[]> = new Map();
    private activeTrades: Map<string, ActiveTrade> = new Map();
    private lastExitTimes: Map<string, number> = new Map();
    private solPrice: number = 150.0;

    // Candlestick Aggregation
    private currentCandles: Map<string, Candle> = new Map();
    private readonly CANDLE_INTERVAL_SEC = 30;

    // ==========================================
    // GOLD-STANDARD TEMPORAL SCALPER CONFIG
    // ==========================================
    private readonly MOMENTUM_WINDOW_MS   = 10000; // 10-second temporal sliding window
    private readonly SPREAD_THRESHOLD_BPS = 8;     // 0.08% breakout threshold over 10 seconds
    private readonly TAKE_PROFIT_BPS      = 15;    // 0.15% Take Profit
    private readonly STOP_LOSS_BPS        = 10;    // 0.10% Stop Loss
    private readonly COOLDOWN_MS          = 30000; // 30-second cooldown
    // ==========================================

    // ── History Logging ────────────────────────────────────────────────
    private readonly HISTORY_FILE = path.resolve(process.cwd(), "microtick_history.json");
    private history: { signals: any[]; stats: any } = {
        signals: [],
        stats: { totalTrades: 0, wins: 0, losses: 0, totalPnL: 0 }
    };
    // ──────────────────────────────────────────────────────────────────

    constructor(orderManager: OrderManager, signalBroadcaster: SignalBroadcaster) {
        this.orderManager      = orderManager;
        this.signalBroadcaster = signalBroadcaster;
        this.dashboardUrl      = `http://localhost:${process.env.DASHBOARD_PORT || 3000}`;

        const exchangeId    = process.env.EXCHANGE_ID || "binance";
        const exchangeClass = ccxt.pro[exchangeId as keyof typeof ccxt.pro] as any;
        this.exchange = new exchangeClass({
            enableRateLimit: true,
            options: { defaultType: "future" }
        });

        this.symbols.forEach(sym => this.prices.set(sym, []));
        this.loadHistory();
    }

    // ── History helpers ──────────────────────────────────────────────
    private loadHistory(): void {
        try {
            if (fs.existsSync(this.HISTORY_FILE)) {
                const raw = fs.readFileSync(this.HISTORY_FILE, "utf-8");
                this.history = JSON.parse(raw);
                logger.info(`[MicroTickScalper] 📂 Loaded ${this.history.signals.length} signals from microtick_history.json`);
            } else {
                this.saveHistory();
                logger.info("[MicroTickScalper] 📂 Created fresh microtick_history.json");
            }
        } catch (e: any) {
            logger.error(`[MicroTickScalper] Failed to load history: ${e.message}`);
        }
    }

    private saveHistory(): void {
        try {
            fs.writeFileSync(this.HISTORY_FILE, JSON.stringify(this.history, null, 2), "utf-8");
        } catch (e: any) {
            logger.error(`[MicroTickScalper] Failed to save history: ${e.message}`);
        }
    }

    private logSignal(signal: Record<string, any>): void {
        this.history.signals.push(signal);
        this.saveHistory();
    }
    // ─────────────────────────────────────────────────────────────────

    public async start() {
        logger.info(`[MicroTickScalper] 🚀 Starting strategy for ${this.symbols.filter(s => s !== "SOL/USDT:USDT").length} tokens with SOL quote-asset stream...`);
        await Promise.all(this.symbols.map(symbol => this.watchSymbol(symbol)));
    }

    private async watchSymbol(symbol: string) {
        logger.info(`[MicroTickScalper] 👀 Subscribing to ${symbol} ticker stream...`);
        while (true) {
            try {
                const ticker = await this.exchange.watchTicker(symbol);
                if (ticker && ticker.last) {
                    const tick: TickData = {
                        symbol,
                        price: ticker.last,
                        timestamp: ticker.timestamp || Date.now()
                    };

                    if (symbol === "SOL/USDT:USDT") {
                        this.solPrice = ticker.last;
                        continue;
                    }

                    this.aggregateCandle(tick);
                    this.onTick(tick);
                }
            } catch (e: any) {
                logger.error(`[MicroTickScalper] WebSocket error for ${symbol}: ${e.message}. Reconnecting...`);
                await new Promise(res => setTimeout(res, 5000));
            }
        }
    }

    private aggregateCandle(tick: TickData) {
        const timestampSeconds = Math.floor(tick.timestamp / 1000);
        const candleTime = timestampSeconds - (timestampSeconds % this.CANDLE_INTERVAL_SEC);
        const priceInSol = tick.price / this.solPrice;
        let currentCandle = this.currentCandles.get(tick.symbol);

        if (!currentCandle || currentCandle.time !== candleTime) {
            currentCandle = { time: candleTime, open: priceInSol, high: priceInSol, low: priceInSol, close: priceInSol };
            this.currentCandles.set(tick.symbol, currentCandle);
        } else {
            currentCandle.high  = Math.max(currentCandle.high, priceInSol);
            currentCandle.low   = Math.min(currentCandle.low, priceInSol);
            currentCandle.close = priceInSol;
        }

        axios.post(`${this.dashboardUrl}/api/internal/candle`, {
            symbol: tick.symbol, candle: currentCandle
        }).catch(() => {});
    }

    private async onTick(tick: TickData) {
        const now     = Date.now();
        const history = this.prices.get(tick.symbol)!;

        history.push({ price: tick.price, timestamp: now });
        const cutoff = now - 60000;
        while (history.length > 0 && history[0].timestamp < cutoff) history.shift();

        const activeTrade = this.activeTrades.get(tick.symbol);
        if (activeTrade) {
            await this.monitorPosition(tick, activeTrade);
        } else {
            const lastExit = this.lastExitTimes.get(tick.symbol) || 0;
            if (now - lastExit < this.COOLDOWN_MS) return;
            if (history.length < 2) return;

            const targetTime = now - this.MOMENTUM_WINDOW_MS;
            let pastPricePoint = history[0];
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].timestamp <= targetTime) { pastPricePoint = history[i]; break; }
            }

            const percentChange = ((tick.price - pastPricePoint.price) / pastPricePoint.price) * 10000; // BPS

            if (percentChange >= this.SPREAD_THRESHOLD_BPS) {
                await this.enterPosition(tick.symbol, tick.price, "long", this.calculateDynamicLeverage(percentChange));
            } else if (percentChange <= -this.SPREAD_THRESHOLD_BPS) {
                await this.enterPosition(tick.symbol, tick.price, "short", this.calculateDynamicLeverage(percentChange));
            }
        }
    }

    private calculateDynamicLeverage(bps: number): number {
        const abs = Math.abs(bps);
        if (abs >= 20) return 25;
        if (abs >= 16) return 20;
        if (abs >= 12) return 15;
        return 10;
    }

    private async enterPosition(symbol: string, currentPriceUsdt: number, side: "long" | "short", leverage: number) {
        const currentPriceSol = currentPriceUsdt / this.solPrice;

        const takeProfitSol = side === "long"
            ? currentPriceSol * (1 + (this.TAKE_PROFIT_BPS / 10000))
            : currentPriceSol * (1 - (this.TAKE_PROFIT_BPS / 10000));

        const stopLossSol = side === "long"
            ? currentPriceSol * (1 - (this.STOP_LOSS_BPS / 10000))
            : currentPriceSol * (1 + (this.STOP_LOSS_BPS / 10000));

        const amount = 100;

        const newTrade: ActiveTrade = {
            symbol,
            side,
            entryPrice:     currentPriceSol,   // SOL (for TP/SL comparison)
            entryPriceUsdt: currentPriceUsdt,  // USDT (for logging)
            amount,
            leverage,
            takeProfit: takeProfitSol,
            stopLoss:   stopLossSol,
            timestamp:  Date.now()
        };

        this.activeTrades.set(symbol, newTrade);
        logger.info(`[MicroTickScalper] 🎯 ENTRY: ${side.toUpperCase()} ${symbol} at $${currentPriceUsdt.toFixed(6)} | ${leverage}x`);

        // 1. Log entry to microtick_history.json
        this.logSignal({
            symbol,
            type: side === "long" ? "BUY" : "SELL",
            price: currentPriceUsdt,   // USDT for report compatibility
            leverage,
            time: Math.floor(Date.now() / 1000),
            strategy: "MicroTickScalper"
        });

        // 2. Broadcast signal
        await this.signalBroadcaster.broadcastSignal({
            symbol, side,
            entryPrice: currentPriceSol,
            leverage,
            takeProfit: takeProfitSol,
            stopLoss:   stopLossSol,
            timestamp:  Date.now()
        });

        // 3. Dashboard chart marker
        axios.post(`${this.dashboardUrl}/api/internal/signal`, {
            symbol, type: side === "long" ? "BUY" : "SELL",
            price: currentPriceSol, leverage,
            time: Math.floor(Date.now() / 1000),
            tp: takeProfitSol,
            sl: stopLossSol
        }).catch(() => {});

        // 4. Execute order
        await this.orderManager.executeMarketOrder(symbol, side === "long" ? "buy" : "sell", amount);
    }

    private async monitorPosition(tick: TickData, trade: ActiveTrade) {
        const currentPriceSol = tick.price / this.solPrice;
        let triggerExit = false;
        let exitReason: "TP" | "SL" = "TP";

        if (trade.side === "long") {
            if (currentPriceSol >= trade.takeProfit) { triggerExit = true; exitReason = "TP"; }
            else if (currentPriceSol <= trade.stopLoss) { triggerExit = true; exitReason = "SL"; }
        } else {
            if (currentPriceSol <= trade.takeProfit) { triggerExit = true; exitReason = "TP"; }
            else if (currentPriceSol >= trade.stopLoss) { triggerExit = true; exitReason = "SL"; }
        }

        if (triggerExit) {
            this.activeTrades.delete(tick.symbol);
            this.lastExitTimes.set(tick.symbol, Date.now());

            // Convert exit price to USDT for logging
            const exitPriceUsdt = currentPriceSol * this.solPrice;
            const tradeSize     = Number(process.env.AMIRO_TRADE_SIZE_USDT || 50);

            const pnlPct = trade.side === "long"
                ? ((exitPriceUsdt - trade.entryPriceUsdt) / trade.entryPriceUsdt) * 100 * trade.leverage
                : ((trade.entryPriceUsdt - exitPriceUsdt) / trade.entryPriceUsdt) * 100 * trade.leverage;
            const pnlUSDT = tradeSize * (pnlPct / 100);

            logger.info(`[MicroTickScalper] 🚪 EXIT (${exitReason}) ${trade.symbol} | Entry: $${trade.entryPriceUsdt.toFixed(6)} → Exit: $${exitPriceUsdt.toFixed(6)} | PnL: ${pnlPct.toFixed(2)}% (${pnlUSDT.toFixed(4)} USDT)`);

            // 1. Log exit to microtick_history.json
            this.logSignal({
                symbol: trade.symbol,
                type: trade.side === "long" ? "SELL_EXIT" : "BUY_EXIT",
                price: exitPriceUsdt,    // USDT for report compatibility
                time: Math.floor(Date.now() / 1000),
                exitReason,
                fullyExited: true,       // MicroTickScalper always fully exits in one step
                strategy: "MicroTickScalper"
            });

            // Update stats
            this.history.stats.totalTrades += 1;
            if (pnlUSDT > 0) this.history.stats.wins += 1;
            else this.history.stats.losses += 1;
            this.history.stats.totalPnL = (this.history.stats.totalPnL || 0) + pnlUSDT;
            this.saveHistory();

            // 2. Dashboard chart marker
            axios.post(`${this.dashboardUrl}/api/internal/signal`, {
                symbol: trade.symbol,
                type: trade.side === "long" ? "SELL_EXIT" : "BUY_EXIT",
                price: currentPriceSol,
                time: Math.floor(Date.now() / 1000),
                exitReason
            }).catch(() => {});

            // 3. Execute exit order
            await this.orderManager.executeMarketOrder(trade.symbol, trade.side === "long" ? "sell" : "buy", trade.amount);
        }
    }
}
