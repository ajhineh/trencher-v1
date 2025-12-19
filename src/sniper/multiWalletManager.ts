// src/sniper/multiWalletManager.ts

/**
 * Multi-Wallet Manager
 * Manages multiple wallets for sniping
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';

export interface WalletConfig {
    privateKey: string;
    name: string;
    maxBuyAmount: number; // SOL per wallet
}

export class MultiWalletManager {
    private connection: Connection;
    private wallets: Map<string, Keypair> = new Map();
    private walletConfigs: Map<string, WalletConfig> = new Map();

    constructor(connection: Connection) {
        this.connection = connection;
    }

    /**
     * Add wallet
     */
    addWallet(config: WalletConfig): void {
        try {
            const keypair = Keypair.fromSecretKey(
                Buffer.from(JSON.parse(config.privateKey))
            );

            const address = keypair.publicKey.toBase58();
            this.wallets.set(address, keypair);
            this.walletConfigs.set(address, config);

            logger.info(`✅ Wallet added: ${config.name} (${address.slice(0, 8)}...)`);

        } catch (error: any) {
            logger.error(`Failed to add wallet ${config.name}:`, error.message);
        }
    }

    /**
     * Add multiple wallets
     */
    addWallets(configs: WalletConfig[]): void {
        logger.info(`Adding ${configs.length} wallets...`);
        configs.forEach(config => this.addWallet(config));
        logger.info(`Total wallets: ${this.wallets.size}`);
    }

    /**
     * Get all wallets
     */
    getAllWallets(): Keypair[] {
        return Array.from(this.wallets.values());
    }

    /**
     * Get wallet by address
     */
    getWallet(address: string): Keypair | undefined {
        return this.wallets.get(address);
    }

    /**
     * Get wallet config
     */
    getConfig(address: string): WalletConfig | undefined {
        return this.walletConfigs.get(address);
    }

    /**
     * Check balances
     */
    async checkBalances(): Promise<Map<string, number>> {
        const balances = new Map<string, number>();

        for (const [address, keypair] of this.wallets) {
            try {
                const balance = await this.connection.getBalance(keypair.publicKey);
                balances.set(address, balance / 1e9);

                const config = this.walletConfigs.get(address);
                logger.info(`${config?.name}: ${(balance / 1e9).toFixed(4)} SOL`);

            } catch (error: any) {
                logger.error(`Failed to get balance for ${address}:`, error.message);
                balances.set(address, 0);
            }
        }

        return balances;
    }

    /**
     * Get wallets with sufficient balance
     */
    async getReadyWallets(minBalance: number = 0.01): Promise<Keypair[]> {
        const ready: Keypair[] = [];

        for (const [address, keypair] of this.wallets) {
            const balance = await this.connection.getBalance(keypair.publicKey);

            if (balance / 1e9 >= minBalance) {
                ready.push(keypair);
            }
        }

        logger.info(`${ready.length}/${this.wallets.size} wallets ready (>=${minBalance} SOL)`);

        return ready;
    }

    /**
     * Distribute SOL to wallets
     */
    async distributeSOL(
        fromKeypair: Keypair,
        amountPerWallet: number
    ): Promise<void> {
        logger.info(`Distributing ${amountPerWallet} SOL to ${this.wallets.size} wallets...`);

        const { SystemProgram, Transaction } = await import('@solana/web3.js');

        for (const [address, keypair] of this.wallets) {
            try {
                const tx = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: fromKeypair.publicKey,
                        toPubkey: keypair.publicKey,
                        lamports: Math.floor(amountPerWallet * 1e9)
                    })
                );

                const signature = await this.connection.sendTransaction(tx, [fromKeypair]);
                await this.connection.confirmTransaction(signature);

                const config = this.walletConfigs.get(address);
                logger.info(`✅ ${config?.name}: ${amountPerWallet} SOL sent`);

            } catch (error: any) {
                logger.error(`Failed to send to ${address}:`, error.message);
            }
        }
    }
}
