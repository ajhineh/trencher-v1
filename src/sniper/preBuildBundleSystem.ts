// src/sniper/preBuildBundleSystem.ts

/**
 * Pre-Build Bundle System
 * Builds bundle immediately after buy, updates on sells
 */

import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';
import { buildPumpSwapSellAccounts } from '../pumpswap/buildPumpSwapSellAccounts';
import { PUMP_AMM_SDK } from '@pump-fun/pump-swap-sdk';
import { logger } from '../logger';
import BN from 'bn.js';

interface PreBuiltBundle {
    transactions: Transaction[];
    wallets: Keypair[];
    lastUpdate: number;
    tokenBalances: Map<string, number>; // wallet address -> balance
}

export class PreBuildBundleSystem {
    private connection: Connection;
    private bundles: Map<string, PreBuiltBundle> = new Map(); // mint -> bundle

    constructor(connection: Connection) {
        this.connection = connection;
    }

    /**
     * Pre-build bundle immediately after buy
     */
    async preBuildBundle(
        mint: PublicKey,
        poolKey: PublicKey,
        quoteMint: PublicKey,
        wallets: Keypair[]
    ): Promise<void> {
        const startTime = Date.now();
        logger.info('🔨 Pre-building emergency bundle...');

        try {
            // Get current balances
            const balances = await this.getTokenBalances(mint, wallets);

            // Build all transactions
            const transactions: Transaction[] = [];

            for (let i = 0; i < wallets.length; i++) {
                const wallet = wallets[i];
                const balance = balances.get(wallet.publicKey.toBase58()) || 0;

                if (balance === 0) {
                    logger.warn(`Wallet ${i + 1} has no tokens, skipping`);
                    continue;
                }

                const tx = await this.buildSellTransaction(
                    mint,
                    poolKey,
                    quoteMint,
                    wallet,
                    balance
                );

                transactions.push(tx);
            }

            // Store pre-built bundle
            this.bundles.set(mint.toBase58(), {
                transactions,
                wallets,
                lastUpdate: Date.now(),
                tokenBalances: balances
            });

            const buildTime = Date.now() - startTime;
            logger.info(`✅ Bundle pre-built in ${buildTime}ms`);
            logger.info(`   Transactions: ${transactions.length}`);
            logger.info(`   Ready for instant execution!`);

        } catch (error: any) {
            logger.error('Failed to pre-build bundle:', error.message);
        }
    }

    /**
     * Update bundle after partial sell
     */
    async updateBundle(
        mint: PublicKey,
        poolKey: PublicKey,
        quoteMint: PublicKey
    ): Promise<void> {
        const mintStr = mint.toBase58();
        const bundle = this.bundles.get(mintStr);

        if (!bundle) {
            logger.warn('No pre-built bundle to update');
            return;
        }

        logger.info('🔄 Updating bundle with new balances...');

        // Get updated balances
        const newBalances = await this.getTokenBalances(mint, bundle.wallets);

        // Check if balances changed
        let changed = false;
        for (const [wallet, newBalance] of newBalances) {
            const oldBalance = bundle.tokenBalances.get(wallet) || 0;
            if (newBalance !== oldBalance) {
                changed = true;
                break;
            }
        }

        if (!changed) {
            logger.info('Balances unchanged, bundle still valid');
            return;
        }

        // Rebuild bundle with new balances
        await this.preBuildBundle(mint, poolKey, quoteMint, bundle.wallets);
    }

    /**
     * Execute pre-built bundle instantly
     */
    async executePreBuiltBundle(
        mint: PublicKey,
        tipAmount: number = 0.01
    ): Promise<string | null> {
        const startTime = Date.now();
        const mintStr = mint.toBase58();
        const bundle = this.bundles.get(mintStr);

        if (!bundle) {
            logger.error('❌ No pre-built bundle found!');
            return null;
        }

        logger.error('⚡ EXECUTING PRE-BUILT BUNDLE!');
        logger.error(`   Transactions: ${bundle.transactions.length}`);
        logger.error(`   Age: ${Date.now() - bundle.lastUpdate}ms`);

        try {
            // Get fresh blockhash
            const { blockhash } = await this.connection.getLatestBlockhash('finalized');

            // Update blockhash and sign
            const signedTxs = bundle.transactions.map((tx, i) => {
                tx.recentBlockhash = blockhash;
                tx.feePayer = bundle.wallets[i].publicKey;

                // Add tip to first transaction
                if (i === 0) {
                    this.addJitoTip(tx, bundle.wallets[0], tipAmount);
                }

                tx.sign(bundle.wallets[i]);
                return tx;
            });

            // Send as bundle
            const bundleId = await this.sendBundle(signedTxs);

            const totalTime = Date.now() - startTime;
            logger.info(`✅ Bundle executed in ${totalTime}ms`);
            logger.info(`   Bundle ID: ${bundleId}`);

            // Clear bundle
            this.bundles.delete(mintStr);

            return bundleId;

        } catch (error: any) {
            logger.error('Bundle execution failed:', error.message);
            return null;
        }
    }

    /**
     * Build sell transaction
     */
    private async buildSellTransaction(
        mint: PublicKey,
        poolKey: PublicKey,
        quoteMint: PublicKey,
        wallet: Keypair,
        balance: number
    ): Promise<Transaction> {
        const { accounts } = await buildPumpSwapSellAccounts({
            connection: this.connection,
            poolPubkey: poolKey,
            userPubkey: wallet.publicKey,
            baseMint: mint,
            quoteMint
        });

        const sellIx = await PUMP_AMM_SDK.sellBaseInput(
            accounts as any,
            new BN(balance),
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
     * Get token balances for all wallets
     */
    private async getTokenBalances(
        mint: PublicKey,
        wallets: Keypair[]
    ): Promise<Map<string, number>> {
        const balances = new Map<string, number>();

        const promises = wallets.map(async wallet => {
            try {
                const accounts = await this.connection.getTokenAccountsByOwner(
                    wallet.publicKey,
                    { mint }
                );

                if (accounts.value.length === 0) {
                    return { address: wallet.publicKey.toBase58(), balance: 0 };
                }

                const balance = await this.connection.getTokenAccountBalance(
                    accounts.value[0].pubkey
                );

                return {
                    address: wallet.publicKey.toBase58(),
                    balance: Number(balance.value.amount)
                };

            } catch (error) {
                return { address: wallet.publicKey.toBase58(), balance: 0 };
            }
        });

        const results = await Promise.all(promises);
        results.forEach(r => balances.set(r.address, r.balance));

        return balances;
    }

    /**
     * Add Jito tip
     */
    private addJitoTip(tx: Transaction, payer: Keypair, tipAmount: number): void {
        const { SystemProgram } = require('@solana/web3.js');

        const tipAccounts = [
            'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
            'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL'
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
     * Send bundle
     */
    private async sendBundle(transactions: Transaction[]): Promise<string> {
        const serialized = transactions.map(tx => tx.serialize().toString('base64'));

        const response = await fetch(
            'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'sendBundle',
                    params: [serialized]
                })
            }
        );

        const result = await response.json();

        if (result.error) {
            throw new Error(`Jito error: ${JSON.stringify(result.error)}`);
        }

        return result.result;
    }

    /**
     * Check if bundle exists
     */
    hasBundle(mint: PublicKey): boolean {
        return this.bundles.has(mint.toBase58());
    }

    /**
     * Get bundle age
     */
    getBundleAge(mint: PublicKey): number {
        const bundle = this.bundles.get(mint.toBase58());
        return bundle ? Date.now() - bundle.lastUpdate : -1;
    }
}
