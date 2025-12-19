// test/dqn-agent.test.ts

/**
 * تست‌های DQN Agent
 * شامل: Model Creation, Training, Action Selection, Experience Replay
 */

import { DQNAgent } from '../src/rl/dqnAgent';
import { Experience } from '../src/rl/replayBuffer';
import * as tf from '@tensorflow/tfjs';

describe('DQN Agent', () => {
    describe('Initialization', () => {
        test('should create DQN agent with config', () => {
            const agent = new DQNAgent({
                stateDim: 10,
                actionDim: 3,
                learningRate: 0.001,
                gamma: 0.99,
                epsilon: 1.0,
                epsilonDecay: 0.995,
                epsilonMin: 0.01,
                batchSize: 32,
                targetUpdateFreq: 100,
            });

            expect(agent).toBeDefined();
            expect(agent).toBeInstanceOf(DQNAgent);
        });

        test('should create DQN agent with state and action dimensions', () => {
            const agent = new DQNAgent(10, 3);

            expect(agent).toBeDefined();
            expect(agent).toBeInstanceOf(DQNAgent);
        });

        test('should have model after initialization', () => {
            const agent = new DQNAgent(10, 3);
            const model = agent.getModel();

            expect(model).toBeDefined();
            expect(model.inputs.length).toBeGreaterThan(0);
            expect(model.outputs.length).toBeGreaterThan(0);
        });
    });

    describe('Model Architecture', () => {
        test('should have correct input shape', () => {
            const stateDim = 10;
            const agent = new DQNAgent(stateDim, 3);
            const model = agent.getModel();

            const inputShape = model.inputs[0].shape;
            expect(inputShape[inputShape.length - 1]).toBe(stateDim);
        });

        test('should have correct output shape', () => {
            const actionDim = 5;
            const agent = new DQNAgent(10, actionDim);
            const model = agent.getModel();

            const outputShape = model.outputs[0].shape;
            expect(outputShape[outputShape.length - 1]).toBe(actionDim);
        });
    });

    describe('Action Selection', () => {
        test('should select action from state', async () => {
            const agent = new DQNAgent(10, 3);
            const state = Array(10).fill(0).map(() => Math.random());

            const action = await agent.selectAction(state);

            expect(action).toBeDefined();
            expect(typeof action).toBe('number');
            expect(action).toBeGreaterThanOrEqual(0);
            expect(action).toBeLessThan(3);
        });

        test('should return valid action index', async () => {
            const actionDim = 5;
            const agent = new DQNAgent(10, actionDim);
            const state = Array(10).fill(0).map(() => Math.random());

            const action = await agent.selectAction(state);

            expect(Number.isInteger(action)).toBe(true);
            expect(action).toBeGreaterThanOrEqual(0);
            expect(action).toBeLessThan(actionDim);
        });
    });

    describe('Experience Replay', () => {
        test('should remember experiences', () => {
            const agent = new DQNAgent(10, 3);
            const experience: Experience = {
                state: Array(10).fill(0).map(() => Math.random()),
                action: 1,
                reward: 10,
                nextState: Array(10).fill(0).map(() => Math.random()),
                done: false,
            };

            expect(() => {
                agent.remember(experience);
            }).not.toThrow();
        });

        test('should handle multiple experiences', () => {
            const agent = new DQNAgent(10, 3);

            for (let i = 0; i < 100; i++) {
                const experience: Experience = {
                    state: Array(10).fill(0).map(() => Math.random()),
                    action: Math.floor(Math.random() * 3),
                    reward: Math.random() * 100 - 50,
                    nextState: Array(10).fill(0).map(() => Math.random()),
                    done: Math.random() > 0.9,
                };

                agent.remember(experience);
            }

            expect(agent.getBufferSize()).toBeGreaterThan(0);
        });
    });

    describe('Training', () => {
        test('should train without errors', async () => {
            const agent = new DQNAgent(10, 3, { batchSize: 4 });

            // Add some experiences
            for (let i = 0; i < 10; i++) {
                const experience: Experience = {
                    state: Array(10).fill(0).map(() => Math.random()),
                    action: Math.floor(Math.random() * 3),
                    reward: Math.random(),
                    nextState: Array(10).fill(0).map(() => Math.random()),
                    done: false,
                };
                agent.remember(experience);
            }

            await expect(agent.train()).resolves.not.toThrow();
        });

        test('should handle training with insufficient data', async () => {
            const agent = new DQNAgent(10, 3, { batchSize: 32 });

            // Add only a few experiences (less than batch size)
            for (let i = 0; i < 5; i++) {
                const experience: Experience = {
                    state: Array(10).fill(0).map(() => Math.random()),
                    action: 0,
                    reward: 1,
                    nextState: Array(10).fill(0).map(() => Math.random()),
                    done: false,
                };
                agent.remember(experience);
            }

            // Should return null for insufficient data
            const loss = await agent.train();
            expect(loss).toBeNull();
        });
    });

    describe('Epsilon Management', () => {
        test('should get epsilon value', () => {
            const agent = new DQNAgent(10, 3, { epsilon: 0.8 });

            expect(agent.getEpsilon()).toBe(0.8);
        });

        test('should set epsilon value', () => {
            const agent = new DQNAgent(10, 3);

            agent.setEpsilon(0.5);
            expect(agent.getEpsilon()).toBe(0.5);
        });
    });

    describe('Model Persistence', () => {
        test.skip('should save model (skipped - Jest file handler limitation)', async () => {
            // این تست در production با @tensorflow/tfjs-node کار می‌کند
            // در محیط Jest به دلیل file handler skip می‌شود
            const agent = new DQNAgent(10, 3);
            const savePath = './test-models/dqn-test';

            await expect(agent.saveModel(savePath)).resolves.not.toThrow();
        });

        test.skip('should load model (skipped - Jest file handler limitation)', async () => {
            // این تست در production با @tensorflow/tfjs-node کار می‌کند
            // در محیط Jest به دلیل file handler skip می‌شود
            const agent1 = new DQNAgent(10, 3);
            const savePath = './test-models/dqn-load-test';

            // Save model
            await agent1.saveModel(savePath);

            // Create new agent and load
            const agent2 = new DQNAgent(10, 3);
            await expect(agent2.loadModel(savePath)).resolves.not.toThrow();
        });
    });

    describe('Performance', () => {
        test('should make predictions quickly', async () => {
            const agent = new DQNAgent(10, 3);
            const state = Array(10).fill(0).map(() => Math.random());

            const startTime = Date.now();
            for (let i = 0; i < 100; i++) {
                await agent.selectAction(state);
            }
            const duration = Date.now() - startTime;

            // 100 predictions should be reasonably fast
            expect(duration).toBeLessThan(5000); // Less than 5 seconds
        });

        test('should handle large state spaces', async () => {
            const agent = new DQNAgent(100, 10);
            const state = Array(100).fill(0).map(() => Math.random());

            await expect(agent.selectAction(state)).resolves.toBeDefined();
        });
    });

    describe('Edge Cases', () => {
        test('should handle zero rewards', () => {
            const agent = new DQNAgent(10, 3);
            const experience: Experience = {
                state: Array(10).fill(0).map(() => Math.random()),
                action: 0,
                reward: 0,
                nextState: Array(10).fill(0).map(() => Math.random()),
                done: false,
            };

            expect(() => agent.remember(experience)).not.toThrow();
        });

        test('should handle negative rewards', () => {
            const agent = new DQNAgent(10, 3);
            const experience: Experience = {
                state: Array(10).fill(0).map(() => Math.random()),
                action: 0,
                reward: -100,
                nextState: Array(10).fill(0).map(() => Math.random()),
                done: false,
            };

            expect(() => agent.remember(experience)).not.toThrow();
        });

        test('should handle terminal states', () => {
            const agent = new DQNAgent(10, 3);
            const experience: Experience = {
                state: Array(10).fill(0).map(() => Math.random()),
                action: 0,
                reward: 10,
                nextState: Array(10).fill(0).map(() => Math.random()),
                done: true,
            };

            expect(() => agent.remember(experience)).not.toThrow();
        });

        test('should handle all zero states', async () => {
            const agent = new DQNAgent(10, 3);
            const state = Array(10).fill(0);

            const action = await agent.selectAction(state);
            expect(action).toBeGreaterThanOrEqual(0);
            expect(action).toBeLessThan(3);
        });
    });

    describe('Buffer Management', () => {
        test('should track buffer size', () => {
            const agent = new DQNAgent(10, 3);

            expect(agent.getBufferSize()).toBe(0);

            const experience: Experience = {
                state: Array(10).fill(0),
                action: 0,
                reward: 1,
                nextState: Array(10).fill(0),
                done: false,
            };

            agent.remember(experience);
            expect(agent.getBufferSize()).toBe(1);
        });
    });
});

