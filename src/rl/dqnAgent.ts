// src/rl/dqnAgent.ts

import * as tf from '@tensorflow/tfjs';
import { ReplayBuffer, Experience } from './replayBuffer';
import { logger } from '../logger';
import { latencyTracker } from '../performance/latencyTracker';

export interface DQNConfig {
    stateDim: number;
    actionDim: number;
    learningRate: number;
    gamma: number; // Discount factor
    epsilon: number; // Exploration rate
    epsilonMin: number;
    epsilonDecay: number;
    batchSize: number;
    targetUpdateFreq: number; // Steps between target network updates
}

export class DQNAgent {
    private config: DQNConfig;
    private model: tf.LayersModel;
    private targetModel: tf.LayersModel;
    private replayBuffer: ReplayBuffer;
    private stepCount: number = 0;

    constructor(
        stateOrConfig: number | DQNConfig,
        actionSize?: number,
        partialConfig?: Partial<DQNConfig>
    ) {
        // Support both constructor signatures
        if (typeof stateOrConfig === 'number') {
            // New signature: (stateSize, actionSize, partialConfig)
            this.config = {
                stateDim: stateOrConfig,
                actionDim: actionSize!,
                learningRate: partialConfig?.learningRate || 0.001,
                gamma: partialConfig?.gamma || 0.99,
                epsilon: partialConfig?.epsilon || 0.5,
                epsilonMin: partialConfig?.epsilonMin || 0.01,
                epsilonDecay: partialConfig?.epsilonDecay || 0.995,
                batchSize: partialConfig?.batchSize || 32,
                targetUpdateFreq: partialConfig?.targetUpdateFreq || 100,
            };
        } else {
            // Old signature: (config)
            this.config = stateOrConfig;
        }

        this.model = this.buildModel();
        this.targetModel = this.buildModel();
        this.replayBuffer = new ReplayBuffer(10000);

        // Initialize target model with same weights
        this.updateTargetModel();

        logger.info('[DQN] Agent initialized');
    }

    /**
     * Build DQN neural network
     */
    private buildModel(): tf.LayersModel {
        const model = tf.sequential();

        // Input layer
        model.add(tf.layers.dense({
            inputShape: [this.config.stateDim],
            units: 64,
            activation: 'relu',
            kernelInitializer: 'heNormal',
        }));

        // Hidden layer 1
        model.add(tf.layers.dense({
            units: 32,
            activation: 'relu',
            kernelInitializer: 'heNormal',
        }));

        // Output layer (Q-values for each action)
        model.add(tf.layers.dense({
            units: this.config.actionDim,
            activation: 'linear',
        }));

        // Compile model
        model.compile({
            optimizer: tf.train.adam(this.config.learningRate),
            loss: 'meanSquaredError',
        });

        return model;
    }

    /**
     * Select action using epsilon-greedy policy
     */
    async selectAction(state: number[]): Promise<number> {
        const stopTimer = latencyTracker.startTimer('DQN_Inference');

        try {
            // Exploration: random action
            if (Math.random() < this.config.epsilon) {
                return Math.floor(Math.random() * this.config.actionDim);
            }

            // Exploitation: best action from Q-network
            // Use tidy to automatically clean up intermediate tensors
            return tf.tidy(() => {
                const stateTensor = tf.tensor2d([state]);
                const qValues = this.model.predict(stateTensor) as tf.Tensor;
                const actionTensor = qValues.argMax(-1);
                // We still need dataSync() or data() to get value to JS, 
                // but argMax return is a scalar so overhead is small.
                // Using dataSync() here within tidy is safe for scalar and avoids async overhead for simple inference
                // if backend allows. For async-only backends, we'd need await outside tidy.
                // But tfjs-node/cpu usually supports sync.
                // Let's safe-guard with dataSync()[0] assuming synchronous backend availability or minimal blocking.
                return actionTensor.dataSync()[0];
            });
        } finally {
            stopTimer();
        }
    }

    /**
     * Store experience in replay buffer
     */
    remember(experience: Experience): void {
        this.replayBuffer.add(experience);
    }

