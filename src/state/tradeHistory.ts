// src/state/tradeHistory.ts

import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export interface TradeRecord {
  id: string;
  timestamp: number;
  mint: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  
  // Entry details
  entryPrice?: number;
  entryAmount?: number;
  entrySolAmount?: number;
  buySignature?: string;
  
  // Exit details
  exitPrice?: number;
  exitAmount?: number;
  exitSolAmount?: number;
  sellSignature?: string;
  
  // Performance
  profitLoss?: number;
  profitLossPercent?: number;
  
  // Context
  liquidityUsd?: number;
  creator?: string;
  exitReason?: string;
  
  // AI Decision
  aiReasoning?: string;
  aiConfidence?: number;
}

export interface TradeStatistics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalProfitLoss: number;
  averageProfitLoss: number;
  bestTrade: number;
  worstTrade: number;
  averageHoldTime?: number;
}

export interface CreatorPerformance {
  creator: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfitLoss: number;
}

class TradeHistory {
  private historyFile: string;
  private trades: Map<string, TradeRecord> = new Map();
  private maxRecords: number = 1000;

  constructor(historyFilePath?: string) {
    this.historyFile = historyFilePath || path.join(process.cwd(), 'trade-history.json');
    this.loadHistory();
  }

  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, 'utf-8');
        const records: TradeRecord[] = JSON.parse(data);
        records.forEach(record => {
          this.trades.set(record.id, record);
        });
        logger.info(`[TradeHistory] Loaded ${this.trades.size} trade records`);
      }
    } catch (error: any) {
      logger.error(`[TradeHistory] Error loading history: ${error?.message ?? error}`);
    }
  }

  private saveHistory(): void {
    try {
      const records = Array.from(this.trades.values());
      // Keep only the most recent records
      const sortedRecords = records
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, this.maxRecords);
      
      fs.writeFileSync(this.historyFile, JSON.stringify(sortedRecords, null, 2));
    } catch (error: any) {
      logger.error(`[TradeHistory] Error saving history: ${error?.message ?? error}`);
    }
  }

  recordBuy(params: {
    mint: string;
    symbol: string;
    entryPrice: number;
    entryAmount: number;
    entrySolAmount: number;
    buySignature: string;
    liquidityUsd?: number;
    creator?: string;
    aiReasoning?: string;
    aiConfidence?: number;
  }): string {
    const id = `${params.mint}-${Date.now()}`;
    const record: TradeRecord = {
      id,
      timestamp: Date.now(),
      mint: params.mint,
      symbol: params.symbol,
      action: 'BUY',
      entryPrice: params.entryPrice,
      entryAmount: params.entryAmount,
      entrySolAmount: params.entrySolAmount,
      buySignature: params.buySignature,
      liquidityUsd: params.liquidityUsd,
      creator: params.creator,
      aiReasoning: params.aiReasoning,
      aiConfidence: params.aiConfidence,
    };

    this.trades.set(id, record);
    this.saveHistory();
    logger.info(`[TradeHistory] Recorded BUY: ${params.symbol} (${id})`);
    return id;
  }

  recordSell(params: {
    mint: string;
    exitPrice: number;
    exitAmount: number;
    exitSolAmount: number;
    sellSignature: string;
    exitReason: string;
  }): void {
    // Find the most recent buy for this mint
    const buyRecord = Array.from(this.trades.values())
      .filter(t => t.mint === params.mint && t.action === 'BUY' && !t.exitPrice)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (!buyRecord) {
      logger.warn(`[TradeHistory] No matching BUY found for SELL: ${params.mint}`);
      return;
    }

    // Update the buy record with exit details
    buyRecord.exitPrice = params.exitPrice;
    buyRecord.exitAmount = params.exitAmount;
    buyRecord.exitSolAmount = params.exitSolAmount;
    buyRecord.sellSignature = params.sellSignature;
    buyRecord.exitReason = params.exitReason;

    // Calculate profit/loss
    if (buyRecord.entrySolAmount && params.exitSolAmount) {
      buyRecord.profitLoss = params.exitSolAmount - buyRecord.entrySolAmount;
      buyRecord.profitLossPercent = (buyRecord.profitLoss / buyRecord.entrySolAmount) * 100;
    }

    this.saveHistory();
    logger.info(
      `[TradeHistory] Recorded SELL: ${buyRecord.symbol} | P/L: ${buyRecord.profitLoss?.toFixed(4)} SOL (${buyRecord.profitLossPercent?.toFixed(2)}%)`
    );
  }

  getRecentTrades(limit: number = 10): TradeRecord[] {
    return Array.from(this.trades.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  getStatistics(lookbackHours: number = 24): TradeStatistics {
    const cutoffTime = Date.now() - lookbackHours * 60 * 60 * 1000;
    const recentTrades = Array.from(this.trades.values())
      .filter(t => t.timestamp >= cutoffTime && t.profitLoss !== undefined);

    const totalTrades = recentTrades.length;
    const winningTrades = recentTrades.filter(t => (t.profitLoss ?? 0) > 0).length;
    const losingTrades = recentTrades.filter(t => (t.profitLoss ?? 0) < 0).length;
    const totalProfitLoss = recentTrades.reduce((sum, t) => sum + (t.profitLoss ?? 0), 0);

    const profitLosses = recentTrades.map(t => t.profitLoss ?? 0);
    const bestTrade = profitLosses.length > 0 ? Math.max(...profitLosses) : 0;
    const worstTrade = profitLosses.length > 0 ? Math.min(...profitLosses) : 0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
      totalProfitLoss,
      averageProfitLoss: totalTrades > 0 ? totalProfitLoss / totalTrades : 0,
      bestTrade,
      worstTrade,
    };
  }

  getCreatorPerformance(lookbackHours: number = 168): CreatorPerformance[] {
    const cutoffTime = Date.now() - lookbackHours * 60 * 60 * 1000;
    const recentTrades = Array.from(this.trades.values())
      .filter(t => t.timestamp >= cutoffTime && t.creator && t.profitLoss !== undefined);

    const creatorMap = new Map<string, { trades: TradeRecord[] }>();
    
    recentTrades.forEach(trade => {
      const creator = trade.creator!;
      if (!creatorMap.has(creator)) {
        creatorMap.set(creator, { trades: [] });
      }
      creatorMap.get(creator)!.trades.push(trade);
    });

    const performance: CreatorPerformance[] = [];
    creatorMap.forEach((data, creator) => {
      const trades = data.trades.length;
      const wins = data.trades.filter(t => (t.profitLoss ?? 0) > 0).length;
      const losses = data.trades.filter(t => (t.profitLoss ?? 0) < 0).length;
      const totalProfitLoss = data.trades.reduce((sum, t) => sum + (t.profitLoss ?? 0), 0);

      performance.push({
        creator,
        trades,
        wins,
        losses,
        winRate: trades > 0 ? (wins / trades) * 100 : 0,
        totalProfitLoss,
      });
    });

    return performance.sort((a, b) => b.totalProfitLoss - a.totalProfitLoss);
  }

  getTradesByMint(mint: string): TradeRecord[] {
    return Array.from(this.trades.values())
      .filter(t => t.mint === mint)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  clear(): void {
    this.trades.clear();
    this.saveHistory();
    logger.info('[TradeHistory] Cleared all trade history');
  }
}

// Singleton instance
let tradeHistoryInstance: TradeHistory | null = null;

export function getTradeHistory(): TradeHistory {
  if (!tradeHistoryInstance) {
    tradeHistoryInstance = new TradeHistory();
  }
  return tradeHistoryInstance;
}

export { TradeHistory };
