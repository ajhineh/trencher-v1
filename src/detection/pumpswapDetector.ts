// src/detection/pumpswapDetector.ts

/**
 * PumpSwap-specific token detector
 * Handles both:
 * 1. PumpFun tokens migrated to PumpSwap (bonding curve completed)
 * 2. Direct PumpSwap launches (create_pool)
 */

import { ParsedTransactionWithMeta, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BaseDetector } from './baseDetector';
import { DetectedToken, DetectionResult } from './types';
import { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import bs58 from 'bs58';
import { logger } from '../logger';

const CREATE_POOL_DISCRIMINATOR = Buffer.from([
    233, 146, 209, 142, 207, 104, 64, 188,
]);

const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';

export class PumpSwapDetector extends BaseDetector {
    async detect(parsedTx: ParsedTransactionWithMeta): Promise<DetectionResult> {
        // Try PumpFun migration first
        const pumpfunResult = await this.detectPumpFunMigration(parsedTx);
        if (pumpfunResult.detected) return pumpfunResult;

        // Try direct PumpSwap launch
        const directResult = await this.detectDirectLaunch(parsedTx);
        if (directResult.detected) return directResult;

        return { detected: false, reason: 'Not a PumpSwap event' };
    }

    /**
     * Detect PumpFun token migrated to PumpSwap
     */
    private async detectPumpFunMigration(
        parsedTx: ParsedTransactionWithMeta
    ): Promise<DetectionResult> {
        // Check for finish_bond instruction
        if (!this.hasInstruction(parsedTx, 'finish_bond')) {
            return { detected: false, reason: 'No finish_bond instruction' };
        }

        const msg: any = parsedTx.transaction.message;
        const accountKeys: any[] = msg.accountKeys || [];
        const postTokenBalances = parsedTx.meta?.postTokenBalances || [];

        // Extract mint from positive token balances
        const positiveMints = postTokenBalances
            .filter((b: any) => (b.uiTokenAmount?.uiAmount || 0) > 0)
            .map((b: any) => b.mint);

        const mint = positiveMints.find((m: string) => m !== SOL_MINT_ADDRESS);

        if (!mint) {
            return { detected: false, reason: 'No token mint found' };
        }

        // Calculate canonical pool address
        const pool = canonicalPumpPoolPda(new (await import('@solana/web3.js')).PublicKey(mint)).toBase58();

        const solAmount = this.extractSolAmount(parsedTx);
        const tokenAmount = this.extractTokenAmount(parsedTx, mint);

        const token: DetectedToken = {
            mint,
            pool,
            dex: 'PUMPSWAP',
            metadata: {
                name: 'Unknown', // Will be fetched later
                symbol: 'UNKNOWN',
                decimals: 6,
            },
            poolInfo: {
                baseMint: mint,
                quoteMint: SOL_MINT_ADDRESS,
                baseReserve: tokenAmount,
                quoteReserve: solAmount,
                liquidityUsd: 0, // Will be calculated later
            },
            timestamp: Date.now(),
            blockTime: parsedTx.blockTime || undefined,
            signature: '', // Will be set by caller
            dexSpecific: {
                bondingCurveCompleted: true,
                migratedFromPumpFun: true,
                directLaunch: false,
            },
        };

        logger.info(`[PUMPSWAP] PumpFun migration detected: ${mint}`);
        return { detected: true, token };
    }

    /**
     * Detect direct PumpSwap launch (create_pool)
     */
    private async detectDirectLaunch(
        parsedTx: ParsedTransactionWithMeta
    ): Promise<DetectionResult> {
        const createPoolIx = this.findCreatePoolInstruction(parsedTx);
        if (!createPoolIx) {
            return { detected: false, reason: 'No create_pool instruction' };
        }

        const { msg, ix } = createPoolIx;
        const accounts: any[] = ix.accounts || [];

        // Extract from instruction accounts
        // Based on pump_amm.json IDL:
        // accounts[0] = pool
        // accounts[4] = base_mint (token)
        // accounts[5] = quote_mint (WSOL)

        const pool = this.normalizeKey(accounts[0]);
        const mint = this.normalizeKey(accounts[4]);
        const quoteMint = this.normalizeKey(accounts[5]);

        if (!mint || !pool) {
            return { detected: false, reason: 'Could not extract mint or pool' };
        }

        const solAmount = this.extractSolAmount(parsedTx);
        const tokenAmount = this.extractTokenAmount(parsedTx, mint);

        const token: DetectedToken = {
            mint,
            pool,
            dex: 'PUMPSWAP',
            metadata: {
                name: 'Unknown',
                symbol: 'UNKNOWN',
                decimals: 6,
            },
            poolInfo: {
                baseMint: mint,
                quoteMint: quoteMint || SOL_MINT_ADDRESS,
                baseReserve: tokenAmount,
                quoteReserve: solAmount,
                liquidityUsd: 0,
            },
            timestamp: Date.now(),
            blockTime: parsedTx.blockTime || undefined,
            signature: '',
            dexSpecific: {
                bondingCurveCompleted: false,
                migratedFromPumpFun: false,
                directLaunch: true,
            },
        };

        logger.info(`[PUMPSWAP] Direct launch detected: ${mint}`);
        return { detected: true, token };
    }

    /**
     * Find create_pool instruction in transaction
     */
    private findCreatePoolInstruction(parsedTx: ParsedTransactionWithMeta) {
        const msg: any = parsedTx.transaction.message;
        const insts: any[] = msg.instructions || [];
        const pumpAmmIdStr = PUMP_AMM_PROGRAM_ID.toBase58();

        for (const ix of insts) {
            const programIdStr = this.normalizeKey(ix.programId);
            if (programIdStr !== pumpAmmIdStr) continue;

            if (!ix.data || typeof ix.data !== 'string') continue;

            let dataBytes: Buffer;
            try {
                dataBytes = Buffer.from(bs58.decode(ix.data));
            } catch {
                continue;
            }

            if (dataBytes.length < 8) continue;

            const disc = dataBytes.subarray(0, 8);
            if (disc.equals(CREATE_POOL_DISCRIMINATOR)) {
                return { msg, ix };
            }
        }

        return null;
    }
}
