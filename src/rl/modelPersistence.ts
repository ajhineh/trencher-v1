// src/rl/modelPersistence.ts

import * as fs from 'fs';
import * as path from 'path';
import { DQNAgent } from './dqnAgent';
import { logger } from '../logger';

export class ModelPersistence {
    private modelDir: string;

    constructor(modelDir: string = './models/rl') {
        this.modelDir = modelDir;
        this.ensureDirectoryExists();
    }

    /**
     * Ensure model directory exists
     */
    private ensureDirectoryExists(): void {
        if (!fs.existsSync(this.modelDir)) {
            fs.mkdirSync(this.modelDir, { recursive: true });
            logger.info(`[ModelPersistence] Created directory: ${this.modelDir}`);
        }
    }

    /**
     * Save agent model
     */
    async saveAgent(agent: DQNAgent, modelName: string = 'dqn-model'): Promise<void> {
        const modelPath = path.join(this.modelDir, modelName);
        await agent.saveModel(modelPath);

        // Save metadata
        const metadata = {
            savedAt: new Date().toISOString(),
            epsilon: agent.getEpsilon(),
            bufferSize: agent.getBufferSize(),
        };

        const metadataPath = path.join(modelPath, 'metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        logger.info(`[ModelPersistence] Model and metadata saved to ${modelPath}`);
    }

    /**
     * Load agent model
     */
    async loadAgent(agent: DQNAgent, modelName: string = 'dqn-model'): Promise<void> {
        const modelPath = path.join(this.modelDir, modelName);

        if (!fs.existsSync(modelPath)) {
            throw new Error(`Model not found: ${modelPath}`);
        }

        await agent.loadModel(modelPath);

        // Load metadata
        const metadataPath = path.join(modelPath, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            agent.setEpsilon(metadata.epsilon);
            logger.info(`[ModelPersistence] Loaded model from ${modelPath} (epsilon: ${metadata.epsilon})`);
        }
    }

    /**
     * List available models
     */
    listModels(): string[] {
        if (!fs.existsSync(this.modelDir)) {
            return [];
        }

        return fs.readdirSync(this.modelDir).filter(file => {
            const fullPath = path.join(this.modelDir, file);
            return fs.statSync(fullPath).isDirectory();
        });
    }

    /**
     * Delete model
     */
    deleteModel(modelName: string): void {
        const modelPath = path.join(this.modelDir, modelName);
        if (fs.existsSync(modelPath)) {
            fs.rmSync(modelPath, { recursive: true });
            logger.info(`[ModelPersistence] Deleted model: ${modelPath}`);
        }
    }
}
