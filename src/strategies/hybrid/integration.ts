/**
 * Hybrid Strategy Integration with Main Sniper Bot
 * Example of how to integrate the hybrid strategy
 */

import { Connection, Keypair } from '@solana/web3.js';
import { logger } from '../../logger';
import { HybridStrategyManager, HybridStrategyConfig } from './hybridStrategyManager';

/**
 * Initialize hybrid strategy manager
 */
export function initializeHybridStrategy(
  connection: Connection,
  keypair: Keypair,
  config?: Partial<HybridStrategyConfig>
): HybridStrategyManager {
  const manager = new HybridStrategyManager(connection, keypair, config);
  return manager;
}

/**
 * Example integration in sniper-bot.ts
 * 
 * Add this to your main sniper-bot.ts flow:
 * 
 * ```typescript
 * import { initializeHybridStrategy } from './strategies/hybrid/integration';
 * 
 * // In main() or after loading wallet:
 * const hybridManager = initializeHybridStrategy(
 *   connection,
 *   keypair,
 *   {
 *     spotBuyAmount: 0.05, // Override default 0.1 SOL
 *     futuresLeverage: 2, // More conservative
 *     executionMode: 'MODERATE',
 *   }
 * );
 * 
 * // When you detect a new token (in handleLogNotification):
 * const newTokenResult = await hybridManager.processNewToken(
 *   newPoolTokenMint,    // From extraction
 *   tokenMetadata.symbol, // From metadata fetch
 *   poolAddress,         // From pool info
 *   initialPrice,        // Current price
 *   buyVolume,           // From on-chain data
 *   sellVolume,          // From on-chain data
 *   recentBuyers         // From buyer tracking
 * );
 * 
 * if (newTokenResult.success && newTokenResult.signal) {
 *   logger.info(`Signal generated: ${newTokenResult.signal.action}`);
 * }
 * 
 * // When price updates (in WebSocket or price monitor):
 * priceMonitor.on('priceUpdate', async (update) => {
 *   await hybridManager.updatePrice(
 *     update.baseMint,
 *     update.symbol,
 *     update.priceInSol,
 *     update.buyVolume,
 *     update.sellVolume,
 *     update.buyerCount,
 *     update.whaleActivity
 *   );
 * });
 * 
 * // Get status periodically:
 * setInterval(() => {
 *   logger.info(hybridManager.getStatus());
 * }, 30000); // Every 30 seconds
 * ```
 */

/**
 * Example configuration for different scenarios
 */
export const HYBRID_CONFIG_PRESETS = {
  // Conservative: Lower risk, slower profits
  CONSERVATIVE: {
    spotBuyAmount: 0.05,
    futuresLeverage: 2,
    executionMode: 'CONSERVATIVE',
    maxDrawdownPercent: 10,
    circuitBreakerLossPercent: 15,
    spotMaxConcurrentPositions: 2,
    futuresMaxConcurrentPositions: 1,
  } as Partial<HybridStrategyConfig>,

  // Moderate: Balanced risk/reward (DEFAULT)
  MODERATE: {
    spotBuyAmount: 0.1,
    futuresLeverage: 3,
    executionMode: 'MODERATE',
    maxDrawdownPercent: 20,
    circuitBreakerLossPercent: 30,
    spotMaxConcurrentPositions: 3,
    futuresMaxConcurrentPositions: 2,
  } as Partial<HybridStrategyConfig>,

  // Aggressive: Higher risk, faster profits
  AGGRESSIVE: {
    spotBuyAmount: 0.2,
    futuresLeverage: 5,
    executionMode: 'AGGRESSIVE',
    maxDrawdownPercent: 30,
    circuitBreakerLossPercent: 50,
    spotMaxConcurrentPositions: 5,
    futuresMaxConcurrentPositions: 3,
  } as Partial<HybridStrategyConfig>,
};

/**
 * Helper: Calculate expected profit from token lifecycle
 */
export function calculateExpectedProfit(
  initialPrice: number,
  pumpPercentage: number,
  dumpPercentage: number,
  spotBuyAmount: number,
  spotPosition: number, // tokens bought
  futuresLeverage: number
): {
  spotProfit: number;
  futuresProfit: number;
  totalProfit: number;
  roi: number;
} {
  // PUMP phase: spot position gains
  const pumpPrice = initialPrice * (1 + pumpPercentage / 100);
  const spotProfit = spotPosition * (pumpPrice - initialPrice);

  // DUMP phase: short position gains (reduced due to pumpback)
  const dumpPrice = pumpPrice * (1 + dumpPercentage / 100);
  const shortPayoff = (pumpPrice - dumpPrice) * futuresLeverage * (spotBuyAmount / initialPrice);
  const futuresProfit = shortPayoff;

  const totalProfit = spotProfit + futuresProfit;
  const roi = (totalProfit / spotBuyAmount) * 100;

  return {
    spotProfit,
    futuresProfit,
    totalProfit,
    roi,
  };
}

/**
 * Helper: Simulate strategy on historical data
 */
export function simulateStrategy(
  tokenData: Array<{
    time: number;
    price: number;
    buyVolume: number;
    sellVolume: number;
    buyerCount: number;
  }>,
  config: Partial<HybridStrategyConfig> = {}
): {
  trades: Array<any>;
  totalPnL: number;
  winRate: number;
  maxDrawdown: number;
} {
  // This would implement backtesting logic
  // Placeholder for now
  logger.warn('[BACKTEST] Backtesting simulation not yet implemented');

  return {
    trades: [],
    totalPnL: 0,
    winRate: 0,
    maxDrawdown: 0,
  };
}

export { HybridStrategyManager } from './hybridStrategyManager';
export type { HybridStrategyConfig, StrategySignal, HybridPosition } from './types';
