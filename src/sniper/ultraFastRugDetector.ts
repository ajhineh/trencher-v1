// src/sniper/ultraFastRugDetector.ts

/**
 * Ultra-Fast Rug Detector
 * Optimized for <1s detection
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';

export class UltraFastRugDetector {
    private connection: Connection;
    private wsConnection: any; // WebSocket connection

    constructor(connection: Connection) {
        this.connection = connection;
    }

    /**
     * Monitor creator wallet in real-time via WebSocket
     */
    async monitorCreatorRealtime(
        creatorAddress: PublicKey,
        poolKey: PublicKey,
        onRugDetected: () => void
    ): Promise<void> {
        logger.info('🔍 Starting REAL-TIME creator monitoring...');
        logger.info(`   Creator: ${creatorAddress.toBase58()}`);

        // Subscribe to account changes via WebSocket
        const subscriptionId = this.connection.onAccountChange(
            creatorAddress,
            async (accountInfo, context) => {
                logger.warn('⚡ Creator account changed!');

                // Check if this is a remove liquidity transaction
                const isRemove = await this.quickCheckRemoveLiquidity(
                    creatorAddress,
                    poolKey,
                    context.slot
                );

                if (isRemove) {
                    logger.error('🚨 RUG DETECTED IN REAL-TIME!');
                    onRugDetected();
                }
            },
            'confirmed' // Use 'confirmed' for speed
        );

        logger.info(`✅ WebSocket monitoring active (ID: ${subscriptionId})`);
    }

    /**
     * Quick check for remove liquidity
     */
    private async quickCheckRemoveLiquidity(
        address: PublicKey,
        poolKey: PublicKey,
        slot: number
    ): Promise<boolean> {
        try {
            // Get transaction from this slot
            const signatures = await this.connection.getSignaturesForAddress(
                address,
                { limit: 1 }
            );

            if (signatures.length === 0) return false;

            const tx = await this.connection.getParsedTransaction(
                signatures[0].signature,
                { maxSupportedTransactionVersion: 0 }
            );

            if (!tx) return false;

            // Quick check for remove keywords in logs
            const logs = tx.meta?.logMessages || [];
            const hasRemove = logs.some(log =>
                log.toLowerCase().includes('remove') ||
                log.toLowerCase().includes('withdraw') ||
                log.toLowerCase().includes('close')
            );

            // Check if pool is involved
            const poolKeyStr = poolKey.toBase58();
            const involvesPool = tx.transaction.message.accountKeys.some(
                key => (typeof key === 'string' ? key : key.pubkey.toBase58()) === poolKeyStr
            );

            return hasRemove && involvesPool;

        } catch (error) {
            return false;
        }
    }

    /**
     * Monitor multiple addresses simultaneously
     */
    async monitorMultipleAddresses(
        addresses: PublicKey[],
        poolKey: PublicKey,
        onRugDetected: () => void
    ): Promise<number[]> {
        const subscriptionIds: number[] = [];

        for (const address of addresses) {
            const id = this.connection.onAccountChange(
                address,
                async () => {
                    const isRemove = await this.quickCheckRemoveLiquidity(
                        address,
                        poolKey,
                        0
                    );

                    if (isRemove) {
                        logger.error(`🚨 RUG from ${address.toBase58()}`);
                        onRugDetected();
                    }
                },
                'confirmed'
            );

            subscriptionIds.push(id);
        }

        logger.info(`✅ Monitoring ${addresses.length} addresses via WebSocket`);

        return subscriptionIds;
    }

    /**
     * Unsubscribe
     */
    async unsubscribe(subscriptionIds: number[]): Promise<void> {
        for (const id of subscriptionIds) {
            await this.connection.removeAccountChangeListener(id);
        }

        logger.info(`Unsubscribed from ${subscriptionIds.length} monitors`);
    }
}
