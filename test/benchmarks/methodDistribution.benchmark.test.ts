// test/benchmarks/methodDistribution.benchmark.ts

/**
 * Method Distribution Benchmark
 * 
 * Measures how often each decision method is used:
 * - Quick Rules
 * - Fast Classifier
 * - DQN
 * - Conservative
 */

import { Connection } from '@solana/web3.js';
import { ConfidenceRouter, TokenContext } from '../../src/decision/confidenceRouter';

const createMockConnection = (): Connection => {
  return {} as any;
};

function generateMockContext(
  riskLevel: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
): TokenContext {
  const profiles = {
    VERY_LOW: {
      liquidity: 50000,
      slippage: 1,
      topHolder: 5,
      buyerCount: 50
    },
    LOW: {
      liquidity: 10000,
      slippage: 3,
      topHolder: 20,
      buyerCount: 20
    },
    MEDIUM: {
      liquidity: 3000,
      slippage: 8,
      topHolder: 45,
      buyerCount: 8
    },
    HIGH: {
      liquidity: 1200,
      slippage: 15,
      topHolder: 70,
      buyerCount: 3
    },
    CRITICAL: {
      liquidity: 500,
      slippage: 25,
      topHolder: 90,
      buyerCount: 1
    }
  };

  const profile = profiles[riskLevel];

  return {
    mintAddress: `TOKEN_${Math.random().toString(36).substr(2, 9)}`,
    creatorAddress: `CREATOR_${Math.random().toString(36).substr(2, 9)}`,
    createdAtMs: Date.now(),
    liquidityUSD: profile.liquidity,
    topHolderPercent: profile.topHolder,
    top5HolderPercent: profile.topHolder + 15,
    buyerCountLast5Min: profile.buyerCount,
    slippagePercent: profile.slippage,
    metadata: { name: 'Test Token', symbol: 'TEST', decimals: 9 }
  };
}

describe('Method Distribution Benchmark', () => {
  let router: ConfidenceRouter;
  const mockConnection = createMockConnection();

  beforeAll(() => {
    router = new ConfidenceRouter(mockConnection);
  });

  it('should measure method distribution across risk levels', async () => {
    const iterations = 200;
    const results: Array<{
      riskLevel: string;
      method: string;
      action: string;
      latency: number;
      confidence: number;
    }> = [];

    console.log('\n=== Method Distribution Benchmark ===');
    console.log(`Running ${iterations} iterations...`);

    // Realistic distribution of tokens
    const riskDistribution: Array<'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = [
      ...Array(10).fill('VERY_LOW'),   // 5%
      ...Array(30).fill('LOW'),        // 15%
      ...Array(60).fill('MEDIUM'),     // 30%
      ...Array(80).fill('HIGH'),       // 40%
      ...Array(20).fill('CRITICAL')    // 10%
    ];

    for (let i = 0; i < iterations; i++) {
      const riskLevel = riskDistribution[i % riskDistribution.length];
      const context = generateMockContext(riskLevel);
      
      const decision = await router.route(context.mintAddress, context);
      
      results.push({
        riskLevel,
        method: decision.method,
        action: decision.action,
        latency: decision.latency,
        confidence: decision.confidence.overall
      });
    }

    // Analyze results
    const methodCounts = results.reduce((acc, r) => {
      acc[r.method] = (acc[r.method] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const actionCounts = results.reduce((acc, r) => {
      acc[r.action] = (acc[r.action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const avgLatencyByMethod = Object.keys(methodCounts).reduce((acc, method) => {
      const methodResults = results.filter(r => r.method === method);
      const avg = methodResults.reduce((sum, r) => sum + r.latency, 0) / methodResults.length;
      acc[method] = avg;
      return acc;
    }, {} as Record<string, number>);

    const avgConfidenceByMethod = Object.keys(methodCounts).reduce((acc, method) => {
      const methodResults = results.filter(r => r.method === method);
      const avg = methodResults.reduce((sum, r) => sum + r.confidence, 0) / methodResults.length;
      acc[method] = avg;
      return acc;
    }, {} as Record<string, number>);

    // Print results
    console.log('\n📊 Method Distribution:');
    Object.entries(methodCounts).forEach(([method, count]) => {
      const percentage = (count / iterations * 100).toFixed(1);
      const avgLat = avgLatencyByMethod[method].toFixed(2);
      const avgConf = (avgConfidenceByMethod[method] * 100).toFixed(1);
      console.log(`  ${method}: ${count} (${percentage}%) - Avg Latency: ${avgLat}ms, Avg Confidence: ${avgConf}%`);
    });

    console.log('\n🎯 Action Distribution:');
    Object.entries(actionCounts).forEach(([action, count]) => {
      const percentage = (count / iterations * 100).toFixed(1);
      console.log(`  ${action}: ${count} (${percentage}%)`);
    });

    console.log('\n⏱️ Overall Performance:');
    const totalLatency = results.reduce((sum, r) => sum + r.latency, 0);
    const avgLatency = totalLatency / iterations;
    console.log(`  Average Latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`  Total Time: ${totalLatency.toFixed(0)}ms`);
    console.log(`  Throughput: ${(iterations / (totalLatency / 1000)).toFixed(2)} decisions/second`);

    // Assertions
    const quickRulesPercentage = (methodCounts['QUICK_RULES'] || 0) / iterations;
    const fastClassifierPercentage = (methodCounts['FAST_CLASSIFIER'] || 0) / iterations;

    // Target: 70-80% Quick Rules
    expect(quickRulesPercentage).toBeGreaterThan(0.6);
    expect(quickRulesPercentage).toBeLessThan(0.9);

    // Target: 15-25% Fast Classifier
    expect(fastClassifierPercentage).toBeGreaterThan(0.1);
    expect(fastClassifierPercentage).toBeLessThan(0.3);

    // Average latency should be <200ms
    expect(avgLatency).toBeLessThan(200);
  });

  it('should show method distribution by risk level', async () => {
    const riskLevels: Array<'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = [
      'VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    ];

    console.log('\n=== Method Distribution by Risk Level ===');

    for (const riskLevel of riskLevels) {
      const iterations = 20;
      const methods: string[] = [];
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const context = generateMockContext(riskLevel);
        const decision = await router.route(context.mintAddress, context);
        methods.push(decision.method);
        latencies.push(decision.latency);
      }

      const methodCounts = methods.reduce((acc, m) => {
        acc[m] = (acc[m] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const avgLatency = latencies.reduce((a, b) => a + b) / iterations;

      console.log(`\n${riskLevel}:`);
      Object.entries(methodCounts).forEach(([method, count]) => {
        console.log(`  ${method}: ${count}/${iterations} (${(count / iterations * 100).toFixed(0)}%)`);
      });
      console.log(`  Avg Latency: ${avgLatency.toFixed(2)}ms`);
    }
  });
});
