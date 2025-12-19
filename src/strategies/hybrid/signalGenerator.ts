/**
 * Hybrid Strategy Signal Generator
 * Generates BUY/SELL signals combining spot and futures strategies
 */

import { logger } from '../../logger';
import {
  LifecyclePhase,
  StrategySignal,
  TokenLifecycleMetrics,
  HybridStrategyConfig,
} from './types';
import { LifecyclePhaseDetector } from './lifecyclePhaseDetector';

export class HybridStrategySignalGenerator {
  private config: HybridStrategyConfig;
  private phaseDetector: LifecyclePhaseDetector;

  constructor(config: HybridStrategyConfig) {
    this.config = config;
    this.phaseDetector = new LifecyclePhaseDetector(config);
  }

  /**
   * Generate trading signal based on lifecycle phase
   */
  generateSignal(
    metrics: TokenLifecycleMetrics,
    currentBalance: number, // SOL available
    openPositions: number,
    hasActiveSpot: boolean,
    hasActiveFutures: boolean
  ): StrategySignal {
    const phase = metrics.currentPhase;
    const confidence = metrics.phaseConfidence;
    const priceChange = metrics.priceChangePercent;
    const timeInPhase = metrics.timeInPhaseSeconds;
    const volatility = metrics.volatilityPercent;

    // ===== INITIAL PUMP PHASE =====
    if (phase === 'INITIAL_PUMP') {
      // This is the ENTRY phase - we want to build spot positions
      if (!hasActiveSpot && openPositions < this.config.spotMaxConcurrentPositions) {
        return {
          action: 'BUY_SPOT',
          phase,
          confidence: Math.min(95, confidence + 15),
          reason: 'Strong pump detected - Prime entry for spot trading',
          spotAmount: this.config.spotBuyAmount,
          stopLossPercent: 15, // Tight stop loss
          takeProfitPercent: 50, // Target 50% gains
          expectedDurationSeconds: 300, // 5 min
          exitAtPhaseShift: true,
        };
      }

      // If already have spot, consider opening SHORT on futures for hedge
      if (
        hasActiveSpot &&
        !hasActiveFutures &&
        timeInPhase > 120 && // After 2 minutes of pump
        confidence > 75
      ) {
        return {
          action: 'OPEN_SHORT',
          phase,
          confidence: confidence - 20,
          reason: 'Hedge spot gains with short futures position',
          leverageMultiplier: 2,
          stopLossPercent: 20,
          takeProfitPercent: 15,
          expectedDurationSeconds: 600,
          exitAtPhaseShift: true,
        };
      }

      return {
        action: 'HOLD',
        phase,
        confidence,
        reason: 'Pump phase active - Monitor for entry opportunities',
      };

      // ===== ACCUMULATION PHASE =====
    } else if (phase === 'ACCUMULATION') {
      // Accumulation is good for continuing spot trades
      if (!hasActiveSpot && openPositions < this.config.spotMaxConcurrentPositions) {
        return {
          action: 'BUY_SPOT',
          phase,
          confidence: Math.max(70, confidence - 10),
          reason: 'Steady accumulation - Good entry point',
          spotAmount: this.config.spotBuyAmount * 0.8, // Slightly reduced
          stopLossPercent: 20,
          takeProfitPercent: 40,
          expectedDurationSeconds: 1200, // 20 min
          exitAtPhaseShift: true,
        };
      }

      return {
        action: 'HOLD',
        phase,
        confidence,
        reason: 'Accumulation phase - Continue holding spot positions',
      };

      // ===== DISTRIBUTION PHASE =====
    } else if (phase === 'DISTRIBUTION') {
      // Distribution = whales exiting. Close spots, open SHORT
      if (hasActiveSpot) {
        return {
          action: 'SELL_SPOT',
          phase,
          confidence: confidence + 20,
          reason: 'Whale distribution detected - Exit spot positions before crash',
          expectedDurationSeconds: 60,
          exitAtPhaseShift: false,
        };
      }

      // Open SHORT positions to profit from coming dump
      if (
        !hasActiveFutures &&
        openPositions < this.config.futuresMaxConcurrentPositions
      ) {
        return {
          action: 'OPEN_SHORT',
          phase,
          confidence: Math.min(95, confidence + 10),
          reason: 'Whales exiting - SHORT the incoming dump',
          leverageMultiplier: this.config.futuresLeverage,
          stopLossPercent: 15,
          takeProfitPercent: 30,
          expectedDurationSeconds: 600, // 10 min
          exitAtPhaseShift: true,
        };
      }

      return {
        action: 'HOLD',
        phase,
        confidence,
        reason: 'Distribution detected - Monitoring for short opportunities',
      };

      // ===== DUMP PHASE =====
    } else if (phase === 'DUMP') {
      // Close any remaining longs
      if (hasActiveSpot) {
        return {
          action: 'SELL_SPOT',
          phase,
          confidence: 99,
          reason: 'Free-fall detected - EMERGENCY EXIT all spot positions',
          expectedDurationSeconds: 10,
          exitAtPhaseShift: false,
        };
      }

      // Maximize short positions if not already in
      if (
        !hasActiveFutures &&
        openPositions < this.config.futuresMaxConcurrentPositions
      ) {
        return {
          action: 'OPEN_SHORT',
          phase,
          confidence: 95,
          reason: 'Token crashing - Maximum SHORT position',
          leverageMultiplier: Math.min(
            this.config.futuresLeverage,
            5 // Cap at 5x for dump
          ),
          stopLossPercent: 10,
          takeProfitPercent: 25,
          expectedDurationSeconds: 300,
          exitAtPhaseShift: true,
        };
      }

      // If already in short, consider adding to it
      if (hasActiveFutures && priceChange < -40) {
        return {
          action: 'HOLD', // Consider adding to position in real impl
          phase,
          confidence: 90,
          reason: 'Deep dump - Maintain short position, consider scaling',
        };
      }

      return {
        action: 'HOLD',
        phase,
        confidence,
        reason: 'Dump phase - Monitor short position',
      };

      // ===== DEAD PHASE =====
    } else if (phase === 'DEAD') {
      // Close EVERYTHING
      return {
        action: 'EXIT_ALL',
        phase,
        confidence: 100,
        reason: 'Token is dead - Close all positions immediately',
        expectedDurationSeconds: 5,
        exitAtPhaseShift: false,
      };
    }

    // Default fallback
    return {
      action: 'HOLD',
      phase,
      confidence: 0,
      reason: 'Unknown phase - No action',
    };
  }

