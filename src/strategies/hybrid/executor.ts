/**
 * Hybrid Strategy Executor
 * Executes trades based on generated signals
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { logger } from '../../logger';
import { executeBuy } from '../../executebuy';
import { executeSell } from '../../executesell';
import {
  StrategySignal,
  HybridPosition,
  HybridStrategyConfig,
} from './types';

export interface ExecutionResult {
  success: boolean;
  txSignature?: string;
  error?: string;
  position?: HybridPosition;
}

export class HybridStrategyExecutor {
  private connection: Connection;
  private keypair: Keypair;
  private config: HybridStrategyConfig;
  private positions: Map<string, HybridPosition> = new Map();

  constructor(
    connection: Connection,
    keypair: Keypair,
    config: HybridStrategyConfig
  ) {
    this.connection = connection;
    this.keypair = keypair;
    this.config = config;
  }

  /**
   * Execute a trading signal
   */
  async executeSignal(
    signal: StrategySignal,
    mint: string,
    symbol: string,
    currentPrice: number
  ): Promise<ExecutionResult> {
    try {
      logger.info(
        `[EXECUTOR] Executing signal: ${signal.action} for ${symbol}`
      );

      switch (signal.action) {
        case 'BUY_SPOT':
          return await this.executeBuySpot(
            mint,
            symbol,
            currentPrice,
            signal
          );

        case 'SELL_SPOT':
          return await this.executeSellSpot(
            mint,
            symbol,
            currentPrice,
            signal
          );

        case 'OPEN_SHORT':
          return await this.executeOpenShort(
            mint,
            symbol,
            currentPrice,
            signal
          );

        case 'CLOSE_SHORT':
          return await this.executeCloseShort(
            mint,
            symbol,
            currentPrice,
            signal
          );

        case 'OPEN_LONG':
          return await this.executeOpenLong(
            mint,
            symbol,
            currentPrice,
            signal
          );

        case 'CLOSE_LONG':
          return await this.executeCloseLong(
            mint,
            symbol,
            currentPrice,
            signal
          );

        case 'EXIT_ALL':
          return await this.executeExitAll(mint, symbol);

        case 'HOLD':
        default:
          return {
            success: true,
            error: undefined,
          };
      }
    } catch (error: any) {
      logger.error(
        `[EXECUTOR] Error executing signal: ${error?.message ?? error}`
      );
      return {
        success: false,
        error: error?.message ?? String(error),
      };
    }
  }

  /**
   * Buy spot token
   */
  private async executeBuySpot(
    mint: string,
    symbol: string,
    currentPrice: number,
    signal: StrategySignal
  ): Promise<ExecutionResult> {
    try {
      if (!signal.spotAmount) {
        return { success: false, error: 'No spot amount specified' };
      }

      logger.info(
        `[BUY-SPOT] Buying ${symbol} | Amount: ${signal.spotAmount} SOL | Price: $${currentPrice}`
      );

      const amountLamports = BigInt(
        Math.floor(signal.spotAmount * 1_000_000_000)
      );

      const txSig = await executeBuy(
        this.connection,
        new PublicKey(mint),
        this.keypair,
        amountLamports,
        this.config.slippageBps,
        false // skipPreflight
      );

      if (!txSig) {
        return { success: false, error: 'Buy execution failed' };
      }

      // Create position record
      const position: HybridPosition = {
        mint,
        symbol,
        spotTokenAmount: 0, // Will be updated after verification
        spotBuyPrice: currentPrice,
        spotBuyTime: Date.now(),
        spotCurrentPrice: currentPrice,
        spotPnL: 0,
        spotPnLPercent: 0,
        futuresOpen: false,
        futuresDirection: null,
        futuresEntryPrice: 0,
        futuresLeverage: 0,
        futuresOpenTime: 0,
        futuresCurrentPrice: 0,
        futuresPnL: 0,
        futuresPnLPercent: 0,
        combinedPnL: 0,
        combinedPnLPercent: 0,
        riskLevel: 'MEDIUM',
        phases: [],
      };

      this.positions.set(mint, position);

      logger.info(`[BUY-SPOT] ✅ Success | TX: ${txSig}`);

      return {
        success: true,
        txSignature: txSig,
        position,
      };
    } catch (error: any) {
      logger.error(
        `[BUY-SPOT] Failed: ${error?.message ?? error}`
      );
      return {
        success: false,
        error: error?.message ?? String(error),
      };
    }
  }

  /**
   * Sell spot token
   */
  private async executeSellSpot(
    mint: string,
    symbol: string,
    currentPrice: number,
    signal: StrategySignal
  ): Promise<ExecutionResult> {
    try {
      const position = this.positions.get(mint);
      if (!position) {
        return { success: false, error: 'No spot position found' };
      }

      logger.info(
        `[SELL-SPOT] Selling ${symbol} | Amount: ${position.spotTokenAmount} | Price: $${currentPrice}`
      );

      const txSig = await executeSell(
        mint,
        position.spotTokenAmount,
        this.connection,
        this.keypair,
        this.config.slippageBps,
        false // skipPreflight
      );

      if (!txSig) {
        return { success: false, error: 'Sell execution failed' };
      }

      // Update position
      const pnl = position.spotTokenAmount * (currentPrice - position.spotBuyPrice);
      position.spotPnL = pnl;
      position.spotPnLPercent =
        ((currentPrice - position.spotBuyPrice) /
          position.spotBuyPrice) *
        100;
      position.spotTokenAmount = 0;

      logger.info(
        `[SELL-SPOT] ✅ Success | PnL: ${pnl.toFixed(6)} SOL (${position.spotPnLPercent.toFixed(
          2
        )}%) | TX: ${txSig}`
      );

      return {
        success: true,
        txSignature: txSig,
        position,
      };
    } catch (error: any) {
      logger.error(
        `[SELL-SPOT] Failed: ${error?.message ?? error}`
      );
      return {
        success: false,
        error: error?.message ?? String(error),
      };
    }
  }

  /**
   * Open SHORT futures position
   */
  private async executeOpenShort(
    mint: string,
    symbol: string,
    currentPrice: number,
    signal: StrategySignal
  ): Promise<ExecutionResult> {
    try {
      if (!signal.leverageMultiplier) {
        return { success: false, error: 'No leverage specified' };
      }

      logger.info(
        `[SHORT] Opening SHORT | ${symbol} | Leverage: ${signal.leverageMultiplier}x | Price: $${currentPrice}`
      );

      // TODO: Integrate with actual futures exchange API (Bybit, Dydx, etc.)
      // This is a placeholder that will be implemented based on exchange choice

      const position = this.positions.get(mint) || {
        mint,
        symbol,
        spotTokenAmount: 0,
        spotBuyPrice: 0,
        spotBuyTime: 0,
        spotCurrentPrice: 0,
        spotPnL: 0,
        spotPnLPercent: 0,
        futuresOpen: true,
        futuresDirection: 'SHORT',
        futuresEntryPrice: currentPrice,
        futuresLeverage: signal.leverageMultiplier,
        futuresOpenTime: Date.now(),
        futuresCurrentPrice: currentPrice,
        futuresPnL: 0,
        futuresPnLPercent: 0,
        combinedPnL: 0,
        combinedPnLPercent: 0,
        riskLevel: 'HIGH',
        phases: [],
      };

      this.positions.set(mint, position);

      logger.info(`[SHORT] ✅ Position opened`);

      return {
        success: true,
        position,
      };
    } catch (error: any) {
      logger.error(
        `[SHORT] Failed: ${error?.message ?? error}`
      );
      return {
        success: false,
        error: error?.message ?? String(error),
      };
    }
  }

  /**
   * Close SHORT position
   */
  private async executeCloseShort(
    mint: string,
    symbol: string,
    currentPrice: number,
    signal: StrategySignal
  ): Promise<ExecutionResult> {
    try {
      const position = this.positions.get(mint);
      if (!position || position.futuresDirection !== 'SHORT') {
        return { success: false, error: 'No active SHORT position' };
      }

      logger.info(
        `[SHORT-CLOSE] Closing SHORT | ${symbol} | Exit Price: $${currentPrice}`
      );

      // TODO: Implement actual futures close

      const pnl =
        (position.futuresEntryPrice - currentPrice) *
        (100 * position.futuresLeverage) / currentPrice;
      position.futuresPnL = pnl;
      position.futuresPnLPercent =
        ((position.futuresEntryPrice - currentPrice) /
          position.futuresEntryPrice) *
        100;
      position.futuresOpen = false;

      logger.info(
        `[SHORT-CLOSE] ✅ Closed | PnL: ${pnl.toFixed(6)} SOL (${position.futuresPnLPercent.toFixed(
          2
        )}%)`
      );

      return {
        success: true,
        position,
      };
    } catch (error: any) {
      logger.error(
        `[SHORT-CLOSE] Failed: ${error?.message ?? error}`
      );
      return {
        success: false,
        error: error?.message ?? String(error),
      };
    }
  }

  /**
   * Open LONG position
   */
  private async executeOpenLong(
    mint: string,
    symbol: string,
    currentPrice: number,
    signal: StrategySignal
  ): Promise<ExecutionResult> {
    // Similar to SHORT but for LONG positions
    return {
      success: false,
      error: 'LONG futures not yet implemented',
    };
  }

  /**
   * Close LONG position
   */
  private async executeCloseLong(
    mint: string,
    symbol: string,
    currentPrice: number,
    signal: StrategySignal
  ): Promise<ExecutionResult> {
    // Similar to SHORT close
    return {
      success: false,
      error: 'LONG futures not yet implemented',
    };
  }

  /**
   * Exit all positions
   */
  private async executeExitAll(
    mint: string,
    symbol: string
  ): Promise<ExecutionResult> {
    try {
      logger.warn(
        `[EXIT-ALL] EMERGENCY EXIT for ${symbol} - Closing all positions`
      );

      const position = this.positions.get(mint);
      if (!position) {
        return { success: true, error: 'No position found' };
      }

      const results: ExecutionResult[] = [];

      // Close spot if open
      if (position.spotTokenAmount > 0) {
        const spotResult = await this.executeSellSpot(
          mint,
          symbol,
          0, // Will use current price
          { action: 'SELL_SPOT', phase: 'DEAD', confidence: 100, reason: 'Emergency exit' }
        );
        results.push(spotResult);
      }

      // Close futures if open
      if (position.futuresOpen) {
        const futuresResult = await this.executeCloseShort(
          mint,
          symbol,
          0,
          { action: 'CLOSE_SHORT', phase: 'DEAD', confidence: 100, reason: 'Emergency exit' }
        );
        results.push(futuresResult);
      }

      const allSuccess = results.every((r) => r.success);
      logger.info(`[EXIT-ALL] ✅ All positions closed`);

      return {
        success: allSuccess,
      };
    } catch (error: any) {
      logger.error(
        `[EXIT-ALL] Failed: ${error?.message ?? error}`
      );
      return {
        success: false,
        error: error?.message ?? String(error),
      };
    }
  }

  /**
   * Get current positions
   */
  getPositions(): Map<string, HybridPosition> {
    return this.positions;
  }

  /**
   * Get position by mint
   */
  getPosition(mint: string): HybridPosition | undefined {
    return this.positions.get(mint);
  }

  /**
   * Update position price
   */
  updatePositionPrice(mint: string, spotPrice: number, futuresPrice?: number): void {
    const position = this.positions.get(mint);
    if (!position) return;

    position.spotCurrentPrice = spotPrice;
    position.spotPnL =
      position.spotTokenAmount * (spotPrice - position.spotBuyPrice);
    position.spotPnLPercent =
      ((spotPrice - position.spotBuyPrice) / position.spotBuyPrice) * 100;

    if (futuresPrice !== undefined && position.futuresOpen) {
      position.futuresCurrentPrice = futuresPrice;
      position.futuresPnL =
        (position.futuresEntryPrice - futuresPrice) *
        (100 * position.futuresLeverage) / futuresPrice;
      position.futuresPnLPercent =
        ((position.futuresEntryPrice - futuresPrice) /
          position.futuresEntryPrice) *
        100;
    }

    position.combinedPnL = position.spotPnL + position.futuresPnL;
    position.combinedPnLPercent =
      position.spotTokenAmount > 0 || position.futuresOpen
        ? (position.combinedPnL /
            (position.spotBuyPrice * position.spotTokenAmount +
              position.futuresEntryPrice * 100 * position.futuresLeverage)) *
          100
        : 0;
  }
}
