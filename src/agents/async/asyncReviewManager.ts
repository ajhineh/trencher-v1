import { AnalysisQueue, AnalysisJob, JobPriority, JobStatus } from './analysisQueue';
import { logger } from '../../logger';
import { v4 as uuidv4 } from 'uuid';
import { LLMProcessor } from './llmProcessor';
import { Connection } from '@solana/web3.js';

export class AsyncReviewManager {
    private static instance: AsyncReviewManager;
    private queue: AnalysisQueue;
    private processor: LLMProcessor | null = null;
    private isHighRiskMode: boolean = false;
    private connection: Connection | null = null;

    private constructor() {
        this.queue = new AnalysisQueue();
        this.loadConfig();
        this.setupEventHandlers();
    }

    public static getInstance(): AsyncReviewManager {
        if (!AsyncReviewManager.instance) {
            AsyncReviewManager.instance = new AsyncReviewManager();
        }
        return AsyncReviewManager.instance;
    }

    public initialize(connection: Connection) {
        this.connection = connection;
        this.processor = new LLMProcessor(connection);
        logger.info('[AsyncManager] Initialized with Connection');
    }

    private loadConfig() {
        this.isHighRiskMode = process.env.HIGH_RISK_MODE === 'true';
        logger.info(`[AsyncManager] High Risk Mode: ${this.isHighRiskMode ? 'ON' : 'OFF'}`);
    }

    private setupEventHandlers() {
        this.queue.on('process', async (job: AnalysisJob) => {
            logger.info(`[AsyncManager] Processing job ${job.id} for token ${job.tokenMint}`);

            if (!this.processor) {
                this.queue.fail(job.id, 'Processor not initialized');
                return;
            }

            try {
                const result = await this.processor.process(job);
                this.queue.complete(job.id, result);
            } catch (error: any) {
                this.queue.fail(job.id, error.message);
            }
        });

        this.queue.on('completed', (job: AnalysisJob) => {
            this.handleJobCompletion(job);
        });
    }

    private handleJobCompletion(job: AnalysisJob) {
        // Record feedback
        try {
            const feedbackManager = require('../../learning/feedbackManager').FeedbackManager.getInstance();
            feedbackManager.recordAnalysis(job.id, job.tokenMint, job.result);
        } catch (e) {
            logger.error(`[AsyncManager] Failed to record feedback: ${e}`);
        }

        if (job.result?.isSafe) {
            logger.info(`[AsyncManager] Token ${job.tokenMint} analysis PASSED. Score: ${job.result.score}`);
            // Notify user via Telegram
            // We can emit an event here that the main bot listens to
        } else {
            logger.info(`[AsyncManager] Token ${job.tokenMint} analysis FAILED. Reason: ${job.result.reason}`);

            // Auto-blacklist if confirmed SCAM or RUG
            const reason = (job.result.reason || '').toUpperCase();
            if (reason.includes('RUG') || reason.includes('SCAM') || reason.includes('HONEYPOT')) {
                try {
                    const { addRugPullRecord, addHoneypotToken } = require('../../risk/rugPullBlacklist');

                    if (reason.includes('HONEYPOT')) {
                        addHoneypotToken(job.tokenMint);
                    } else {
                        addRugPullRecord({
                            tokenMint: job.tokenMint,
                            creatorAddress: job.data?.coinCreator || job.data?.creatorAddress || 'UNKNOWN',
                            rugDate: new Date(),
                            rugType: 'UNKNOWN', // LLM didn't specify usually
                            losses: { affectedWallets: 0, estimatedUSDLoss: 0 },
                            notes: `Auto-detected by LLM: ${job.result.reason}`
                        });
                    }
                    logger.warn(`[AsyncManager] Auto-blacklisted ${job.tokenMint} based on LLM analysis.`);
                } catch (e) {
                    logger.error(`[AsyncManager] Failed to auto-blacklist: ${e}`);
                }
            }
        }
    }

    /**
     * Submit a token for review
     */
    public submitForReview(tokenMint: string, data: any): { shouldBuy: boolean; jobId?: string; message: string } {
        if (this.isHighRiskMode) {
            logger.warn(`[AsyncManager] High Risk Mode ON - Bypassing review for ${tokenMint}`);
            return { shouldBuy: true, message: 'High Risk Mode Bypassed Review' };
        }

        const jobId = uuidv4();
        this.queue.add({
            id: jobId,
            tokenMint,
            priority: JobPriority.MEDIUM,
            data
        });

        return {
            shouldBuy: false,
            jobId,
            message: 'Queued for Async Review'
        };
    }

    public getQueueStats() {
        return {
            length: this.queue.getQueueLength(),
            processing: this.queue.getProcessingCount(),
            highRiskMode: this.isHighRiskMode
        };
    }
}
