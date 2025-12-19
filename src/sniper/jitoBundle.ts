// src/sniper/jitoBundle.ts

/**
 * Jito Bundle System
 * Multiple wallets + atomic bundle execution
 */

import {
    Connection,
    PublicKey,
    Transaction,
    Keypair,
    VersionedTransaction,
    TransactionMessage
} from '@solana/web3.js';
import { buildPumpSwapSellAccounts } from '../pumpswap/buildPumpSwapSellAccounts';
import { PUMP_AMM_SDK } from '@pump-fun/pump-swap-sdk';
import { logger } from '../logger';
import BN from 'bn.js';

interface WalletPosition {
    keypair: Keypair;
    mint: PublicKey;
    poolKey: PublicKey;
    quoteMint: PublicKey;
    balance: number;
}

export class JitoBundleSystem {
    private connection: Connection;
    private jitoRpcUrl: string;
    private jitoBundleUrl: string;

    constructor(connection: Connection) {
        this.connection = connection;

        // Jito endpoints
        this.jitoRpcUrl = 'https://mainnet.block-engine.jito.wtf/api/v1/transactions';
        this.jitoBundleUrl = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';
    }

    /**
     * Emergency bundle sell from multiple wallets
     * This executes ATOMICALLY - all or nothing
     */
    async emergencyBundleSell(
        positions: WalletPosition[],
        tipAmount: number = 0.01 // Higher tip for emergency
    ): Promise<string | null> {
        logger.error('🚨🚨🚨 EMERGENCY BUNDLE SELL 🚨🚨🚨');
        logger.error(`Wallets: ${positions.length}`);
        logger.error(`Tip: ${tipAmount} SOL (HIGH PRIORITY)`);

        try {
            const startTime = Date.now();

            // Build all transactions in parallel
            const txPromises = positions.map(pos =>
                this.buildSellTransaction(pos)
            );

            const transactions = await Promise.all(txPromises);

            logger.info(`Built ${transactions.length} transactions in ${Date.now() - startTime}ms`);

            // Add tip to first transaction
            this.addJitoTip(transactions[0], positions[0].keypair, tipAmount);

            // Send as bundle
            const bundleId = await this.sendBundle(transactions, positions);

            const totalTime = Date.now() - startTime;
            logger.info(`✅ Bundle sent in ${totalTime}ms`);
            logger.info(`Bundle ID: ${bundleId}`);

            return bundleId;

        } catch (error: any) {
            logger.error('❌ Bundle failed:', error.message);

            // Fallback: send individually
            logger.warn('⚠️ Falling back to individual transactions...');
            return await this.fallbackIndividualSells(positions);
        }
    }

    /**
     * Build sell transaction for one wallet
     */
    private async buildSellTransaction(
        position: WalletPosition
    ): Promise<Transaction> {
        // Build accounts
        const { accounts } = await buildPumpSwapSellAccounts({
            connection: this.connection,
            poolPubkey: position.poolKey,
            userPubkey: position.keypair.publicKey,
            baseMint: position.mint,
            quoteMint: position.quoteMint
        });

        // Build sell instruction
        const sellIx = await PUMP_AMM_SDK.sellBaseInput(
            accounts as any,
            new BN(position.balance),
            50 // 50% slippage for emergency
        );

        const tx = new Transaction();
        if (Array.isArray(sellIx)) {
            tx.add(...sellIx);
        } else {
            tx.add(sellIx);
        }

        return tx;
    }

    /**
     * Add Jito tip
     */
    private addJitoTip(
        tx: Transaction,
        payer: Keypair,
        tipAmount: number
    ): void {
        const { SystemProgram } = require('@solana/web3.js');

        // Random tip account
        const tipAccounts = [
            'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
            'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
            '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'
        ];

        const tipAccount = new PublicKey(
            tipAccounts[Math.floor(Math.random() * tipAccounts.length)]
        );

        tx.add(
            SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: tipAccount,
                lamports: Math.floor(tipAmount * 1e9)
            })
        );
    }

    /**
     * Send bundle to Jito
     */
    private async sendBundle(
        transactions: Transaction[],
        positions: WalletPosition[]
    ): Promise<string> {
        // Get recent blockhash
        const { blockhash } = await this.connection.getLatestBlockhash('finalized');

        // Sign all transactions
        const signedTxs = transactions.map((tx, i) => {
            tx.recentBlockhash = blockhash;
            tx.feePayer = positions[i].keypair.publicKey;
            tx.sign(positions[i].keypair);
            return tx;
        });

        // Serialize
        const serializedTxs = signedTxs.map(tx =>
            tx.serialize().toString('base64')
        );

        logger.info('Sending bundle to Jito...');

        // Send bundle
        const response = await fetch(this.jitoBundleUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'sendBundle',
                params: [serializedTxs]
            })
        });

        const result = await response.json();

        if (result.error) {
            throw new Error(`Jito bundle error: ${JSON.stringify(result.error)}`);
        }

        return result.result;
    }

    /**
     * Fallback: send individually
     */
    private async fallbackIndividualSells(
        positions: WalletPosition[]
    ): Promise<string | null> {
        logger.warn('Sending transactions individually...');

        const promises = positions.map(async (pos, i) => {
            try {
                const tx = await this.buildSellTransaction(pos);

                // Add tip to first one
                if (i === 0) {
                    this.addJitoTip(tx, pos.keypair, 0.01);
                }

                const { blockhash } = await this.connection.getLatestBlockhash();
                tx.recentBlockhash = blockhash;
                tx.feePayer = pos.keypair.publicKey;
                tx.sign(pos.keypair);

                const signature = await this.connection.sendRawTransaction(
                    tx.serialize(),
                    { skipPreflight: true }
                );

                logger.info(`Wallet ${i + 1} sold: ${signature}`);
                return signature;

            } catch (error: any) {
                logger.error(`Wallet ${i + 1} failed:`, error.message);
                return null;
            }
        });

        const results = await Promise.all(promises);
        const successful = results.filter(r => r !== null);

        logger.info(`${successful.length}/${positions.length} wallets sold successfully`);

        return successful[0] || null;
    }

    /**
     * Estimate bundle execution time
     */
    estimateBundleTime(): number {
        // Jito bundles typically land in 1-2 slots
        // 1 slot = ~400ms
        return 800; // ms
    }
}
