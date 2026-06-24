import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';

export interface TradeContext {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    leverage: number;
    riskLevel: 'VERY_LOW' | 'LOW' | 'MEDIUM';
    confidence: number;
    channelWidth: number;
    channelWidthPct: number;
    macroTrend: string;
    structuralTrend: string;
    tradingTrend: string;
    atr: number;
    atrPct: number;
    slPrice: number;
    slDistancePct: number;
    tp1Price: number;
    tp1DistancePct: number;
}

export interface TradeExit {
    reason: string;
    price: number;
    pnlPct: number;
    pnlUsdt: number;
    timestamp: number;
    fullyExited: boolean;
}

export type TradeOutcome = 'WIN' | 'LOSS' | 'PARTIAL_WIN' | 'BREAKEVEN';

export interface TradeMemoryEntry {
    id: string;
    timestamp: number;
    context: TradeContext;
    exits: TradeExit[];
    finalPnlPct: number;
    finalPnlUsdt: number;
    outcome: TradeOutcome;
    closed: boolean;
    durationSeconds: number;
}

export class TradeMemory {
    private readonly FILE = path.resolve(process.cwd(), 'trade_memory.json');
    private trades: TradeMemoryEntry[] = [];

    constructor() {
        this.load();
    }

    private load(): void {
        try {
            if (fs.existsSync(this.FILE)) {
                this.trades = JSON.parse(fs.readFileSync(this.FILE, 'utf-8'));
                logger.info(`[TradeMemory] Loaded ${this.trades.length} historical trades`);
            } else {
                this.save();
                logger.info('[TradeMemory] Created fresh trade_memory.json');
            }
        } catch (e: any) {
            logger.error(`[TradeMemory] Load error: ${e.message}`);
            this.trades = [];
        }
    }

    private save(): void {
        try {
            fs.writeFileSync(this.FILE, JSON.stringify(this.trades, null, 2), 'utf-8');
        } catch (e: any) {
            logger.error(`[TradeMemory] Save error: ${e.message}`);
        }
    }

    openTrade(context: TradeContext, debugSnapshot?: any): string {
        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const entry: TradeMemoryEntry = {
            id,
            timestamp: Math.floor(Date.now() / 1000),
            context,
            exits: [],
            finalPnlPct: 0,
            finalPnlUsdt: 0,
            outcome: 'LOSS',
            closed: false,
            durationSeconds: 0
        };
        this.trades.push(entry);
        this.save();

        if (debugSnapshot) {
            try {
                const debugDir = path.resolve(process.cwd(), 'signal_debug_data');
                if (!fs.existsSync(debugDir)) {
                    fs.mkdirSync(debugDir, { recursive: true });
                }
                const debugPath = path.resolve(debugDir, `${id}.json`);
                // Inject the generated tradeId into the snapshot
                debugSnapshot.tradeId = id;
                fs.writeFileSync(debugPath, JSON.stringify(debugSnapshot, null, 2), 'utf-8');
                logger.info(`[TradeMemory] Saved signal detailed debug calculations to ${debugPath}`);
            } catch (e: any) {
                logger.error(`[TradeMemory] Failed to save debug snapshot: ${e.message}`);
            }
        }

        logger.info(`[TradeMemory] Opened trade ${id} for ${context.symbol}`);
        return id;
    }

    addExit(tradeId: string, exit: TradeExit): void {
        const trade = this.trades.find(t => t.id === tradeId);
        if (!trade) return;
        trade.exits.push(exit);
        trade.finalPnlPct += exit.pnlPct;
        trade.finalPnlUsdt += exit.pnlUsdt;
        if (exit.fullyExited) {
            trade.closed = true;
            trade.durationSeconds = Math.floor(Date.now() / 1000) - trade.timestamp;
            trade.outcome = this.determineOutcome(trade.finalPnlUsdt);
            logger.info(`[TradeMemory] Closed trade ${tradeId} | Outcome: ${trade.outcome} | PnL: ${trade.finalPnlUsdt.toFixed(4)} USDT`);
        }
        this.save();
    }

    private determineOutcome(pnlUsdt: number): TradeOutcome {
        if (pnlUsdt > 0.5) return 'WIN';
        if (pnlUsdt < -0.1) return 'LOSS';
        if (pnlUsdt >= 0 && pnlUsdt <= 0.5) return 'PARTIAL_WIN';
        return 'BREAKEVEN';
    }

    getClosedTrades(): TradeMemoryEntry[] {
        return this.trades.filter(t => t.closed);
    }

    getAll(): TradeMemoryEntry[] {
        return this.trades;
    }

    countClosed(): number {
        return this.getClosedTrades().length;
    }
}
