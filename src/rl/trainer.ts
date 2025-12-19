// src/rl/trainer.ts

import { Connection } from "@solana/web3.js";
import { DQNAgent, DQNConfig } from "./dqnAgent";
import { StateEncoder, MarketData, PortfolioData, PositionData } from "./stateEncoder";
import { RewardCalculator, TradeOutcome } from "./rewardCalculator";
import { DataReplay, BacktestConfig } from "../backtesting/dataReplay";
import { logger } from "../logger";
import { Experience } from "./replayBuffer";

export interface TrainingConfig {
    episodes: number;
    maxStepsPerEpisode: number;
    saveInterval: number; // Episodes between saves
    modelSavePath: string;
}

export class RLTrainer {
    private agent: DQNAgent;
    private stateEncoder: StateEncoder;
    private rewardCalculator: RewardCalculator;
    private dataReplay: DataReplay;

    constructor() {
        // Initialize DQN agent
        const dqnConfig: DQNConfig = {
            stateDim: 15,
            actionDim: 3, // IGNORE, BUY, SELL
            learningRate: 0.001,
            gamma: 0.95,
            epsilon: 1.0, // Start with full exploration
            epsilonMin: 0.01,
            epsilonDecay: 0.995,
            batchSize: 32,
            targetUpdateFreq: 100,
        };

        this.agent = new DQNAgent(dqnConfig);
        this.stateEncoder = new StateEncoder();
        this.rewardCalculator = new RewardCalculator();
        this.dataReplay = new DataReplay();
    }

    /**
     * Train agent on historical data
     */
    async train(config: TrainingConfig): Promise<void> {
        logger.info('[RL Trainer] Starting training...');
        logger.info(`[RL Trainer] Episodes: ${config.episodes}`);

        // Load historical data
        const backtestConfig: BacktestConfig = {
            startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            endDate: new Date(),
            initialCapital: 1.0,
            dataSource: 'generated',
        };
        await this.dataReplay.loadData(backtestConfig);

        // Training loop
        for (let episode = 0; episode < config.episodes; episode++) {
            await this.runEpisode(episode, config);

            // Save model periodically
            if ((episode + 1) % config.saveInterval === 0) {
                await this.agent.saveModel(config.modelSavePath);
                logger.info(`[RL Trainer] Model saved at episode ${episode + 1}`);
            }
        }

        // Final save
        await this.agent.saveModel(config.modelSavePath);
        logger.info('[RL Trainer] Training complete!');
    }

    /**
     * Run single training episode
     */
    private async runEpisode(episode: number, config: TrainingConfig): Promise<void> {
        this.dataReplay.reset();

        let totalReward = 0;
        let steps = 0;
        let hasPosition = false;
        let positionEntry: any = null;

        while (steps < config.maxStepsPerEpisode) {
            const token = this.dataReplay.getNextToken();
            if (!token) break;

            // Encode state
            const marketData: MarketData = {
                liquidityUsd: token.liquidityUsd,
                recentBuyers: token.recentBuyers,
                ageMs: token.ageMs,
                fdv: token.fdv,
                volatility: 10, // Simplified
                pumpDumpScore: 20, // Simplified
                whaleRisk: false,
                coordinatedBuying: 10,
            };

            const portfolioData: PortfolioData = {
                capitalUtilization: 30,
                openPositions: hasPosition ? 1 : 0,
                winRate: 50,
                currentDrawdown: 5,
            };

            const positionData: PositionData = {
                hasPosition,
                pnlPercent: hasPosition && positionEntry ? token.actualOutcome!.priceChange24h : 0,
                timeInPositionMs: hasPosition && positionEntry ? Date.now() - positionEntry.timestamp : 0,
            };

            const state = this.stateEncoder.encode(marketData, portfolioData, positionData);

            // Select action
            const action = await this.agent.selectAction(state);

            // Execute action and get reward
            let reward = 0;
            let done = false;

            if (action === 1 && !hasPosition) {
                // BUY
                hasPosition = true;
                positionEntry = token;
                reward = -0.01; // Immediate cost
            } else if (action === 2 && hasPosition) {
                // SELL
                const outcome: TradeOutcome = {
                    action: 'SELL',
                    pnlPercent: token.actualOutcome!.priceChange24h,
                    pnlSol: 0,
                    timeHeld: 1,
                };
                reward = this.rewardCalculator.calculateReward('SELL', outcome);
                hasPosition = false;
                positionEntry = null;
                done = true;
            } else {
                // IGNORE or invalid action
                reward = 0;
            }

            // Get next state
            const nextToken = this.dataReplay.getNextToken();
            const nextState = nextToken
                ? this.stateEncoder.encode(marketData, portfolioData, positionData)
                : state;

            // Store experience
            const experience: Experience = {
                state,
                action,
                reward,
                nextState,
                done,
            };
            this.agent.remember(experience);

            // Train
            const loss = await this.agent.train();

            totalReward += reward;
            steps++;

            // Log progress
            if (loss !== null && steps % 10 === 0) {
                logger.info(
                    `[RL Trainer] Episode ${episode + 1}, Step ${steps}, ` +
                    `Loss: ${loss.toFixed(4)}, Reward: ${totalReward.toFixed(2)}, ` +
                    `Epsilon: ${this.agent.getEpsilon().toFixed(3)}`
                );
            }
        }

        logger.info(
            `[RL Trainer] Episode ${episode + 1} complete. ` +
            `Total reward: ${totalReward.toFixed(2)}, Steps: ${steps}`
        );
    }

    /**
     * Get trained agent
     */
    getAgent(): DQNAgent {
        return this.agent;
    }
}