    /**
     * Train on batch from replay buffer (Vectorized & Optimized)
     */
    async train(): Promise<number | null> {
        const stopTimer = latencyTracker.startTimer('DQN_Train');

        try {
            if (!this.replayBuffer.canSample(this.config.batchSize)) {
                return null; // Not enough samples
            }

            const batch = this.replayBuffer.sample(this.config.batchSize);

            // Prepare raw data arrays
            const states = batch.map(e => e.state);
            const actions = batch.map(e => e.action);
            const rewards = batch.map(e => e.reward);
            const nextStates = batch.map(e => e.nextState);
            const dones = batch.map(e => e.done ? 0 : 1); // 0 if done (mask), 1 if not

            // Optimize with tidy()
            // Note: model.fit cannot be inside tidy() usually because it creates internal variables or async updates.
            // So we prepare targets in tidy, then fit.

            let loss = 0;

            const { statesTensor, targetQsTensor } = tf.tidy(() => {
                const statesT = tf.tensor2d(states);
                const nextStatesT = tf.tensor2d(nextStates);
                const rewardsT = tf.tensor1d(rewards);
                const donesT = tf.tensor1d(dones);
                const actionsT = tf.tensor1d(actions, 'int32');

                // Get current Q-values (for the actions we NOT took, we want to keep them same to avoid error)
                // But standard DQN update: Target[action] = reward + gamma * max(nextQ)
                // Target[other] = CurrentQ[other]

                const currentQs = this.model.predict(statesT) as tf.Tensor;
                const nextQs = this.targetModel.predict(nextStatesT) as tf.Tensor;

                const maxNextQs = nextQs.max(-1); // [batch]

                // target = reward + gamma * maxNextQ * (1 - done)
                // Note: dones is 0 if done. Wait. 
                // Logic: if done, target = reward + 0.
                // So mask should be 0 if done. My dones map above: done?0:1. Correct.

                const targetValues = rewardsT.add(maxNextQs.mul(this.config.gamma).mul(donesT));

                // We need to update ONLY the specific action indices in the current Q-values.
                // One way is using tf.oneHot to create a mask.

                const actionMask = tf.oneHot(actionsT, this.config.actionDim); // [batch, actionDim]
                const inverseActionMask = tf.onesLike(actionMask).sub(actionMask);

                // New Target Qs = (currentQs * inverseMask) + (targetValues * actionMask)
                // Need to reshape targetValues to [batch, 1] to broadcast
                const targetValuesReshaped = targetValues.expandDims(-1);

                const targetQs = currentQs.mul(inverseActionMask).add(actionMask.mul(targetValuesReshaped));

                return { statesTensor: statesT, targetQsTensor: targetQs };
            });

            // Train model
            try {
                const history = await this.model.fit(statesTensor, targetQsTensor, {
                    epochs: 1,
                    verbose: 0,
                    batchSize: this.config.batchSize
                });
                loss = history.history.loss[0] as number;
            } finally {
                // Cleanup tensors created for fit
                statesTensor.dispose();
                targetQsTensor.dispose();
            }

            // Update target network periodically
            this.stepCount++;
            if (this.stepCount % this.config.targetUpdateFreq === 0) {
                this.updateTargetModel();
                logger.info('[DQN] Target network updated');
            }

            // Decay epsilon
            if (this.config.epsilon > this.config.epsilonMin) {
                this.config.epsilon *= this.config.epsilonDecay;
            }

            return loss;
        } finally {
            stopTimer();
        }
    }

    /**
     * Update target network with current model weights
     */
    private updateTargetModel(): void {
        const weights = this.model.getWeights();
        this.targetModel.setWeights(weights);
    }

    /**
     * Save model to file
     */
    async saveModel(path: string): Promise<void> {
        await this.model.save(`file://${path}`);
        logger.info(`[DQN] Model saved to ${path}`);
    }

    /**
     * Load model from file
     */
    async loadModel(path: string): Promise<void> {
        this.model = await tf.loadLayersModel(`file://${path}/model.json`);
        this.updateTargetModel();
        logger.info(`[DQN] Model loaded from ${path}`);
    }

    /**
     * Get current epsilon
     */
    getEpsilon(): number {
        return this.config.epsilon;
    }

    /**
     * Set epsilon (for testing/deployment)
     */
    setEpsilon(epsilon: number): void {
        this.config.epsilon = epsilon;
    }

    /**
     * Get replay buffer size
     */
    getBufferSize(): number {
        return this.replayBuffer.size();
    }

    /**
     * Get the model (for advanced RL features)
     */
    getModel(): tf.LayersModel {
        return this.model;
    }

    /**
     * Train on a specific batch of experiences (for Meta-Learning)
     */
    async trainOnBatch(experiences: Experience[]): Promise<void> {
        if (experiences.length === 0) return;

        const states: number[][] = [];
        const actions: number[] = [];
        const rewards: number[] = [];
        const nextStates: number[][] = [];
        const dones: boolean[] = [];

        experiences.forEach(exp => {
            states.push(exp.state);
            actions.push(exp.action);
            rewards.push(exp.reward);
            nextStates.push(exp.nextState);
            dones.push(exp.done);
        });

        const stateTensor = tf.tensor2d(states);
        const nextStateTensor = tf.tensor2d(nextStates);

        // Calculate target Q-values
        const targetQ = this.targetModel.predict(nextStateTensor) as tf.Tensor;
        const targetQVal = await targetQ.data();

        // Calculate Q-values for current states
        const target = await this.model.predict(stateTensor) as tf.Tensor;
        const targetVal = Float32Array.from(await target.data());

        // Update target values
        for (let i = 0; i < experiences.length; i++) {
            let qTarget = rewards[i];
            if (!dones[i]) {
                const maxNextQ = Math.max(...Array.from(targetQVal).slice(i * this.config.actionDim, (i + 1) * this.config.actionDim));
                qTarget += this.config.gamma * maxNextQ;
            }

            const actionIdx = i * this.config.actionDim + actions[i];
            targetVal[actionIdx] = qTarget;
        }

        const targetTensor = tf.tensor2d(targetVal, [experiences.length, this.config.actionDim]);

        // Train model on this batch
        await this.model.fit(stateTensor, targetTensor, {
            batchSize: experiences.length, // Full batch
            epochs: 1,
            verbose: 0,
        });

        // Cleanup tensors
        stateTensor.dispose();
        nextStateTensor.dispose();
        targetQ.dispose();
        target.dispose();
        targetTensor.dispose();
    }
}
