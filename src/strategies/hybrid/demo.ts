/**
 * Hybrid Strategy Example / Demo
 * Shows how the strategy works with simulated data
 */

import { Connection } from '@solana/web3.js';
import { logger } from '../../logger';
import {
  HybridStrategyManager,
  HybridStrategyConfig,
} from './hybridStrategyManager';
import { LifecyclePhaseDetector } from './lifecyclePhaseDetector';
import { HybridStrategySignalGenerator } from './signalGenerator';
import { HYBRID_CONFIG_PRESETS, calculateExpectedProfit } from './integration';

/**
 * Simulated token lifecycle for demo
 */
const SIMULATED_TOKEN_LIFECYCLE = [
  // INITIAL PUMP: Minutes 0-5 (Strong uptrend)
  {
    minute: 0,
    price: 0.00001,
    buyVolume: 100,
    sellVolume: 50,
    buyerCount: 50,
    whaleActivity: false,
    phase: 'INITIAL_PUMP',
  },
  {
    minute: 1,
    price: 0.000015,
    buyVolume: 200,
    sellVolume: 80,
    buyerCount: 120,
    whaleActivity: false,
    phase: 'INITIAL_PUMP',
  },
  {
    minute: 2,
    price: 0.000025,
    buyVolume: 300,
    sellVolume: 100,
    buyerCount: 200,
    whaleActivity: false,
    phase: 'INITIAL_PUMP',
  },
  {
    minute: 3,
    price: 0.000045,
    buyVolume: 400,
    sellVolume: 150,
    buyerCount: 250,
    whaleActivity: false,
    phase: 'INITIAL_PUMP',
  },
  {
    minute: 4,
    price: 0.000080,
    buyVolume: 500,
    sellVolume: 200,
    buyerCount: 300,
    whaleActivity: false,
    phase: 'INITIAL_PUMP',
  },
  {
    minute: 5,
    price: 0.000150,
    buyVolume: 600,
    sellVolume: 250,
    buyerCount: 350,
    whaleActivity: false,
    phase: 'INITIAL_PUMP',
  },

  // ACCUMULATION: Minutes 5-15 (Steady growth)
  {
    minute: 7,
    price: 0.000250,
    buyVolume: 400,
    sellVolume: 350,
    buyerCount: 280,
    whaleActivity: false,
    phase: 'ACCUMULATION',
  },
  {
    minute: 10,
    price: 0.000400,
    buyVolume: 350,
    sellVolume: 400,
    buyerCount: 200,
    whaleActivity: false,
    phase: 'ACCUMULATION',
  },
  {
    minute: 15,
    price: 0.000500,
    buyVolume: 300,
    sellVolume: 450,
    buyerCount: 150,
    whaleActivity: true,
    phase: 'DISTRIBUTION',
  },

  // DISTRIBUTION: Minutes 15-25 (Whales exit)
  {
    minute: 17,
    price: 0.000480,
    buyVolume: 200,
    sellVolume: 600,
    buyerCount: 100,
    whaleActivity: true,
    phase: 'DISTRIBUTION',
  },
  {
    minute: 20,
    price: 0.000400,
    buyVolume: 150,
    sellVolume: 800,
    buyerCount: 50,
    whaleActivity: true,
    phase: 'DISTRIBUTION',
  },
  {
    minute: 22,
    price: 0.000300,
    buyVolume: 100,
    sellVolume: 1000,
    buyerCount: 20,
    whaleActivity: true,
    phase: 'DUMP',
  },

  // DUMP: Minutes 25-35 (Free-fall)
  {
    minute: 25,
    price: 0.000150,
    buyVolume: 50,
    sellVolume: 1500,
    buyerCount: 10,
    whaleActivity: true,
    phase: 'DUMP',
  },
  {
    minute: 28,
    price: 0.000050,
    buyVolume: 20,
    sellVolume: 2000,
    buyerCount: 5,
    whaleActivity: false,
    phase: 'DUMP',
  },

  // DEAD: After 30 minutes
  {
    minute: 35,
    price: 0.000001,
    buyVolume: 1,
    sellVolume: 100,
    buyerCount: 0,
    whaleActivity: false,
    phase: 'DEAD',
  },
];

/**
 * Run demo
 */
