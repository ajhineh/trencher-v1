// src/sniper/jitoEmergencyExit.ts

/**
 * Jito Emergency Exit
 * Fast exit with MEV protection using Jito
 */

import {
    Connection,
    PublicKey,
    Transaction,
    Keypair,
    SystemProgram,
    TransactionInstruction
} from '@solana/web3.js';
import { logger } from '../logger';
import { getAssociatedTokenAddress } from '@solana/spl-token';

export class JitoEmergencyExit {
    private connection: Connection;
    private keypair: Keypair;
    private jitoTipAccount: PublicKey;
    private jitoRpcUrl: string;

    // Jito tip accounts (rotate for better delivery)
    private static readonly JITO_TIP_ACCOUNTS = [
        'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
        'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
        '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
        '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
        'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe'
    ];

    constructor(
        connection: Connection,
        keypair: Keypair,
        jitoTipAmount: number = 0.001
    ) {
        this.connection = connection;
        this.keypair = keypair;

        // Rotate tip account
        const randomIndex = Math.floor(Math.random() * JitoEmergencyExit.JITO_TIP_ACCOUNTS.length);
        this.jitoTipAccount = new PublicKey(JitoEmergencyExit.JITO_TIP_ACCOUNTS[randomIndex]);

        // Jito RPC endpoints
        this.jitoRpcUrl = 'https://mainnet.block-engine.jito.wtf/api/v1/transactions';

        logger.info('🚀 Jito Emergency Exit initialized');
        logger.info(`   Tip account: ${this.jitoTipAccount.toBase58()}`);
        logger.info(`   Tip amount: ${jitoTipAmount} SOL`);
    }

    /**
     * Emergency exit with Jito MEV protection
     */
    async emergencyExit(
        mint: PublicKey,
        poolKey: PublicKey,
        tipAmount: number = 0.001
    ): Promise<string | null> {
        const startTime = Date.now();
        logger.error('🚨🚨🚨 EMERGENCY EXIT INITIATED 🚨🚨🚨');
        logger.error(`Token: ${mint.toBase58()}`);
        logger.error(`Using Jito for MEV protection...`);

        try {
            // 1. Get token balance
            const tokenBalance = await this.getTokenBalance(mint);

            if (tokenBalance === 0) {
                logger.warn('No tokens to sell');
                return null;
            }

            logger.info(`Token balance: ${tokenBalance}`);

            // 2. Build sell transaction
            logger.info('Building sell transaction...');
            const sellTx = await this.buildEmergencySellTx(
                mint,
                poolKey,
                tokenBalance,
                50 // High slippage for emergency (50%)
            );

            // 3. Add Jito tip for priority
            logger.info(`Adding Jito tip: ${tipAmount} SOL`);
            this.addJitoTip(sellTx, tipAmount);

            // 4. Send via Jito
            logger.info('Sending transaction via Jito...');
            const signature = await this.sendViaJito(sellTx);

            const totalTime = Date.now() - startTime;
            logger.info(`✅ Emergency exit successful in ${totalTime}ms`);
            logger.info(`TX: ${signature}`);

            return signature;

        } catch (error: any) {
            logger.error('❌ Emergency exit failed:', error.message);
            logger.error('Stack:', error.stack);
            return null;
        }
    }

    /**
     * Build emergency sell transaction
     */
    private async buildEmergencySellTx(
        mint: PublicKey,
        poolKey: PublicKey,
        tokenAmount: number,
        slippageBps: number
    ): Promise<Transaction> {
        // This is a placeholder - you need to implement actual sell logic
        // using your PumpSwap SDK or similar

        const tx = new Transaction();

        // Add sell instructions here
        // For now, this is a placeholder
        logger.warn('⚠️ Sell instruction not implemented - using placeholder');

        return tx;
    }

    /**
     * Add Jito tip to transaction
     */
    private addJitoTip(tx: Transaction, tipSol: number): void {
        const tipLamports = Math.floor(tipSol * 1e9);

        const tipIx = SystemProgram.transfer({
            fromPubkey: this.keypair.publicKey,
            toPubkey: this.jitoTipAccount,
            lamports: tipLamports
        });

        // Add tip as last instruction
        tx.add(tipIx);

        logger.info(`Tip instruction added: ${tipLamports} lamports`);
    }

    /**
     * Send transaction via Jito
     */
    private async sendViaJito(tx: Transaction): Promise<string> {
        try {
            // Get recent blockhash
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('finalized');
            tx.recentBlockhash = blockhash;
            tx.lastValidBlockHeight = lastValidBlockHeight;

            // Sign transaction
            tx.sign(this.keypair);

            // Serialize
            const serialized = tx.serialize();
            const base64Tx = serialized.toString('base64');

            logger.info('Sending to Jito...');

            // Send to Jito
            const response = await fetch(this.jitoRpcUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'sendTransaction',
                    params: [base64Tx, {
                        encoding: 'base64',
                        skipPreflight: true,
                        maxRetries: 0
                    }]
                })
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(`Jito error: ${JSON.stringify(result.error)}`);
            }

            const signature = result.result;
            logger.info('Transaction sent to Jito');

            // Wait for confirmation
            logger.info('Waiting for confirmation...');
            await this.connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight
            });

            return signature;

        } catch (error: any) {
            logger.error('Jito send failed:', error.message);

            // Fallback to regular RPC
            logger.warn('Falling back to regular RPC...');
            return await this.sendViaRegularRpc(tx);
        }
    }

    /**
     * Fallback: send via regular RPC
     */
    private async sendViaRegularRpc(tx: Transaction): Promise<string> {
        const signature = await this.connection.sendRawTransaction(
            tx.serialize(),
            {
                skipPreflight: true,
                maxRetries: 3
            }
        );

        logger.info('Sent via regular RPC');

        // Confirm
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
        await this.connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight
        });

        return signature;
    }

    /**
     * Get token balance
     */
    private async getTokenBalance(mint: PublicKey): Promise<number> {
        try {
            const tokenAccount = await getAssociatedTokenAddress(
                mint,
                this.keypair.publicKey
            );

            const balance = await this.connection.getTokenAccountBalance(tokenAccount);
            return Number(balance.value.amount);

        } catch (error: any) {
            logger.error('Error getting token balance:', error.message);
            return 0;
        }
    }

    /**
     * Estimate exit time
     */
    async estimateExitTime(): Promise<number> {
        // Jito typically lands in 1-2 slots (400-800ms)
        return 800; // ms
    }
}
