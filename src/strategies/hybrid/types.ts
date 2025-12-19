/**
 * Hybrid Strategy Types
 * For capturing gains from token lifecycle (pump + dump)
 */

export type LifecyclePhase = 'INITIAL_PUMP' | 'ACCUMULATION' | 'DISTRIBUTION' | 'DUMP' | 'DEAD';

export interface TokenLifecycleMetrics {
  mint: string;
  symbol: string;
  phaseStartTime: number;
  currentPhase: LifecyclePhase;
  
  // Price progression
  entryPrice: number;
  highestPrice: number;
  currentPrice: number;
  lowestPrice: number;
  
  // Volatility & movement
  volatilityPercent: number;
  priceChangePercent: number;
  timeInPhaseSeconds: number;
  
  // Market signals
  buyVolume: number;
  sellVolume: number;
  buyerCount: number;
  sellerCount: number;
  whaleActivity: boolean;
  
  // Confidence metrics
  phaseConfidence: number; // 0-100
  timeUntilNextPhaseSeconds: number;
}

export interface StrategySignal {
  action: 'BUY_SPOT' | 'SELL_SPOT' | 'OPEN_SHORT' | 'CLOSE_SHORT' | 'OPEN_LONG' | 'CLOSE_LONG' | 'HOLD' | 'EXIT_ALL';
  phase: LifecyclePhase;
  confidence: number; // 0-100
  reason: string;
  
  // Position parameters
  spotAmount?: number; // SOL amount for spot trade
  leverageMultiplier?: number; // For futures (e.g., 2x, 5x)
  stopLossPercent?: number;
  takeProfitPercent?: number;
  
  // Timing
  expectedDurationSeconds?: number;
  exitAtPhaseShift?: boolean;
}

export interface HybridPosition {
  mint: string;
  symbol: string;
  
  // Spot position
  spotTokenAmount: number;
  spotBuyPrice: number;
  spotBuyTime: number;
  spotCurrentPrice: number;
  spotPnL: number;
  spotPnLPercent: number;
  
  // Futures position (if active)
  futuresOpen: boolean;
  futuresDirection: 'LONG' | 'SHORT' | null;
  futuresEntryPrice: number;
  futuresLeverage: number;
  futuresOpenTime: number;
  futuresCurrentPrice: number;
  futuresPnL: number;
  futuresPnLPercent: number;
  
  // Combined metrics
  combinedPnL: number;
  combinedPnLPercent: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  
  // Lifecycle tracking
  phases: PhaseTransition[];
}

export interface PhaseTransition {
  fromPhase: LifecyclePhase;
  toPhase: LifecyclePhase;
  transitionTime: number;
  priceAtTransition: number;
  priceChangePercent: number;
}

export interface StrategyMetrics {
  totalTokensTraded: number;
  successfulTrades: number;
  failedTrades: number;
  winRate: number; // percentage
  
  spotTradingPnL: number;
  futuresTradingPnL: number;
  totalPnL: number;
  
  largestWin: number;
  largestLoss: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number; // totalWins / totalLosses
  
  averageHoldTime: number; // seconds
  totalTradeTime: number;
}

export interface HybridStrategyConfig {
  // Phase detection thresholds
  pumpThresholdPercent: number; // e.g., 50% = considered pump
  dumpThresholdPercent: number; // e.g., -30% = considered dump
  phaseDetectionWindowSeconds: number; // e.g., 300 for 5-min window
  
  // Spot trading
  spotBuyAmount: number; // SOL
  spotMaxConcurrentPositions: number;
  spotAutoSellAfterMinutes: number;
  
  // Futures trading
  futuresLeverage: number; // e.g., 3x, 5x (be careful!)
  futuresMaxConcurrentPositions: number;
  futuresMaxLossPercent: number; // liquidation protection
  
  // Risk management
  maxDrawdownPercent: number;
  circuitBreakerLossPercent: number; // Stop all trading if hit
  riskPerTradePercent: number; // Risk percentage of total capital
  
  // Timing
  minHoldTimeSeconds: number;
  maxHoldTimeSeconds: number;
  earlyExitAfterPhaseShiftSeconds: number;
  
  // Execution
  executionMode: 'AGGRESSIVE' | 'MODERATE' | 'CONSERVATIVE';
  slippageBps: number;
  maxRetries: number;
}

/**
 * Detailed phase detection results
 */
export interface PhaseDetectionResult {
  currentPhase: LifecyclePhase;
  confidence: number; // 0-100
  signals: {
    priceAction: string;
    volumePattern: string;
    whaleActivity: string;
    buyerMomentum: string;
    timeInCurrent: string;
  };
  estimatedTransitionTime: number; // milliseconds until phase shift
  recommendation: string;
}
