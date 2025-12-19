// src/execution/pumpswapExecutor.ts

/**
 * PumpSwap-specific buy executor
 * Handles both PumpFun migration and direct launch
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { DetectedToken } from '../detection/types';
import { ExecutionResult } from './types';
import { executeBuy } from '../executebuy';
import { executeSell } from '../executesell';
import { logger } from '../logger';

export class PumpSwapExecutor {
    private connection: Connection;
    private keypair: Keypair;

    constructor(connection: Connection, keypair: Keypair) {
        this.connection = connection;
        this.keypair = keypair;
    }

    /**
     * Execute buy on PumpSwap
     */
    async executeBuy(
        token: DetectedToken,
        amountSol: number,
        slippageBps: number,
        skipPreflight: boolean
    ): Promise<ExecutionResult> {
        const startTime = Date.now();

        try {
            const mintPubkey = new PublicKey(token.mint);
            const lamports = BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL));

            logger.info(
                `[PUMPSWAP-EXEC] Buying ${token.metadata.symbol} ` +
                `(${token.dexSpecific?.migratedFromPumpFun ? 'PumpFun migration' : 'Direct launch'})`
            );

            // Use existing executeBuy which handles both cases
            const signature = await executeBuy(
                this.connection,
                mintPubkey,
                this.keypair,
                lamports,
                slippageBps,
                skipPreflight
            );

            if (!signature) {
                return {
                    success: false,
                    error: 'executeBuy returned null',
                    dex: 'PUMPSWAP',
                    mint: token.mint,
                    amountSol,
                    timestamp: Date.now(),
                };
            }

            const elapsed = Date.now() - startTime;
            logger.info(`[PUMPSWAP-EXEC] ✅ Buy successful in ${elapsed}ms: ${signature}`);

            return {
                success: true,
                signature,
                dex: 'PUMPSWAP',
                mint: token.mint,
                amountSol,
                timestamp: Date.now(),
            };

        } catch (error: any) {
            logger.error(`[PUMPSWAP-EXEC] Buy failed: ${error.message}`);

            return {
                success: false,
                error: error.message,
                dex: 'PUMPSWAP',
                mint: token.mint,
                amountSol,
                timestamp: Date.now(),
            };
        }
    }
    /**
 * Execute sell on PumpSwap
 */
    async executeSell(
        tokenMint: string,
        tokenAmount: number,
        slippageBps: number,
        skipPreflight: boolean
    ): Promise<ExecutionResult> {
        const startTime = Date.now();

        try {
            logger.info(`[PUMPSWAP-EXEC] Selling ${tokenAmount} of ${tokenMint}`);

            const signature = await executeSell(
                tokenMint,
                tokenAmount,
                this.connection,
                this.keypair,
                slippageBps,
                skipPreflight
            );

            if (!signature) {
                return {
                    success: false,
                    error: 'executeSell returned null',
                    dex: 'PUMPSWAP',
                    mint: tokenMint,
                    amountSol: 0, // Sell result doesn't return SOL amount directly yet
                    timestamp: Date.now(),
                };
            }

            const elapsed = Date.now() - startTime;
            logger.info(`[PUMPSWAP-EXEC] ✅ Sell successful in ${elapsed}ms: ${signature}`);

            return {
                success: true,
                signature,
                dex: 'PUMPSWAP',
                mint: tokenMint,
                amountSol: 0,
                timestamp: Date.now(),
            };

        } catch (error: any) {
            logger.error(`[PUMPSWAP-EXEC] Sell failed: ${error.message}`);
            return {
                success: false,
                error: error.message,
                dex: 'PUMPSWAP',
                mint: tokenMint,
                amountSol: 0,
                timestamp: Date.now(),
            };
        }
    }
}

