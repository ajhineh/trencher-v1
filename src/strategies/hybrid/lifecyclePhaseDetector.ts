/**
 * Token Lifecycle Phase Detector
 * Identifies which phase a token is in (PUMP, ACCUMULATION, DISTRIBUTION, DUMP, DEAD)
 */

import { logger } from '../../logger';
import {
  LifecyclePhase,
  TokenLifecycleMetrics,
  PhaseDetectionResult,
  HybridStrategyConfig,
} from './types';

export class LifecyclePhaseDetector {
  private config: HybridStrategyConfig;
  private priceHistory: Array<{ time: number; price: number }> = [];
  private volumeHistory: Array<{ time: number; volume: number }> = [];
  private buyerCounts: Array<{ time: number; count: number }> = [];

  constructor(config: HybridStrategyConfig) {
    this.config = config;
  }

  /**
   * Add new price data point
   */
  addPrice(price: number, timestamp: number = Date.now()): void {
    this.priceHistory.push({ time: timestamp, price });

    // Keep only data from last hour (3600 seconds)
    const oneHourAgo = timestamp - 3600000;
    this.priceHistory = this.priceHistory.filter((p) => p.time > oneHourAgo);
  }

  /**
   * Add volume data
   */
  addVolume(buyVolume: number, sellVolume: number, timestamp: number = Date.now()): void {
    this.volumeHistory.push({
      time: timestamp,
      volume: buyVolume + sellVolume,
    });

    const oneHourAgo = timestamp - 3600000;
    this.volumeHistory = this.volumeHistory.filter((v) => v.time > oneHourAgo);
  }

  /**
   * Add buyer count data
   */
  addBuyerCount(count: number, timestamp: number = Date.now()): void {
    this.buyerCounts.push({ time: timestamp, count });

    const oneHourAgo = timestamp - 3600000;
    this.buyerCounts = this.buyerCounts.filter((b) => b.time > oneHourAgo);
  }

