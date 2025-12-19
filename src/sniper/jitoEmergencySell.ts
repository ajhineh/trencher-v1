// src/sniper/jitoEmergencySell.ts

/**
 * Jito Emergency Sell with PumpSwap Integration
 */

import {
    Connection,
    PublicKey,
    Transaction,
    Keypair,
    SystemProgram,
    TransactionInstruction
} from '@solana/web3.js';
import { buildPumpSwapSellAccounts } from '../pumpswap/buildPumpSwapSellAccounts';
import { PUMP_AMM_SDK } from '@pump-fun/pump-swap-sdk';
import { logger } from '../logger';
import BN from 'bn.js';

export class JitoEmergencySell {
    private connection: Connection;
    private keypair: Keypair;
    private jitoTipAccounts: PublicKey[];
    private jitoRpcUrl: string;

    constructor(connection: Connection, keypair: Keypair) {
        this.connection = connection;
        this.keypair = keypair;

        // Jito tip accounts
        this.jitoTipAccounts = [
            'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
            'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
            '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
            '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
            'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe'
        ].map(addr => new PublicKey(addr));

        this.jitoRpcUrl = 'https://mainnet.block-engine.jito.wtf/api/v1/transactions';
    }

    /**
     * Emergency sell with Jito
     */
    async emergencySell(
        mint: PublicKey,
        poolKey: PublicKey,
        quoteMint: PublicKey,
        tipAmount: number = 0.001
    ): Promise<string | null> {
        logger.error('🚨 EMERGENCY SELL VIA JITO');

        try {
            // Build sell transaction
            const tx = await this.buildSellTransaction(
                mint,
                poolKey,
                quoteMint,
                5000 // 50% slippage for emergency
            );

            // Add Jito tip
            this.addJitoTip(tx, tipAmount);

            // Send via Jito
            const signature = await this.sendViaJito(tx);

            logger.info('✅ Emergency sell successful:', signature);
            return signature;

        } catch (error: any) {
            logger.error('❌ Emergency sell failed:', error.message);
            return null;
        }
    }

    /**
     * Build sell transaction
     */
    private async buildSellTransaction(
        baseMint: PublicKey,
        poolKey: PublicKey,
        quoteMint: PublicKey,
        slippageBps: number
    ): Promise<Transaction> {
        // Build accounts
        const { accounts } = await buildPumpSwapSellAccounts({
            connection: this.connection,
            poolPubkey: poolKey,
            userPubkey: this.keypair.publicKey,
            baseMint,
            quoteMint
        });

        // Get token balance (sell all)
        const balance = await this.getTokenBalance(baseMint);

        if (balance === 0) {
            throw new Error('No tokens to sell');
        }

        logger.info(`Selling ${balance} tokens`);

        // Build sell instruction using SDK
        const sellIx = await PUMP_AMM_SDK.sellBaseInput(
            accounts as any,
            new BN(balance),
            slippageBps / 100 // Convert bps to percent
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
    private addJitoTip(tx: Transaction, tipSol: number): void {
        // Random tip account
        const tipAccount = this.jitoTipAccounts[
            Math.floor(Math.random() * this.jitoTipAccounts.length)
        ];

        const tipIx = SystemProgram.transfer({
            fromPubkey: this.keypair.publicKey,
            toPubkey: tipAccount,
            lamports: Math.floor(tipSol * 1e9)
        });

        tx.add(tipIx);
        logger.info(`Added Jito tip: ${tipSol} SOL to ${tipAccount.toBase58()}`);
    }

    /**
     * Send via Jito
     */
    private async sendViaJito(tx: Transaction): Promise<string> {
        // Get blockhash
        const { blockhash, lastValidBlockHeight } =
            await this.connection.getLatestBlockhash('finalized');

        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
        tx.feePayer = this.keypair.publicKey;

        // Sign
        tx.sign(this.keypair);

        // Serialize
        const serialized = tx.serialize();

        // Send to Jito
        const response = await fetch(this.jitoRpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'sendTransaction',
                params: [serialized.toString('base64'), {
                    encoding: 'base64',
                    skipPreflight: true
                }]
            })
        });

        const result = await response.json();

        if (result.error) {
            throw new Error(`Jito error: ${JSON.stringify(result.error)}`);
        }

        const signature = result.result;

        // Confirm
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
        const accounts = await this.connection.getTokenAccountsByOwner(
            this.keypair.publicKey,
            { mint }
        );

        if (accounts.value.length === 0) return 0;

        const balance = await this.connection.getTokenAccountBalance(
            accounts.value[0].pubkey
        );

        return Number(balance.value.amount);
    }
}