export async function runHybridStrategyDemo(): Promise<void> {
  console.log('\n' + '═'.repeat(80));
  console.log('🚀 HYBRID STRATEGY DEMONSTRATION');
  console.log('═'.repeat(80) + '\n');

  // Create phase detector
  const config = HYBRID_CONFIG_PRESETS.MODERATE as HybridStrategyConfig;
  const phaseDetector = new LifecyclePhaseDetector(config);
  const signalGenerator = new HybridStrategySignalGenerator(config);

  console.log('📊 SIMULATED TOKEN LIFECYCLE:\n');

  const results: Array<{
    minute: number;
    price: string;
    phase: string;
    signal: string;
    priceChange: string;
  }> = [];

  let previousPrice = SIMULATED_TOKEN_LIFECYCLE[0].price;
  let entryPrice = SIMULATED_TOKEN_LIFECYCLE[0].price;
  let spotPosition: number | null = null;
  let shortsOpen = false;

  for (const dataPoint of SIMULATED_TOKEN_LIFECYCLE) {
    const priceChangePercent =
      ((dataPoint.price - previousPrice) / previousPrice) * 100;

    // Detect phase
    const detection = phaseDetector.detectPhase(
      dataPoint.price,
      dataPoint.buyVolume,
      dataPoint.sellVolume,
      dataPoint.buyerCount,
      dataPoint.whaleActivity
    );

    // Get metrics
    const metrics = phaseDetector.getMetrics(
      'DEMO123',
      'DEMO',
      dataPoint.price,
      dataPoint.buyVolume,
      dataPoint.sellVolume,
      dataPoint.buyerCount,
      dataPoint.whaleActivity,
      entryPrice,
      Date.now()
    );

    // Generate signal
    const signal = signalGenerator.generateSignal(
      metrics,
      1, // 1 SOL available
      spotPosition ? 1 : 0,
      spotPosition !== null,
      shortsOpen
    );

    // Track positions
    if (signal.action === 'BUY_SPOT' && !spotPosition) {
      spotPosition = (config.spotBuyAmount / dataPoint.price) * 1000000000; // In satoshis
      entryPrice = dataPoint.price;
    } else if (signal.action === 'SELL_SPOT' && spotPosition) {
      spotPosition = null;
    } else if (signal.action === 'OPEN_SHORT' && !shortsOpen) {
      shortsOpen = true;
    } else if (signal.action === 'CLOSE_SHORT' && shortsOpen) {
      shortsOpen = false;
    }

    results.push({
      minute: dataPoint.minute,
      price: `$${dataPoint.price.toFixed(9)}`,
      phase: detection.currentPhase,
      signal: signal.action,
      priceChange: `${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%`,
    });

    previousPrice = dataPoint.price;

    // Print details for key points
    if (signal.action !== 'HOLD') {
      console.log(
        `⏱️  Minute ${dataPoint.minute}: ${detection.currentPhase}`
      );
      console.log(`   Price: $${dataPoint.price.toFixed(9)} (${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)`);
      console.log(`   Buyers: ${dataPoint.buyerCount} | Whale Activity: ${dataPoint.whaleActivity ? 'YES ⚠️' : 'NO'}`);
      console.log(`   📍 SIGNAL: ${signal.action}`);
      console.log(`   📌 Confidence: ${signal.confidence}%`);
      console.log(`   💭 Reason: ${signal.reason}`);

      if (signal.spotAmount) {
        console.log(`   💰 Spot Amount: ${signal.spotAmount} SOL`);
      }
      if (signal.leverageMultiplier) {
        console.log(`   ⚡ Leverage: ${signal.leverageMultiplier}x`);
      }
      console.log('');
    }
  }

  // Print summary table
  console.log('\n📋 COMPLETE LIFECYCLE SUMMARY:\n');
  console.table(results);

  // Calculate expected profit
  console.log('\n💹 PROFIT CALCULATION:\n');
  const maxPrice = Math.max(
    ...SIMULATED_TOKEN_LIFECYCLE.map((d) => d.price)
  );
  const minPriceAfterMax = Math.min(
    ...SIMULATED_TOKEN_LIFECYCLE.filter(
      (d) => d.price <= maxPrice && d.minute > 5
    ).map((d) => d.price)
  );

  const profit = calculateExpectedProfit(
    SIMULATED_TOKEN_LIFECYCLE[0].price,
    ((maxPrice - SIMULATED_TOKEN_LIFECYCLE[0].price) /
      SIMULATED_TOKEN_LIFECYCLE[0].price) *
      100,
    ((minPriceAfterMax - maxPrice) / maxPrice) * 100,
    config.spotBuyAmount,
    (config.spotBuyAmount / maxPrice) * 1000000000,
    config.futuresLeverage
  );

  console.log(`Initial Price: $${SIMULATED_TOKEN_LIFECYCLE[0].price.toFixed(9)}`);
  console.log(`Peak Price: $${maxPrice.toFixed(9)} (+${(((maxPrice - SIMULATED_TOKEN_LIFECYCLE[0].price) / SIMULATED_TOKEN_LIFECYCLE[0].price) * 100).toFixed(2)}%)`);
  console.log(`Final Price: $${minPriceAfterMax.toFixed(9)} (${(((minPriceAfterMax - maxPrice) / maxPrice) * 100).toFixed(2)}%)`);
  console.log(`\nExpected Profits:`);
  console.log(`  Spot Trading: ${profit.spotProfit.toFixed(6)} SOL`);
  console.log(`  Futures (${config.futuresLeverage}x): ${profit.futuresProfit.toFixed(6)} SOL`);
  console.log(`  TOTAL: ${profit.totalProfit.toFixed(6)} SOL`);
  console.log(`  ROI: ${profit.roi.toFixed(2)}%`);

  console.log('\n' + '═'.repeat(80));
  console.log('✅ Demo completed\n');
}

// Run if executed directly
if (require.main === module) {
  runHybridStrategyDemo().catch(console.error);
}
