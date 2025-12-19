
import { QuickRejectOptimizer } from '../../src/decision/quickReject';
import { performance } from 'perf_hooks';

describe('QuickReject Performance', () => {
    let optimizer: QuickRejectOptimizer;

    beforeEach(() => {
        optimizer = new QuickRejectOptimizer();
        optimizer.clearCache();
    });

    it('should handle high throughput (1000 ops)', async () => {
        const ITERATIONS = 1000;
        const start = performance.now();

        for (let i = 0; i < ITERATIONS; i++) {
            await optimizer.quickReject({
                mintAddress: `TOKEN_${i}`,
                creatorAddress: 'CREATOR',
                liquidityUSD: 5000 + i // Vary data slightly
            });
        }

        const end = performance.now();
        const totalTime = end - start;
        const avgTime = totalTime / ITERATIONS;
        const opsPerSec = 1000 / (totalTime / 1000);

        console.log(`\nQuickReject Performance:`);
        console.log(`Total Time (${ITERATIONS} ops): ${totalTime.toFixed(2)}ms`);
        console.log(`Avg Latency: ${avgTime.toFixed(4)}ms`);
        console.log(`Throughput: ${opsPerSec.toFixed(0)} ops/sec`);

        // Assert performance requirements
        expect(avgTime).toBeLessThan(1.0); // Should be sub-millisecond mostly
        expect(opsPerSec).toBeGreaterThan(1000);
    });

    it('should be O(1) with cache growth', async () => {
        // Measure first 100
        const start1 = performance.now();
        for (let i = 0; i < 100; i++) {
            await optimizer.quickReject({ mintAddress: `T${i}`, creatorAddress: 'C', liquidityUSD: 5000 });
        }
        const time1 = performance.now() - start1;

        // Populate cache with 1000 items
        for (let i = 100; i < 1100; i++) {
            await optimizer.quickReject({ mintAddress: `T${i}`, creatorAddress: 'C', liquidityUSD: 5000 });
        }

        // Measure next 100 with larger cache
        const start2 = performance.now();
        for (let i = 1100; i < 1200; i++) {
            await optimizer.quickReject({ mintAddress: `T${i}`, creatorAddress: 'C', liquidityUSD: 5000 });
        }
        const time2 = performance.now() - start2;

        // Performance should not degrade significantly
        const diff = Math.abs(time2 - time1);
        console.log(`Cache Scale Diff: ${diff.toFixed(2)}ms`);
        expect(diff).toBeLessThan(10); // Allowance for JS variation
    });
});
