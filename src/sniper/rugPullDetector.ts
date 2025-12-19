// src/sniper/rugPullDetector.ts

/**
 * Rug Pull Detector
 * Monitors tokens for rug pull signals
 */

import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import { logger } from '../logger';
import {
    MonitoringState,
    RugPullSignal,
    TopHolder
} from './types';

export class RugPullDetector {
    private connection: Connection;
    private monitoredTokens: Map<string, MonitoringState> = new Map();
    private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();

    constructor(connection: Connection) {
        this.connection = connection;
    }

    /**
     * Start monitoring token for rug pull
     */
    async startMonitoring(
        mint: PublicKey,
        creatorAddress: PublicKey,
        poolKey: PublicKey,
        purchasePrice: number,
        tokenAmount: number
    ): Promise<void> {
        const mintStr = mint.toBase58();
        logger.info('👁️ Starting rug pull monitoring:', mintStr);

        try {
            // Get initial state
            const topHolders = await this.getTopHolders(mint, 10);
            const initialBuyerCount = await this.getBuyerCount(poolKey);

            const state: MonitoringState = {
                mint,
                creatorAddress,
                poolKey,
                topHolders,
                initialBuyerCount,
                lastCheck: Date.now(),
                purchasePrice,
                tokenAmount
            };

            this.monitoredTokens.set(mintStr, state);

            logger.info(`   Initial buyers: ${initialBuyerCount}`);
            logger.info(`   Top holders: ${topHolders.length}`);

            // Start continuous monitoring
            this.startContinuousMonitoring(mintStr);

        } catch (error: any) {
            logger.error('Failed to start monitoring:', error.message);
        }
    }

    /**
     * Stop monitoring a token
     */
    stopMonitoring(mint: PublicKey): void {
        const mintStr = mint.toBase58();
        const interval = this.monitoringIntervals.get(mintStr);

        if (interval) {
            clearInterval(interval);
            this.monitoringIntervals.delete(mintStr);
        }

        this.monitoredTokens.delete(mintStr);
        logger.info('🛑 Stopped monitoring:', mintStr);
    }

    /**
     * Start continuous monitoring
     */
    private startContinuousMonitoring(mintAddress: string): void {
        // Check every 5 seconds
        const interval = setInterval(async () => {
            await this.checkToken(mintAddress);
        }, 5000);

        this.monitoringIntervals.set(mintAddress, interval);
    }

    /**
     * Check token for rug pull signals
     */
    private async checkToken(mintAddress: string): Promise<void> {
        const state = this.monitoredTokens.get(mintAddress);
        if (!state) return;

        try {
            const signals = await this.checkForRugPull(state);

            for (const signal of signals) {
                logger.warn(`⚠️ RUG PULL SIGNAL: ${signal.type}`);
                logger.warn(`   Severity: ${signal.severity}`);
                logger.warn(`   Confidence: ${signal.confidence}%`);
                logger.warn(`   Action: ${signal.action}`);
                logger.warn(`   Details: ${signal.details}`);

                // Emit event for action
                if (signal.action === 'EXIT_IMMEDIATELY') {
                    this.emit('rugPullDetected', {
                        mint: state.mint,
                        poolKey: state.poolKey,
                        signal
                    });
                }
            }

            state.lastCheck = Date.now();

        } catch (error: any) {
            logger.error(`Error checking ${mintAddress}:`, error.message);
        }
    }

    /**
     * Check for rug pull signals
     */
    private async checkForRugPull(state: MonitoringState): Promise<RugPullSignal[]> {
        const signals: RugPullSignal[] = [];

        // 1. Check creator wallet for remove liquidity
        const creatorRemove = await this.checkWalletForRemoveLiquidity(
            state.creatorAddress,
            state.poolKey
        );

        if (creatorRemove) {
            signals.push({
                type: 'CREATOR_REMOVE',
                severity: 'CRITICAL',
                confidence: 95,
                action: 'EXIT_IMMEDIATELY',
                details: 'Creator is removing liquidity!'
            });
        }

        // 2. Check top holders for remove liquidity
        for (const holder of state.topHolders) {
            if (holder.percentage > 2) { // Only check holders with >2%
                const holderRemove = await this.checkWalletForRemoveLiquidity(
                    holder.address,
                    state.poolKey
                );

                if (holderRemove) {
                    const action = holder.percentage > 5 ? 'EXIT_IMMEDIATELY' : 'REDUCE';
                    signals.push({
                        type: 'WHALE_REMOVE',
                        severity: holder.percentage > 5 ? 'CRITICAL' : 'HIGH',
                        confidence: 85,
                        action,
                        details: `Whale (${holder.percentage.toFixed(1)}%) removing liquidity`
                    });
                }
            }
        }

        // 3. Check buyer count drop
        const currentBuyerCount = await this.getBuyerCount(state.poolKey);
        const buyerDropPercent = ((state.initialBuyerCount - currentBuyerCount) / state.initialBuyerCount) * 100;

        if (buyerDropPercent > 30) {
            signals.push({
                type: 'BUYER_DROP',
                severity: buyerDropPercent > 50 ? 'HIGH' : 'MEDIUM',
                confidence: 70,
                action: buyerDropPercent > 50 ? 'REDUCE' : 'MONITOR',
                details: `Buyer count dropped ${buyerDropPercent.toFixed(1)}%`
            });
        }

        // 4. Check liquidity drop
        const liquidityDrop = await this.checkLiquidityDrop(state.poolKey);

        if (liquidityDrop > 30) {
            signals.push({
                type: 'LIQUIDITY_DROP',
                severity: liquidityDrop > 50 ? 'CRITICAL' : 'HIGH',
                confidence: 90,
                action: liquidityDrop > 50 ? 'EXIT_IMMEDIATELY' : 'REDUCE',
                details: `Liquidity dropped ${liquidityDrop.toFixed(1)}%`
            });
        }

        return signals;
    }

