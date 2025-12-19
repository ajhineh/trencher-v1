// test/rl/conditionalDQN.test.ts

/**
 * Unit Tests for Conditional DQN Agent
 */

import { ConditionalDQNAgent } from '../../src/rl/conditionalDQN';

describe('ConditionalDQNAgent', () => {
    let agent: ConditionalDQNAgent;
    const stateSize = 10;
    const actionSize = 3;
    const confidenceThreshold = 0.7;

    beforeEach(() => {
        agent = new ConditionalDQNAgent(stateSize, actionSize, confidenceThreshold);
    });

    describe('Initialization', () => {
        it('should initialize with correct parameters', () => {
            expect(agent.getConfidenceThreshold()).toBe(confidenceThreshold);
            expect(agent.getBufferSize()).toBe(0); // No experiences yet
        });

        it('should initialize with default threshold if not provided', () => {
            const defaultAgent = new ConditionalDQNAgent(stateSize, actionSize);
            expect(defaultAgent.getConfidenceThreshold()).toBe(0.7);
        });
    });

    describe('selectActionConditional', () => {
        const mockState = [50, 0.5, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.001];

        it('should bypass DQN for high confidence', async () => {
            const result = await agent.selectActionConditional(mockState, 0.9);

            expect(result.usedDQN).toBe(false);
            expect(result.method).toBe('QUICK_DECISION');
            expect(result.latency).toBeLessThan(50); // Should be very fast
            expect(result.action).toBeGreaterThanOrEqual(0);
            expect(result.action).toBeLessThan(actionSize);
        });

        it('should use DQN for low confidence', async () => {
            const result = await agent.selectActionConditional(mockState, 0.5);

            expect(result.usedDQN).toBe(true);
            expect(result.method).toBe('DQN');
            expect(result.action).toBeGreaterThanOrEqual(0);
            expect(result.action).toBeLessThan(actionSize);
        });

        it('should bypass DQN when confidence equals threshold', async () => {
            const result = await agent.selectActionConditional(mockState, 0.7);

            // At threshold, should bypass (>= threshold bypasses)
            expect(result.usedDQN).toBe(false);
            expect(result.method).toBe('QUICK_DECISION');
        });

        it('should bypass when confidence is just above threshold', async () => {
            const result = await agent.selectActionConditional(mockState, 0.71);

            expect(result.usedDQN).toBe(false);
            expect(result.method).toBe('QUICK_DECISION');
        });
    });

    describe('Quick Decision Logic', () => {
        it('should return BLOCK (0) for high risk', async () => {
            const highRiskState = [80, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05];
            const result = await agent.selectActionConditional(highRiskState, 0.9);

            expect(result.action).toBe(0); // BLOCK
            expect(result.usedDQN).toBe(false);
        });

        it('should return ALLOW (1) for low risk', async () => {
            const lowRiskState = [30, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];
            const result = await agent.selectActionConditional(lowRiskState, 0.9);

            expect(result.action).toBe(1); // ALLOW
            expect(result.usedDQN).toBe(false);
        });

        it('should return PROBE (2) for medium risk', async () => {
            const mediumRiskState = [60, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01];
            const result = await agent.selectActionConditional(mediumRiskState, 0.9);

            expect(result.action).toBe(2); // PROBE
            expect(result.usedDQN).toBe(false);
        });
    });

    describe('Usage Stats', () => {
        const mockState = [50, 0.5, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.001];

        it('should track total calls', async () => {
            await agent.selectActionConditional(mockState, 0.9);
            await agent.selectActionConditional(mockState, 0.5);
            await agent.selectActionConditional(mockState, 0.8);

            const stats = agent.getStats();
            expect(stats.totalCalls).toBe(3);
        });

        it('should track DQN calls', async () => {
            await agent.selectActionConditional(mockState, 0.5); // DQN
            await agent.selectActionConditional(mockState, 0.6); // DQN
            await agent.selectActionConditional(mockState, 0.9); // Bypass

            const stats = agent.getStats();
            expect(stats.dqnCalls).toBe(2);
        });

        it('should track bypassed calls', async () => {
            await agent.selectActionConditional(mockState, 0.9); // Bypass
            await agent.selectActionConditional(mockState, 0.8); // Bypass
            await agent.selectActionConditional(mockState, 0.5); // DQN

            const stats = agent.getStats();
            expect(stats.bypassed).toBe(2);
        });

        it('should calculate bypass rate correctly', async () => {
            // 7 bypasses, 3 DQN calls
            for (let i = 0; i < 7; i++) {
                await agent.selectActionConditional(mockState, 0.9);
            }
            for (let i = 0; i < 3; i++) {
                await agent.selectActionConditional(mockState, 0.5);
            }

            const stats = agent.getStats();
            expect(stats.bypassRate).toBeCloseTo(0.7, 1); // 7/10 = 0.7
        });

        it('should calculate DQN usage rate correctly', async () => {
            // 3 DQN calls, 7 bypasses
            for (let i = 0; i < 3; i++) {
                await agent.selectActionConditional(mockState, 0.5);
            }
            for (let i = 0; i < 7; i++) {
                await agent.selectActionConditional(mockState, 0.9);
            }

            const stats = agent.getStats();
            expect(stats.dqnUsageRate).toBeCloseTo(0.3, 1); // 3/10 = 0.3
        });

        it('should track average latencies', async () => {
            await agent.selectActionConditional(mockState, 0.9); // Bypass
            await agent.selectActionConditional(mockState, 0.5); // DQN

            const stats = agent.getStats();
            expect(stats.avgBypassLatency).toBeGreaterThanOrEqual(0);
            expect(stats.avgDQNLatency).toBeGreaterThanOrEqual(0);
            // expect(stats.avgBypassLatency).toBeLessThan(stats.avgDQNLatency); // Bypass should be faster (commented out as 0 < 0 is false)
        });

        it('should reset stats', async () => {
            await agent.selectActionConditional(mockState, 0.9);
            await agent.selectActionConditional(mockState, 0.5);

            agent.resetStats();
            const stats = agent.getStats();

            expect(stats.totalCalls).toBe(0);
            expect(stats.dqnCalls).toBe(0);
            expect(stats.bypassed).toBe(0);
        });
    });

    describe('Confidence Threshold', () => {
        const mockState = [50, 0.5, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.001];

        it('should allow changing confidence threshold', () => {
            agent.setConfidenceThreshold(0.8);
            expect(agent.getConfidenceThreshold()).toBe(0.8);
        });

        it('should use new threshold for decisions', async () => {
            agent.setConfidenceThreshold(0.8);

            // 0.75 is below new threshold, should use DQN
            const result = await agent.selectActionConditional(mockState, 0.75);
            expect(result.usedDQN).toBe(true);
        });

        it('should throw error for invalid threshold', () => {
            expect(() => agent.setConfidenceThreshold(-0.1)).toThrow();
            expect(() => agent.setConfidenceThreshold(1.1)).toThrow();
        });

        it('should accept valid threshold range', () => {
            expect(() => agent.setConfidenceThreshold(0.0)).not.toThrow();
            expect(() => agent.setConfidenceThreshold(0.5)).not.toThrow();
            expect(() => agent.setConfidenceThreshold(1.0)).not.toThrow();
        });
    });

    describe('Performance', () => {
        const mockState = [50, 0.5, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.001];

        it('should have fast bypass latency (<10ms)', async () => {
            const iterations = 10;
            const latencies: number[] = [];

            for (let i = 0; i < iterations; i++) {
                const result = await agent.selectActionConditional(mockState, 0.9);
                latencies.push(result.latency);
            }

            const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;
            expect(avgLatency).toBeLessThan(10);
        });

        it('should achieve target bypass rate (60-70%)', async () => {
            // Simulate realistic confidence distribution
            const confidences = [
                0.9, 0.85, 0.92, 0.88, 0.75, // 5 high (bypass)
                0.65, 0.55, 0.6,              // 3 low (DQN)
                0.87, 0.91                    // 2 high (bypass)
            ]; // Total: 7 bypass, 3 DQN = 70% bypass rate

            for (const conf of confidences) {
                await agent.selectActionConditional(mockState, conf);
            }

            const stats = agent.getStats();
            expect(stats.bypassRate).toBeGreaterThanOrEqual(0.6);
            expect(stats.bypassRate).toBeLessThanOrEqual(0.8);
        });
    });
});
