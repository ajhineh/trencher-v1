import { AnalysisQueue, AnalysisJob, JobStatus } from './analysisQueue';
import { AsyncReviewManager } from './asyncReviewManager';
import { askAgentForAction } from '../../agent/agentClient'; // Re-use existing logic
import { logger } from '../../logger';
import { Connection } from '@solana/web3.js';
import pLimit from 'p-limit';

// Concurrency limit for LLM calls (Rate Limit protection)
// Default to 2, can be increased if tier allows
const CONCURRENCY_LIMIT = Number(process.env.LLM_CONCURRENCY_LIMIT) || 2;
const limit = pLimit(CONCURRENCY_LIMIT);

export class LLMWorker {
    private manager: AsyncReviewManager;
    private queue: AnalysisQueue;
    private isProcessing: boolean = false;
    private interval: NodeJS.Timeout | null = null;
    private connection: Connection;

    constructor(manager: AsyncReviewManager, connection: Connection) {
        this.manager = manager;
        // @ts-ignore - access private queue (or we should make it public/accessible)
        this.queue = manager['queue'];
        this.connection = connection;
    }

    public start() {
        if (this.interval) return;
        logger.info('[LLMWorker] Starting worker...');
        this.interval = setInterval(() => this.processNext(), 1000); // Check every second
    }

    public stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            logger.info('[LLMWorker] Stopped worker');
        }
    }

    private async processNext() {
        if (this.isProcessing) return; // Simple locking

        // We need to access the queue instance from the manager. 
        // Ideally AsyncReviewManager exposes a way to get the "next" job.
        // But AnalysisQueue handles its own processing loop via events?
        // Wait, AnalysisQueue emits 'process'. We should listen to that in AsyncReviewManager!

        // Re-reading AsyncReviewManager:
        // It creates an AnalysisQueue and listens to 'process'.
        // `this.queue.on('process', async (job) => { ... this.simulateProcessing(job) ... })`

        // So `AsyncReviewManager` IS the worker orchestrator.
        // The `LLMWorker` class might be redundant if we just put the logic in `AsyncReviewManager`
        // OR `AsyncReviewManager` delegates the logic to `LLMProcessor`.

        // Let's refactor `AsyncReviewManager` to use `LLMWorker` (or `LLMProcessor`)
        // instead of `simulateProcessing`.
    }
}

export class LLMProcessor {
    private connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    public async process(job: AnalysisJob): Promise<any> {
        logger.info(`[LLMProcessor] Analyzing ${job.tokenMint}...`);

        // 1. Re-construct context
        // We assume job.data has the initial context.
        // We might want to refresh dynamic data (liquidity, buyers)
        const initialCtx = job.data;

        // TODO: Ideally verify if token still exists/valid

        // 2. Call LLM (using existing agent logic for now)
        // We wrap it in rate limiter
        return limit(async () => {
            try {
                const decision = await askAgentForAction({
                    pool: initialCtx.pool || 'UNKNOWN',
                    baseMint: job.tokenMint,
                    quoteMint: initialCtx.quoteMint || 'So11111111111111111111111111111111111111112',
                    coinCreator: initialCtx.coinCreator || initialCtx.creatorAddress,
                    liquidityUsd: initialCtx.liquidityUsd, // Note: using stale data for now, should update
                    recentBuyers: initialCtx.recentBuyers || initialCtx.buyerCountLast5Min,
                    ageMs: Date.now() - (initialCtx.createdAt || initialCtx.createdAtMs || 0),
                    fdv: initialCtx.fdv || 0,
                    type: 'NEW_POOL'
                });

                return {
                    isSafe: decision.action === 'BUY',
                    score: decision.action === 'BUY' ? (decision.confidence || 80) : (decision.confidence || 20),
                    reason: decision.reason,
                    decision // Full decision object
                };
            } catch (error: any) {
                logger.error(`[LLMProcessor] Error analyzing ${job.tokenMint}: ${error.message}`);
                throw error;
            }
        });
    }
}