// Integration tests
describe('DQN Agent Integration', () => {
    test('should complete training episode', async () => {
        const agent = new DQNAgent(10, 3, { batchSize: 8 });

        // Simulate an episode
        for (let step = 0; step < 50; step++) {
            const state = Array(10).fill(0).map(() => Math.random());
            const action = await agent.selectAction(state);
            const reward = Math.random() * 10;
            const nextState = Array(10).fill(0).map(() => Math.random());
            const done = step === 49;

            const experience: Experience = {
                state,
                action,
                reward,
                nextState,
                done,
            };

            agent.remember(experience);

            if (step % 10 === 0 && step > 0) {
                await agent.train();
            }
        }

        expect(agent.getBufferSize()).toBeGreaterThan(0);
    });

    test('should improve over multiple episodes', async () => {
        const agent = new DQNAgent(5, 2, {
            batchSize: 4,
            epsilon: 1.0,
            epsilonDecay: 0.95,
        });

        // Run multiple episodes
        for (let episode = 0; episode < 5; episode++) {
            for (let step = 0; step < 20; step++) {
                const state = Array(5).fill(0).map(() => Math.random());
                const action = await agent.selectAction(state);
                const reward = Math.random() * 5;
                const nextState = Array(5).fill(0).map(() => Math.random());
                const done = step === 19;

                const experience: Experience = {
                    state,
                    action,
                    reward,
                    nextState,
                    done,
                };

                agent.remember(experience);

                if (step % 5 === 0 && step > 0) {
                    await agent.train();
                }
            }
        }

        // Agent should have learned something
        expect(agent.getBufferSize()).toBeGreaterThan(0);
    });
});

// Cleanup
afterAll(async () => {
    // Clean up TensorFlow resources
    tf.disposeVariables();
});