  /**
   * Generate detailed signal explanation
   */
  explainSignal(signal: StrategySignal): string {
    const lines: string[] = [];

    lines.push(`\n${'═'.repeat(60)}`);
    lines.push(`📊 HYBRID STRATEGY SIGNAL - ${signal.phase.toUpperCase()}`);
    lines.push(`${'═'.repeat(60)}`);
    lines.push(`🎯 Action: ${signal.action}`);
    lines.push(`📈 Confidence: ${signal.confidence}%`);
    lines.push(`💭 Reason: ${signal.reason}`);

    if (signal.spotAmount) {
      lines.push(`💰 Spot Amount: ${signal.spotAmount.toFixed(6)} SOL`);
    }

    if (signal.leverageMultiplier) {
      lines.push(`⚡ Leverage: ${signal.leverageMultiplier}x`);
    }

    if (signal.stopLossPercent) {
      lines.push(`🛑 Stop Loss: ${signal.stopLossPercent}%`);
    }

    if (signal.takeProfitPercent) {
      lines.push(`🎁 Take Profit: ${signal.takeProfitPercent}%`);
    }

    if (signal.expectedDurationSeconds) {
      const minutes = Math.round(signal.expectedDurationSeconds / 60);
      lines.push(`⏱️  Expected Duration: ~${minutes} minutes`);
    }

    lines.push(`${'═'.repeat(60)}`);

    return lines.join('\n');
  }

  /**
   * Get phase detector for direct metrics
   */
  getPhaseDetector(): LifecyclePhaseDetector {
    return this.phaseDetector;
  }
}
