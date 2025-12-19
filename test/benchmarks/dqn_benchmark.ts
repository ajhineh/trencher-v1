
import { DQNAgent, DQNConfig } from '../../src/rl/dqnAgent';
import * as tf from '@tensorflow/tfjs';
import { performance } from 'perf_hooks';

// Force CPU backend for consistent testing or allow default
// await tf.setBackend('cpu'); 

async function runBenchmark() {
    console.log("Setting up DQN Benchmark...");

    const config: DQNConfig = {
        stateDim: 10,
        actionDim: 3,
        learningRate: 0.001,
        gamma: 0.99,
        epsilon: 0.1,
        epsilonMin: 0.01,
        epsilonDecay: 0.995,
        batchSize: 32,
        targetUpdateFreq: 100
    };

    const agent = new DQNAgent(config);

    // Warmup
    const dummyState = Array(10).fill(0.5);
    await agent.selectAction(dummyState);

    console.log("Starting Inference Benchmark (1000 iter)...");
    const startInf = performance.now();
    for (let i = 0; i < 1000; i++) {
        await agent.selectAction(dummyState);
    }
    const endInf = performance.now();
    const durationInf = endInf - startInf;
    console.log(`Inference Total: ${durationInf.toFixed(2)}ms`);
    console.log(`Inference Avg: ${(durationInf / 1000).toFixed(4)}ms/op`);
    console.log(`Inference Ops/Sec: ${(1000 / (durationInf / 1000)).toFixed(2)}`);

    // Setup Training Data
    console.log("Preparing Replay Buffer...");
    for (let i = 0; i < 100; i++) {
        agent.remember({
            state: Array(10).fill(Math.random()),
            action: Math.floor(Math.random() * 3),
            reward: Math.random(),
            nextState: Array(10).fill(Math.random()),
            done: Math.random() > 0.9
        });
    }

    console.log("Starting Training Benchmark (100 iter)...");
    const startTrain = performance.now();
    for (let i = 0; i < 100; i++) {
        await agent.train();
    }
    const endTrain = performance.now();
    const durationTrain = endTrain - startTrain;
    console.log(`Training Total: ${durationTrain.toFixed(2)}ms`);
    console.log(`Training Avg: ${(durationTrain / 100).toFixed(4)}ms/op`);
}

runBenchmark().then(() => console.log("Done"));
