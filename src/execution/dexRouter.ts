// src/execution/dexRouter.ts

/**
 * DEX Router
 * Routes buy execution to appropriate DEX-specific executor
 */

import { Connection, Keypair } from '@solana/web3.js';
import { DetectedToken } from '../detection/types';
import { ExecutionResult, ExecutionConfig } from './types';
import { PumpSwapExecutor } from './pumpswapExecutor';
import { MeteoraExecutor } from './meteoraExecutor';
import { logger } from '../logger';

const DEFAULT_CONFIG: ExecutionConfig = {
    slippageBps: Number(process.env.SLIPPAGE_BPS ?? 300),
    skipPreflight: (process.env.SKIP_PREFLIGHT ?? 'true').toLowerCase() === 'true',
    buyDelayMs: Number(process.env.BUY_DELAY_MS ?? 0),
    maxRetries: 3,
};

export class DexRouter {
    private connection: Connection;
    private keypair: Keypair;
    private config: ExecutionConfig;
    private executors: Map<string, any>;

    constructor(
        connection: Connection,
        keypair: Keypair,
        config?: Partial<ExecutionConfig>
    ) {
        this.connection = connection;
        this.keypair = keypair;
        this.config = { ...DEFAULT_CONFIG, ...config };

        // Initialize executors
        const pumpSwapExecutor = new PumpSwapExecutor(connection, keypair);
        const meteoraExecutor = new MeteoraExecutor(connection, keypair);

        this.executors = new Map<string, PumpSwapExecutor | MeteoraExecutor>();
        this.executors.set('PUMPSWAP', pumpSwapExecutor);
        this.executors.set('METEORA', meteoraExecutor);
        // Add more executors here

        logger.info('[ROUTER] Initialized with executors:', Array.from(this.executors.keys()));
        logger.info('[ROUTER] Config:', this.config);
    }

    /**
     * Execute buy on appropriate DEX
     */
    async executeBuy(
        token: DetectedToken,
        amountSol: number
    ): Promise<ExecutionResult> {
        logger.info(`[ROUTER] Routing ${token.metadata.symbol} to ${token.dex}`);

        // Apply buy delay if configured
        if (this.config.buyDelayMs > 0) {
            logger.info(`[ROUTER] Applying ${this.config.buyDelayMs}ms delay...`);
            await new Promise(resolve => setTimeout(resolve, this.config.buyDelayMs));
        }

        // Get executor for this DEX
        const executor = this.executors.get(token.dex);

        if (!executor) {
            logger.error(`[ROUTER] No executor found for ${token.dex}`);
            return {
                success: false,
                error: `No executor for ${token.dex}`,
                dex: token.dex,
                mint: token.mint,
                amountSol,
                timestamp: Date.now(),
            };
        }

        // Execute with retries
        let lastError: string = '';

        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
                logger.info(`[ROUTER] Attempt ${attempt}/${this.config.maxRetries}`);

                const result = await executor.executeBuy(
                    token,
                    amountSol,
                    this.config.slippageBps,
                    this.config.skipPreflight
                );

                if (result.success) {
                    logger.info(`[ROUTER] ✅ Buy successful on attempt ${attempt}`);
                    return result;
                }

                lastError = result.error || 'Unknown error';
                logger.warn(`[ROUTER] Attempt ${attempt} failed: ${lastError}`);

                // Wait before retry
                if (attempt < this.config.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }

            } catch (error: any) {
                lastError = error.message;
                logger.error(`[ROUTER] Attempt ${attempt} error: ${lastError}`);

                if (attempt < this.config.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        }

        // All retries failed
        logger.error(`[ROUTER] ❌ All ${this.config.maxRetries} attempts failed`);

        return {
            success: false,
            error: `All retries failed. Last error: ${lastError}`,
            dex: token.dex,
            mint: token.mint,
            amountSol,
            timestamp: Date.now(),
        };
    }
    /**
     * Execute sell on appropriate DEX
     */
    async executeSell(
        token: DetectedToken,
        tokenAmount: number
    ): Promise<ExecutionResult> {
        logger.info(`[ROUTER] Routing SELL ${tokenAmount} ${token.metadata.symbol} to ${token.dex}`);

        // Get executor for this DEX
        const executor = this.executors.get(token.dex);

        if (!executor) {
            logger.error(`[ROUTER] No executor found for ${token.dex}`);
            return {
                success: false,
                error: `No executor for ${token.dex}`,
                dex: token.dex,
                mint: token.mint,
                amountSol: 0,
                timestamp: Date.now(),
            };
        }

        // Execute with retries
        let lastError: string = '';

        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
                logger.info(`[ROUTER] Sell Attempt ${attempt}/${this.config.maxRetries}`);

                // Check if executor has executeSell (Meteora might not yet)
                if (typeof executor.executeSell !== 'function') {
                    throw new Error(`Executor for ${token.dex} does not support executeSell`);
                }

                const result = await executor.executeSell(
                    token.mint,
                    tokenAmount,
                    this.config.slippageBps,
                    this.config.skipPreflight
                );

                if (result.success) {
                    logger.info(`[ROUTER] ✅ Sell successful on attempt ${attempt}`);
                    return result;
                }

                lastError = result.error || 'Unknown error';
                logger.warn(`[ROUTER] Sell Attempt ${attempt} failed: ${lastError}`);

                if (attempt < this.config.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }

            } catch (error: any) {
                lastError = error.message;
                logger.error(`[ROUTER] Sell Attempt ${attempt} error: ${lastError}`);

                if (attempt < this.config.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        }

        return {
            success: false,
            error: `All sell retries failed. Last error: ${lastError}`,
            dex: token.dex,
            mint: token.mint,
            amountSol: 0,
            timestamp: Date.now(),
        };
    }
}