    /**
     * Check wallet for remove liquidity transactions
     */
    private async checkWalletForRemoveLiquidity(
        address: PublicKey,
        poolKey: PublicKey
    ): Promise<boolean> {
        try {
            // Get recent transactions (last 10)
            const signatures = await this.connection.getSignaturesForAddress(
                address,
                { limit: 10 }
            );

            // Check transactions from last 30 seconds only
            const recentSigs = signatures.filter(sig =>
                Date.now() - (sig.blockTime || 0) * 1000 < 30000
            );

            for (const sig of recentSigs) {
                const tx = await this.connection.getParsedTransaction(
                    sig.signature,
                    { maxSupportedTransactionVersion: 0 }
                );

                if (!tx) continue;

                // Check if transaction involves the pool
                const involvesPool = this.transactionInvolvesPool(tx, poolKey);

                if (involvesPool) {
                    // Check if it's a remove liquidity instruction
                    const isRemove = this.isRemoveLiquidityTx(tx);

                    if (isRemove) {
                        logger.warn(`🚨 Remove liquidity detected from ${address.toBase58()}`);
                        return true;
                    }
                }
            }

            return false;

        } catch (error: any) {
            logger.error('Error checking wallet:', error.message);
            return false;
        }
    }

    /**
     * Check if transaction involves pool
     */
    private transactionInvolvesPool(
        tx: ParsedTransactionWithMeta,
        poolKey: PublicKey
    ): boolean {
        const poolKeyStr = poolKey.toBase58();

        // Check all account keys
        const accountKeys = tx.transaction.message.accountKeys.map(k =>
            typeof k === 'string' ? k : k.pubkey.toBase58()
        );

        return accountKeys.includes(poolKeyStr);
    }

    /**
     * Check if transaction is remove liquidity
     */
    private isRemoveLiquidityTx(tx: ParsedTransactionWithMeta): boolean {
        // Look for common remove liquidity patterns
        const instructions = tx.transaction.message.instructions;

        for (const ix of instructions) {
            if ('parsed' in ix && ix.parsed) {
                const type = ix.parsed.type;

                // Common remove liquidity instruction types
                if (type === 'removeLiquidity' ||
                    type === 'withdraw' ||
                    type === 'close') {
                    return true;
                }
            }

            // Check program logs for remove keywords
            if (tx.meta?.logMessages) {
                const hasRemoveLog = tx.meta.logMessages.some(log =>
                    log.toLowerCase().includes('remove') ||
                    log.toLowerCase().includes('withdraw') ||
                    log.toLowerCase().includes('close')
                );

                if (hasRemoveLog) return true;
            }
        }

        return false;
    }

    /**
     * Get top token holders
     */
    private async getTopHolders(
        mint: PublicKey,
        count: number
    ): Promise<TopHolder[]> {
        try {
            const largestAccounts = await this.connection.getTokenLargestAccounts(mint);

            const totalSupply = largestAccounts.value.reduce(
                (sum, acc) => sum + Number(acc.amount),
                0
            );

            return largestAccounts.value.slice(0, count).map(acc => ({
                address: acc.address,
                balance: Number(acc.amount),
                percentage: (Number(acc.amount) / totalSupply) * 100
            }));

        } catch (error: any) {
            logger.error('Error getting top holders:', error.message);
            return [];
        }
    }

    /**
     * Get buyer count (simplified - counts unique holders)
     */
    private async getBuyerCount(poolKey: PublicKey): Promise<number> {
        try {
            // This is simplified - in reality you'd track actual buyers
            // For now, we'll use a placeholder
            return 100; // Placeholder

        } catch (error: any) {
            logger.error('Error getting buyer count:', error.message);
            return 0;
        }
    }

    /**
     * Check liquidity drop
     */
    private async checkLiquidityDrop(poolKey: PublicKey): Promise<number> {
        try {
            // Get current pool balance
            // This is simplified - you'd need to fetch actual pool state
            return 0; // Placeholder

        } catch (error: any) {
            logger.error('Error checking liquidity:', error.message);
            return 0;
        }
    }

    /**
     * Event emitter (simplified)
     */
    private listeners: Map<string, Function[]> = new Map();

    on(event: string, callback: Function): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(callback);
    }

    private emit(event: string, data: any): void {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(cb => cb(data));
        }
    }
}
