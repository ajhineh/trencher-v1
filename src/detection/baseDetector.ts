// src/detection/baseDetector.ts

/**
 * Base class for DEX-specific detectors
 */

import { Connection, ParsedTransactionWithMeta } from '@solana/web3.js';
import { DetectedToken, DetectionResult } from './types';
import { logger } from '../logger';

export abstract class BaseDetector {
    protected connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    /**
     * Main detection method - must be implemented by each DEX
     */
    abstract detect(
        parsedTx: ParsedTransactionWithMeta
    ): Promise<DetectionResult>;

    /**
     * Check if transaction has specific instruction
     */
    protected hasInstruction(
        parsedTx: ParsedTransactionWithMeta,
        keyword: string
    ): boolean {
        const logs = parsedTx.meta?.logMessages || [];
        const joinedLogs = logs.join(' ').toLowerCase();
        return joinedLogs.includes(keyword.toLowerCase());
    }

    /**
     * Normalize key to string
     */
    protected normalizeKey(k: any): string {
        if (!k) return 'undefined';
        if (typeof k === 'string') return k;
        if (typeof k.toBase58 === 'function') return k.toBase58();

        if (k.pubkey) {
            if (typeof k.pubkey === 'string') return k.pubkey;
            if (typeof k.pubkey.toBase58 === 'function') return k.pubkey.toBase58();
        }

        try {
            return k.toString();
        } catch {
            return JSON.stringify(k);
        }
    }

    /**
     * Extract SOL amount from transaction
     */
    protected extractSolAmount(parsedTx: ParsedTransactionWithMeta): number {
        const pre0 = parsedTx.meta?.preBalances?.[0] || 0;
        const post0 = parsedTx.meta?.postBalances?.[0] || 0;
        return (pre0 - post0) / 1e9; // Convert lamports to SOL
    }

    /**
     * Extract token amount from transaction
     */
    protected extractTokenAmount(
        parsedTx: ParsedTransactionWithMeta,
        mint: string
    ): number {
        const postTokenBalances = parsedTx.meta?.postTokenBalances || [];
        return (
            postTokenBalances.find((b: any) => b.mint === mint)?.uiTokenAmount
                ?.uiAmount || 0
        );
    }

    /**
     * Log detection result
     */
    protected logDetection(dex: string, detected: boolean, reason?: string): void {
        if (detected) {
            logger.info(`[${dex}] Token detected`);
        } else if (reason) {
            logger.debug(`[${dex}] Not detected: ${reason}`);
        }
    }
}
