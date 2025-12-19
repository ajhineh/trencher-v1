/**
 * Hybrid Strategy Manager
 * Main orchestrator for the hybrid spot + futures trading strategy
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { logger } from '../../logger';
import { sendTelegram } from '../../telegram';
import {
  StrategySignal,
  HybridPosition,
  HybridStrategyConfig,
  StrategyMetrics,
} from './types';
import { LifecyclePhaseDetector } from './lifecyclePhaseDetector';
import { HybridStrategySignalGenerator } from './signalGenerator';
import { HybridStrategyExecutor, ExecutionResult } from './executor';

const DEFAULT_CONFIG: HybridStrategyConfig = {
  // Phase detection
  pumpThresholdPercent: 50,
  dumpThresholdPercent: -30,
  phaseDetectionWindowSeconds: 300, // 5 minutes
  
  // Spot trading
  spotBuyAmount: 0.1, // 0.1 SOL per trade
  spotMaxConcurrentPositions: 3,
  spotAutoSellAfterMinutes: 30,
  
  // Futures trading
  futuresLeverage: 3,
  futuresMaxConcurrentPositions: 2,
  futuresMaxLossPercent: 10, // Liquidation protection
  
  // Risk management
  maxDrawdownPercent: 20,
  circuitBreakerLossPercent: 30,
  riskPerTradePercent: 2,
  
  // Timing
  minHoldTimeSeconds: 30,
  maxHoldTimeSeconds: 1800, // 30 minutes
  earlyExitAfterPhaseShiftSeconds: 10,
  
  // Execution
  executionMode: 'MODERATE',
  slippageBps: 300,
  maxRetries: 3,
};

export class HybridStrategyManager {
  private connection: Connection;
  private keypair: Keypair;
  private config: HybridStrategyConfig;
  
  private signalGenerator: HybridStrategySignalGenerator;
  private executor: HybridStrategyExecutor;
  private phaseDetectors: Map<string, LifecyclePhaseDetector> = new Map();
  
  private metrics: StrategyMetrics = {
    totalTokensTraded: 0,
    successfulTrades: 0,
    failedTrades: 0,
    winRate: 0,
    spotTradingPnL: 0,
    futuresTradingPnL: 0,
    totalPnL: 0,
    largestWin: 0,
    largestLoss: 0,
    averageWin: 0,
    averageLoss: 0,
    profitFactor: 0,
    averageHoldTime: 0,
    totalTradeTime: 0,
  };
  
  private tradingActive: boolean = true;
  private totalCapitalUsed: number = 0;
  private drawdownTracker: number = 0;

  constructor(
    connection: Connection,
    keypair: Keypair,
    config?: Partial<HybridStrategyConfig>
  ) {
    this.connection = connection;
    this.keypair = keypair;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.signalGenerator = new HybridStrategySignalGenerator(this.config);
    this.executor = new HybridStrategyExecutor(connection, keypair, this.config);
    
    logger.info('[HYBRID] Hybrid Strategy Manager initialized');
    this.logConfig();
  }

  /**
   * Process a new token detection
   */
  async processNewToken(
    mint: string,
    symbol: string,
    poolAddress: string,
    initialPrice: number,
    buyVolume: number,
    sellVolume: number,
    buyerCount: number
  ): Promise<{ success: boolean; signal?: StrategySignal; error?: string }> {
    try {
      // Create phase detector for this token
      const phaseDetector = new LifecyclePhaseDetector(this.config);
      this.phaseDetectors.set(mint, phaseDetector);

      // Get initial metrics
      const metrics = phaseDetector.getMetrics(
        mint,
        symbol,
        initialPrice,
        buyVolume,
        sellVolume,
        buyerCount,
        false, // No whale activity at start
        initialPrice,
        Date.now()
      );

      logger.info(`\n${'='.repeat(70)}`);
      logger.info(`🚀 NEW TOKEN DETECTED: ${symbol} (${mint.slice(0, 8)}...)`);
      logger.info(`${'='.repeat(70)}`);
      logger.info(`💰 Pool: ${poolAddress}`);
      logger.info(`📊 Initial Price: $${initialPrice.toFixed(9)}`);
      logger.info(`👥 Buyers: ${buyerCount} | Buy Volume: ${buyVolume}`);
      logger.info(`${'='.repeat(70)}\n`);

      // Generate signal
      const signal = this.signalGenerator.generateSignal(
        metrics,
        0, // Will get from wallet in real impl
        this.executor.getPositions().size,
        false,
        false
      );

      logger.info(this.signalGenerator.explainSignal(signal));

      // Execute if action is not HOLD
      if (signal.action !== 'HOLD' && this.tradingActive) {
        const execResult = await this.executor.executeSignal(
          signal,
          mint,
          symbol,
          initialPrice
        );

        if (execResult.success) {
          await sendTelegram(
            `✅ ${signal.action}\n` +
            `Token: ${symbol}\n` +
            `Phase: ${signal.phase}\n` +
            `Confidence: ${signal.confidence}%\n` +
            `TX: ${execResult.txSignature || 'N/A'}`
          );

          return {
            success: true,
            signal,
          };
        } else {
          await sendTelegram(
            `❌ FAILED: ${signal.action}\n` +
            `Token: ${symbol}\n` +
            `Error: ${execResult.error}`
          );

          return {
            success: false,
            error: execResult.error,
          };
        }
      }

      return { success: true, signal };
    } catch (error: any) {
      logger.error(`[HYBRID] Error processing token: ${error?.message ?? error}`);
      return {
        success: false,
        error: error?.message ?? String(error),
      };
    }
  }

  /**
   * Update price and monitor position
   */
  async updatePrice(
    mint: string,
    symbol: string,
    currentPrice: number,
    buyVolume: number,
    sellVolume: number,
    buyerCount: number,
    whaleActivity: boolean = false
  ): Promise<void> {
    try {
      const position = this.executor.getPosition(mint);
      const phaseDetector = this.phaseDetectors.get(mint);

      if (!position || !phaseDetector) return;

      // Update position price
      this.executor.updatePositionPrice(mint, currentPrice);

      // Get updated metrics
      const metrics = phaseDetector.getMetrics(
        mint,
        symbol,
        currentPrice,
        buyVolume,
        sellVolume,
        buyerCount,
        whaleActivity,
        position.spotBuyPrice,
        position.spotBuyTime
      );

      // Check if we should generate new signal
      const signal = this.signalGenerator.generateSignal(
        metrics,
        0,
        this.executor.getPositions().size,
        position.spotTokenAmount > 0,
        position.futuresOpen
      );

      // Execute signal if not HOLD and meets conditions
      if (
        signal.action !== 'HOLD' &&
        this.shouldExecuteSignal(signal, position, metrics)
      ) {
        logger.info(
          `\n📍 SIGNAL UPDATE: ${signal.action} for ${symbol} (${metrics.currentPhase})`
        );
        logger.info(this.signalGenerator.explainSignal(signal));

        const execResult = await this.executor.executeSignal(
          signal,
          mint,
          symbol,
          currentPrice
        );

        if (execResult.success) {
          await sendTelegram(
            `🔄 ${signal.action}\n` +
            `Token: ${symbol}\n` +
            `Phase: ${signal.phase}\n` +
            `Price: $${currentPrice.toFixed(9)}\n` +
            `Spot PnL: ${position.spotPnL.toFixed(6)} SOL (${position.spotPnLPercent.toFixed(2)}%)`
          );
        }
      }

      // Check for circuit breaker
      if (this.drawdownTracker < -this.config.circuitBreakerLossPercent) {
        logger.error(`❌ CIRCUIT BREAKER TRIGGERED - Stopping all trades`);
        this.tradingActive = false;
        await sendTelegram(`🛑 CIRCUIT BREAKER TRIGGERED\nMax loss reached: ${this.drawdownTracker.toFixed(2)}%`);
      }
    } catch (error: any) {
      logger.error(
        `[HYBRID] Error updating price: ${error?.message ?? error}`
      );
    }
  }

  /**
   * Check if signal should be executed
   */
  private shouldExecuteSignal(
    signal: StrategySignal,
    position: HybridPosition,
    metrics: any
  ): boolean {
    // Don't double-trade same direction
    if (
      signal.action === 'BUY_SPOT' &&
      position.spotTokenAmount > 0
    ) {
      return false;
    }

    if (
      signal.action === 'SELL_SPOT' &&
      position.spotTokenAmount === 0
    ) {
      return false;
    }

    if (
      signal.action === 'OPEN_SHORT' &&
      position.futuresOpen &&
      position.futuresDirection === 'SHORT'
    ) {
      return false;
    }

    // Respect minimum hold time
    if (
      signal.action === 'SELL_SPOT' &&
      Date.now() - position.spotBuyTime <
        this.config.minHoldTimeSeconds * 1000
    ) {
      return false;
    }

    // Respect maximum hold time
    if (
      position.spotTokenAmount > 0 &&
      Date.now() - position.spotBuyTime >
        this.config.maxHoldTimeSeconds * 1000
    ) {
      return true; // Force exit
    }

    return true;
  }

  /**
   * Get current metrics
   */
  getMetrics(): StrategyMetrics {
    return { ...this.metrics };
  }

  /**
   * Get all active positions
   */
  getPositions(): Map<string, HybridPosition> {
    return this.executor.getPositions();
  }

  /**
   * Enable/disable trading
   */
  setTradingActive(active: boolean): void {
    this.tradingActive = active;
    logger.info(
      `[HYBRID] Trading ${active ? 'ENABLED' : 'DISABLED'}`
    );
  }

  /**
   * Log configuration
   */
  private logConfig(): void {
    logger.info('\n🔧 HYBRID STRATEGY CONFIGURATION:');
    logger.info(`├─ Execution Mode: ${this.config.executionMode}`);
    logger.info(`├─ Spot Buy Amount: ${this.config.spotBuyAmount} SOL`);
    logger.info(`├─ Futures Leverage: ${this.config.futuresLeverage}x`);
    logger.info(`├─ Pump Threshold: +${this.config.pumpThresholdPercent}%`);
    logger.info(`├─ Dump Threshold: ${this.config.dumpThresholdPercent}%`);
    logger.info(
      `└─ Phase Window: ${this.config.phaseDetectionWindowSeconds}s\n`
    );
  }

  /**
   * Get formatted status
   */
  getStatus(): string {
    const positions = this.executor.getPositions();
    const lines: string[] = [];

    lines.push(`\n${'═'.repeat(70)}`);
    lines.push(`📈 HYBRID STRATEGY STATUS`);
    lines.push(`${'═'.repeat(70)}`);
    lines.push(`Trading Active: ${this.tradingActive ? '✅ YES' : '❌ NO'}`);
    lines.push(`Active Positions: ${positions.size}`);
    lines.push(`Total Tokens Traded: ${this.metrics.totalTokensTraded}`);
    lines.push(`Win Rate: ${this.metrics.winRate.toFixed(1)}%`);
    lines.push(`Total PnL: ${this.metrics.totalPnL.toFixed(6)} SOL`);
    lines.push(`├─ Spot: ${this.metrics.spotTradingPnL.toFixed(6)} SOL`);
    lines.push(`└─ Futures: ${this.metrics.futuresTradingPnL.toFixed(6)} SOL`);
    lines.push(`${'═'.repeat(70)}\n`);

    return lines.join('\n');
  }
}

export { HybridStrategyConfig, StrategySignal, HybridPosition, StrategyMetrics };
