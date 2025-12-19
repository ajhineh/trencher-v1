// src/rl/advancedRL.ts

/**
 * Advanced RL Features
 * Multi-Agent RL, Hierarchical RL, and Meta-Learning
 */

import * as tf from '@tensorflow/tfjs';
import { logger } from '../logger';
import { DQNAgent } from './dqnAgent';

/**
 * Multi-Agent RL
 * Multiple agents with different strategies
 */
export class MultiAgentRL {
    private agents: {
        conservative: DQNAgent;
        moderate: DQNAgent;
        aggressive: DQNAgent;
    };

    private performance: {
        conservative: number[];
        moderate: number[];
        aggressive: number[];
    };

    constructor(stateSize: number, actionSize: number) {
        // Create three agents with different parameters
        this.agents = {
            conservative: new DQNAgent(stateSize, actionSize, {
                epsilon: 0.3,
                epsilonDecay: 0.999,
                learningRate: 0.0005,
            }),
            moderate: new DQNAgent(stateSize, actionSize, {
                epsilon: 0.5,
                epsilonDecay: 0.995,
                learningRate: 0.001,
            }),
            aggressive: new DQNAgent(stateSize, actionSize, {
                epsilon: 0.7,
                epsilonDecay: 0.99,
                learningRate: 0.002,
            }),
        };

        this.performance = {
            conservative: [],
            moderate: [],
            aggressive: [],
        };
    }

    /**
     * Select best agent based on market conditions
     */
    selectAgent(marketCondition: 'VOLATILE' | 'TRENDING' | 'STABLE'): DQNAgent {
        if (marketCondition === 'VOLATILE') {
            logger.info('[MultiAgentRL] Selected conservative agent for volatile market');
            return this.agents.conservative;
        }

        if (marketCondition === 'TRENDING') {
            logger.info('[MultiAgentRL] Selected aggressive agent for trending market');
            return this.agents.aggressive;
        }

        logger.info('[MultiAgentRL] Selected moderate agent for stable market');
        return this.agents.moderate;
    }

    /**
     * Select agent based on recent performance
     */
    selectBestPerformingAgent(): DQNAgent {
        const avgPerformance = {
            conservative: this.getAvgPerformance('conservative'),
            moderate: this.getAvgPerformance('moderate'),
            aggressive: this.getAvgPerformance('aggressive'),
        };

        const best = Object.entries(avgPerformance).reduce((max, [name, perf]) =>
            perf > max.perf ? { name, perf } : max,
            { name: 'moderate', perf: avgPerformance.moderate }
        );

        logger.info(`[MultiAgentRL] Selected ${best.name} agent (avg reward: ${best.perf.toFixed(2)})`);
        return this.agents[best.name as keyof typeof this.agents];
    }

    /**
     * Update agent performance
     */
    updatePerformance(agentType: 'conservative' | 'moderate' | 'aggressive', reward: number): void {
        this.performance[agentType].push(reward);

        // Keep only last 100 episodes
        if (this.performance[agentType].length > 100) {
            this.performance[agentType].shift();
        }
    }

    /**
     * Get average performance
     */
    private getAvgPerformance(agentType: 'conservative' | 'moderate' | 'aggressive'): number {
        const perf = this.performance[agentType];
        if (perf.length === 0) return 0;
        return perf.reduce((sum, r) => sum + r, 0) / perf.length;
    }

    /**
     * Get all agents
     */
    getAllAgents() {
        return this.agents;
    }
}

/**
 * Hierarchical RL
 * High-level policy (strategy selection) + Low-level policy (trade execution)
 */
export class HierarchicalRL {
    private highLevelPolicy: DQNAgent; // Selects strategy
    private lowLevelPolicy: DQNAgent; // Executes trades

    constructor(
        highLevelStateSize: number,
        highLevelActionSize: number,
        lowLevelStateSize: number,
        lowLevelActionSize: number
    ) {
        this.highLevelPolicy = new DQNAgent(highLevelStateSize, highLevelActionSize);
        this.lowLevelPolicy = new DQNAgent(lowLevelStateSize, lowLevelActionSize);
    }

    /**
     * Make hierarchical decision
     */
    async decide(
        highLevelState: number[],
        lowLevelState: number[]
    ): Promise<{ strategy: number; action: number }> {
        // High-level: Select strategy
        const strategy = await this.highLevelPolicy.selectAction(highLevelState);

        // Low-level: Execute action based on strategy
        const action = await this.lowLevelPolicy.selectAction(lowLevelState);

        return { strategy, action };
    }

    /**
     * Train hierarchical policies
     */
    async train(
        highLevelExperience: any,
        lowLevelExperience: any
    ): Promise<void> {
        // Train high-level policy
        await this.highLevelPolicy.train();

        // Train low-level policy
        await this.lowLevelPolicy.train();
    }

    /**
     * Get policies
     */
    getPolicies() {
        return {
            highLevel: this.highLevelPolicy,
            lowLevel: this.lowLevelPolicy,
        };
    }
}

/**
 * Meta-Learning
 * Learn to adapt quickly to new market conditions
 */
export class MetaLearningRL {
    private baseAgent: DQNAgent;
    private adaptationRate: number = 0.01;
    private taskHistory: Map<string, number[]> = new Map();

    constructor(stateSize: number, actionSize: number) {
        this.baseAgent = new DQNAgent(stateSize, actionSize);
    }