  /**
   * Detect current lifecycle phase
   */
  detectPhase(
    currentPrice: number,
    buyVolume: number,
    sellVolume: number,
    buyerCount: number,
    whaleActivity: boolean,
    timestamp: number = Date.now()
  ): PhaseDetectionResult {
    this.addPrice(currentPrice, timestamp);
    this.addVolume(buyVolume, sellVolume, timestamp);
    this.addBuyerCount(buyerCount, timestamp);

    const windowStart = timestamp - this.config.phaseDetectionWindowSeconds * 1000;
    const recentPrices = this.priceHistory.filter((p) => p.time >= windowStart);
    const recentVolumes = this.volumeHistory.filter((v) => v.time >= windowStart);
    const recentBuyers = this.buyerCounts.filter((b) => b.time >= windowStart);

    if (recentPrices.length < 2) {
      return {
        currentPhase: 'INITIAL_PUMP',
        confidence: 30,
        signals: {
          priceAction: 'Insufficient data',
          volumePattern: 'Insufficient data',
          whaleActivity: 'Unknown',
          buyerMomentum: `${buyerCount} buyers`,
          timeInCurrent: 'Just launched',
        },
        estimatedTransitionTime: this.config.phaseDetectionWindowSeconds * 1000,
        recommendation: 'Wait for more data before trading',
      };
    }

    // Calculate metrics
    const firstPrice = recentPrices[0].price;
    const lastPrice = recentPrices[recentPrices.length - 1].price;
    const priceChangePercent = ((lastPrice - firstPrice) / firstPrice) * 100;

    const highestPrice = Math.max(...recentPrices.map((p) => p.price));
    const lowestPrice = Math.min(...recentPrices.map((p) => p.price));
    const volatilityPercent =
      ((highestPrice - lowestPrice) / lowestPrice) * 100;

    const totalVolume = recentVolumes.reduce((sum, v) => sum + v.volume, 0);
    const buyVolumePercent = (buyVolume / (buyVolume + sellVolume)) * 100;

    const avgBuyerCount =
      recentBuyers.length > 0
        ? recentBuyers.reduce((sum, b) => sum + b.count, 0) /
          recentBuyers.length
        : 0;

    // Phase detection logic
    let phase: LifecyclePhase;
    let confidence: number;
    let signals: PhaseDetectionResult['signals'];
    let estimatedTransitionTime: number;
    let recommendation: string;

    // ===== PUMP PHASE =====
    if (
      priceChangePercent > this.config.pumpThresholdPercent &&
      buyVolumePercent > 65 &&
      buyerCount > 10 &&
      !whaleActivity
    ) {
      phase = 'INITIAL_PUMP';
      confidence = Math.min(100, 50 + Math.abs(priceChangePercent) / 2);
      signals = {
        priceAction: `Strong uptrend: +${priceChangePercent.toFixed(2)}%`,
        volumePattern: `Buy dominance: ${buyVolumePercent.toFixed(1)}%`,
        whaleActivity: 'Low whale activity',
        buyerMomentum: `${buyerCount} active buyers`,
        timeInCurrent: `${Math.round(
          (timestamp - recentPrices[0].time) / 1000
        )}s in pump`,
      };
      estimatedTransitionTime = Math.max(
        30000,
        Math.min(600000, 600000 - priceChangePercent * 5000)
      ); // 30s to 10min
      recommendation = 'PRIME TIME FOR ENTRY - Strong pump detected';

      // ===== ACCUMULATION PHASE =====
    } else if (
      priceChangePercent > 10 &&
      priceChangePercent <= this.config.pumpThresholdPercent &&
      buyVolumePercent > 55 &&
      volatilityPercent < 15
    ) {
      phase = 'ACCUMULATION';
      confidence = 65;
      signals = {
        priceAction: `Modest uptrend: +${priceChangePercent.toFixed(2)}%`,
        volumePattern: `Balanced volume, slight buy pressure`,
        whaleActivity: whaleActivity ? 'Some whale accumulation' : 'Retail-driven',
        buyerMomentum: `${buyerCount} buyers, steady momentum`,
        timeInCurrent: `${Math.round(
          (timestamp - recentPrices[0].time) / 1000
        )}s`,
      };
      estimatedTransitionTime = 1200000; // ~20 minutes
      recommendation = 'Steady growth - Good entry point, prepare for next phase';

      // ===== DISTRIBUTION PHASE =====
    } else if (
      Math.abs(priceChangePercent) < 10 &&
      buyVolumePercent < 55 &&
      whaleActivity
    ) {
      phase = 'DISTRIBUTION';
      confidence = 70;
      signals = {
        priceAction: `Consolidation: ${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(
          2
        )}%`,
        volumePattern: 'Heavy whale selling detected',
        whaleActivity: 'AGGRESSIVE whale distribution',
        buyerMomentum: `${buyerCount} buyers (declining)`,
        timeInCurrent: `${Math.round(
          (timestamp - recentPrices[0].time) / 1000
        )}s`,
      };
      estimatedTransitionTime = 300000; // ~5 minutes
      recommendation = 'WARNING: Whales exiting - Consider closing spot positions, SHORT opportunities';

      // ===== DUMP PHASE =====
    } else if (
      priceChangePercent < -this.config.dumpThresholdPercent &&
      buyVolumePercent < 40 &&
      buyerCount < 5
    ) {
      phase = 'DUMP';
      confidence = Math.min(
        100,
        80 + Math.abs(priceChangePercent) / 5
      );
      signals = {
        priceAction: `Strong downtrend: ${priceChangePercent.toFixed(2)}%`,
        volumePattern: `Sell dominance: ${(100 - buyVolumePercent).toFixed(
          1
        )}%`,
        whaleActivity: 'Massive selling',
        buyerMomentum: `${buyerCount} buyers (panic)`,
        timeInCurrent: `${Math.round(
          (timestamp - recentPrices[0].time) / 1000
        )}s in crash`,
      };
      estimatedTransitionTime = 60000; // 1 minute to dead
      recommendation = 'CRITICAL: Token in free-fall - CLOSE ALL LONGS, maximize SHORT positions';

      // ===== DEAD PHASE =====
    } else if (
      buyerCount < 1 &&
      buyVolumePercent < 30 &&
      volatilityPercent < 1
    ) {
      phase = 'DEAD';
      confidence = 90;
      signals = {
        priceAction: 'No price movement',
        volumePattern: 'No volume',
        whaleActivity: 'No activity',
        buyerMomentum: 'No buyers',
        timeInCurrent: 'Expired',
      };
      estimatedTransitionTime = 0;
      recommendation = 'Token is dead - EXIT all positions immediately';

      // ===== DEFAULT =====
    } else {
      phase = 'ACCUMULATION';
      confidence = 40;
      signals = {
        priceAction: `Neutral: ${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%`,
        volumePattern: `Mixed volume pattern`,
        whaleActivity: whaleActivity ? 'Some whale activity' : 'Minimal',
        buyerMomentum: `${buyerCount} buyers`,
        timeInCurrent: `${Math.round(
          (timestamp - recentPrices[0].time) / 1000
        )}s`,
      };
      estimatedTransitionTime = 600000; // 10 min
      recommendation = 'Uncertain phase - Monitor closely';
    }

    logger.info(
      `[PHASE] ${phase} (confidence: ${confidence}%) | Price: ${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(
        2
      )}% | Buyers: ${buyerCount} | Whale Activity: ${whaleActivity}`
    );

    return {
      currentPhase: phase,
      confidence,
      signals,
      estimatedTransitionTime,
      recommendation,
    };
  }

  /**
   * Get metrics for current state
   */
  getMetrics(
    mint: string,
    symbol: string,
    currentPrice: number,
    buyVolume: number,
    sellVolume: number,
    buyerCount: number,
    whaleActivity: boolean,
    entryPrice: number,
    entryTime: number
  ): TokenLifecycleMetrics {
    const detection = this.detectPhase(
      currentPrice,
      buyVolume,
      sellVolume,
      buyerCount,
      whaleActivity
    );
    const now = Date.now();

    const windowStart = now - this.config.phaseDetectionWindowSeconds * 1000;
    const recentPrices = this.priceHistory.filter((p) => p.time >= windowStart);

    const highestPrice =
      recentPrices.length > 0
        ? Math.max(...recentPrices.map((p) => p.price))
        : currentPrice;
    const lowestPrice =
      recentPrices.length > 0
        ? Math.min(...recentPrices.map((p) => p.price))
        : currentPrice;

    return {
      mint,
      symbol,
      phaseStartTime: entryTime,
      currentPhase: detection.currentPhase,
      entryPrice,
      highestPrice,
      currentPrice,
      lowestPrice,
      volatilityPercent:
        ((highestPrice - lowestPrice) / lowestPrice) * 100,
      priceChangePercent:
        ((currentPrice - entryPrice) / entryPrice) * 100,
      timeInPhaseSeconds: (now - entryTime) / 1000,
      buyVolume,
      sellVolume,
      buyerCount,
      sellerCount: Math.max(1, Math.floor(sellVolume / 100)), // Rough estimate
      whaleActivity,
      phaseConfidence: detection.confidence,
      timeUntilNextPhaseSeconds:
        detection.estimatedTransitionTime / 1000,
    };
  }

  /**
   * Clear history (useful for memory management)
   */
  clearHistory(): void {
    this.priceHistory = [];
    this.volumeHistory = [];
    this.buyerCounts = [];
  }
}
