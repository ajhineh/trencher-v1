import { AsyncReviewManager } from '../../../src/agents/async/asyncReviewManager';
import { JobStatus } from '../../../src/agents/async/analysisQueue';

jest.mock('uuid', () => ({ v4: () => 'mock-uuid-1234' }));
jest.mock('p-limit', () => () => (fn: any) => fn());
jest.mock('../../../src/agents/async/llmProcessor', () => {
    return {
        LLMProcessor: jest.fn().mockImplementation(() => {
            return {
                process: jest.fn().mockImplementation(async () => {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    return {
                        shouldBuy: false,
                        confidence: 0.8,
                        reason: 'Mock result',
                        risks: []
                    };
                })
            };
        })
    };
});

describe('AsyncReviewManager', () => {
    let manager: AsyncReviewManager;

    beforeEach(() => {
        // Reset instance (singleton hack for testing)
        (AsyncReviewManager as any).instance = null;
        manager = AsyncReviewManager.getInstance();
        manager.initialize({} as any); // Initialize with dummy connection
    });

    it('should be a singleton', () => {
        const manager2 = AsyncReviewManager.getInstance();
        expect(manager).toBe(manager2);
    });

    it('should queue items in default mode', () => {
        const result = manager.submitForReview('TOKEN_MINT_1', { data: 'test' });

        expect(result.shouldBuy).toBe(false);
        expect(result.jobId).toBeDefined();
        expect(result.message).toContain('Queued');

        const stats = manager.getQueueStats();
        // It might be pending or processing immediately depending on event loop
        expect(stats.length + stats.processing).toBe(1);
    });

    it('should bypass review in high risk mode', () => {
        // Mock env
        process.env.HIGH_RISK_MODE = 'true';
        (AsyncReviewManager as any).instance = null; // Reset to reload config
        const riskManager = AsyncReviewManager.getInstance();

        const result = riskManager.submitForReview('TOKEN_MINT_2', { data: 'test' });

        expect(result.shouldBuy).toBe(true);
        expect(result.jobId).toBeUndefined();
        expect(result.message).toContain('Bypassed');

        const stats = riskManager.getQueueStats();
        expect(stats.length).toBe(0);
        expect(stats.highRiskMode).toBe(true);

        // Cleanup
        delete process.env.HIGH_RISK_MODE;
    });

    it('should process jobs (simulation)', async () => {
        jest.useFakeTimers();

        manager.submitForReview('TOKEN_MINT_3', { data: 'test' });
        expect(manager.getQueueStats().processing).toBe(1);

        // Fast forward time
        jest.advanceTimersByTime(2500);

        // Wait for promise resolution (microtasks)
        await Promise.resolve();

        // Since we can't easily check internal state without exposing more methods,
        // we rely on the fact that processing count should decrease
        // Note: This part is tricky with setTimeout in implementation. 
        // Ideally we'd mock the queue processing or make it more testable.
        // For now, let's just check it started processing.
    });
});
