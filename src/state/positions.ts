// src/state/positions.ts
import fs from "fs";
import path from "path";

const POSITIONS_FILE = path.join(__dirname, "positions.json");

export type PositionStatus = "OPEN" | "CLOSED";

export interface Position {
  id: string;
  pool: string;
  baseMint: string;
  quoteMint: string;
  buySignature: string;
  buyAmountLamports: number;
  tokenAmount?: number;      // Amount of tokens bought
  buyPriceInQuote: number;   // قیمت خرید بر حسب WSOL یا USD (هرچی داری)
  tpPercent: number;
  slPercent: number;
  openedAt: number;
  closedAt?: number;
  closeSignature?: string;
  closePriceInQuote?: number;
  status: PositionStatus;
  realizedPnlQuote?: number;  // سود/ضرر واقعی
  creator?: string; // Token creator address
}

export interface PortfolioMetrics {
  totalPositions: number;
  openPositions: number;
  totalCapitalDeployed: number; // in SOL
  diversification: {
    uniqueTokens: number;
    uniqueCreators: number;
    largestPositionPercent: number;
    concentrationRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  performance: {
    totalPnL: number;
    averagePnL: number;
    winRate: number;
    bestPosition: number;
    worstPosition: number;
  };
  riskMetrics: {
    maxDrawdown: number;
    averagePositionSize: number;
    capitalUtilization: number; // % of max capital used
  };
}

export interface CapitalAllocation {
  availableCapital: number;
  recommendedPositionSize: number;
  maxPositionSize: number;
  shouldReduceExposure: boolean;
  reason: string;
}

function readAll(): Position[] {
  if (!fs.existsSync(POSITIONS_FILE)) return [];
  return JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf8"));
}

function writeAll(positions: Position[]) {
  fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
}

export function getOpenPositions(): Position[] {
  return readAll().filter((p) => p.status === "OPEN");
}

export function getAllPositions(): Position[] {
  return readAll();
}

export function saveNewPosition(pos: Omit<Position, "id" | "status">) {
  const all = readAll();
  const id = `${pos.pool}-${Date.now()}`;
  const newPos: Position = { ...pos, id, status: "OPEN" };
  all.push(newPos);
  writeAll(all);
  return newPos;
}

export function closePosition(id: string, data: {
  closeSignature: string;
  closePriceInQuote: number;
}) {
  const all = readAll();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return;

  const p = all[idx];
  const priceChange =
    (data.closePriceInQuote - p.buyPriceInQuote) / p.buyPriceInQuote;
  const realizedPnl = priceChange * (p.buyAmountLamports / 1e9); // اگر quote = SOL

  all[idx] = {
    ...p,
    status: "CLOSED",
    closedAt: Date.now(),
    closeSignature: data.closeSignature,
    closePriceInQuote: data.closePriceInQuote,
    realizedPnlQuote: realizedPnl,
  };

  writeAll(all);
  return all[idx];
}

/**
 * Get comprehensive portfolio metrics
 */
export function getPortfolioMetrics(): PortfolioMetrics {
  const all = readAll();
  const open = all.filter(p => p.status === "OPEN");
  const closed = all.filter(p => p.status === "CLOSED");

  // Calculate total capital deployed
  const totalCapitalDeployed = open.reduce((sum, p) => sum + (p.buyAmountLamports / 1e9), 0);

  // Diversification metrics
  const uniqueTokens = new Set(open.map(p => p.baseMint)).size;
  const uniqueCreators = new Set(open.map(p => p.creator).filter(Boolean)).size;

  const positionSizes = open.map(p => p.buyAmountLamports / 1e9);
  const largestPosition = Math.max(...positionSizes, 0);
  const largestPositionPercent = totalCapitalDeployed > 0
    ? (largestPosition / totalCapitalDeployed) * 100
    : 0;

  let concentrationRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  if (largestPositionPercent > 40 || uniqueTokens < 3) {
    concentrationRisk = 'HIGH';
  } else if (largestPositionPercent > 25 || uniqueTokens < 5) {
    concentrationRisk = 'MEDIUM';
  } else {
    concentrationRisk = 'LOW';
  }

  // Performance metrics
  const closedWithPnL = closed.filter(p => p.realizedPnlQuote !== undefined);
  const totalPnL = closedWithPnL.reduce((sum, p) => sum + (p.realizedPnlQuote || 0), 0);
  const averagePnL = closedWithPnL.length > 0 ? totalPnL / closedWithPnL.length : 0;
  const winners = closedWithPnL.filter(p => (p.realizedPnlQuote || 0) > 0).length;
  const winRate = closedWithPnL.length > 0 ? (winners / closedWithPnL.length) * 100 : 0;
  const bestPosition = Math.max(...closedWithPnL.map(p => p.realizedPnlQuote || 0), 0);
  const worstPosition = Math.min(...closedWithPnL.map(p => p.realizedPnlQuote || 0), 0);

  // Risk metrics
  const averagePositionSize = open.length > 0
    ? totalCapitalDeployed / open.length
    : 0;

  const maxCapital = 2.0; // Maximum 2 SOL total exposure
  const capitalUtilization = (totalCapitalDeployed / maxCapital) * 100;

  // Calculate max drawdown (simplified)
  let maxDrawdown = 0;
  if (closedWithPnL.length > 0) {
    const pnls = closedWithPnL.map(p => p.realizedPnlQuote || 0);
    let peak = 0;
    let runningSum = 0;
    for (const pnl of pnls) {
      runningSum += pnl;
      peak = Math.max(peak, runningSum);
      const drawdown = peak - runningSum;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
  }

  return {
    totalPositions: all.length,
    openPositions: open.length,
    totalCapitalDeployed,
    diversification: {
      uniqueTokens,
      uniqueCreators,
      largestPositionPercent,
      concentrationRisk,
    },
    performance: {
      totalPnL,
      averagePnL,
      winRate,
      bestPosition,
      worstPosition,
    },
    riskMetrics: {
      maxDrawdown,
      averagePositionSize,
      capitalUtilization,
    },
  };
}

/**
 * Get capital allocation recommendation
 */
export function getCapitalAllocation(
  basePositionSize: number = 0.2 // Base 0.2 SOL
): CapitalAllocation {
  const metrics = getPortfolioMetrics();
  const maxTotalCapital = 2.0; // Max 2 SOL total
  const maxSinglePosition = 0.3; // Max 0.3 SOL per position

  const availableCapital = maxTotalCapital - metrics.totalCapitalDeployed;

  let recommendedPositionSize = basePositionSize;
  let shouldReduceExposure = false;
  let reason = "Normal capital allocation";

  // Adjust based on capital utilization
  if (metrics.riskMetrics.capitalUtilization > 80) {
    recommendedPositionSize = Math.min(basePositionSize * 0.5, availableCapital);
    shouldReduceExposure = true;
    reason = "High capital utilization (>80%), reducing position size";
  } else if (metrics.riskMetrics.capitalUtilization > 60) {
    recommendedPositionSize = Math.min(basePositionSize * 0.7, availableCapital);
    reason = "Moderate capital utilization (>60%), slightly reducing position size";
  }

  // Adjust based on concentration risk
  if (metrics.diversification.concentrationRisk === 'HIGH') {
    recommendedPositionSize *= 0.6;
    shouldReduceExposure = true;
    reason = "High concentration risk, reducing position size for diversification";
  } else if (metrics.diversification.concentrationRisk === 'MEDIUM') {
    recommendedPositionSize *= 0.8;
    reason = "Medium concentration risk, slightly reducing position size";
  }

  // Adjust based on performance
  if (metrics.performance.winRate < 40 && metrics.totalPositions > 5) {
    recommendedPositionSize *= 0.7;
    shouldReduceExposure = true;
    reason = "Low win rate (<40%), reducing position size";
  }

  // Ensure we don't exceed available capital
  recommendedPositionSize = Math.min(recommendedPositionSize, availableCapital);

  // Ensure we don't exceed max single position
  recommendedPositionSize = Math.min(recommendedPositionSize, maxSinglePosition);

  // Don't allow new positions if no capital available
  if (availableCapital <= 0.05) {
    recommendedPositionSize = 0;
    shouldReduceExposure = true;
    reason = "No available capital, portfolio is fully deployed";
  }

  return {
    availableCapital,
    recommendedPositionSize,
    maxPositionSize: maxSinglePosition,
    shouldReduceExposure,
    reason,
  };
}

/**
 * Check if we should skip a new position due to portfolio constraints
 */
export function shouldSkipNewPosition(newTokenMint: string, newCreator?: string): {
  shouldSkip: boolean;
  reason: string;
} {
  const open = getOpenPositions();
  const metrics = getPortfolioMetrics();

  // Check if already have position in this token
  const existingPosition = open.find(p => p.baseMint === newTokenMint);
  if (existingPosition) {
    return {
      shouldSkip: true,
      reason: "Already have an open position in this token",
    };
  }

  // Check if too many positions from same creator
  if (newCreator) {
    const creatorPositions = open.filter(p => p.creator === newCreator).length;
    if (creatorPositions >= 2) {
      return {
        shouldSkip: true,
        reason: `Already have ${creatorPositions} positions from this creator`,
      };
    }
  }

  // Check capital utilization
  if (metrics.riskMetrics.capitalUtilization > 90) {
    return {
      shouldSkip: true,
      reason: "Portfolio capital utilization >90%, no room for new positions",
    };
  }

  // Check max open positions
  if (open.length >= 10) {
    return {
      shouldSkip: true,
      reason: "Maximum 10 open positions reached",
    };
  }

  return {
    shouldSkip: false,
    reason: "Portfolio has room for new position",
  };
}