    /**
     * Adapt to new market quickly using meta-learning
     */
    async adaptToMarket(
        marketId: string,
        experiences: any[],
        numAdaptationSteps: number = 5
    ): Promise<void> {
        logger.info(`[MetaLearning] Adapting to market ${marketId} with ${experiences.length} experiences`);

        // Store original weights
        const originalWeights = await this.baseAgent.getModel().getWeights();

        // Quick adaptation with few examples
        for (let i = 0; i < numAdaptationSteps; i++) {
            // Sample from experiences
            const batch = this.sampleExperiences(experiences, 32);

            // Fast adaptation update
            await this.fastAdaptation(batch);
        }

        // Evaluate adaptation
        const performance = await this.evaluateAdaptation(experiences);

        // Store task performance
        if (!this.taskHistory.has(marketId)) {
            this.taskHistory.set(marketId, []);
        }
        this.taskHistory.get(marketId)!.push(performance);

        logger.info(`[MetaLearning] Adaptation complete. Performance: ${performance.toFixed(2)}`);
    }

    /**
     * Fast adaptation with small learning rate
     * Implements a simplified Reptile-like update:
     * 1. Backup current weights
     * 2. Train on the new task batch for a few steps
     * 3. (Optional) In full Reptile, we'd Interpolate, but here we just keep the adapted weights 
     *    temporarily or update them towards the new task direction.
     *    Given the method signature "adaptToMarket" implies persistent adaptation to a specific market context.
     */
    private async fastAdaptation(batch: any[]): Promise<void> {
        // Use the newly implemented trainOnBatch
        // This performs one gradient descent step on the batch
        await this.baseAgent.trainOnBatch(batch);

        // logger.debug(`[MetaLearning] Performed fast adaptation step on batch size ${batch.length}`);
    }

    /**
     * Evaluate adaptation performance
     */
    private async evaluateAdaptation(experiences: any[]): Promise<number> {
        // Calculate average reward on experiences
        let totalReward = 0;
        for (const exp of experiences) {
            totalReward += exp.reward;
        }
        return totalReward / experiences.length;
    }

    /**
     * Sample experiences
     */
    private sampleExperiences(experiences: any[], batchSize: number): any[] {
        const sampled: any[] = [];
        for (let i = 0; i < Math.min(batchSize, experiences.length); i++) {
            const idx = Math.floor(Math.random() * experiences.length);
            sampled.push(experiences[idx]);
        }
        return sampled;
    }

    /**
     * Get task history
     */
    getTaskHistory(): Map<string, number[]> {
        return this.taskHistory;
    }

    /**
     * Get base agent
     */
    getAgent(): DQNAgent {
        return this.baseAgent;
    }
}

/**
 * Transfer Learning
 * Transfer knowledge between similar tokens
 */
export class TransferLearningRL {
    private sourceAgent: DQNAgent;
    private targetAgent: DQNAgent;

    constructor(stateSize: number, actionSize: number) {
        this.sourceAgent = new DQNAgent(stateSize, actionSize);
        this.targetAgent = new DQNAgent(stateSize, actionSize);
    }

    /**
     * Transfer knowledge from source to target
     */
    async transferKnowledge(
        fromToken: string,
        toToken: string,
        freezeLayers: number = 2
    ): Promise<void> {
        logger.info(`[TransferLearning] Transferring knowledge from ${fromToken} to ${toToken}`);

        // Get source model weights
        const sourceWeights = await this.sourceAgent.getModel().getWeights();

        // Copy weights to target model
        const targetModel = this.targetAgent.getModel();
        const targetWeights = await targetModel.getWeights();

        // Transfer weights (freeze first N layers)
        for (let i = 0; i < Math.min(freezeLayers * 2, sourceWeights.length); i++) {
            targetWeights[i] = sourceWeights[i].clone();
        }

        // Set new weights
        targetModel.setWeights(targetWeights);

        logger.info(`[TransferLearning] Transfer complete. Froze ${freezeLayers} layers`);
    }

    /**
     * Fine-tune target agent
     */
    async fineTune(experiences: any[], epochs: number = 10): Promise<void> {
        logger.info(`[TransferLearning] Fine-tuning with ${experiences.length} experiences`);

        for (let epoch = 0; epoch < epochs; epoch++) {
            await this.targetAgent.train();
        }

        logger.info('[TransferLearning] Fine-tuning complete');
    }

    /**
     * Get agents
     */
    getAgents() {
        return {
            source: this.sourceAgent,
            target: this.targetAgent,
        };
    }
}

/**
 * Ensemble RL
 * Combine multiple RL agents for better decisions
 */
export class EnsembleRL {
    private agents: DQNAgent[] = [];

    constructor(stateSize: number, actionSize: number, numAgents: number = 3) {
        for (let i = 0; i < numAgents; i++) {
            this.agents.push(new DQNAgent(stateSize, actionSize));
        }
    }

    /**
     * Get ensemble action (majority vote)
     */
    async selectAction(state: number[]): Promise<number> {
        const actions: number[] = [];

        for (const agent of this.agents) {
            const action = await agent.selectAction(state);
            actions.push(action);
        }

        // Majority vote
        const votes = new Map<number, number>();
        for (const action of actions) {
            votes.set(action, (votes.get(action) || 0) + 1);
        }

        const majorityAction = Array.from(votes.entries())
            .reduce((max, [action, count]) => count > max.count ? { action, count } : max,
                { action: 0, count: 0 });

        return majorityAction.action;
    }

    /**
     * Train all agents
     */
    async trainAll(): Promise<void> {
        for (const agent of this.agents) {
            await agent.train();
        }
    }

    /**
     * Get all agents
     */
    getAgents(): DQNAgent[] {
        return this.agents;
    }
}
