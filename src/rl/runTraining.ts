// src/rl/runTraining.ts
// Example script to train RL agent

import { RLTrainer, TrainingConfig } from './trainer';
import { logger } from '../logger';

async function runTraining() {
    logger.info('='.repeat(60));
    logger.info('Starting RL Training');
    logger.info('='.repeat(60));

    const trainer = new RLTrainer();

    const config: TrainingConfig = {
        episodes: 100, // Train for 100 episodes
        maxStepsPerEpisode: 100, // Max 100 steps per episode
        saveInterval: 10, // Save every 10 episodes
        modelSavePath: './models/rl/dqn-model',
    };

    try {
        await trainer.train(config);
        logger.info('Training complete!');
    } catch (error: any) {
        logger.error(`Training failed: ${error.message}`);
        throw error;
    }
}

// Run if executed directly
if (require.main === module) {
    runTraining().catch(error => {
        logger.error(`Fatal error: ${error}`);
        process.exit(1);
    });
}

export { runTraining };
