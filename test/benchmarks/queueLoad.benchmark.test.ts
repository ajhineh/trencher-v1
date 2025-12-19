
import { AnalysisQueue, AnalysisJob, JobPriority } from '../../src/agents/async/analysisQueue';
import { AsyncReviewManager } from '../../src/agents/async/asyncReviewManager';
import { logger } from '../../src/logger';

// Mock uuid and p-limit to comply with Jest ESM issues
jest.mock('uuid', () => ({ v4: () => 'mock-uuid-' + Math.random() }));
jest.mock('p-limit', () => () => (fn: any) => fn());

// Mock logger to avoid clutter
logger.info = jest.fn();
logger.warn = jest.fn();
logger.error = jest.fn();

// Mock LLMProcessor inside AsyncReviewManager
jest.mock('../../src/agents/async/llmProcessor', () => {
    return {
        LLMProcessor: jest.fn().mockImplementation(() => {
            return {
                process: jest.fn().mockImplementation(async (job) => {
                    // Simulate random processing time (50ms - 200ms)
                    const delay = Math.floor(Math.random() * 150) + 50;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return {
                        isSafe: Math.random() > 0.5,
                        score: 80,
                        reason: 'Load Test Result'
                    };
                })
            };
        })
    };
});

describe('Queue Load Benchmark', () => {
    let manager: AsyncReviewManager;

    beforeAll(() => {
        // Reset singleton
        (AsyncReviewManager as any).instance = null;
        manager = AsyncReviewManager.getInstance();
        manager.initialize({} as any); // Mock connection
    });

    test('Should handle high load of 100 jobs', async () => {
        const JOB_COUNT = 100;
        const startTime = Date.now();

        // Submit jobs rapidly
        console.log(`[LoadTest] Submitting ${JOB_COUNT} jobs...`);
        for (let i = 0; i < JOB_COUNT; i++) {
            manager.submitForReview(`TOKEN_${i}`, { data: 'load_test' });
        }

        const submissionTime = Date.now() - startTime;
        console.log(`[LoadTest] Submission took ${submissionTime}ms`);

        // Poll for completion
        while (true) {
            const stats = manager.getQueueStats();
            if (stats.length === 0 && stats.processing === 0) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100)); // Poll every 100ms

            // Safety timeout (e.g. 30s)
            if (Date.now() - startTime > 30000) {
                throw new Error('Load test timed out!');
            }
        }

        const totalTime = Date.now() - startTime;
        const throughput = JOB_COUNT / (totalTime / 1000);

        console.log(`[LoadTest] Completed ${JOB_COUNT} jobs in ${totalTime}ms`);
        console.log(`[LoadTest] Throughput: ${throughput.toFixed(2)} jobs/sec`);

        expect(totalTime).toBeLessThan(30000); // Should be reasonable
        expect(throughput).toBeGreaterThan(1); // At least 1 job/sec with our mock delay
    });
});
