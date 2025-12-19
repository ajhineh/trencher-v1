// src/wallet/walletBalanceManager.ts

/**
 * Wallet Balance Manager
 * Automated balance management for multi-wallet system:
 * - Wallet 0: Main treasury wallet
 * - Wallets 1-10: Trading wallets (auto-rebalanced)
 * - Auto-refill when below threshold
 * - Auto-drain when above target
 * - SOL/WSOL detection and handling
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { logger } from '../logger';
import { WSOLManager } from '../wsol-manager';

const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

export interface BalanceConfig {
    idealBalance: number;          // SOL - ideal balance per wallet
    refillThresholdPercent: number; // % - refill when below this (e.g., 20)
    drainThresholdMultiplier: number; // x - drain when above this (e.g., 3)
    useWSOL: boolean;              // Use WSOL instead of SOL for trading
}

export interface WalletInfo {
    index: number;
    keypair: Keypair;
    name: string;
    balance: number;
    wsolBalance: number;
    needsRefill: boolean;
    needsDrain: boolean;
}

export class WalletBalanceManager {
    private connection: Connection;
    private mainWallet: Keypair;  // Wallet 0 (treasury)
    private tradingWallets: Keypair[] = []; // Wallets 1-10
    private futuresWallet?: Keypair; // Separate futures wallet
    private config: BalanceConfig;
    private wsolManager: WSOLManager;

    constructor(
        connection: Connection,
        mainWallet: Keypair,
        tradingWallets: Keypair[],
        config: BalanceConfig,
        futuresWallet?: Keypair
    ) {
        this.connection = connection;
        this.mainWallet = mainWallet;
        this.tradingWallets = tradingWallets.slice(0, 10); // Max 10 wallets
        this.futuresWallet = futuresWallet;
        this.config = config;
        this.wsolManager = new WSOLManager(connection, mainWallet);

        logger.info('💼 Wallet Balance Manager initialized');
        logger.info(`   Main Wallet: ${mainWallet.publicKey.toBase58().slice(0, 8)}...`);
        logger.info(`   Trading Wallets: ${this.tradingWallets.length}`);
        logger.info(`   Ideal Balance: ${config.idealBalance} ${config.useWSOL ? 'WSOL' : 'SOL'}`);
        logger.info(`   Refill Threshold: ${config.refillThresholdPercent}%`);
        logger.info(`   Drain Threshold: ${config.drainThresholdMultiplier}x`);
        if (futuresWallet) {
            logger.info(`   Futures Wallet: ${futuresWallet.publicKey.toBase58().slice(0, 8)}...`);
        }
    }

    /**
     * Initialize and check all wallets on startup
     */
    async initialize(): Promise<void> {
        logger.info('🔍 Checking wallet balances on startup...');

        // Check main wallet
        const mainBalance = await this.getSOLBalance(this.mainWallet.publicKey);
        logger.info(`💰 Main Wallet: ${mainBalance.toFixed(4)} SOL`);

        // Check and rebalance trading wallets
        await this.rebalanceAll();

        // Check futures wallet if exists
        if (this.futuresWallet) {
            const futuresBalance = await this.getSOLBalance(this.futuresWallet.publicKey);
            logger.info(`📊 Futures Wallet: ${futuresBalance.toFixed(4)} SOL`);
        }

        logger.info('✅ Wallet initialization complete');
    }

    /**
     * Check and rebalance all trading wallets
     */
    async rebalanceAll(): Promise<void> {
        logger.info('⚖️ Rebalancing all trading wallets...');

        const walletsInfo = await this.checkAllWallets();

        // Process refills first
        const walletsNeedingRefill = walletsInfo.filter(w => w.needsRefill);
        if (walletsNeedingRefill.length > 0) {
            logger.info(`💉 ${walletsNeedingRefill.length} wallets need refill`);
            await this.refillWallets(walletsNeedingRefill);
        }

        // Process drains
        const walletsNeedingDrain = walletsInfo.filter(w => w.needsDrain);
        if (walletsNeedingDrain.length > 0) {
            logger.info(`💧 ${walletsNeedingDrain.length} wallets need drain`);
            await this.drainWallets(walletsNeedingDrain);
        }

        if (walletsNeedingRefill.length === 0 && walletsNeedingDrain.length === 0) {
            logger.info('✅ All wallets balanced');
        }
    }

    /**
     * Check all trading wallets and determine rebalancing needs
     */
    private async checkAllWallets(): Promise<WalletInfo[]> {
        const walletsInfo: WalletInfo[] = [];

        for (let i = 0; i < this.tradingWallets.length; i++) {
            const wallet = this.tradingWallets[i];
            const balance = this.config.useWSOL
                ? await this.getWSOLBalance(wallet.publicKey)
                : await this.getSOLBalance(wallet.publicKey);

            const solBalance = await this.getSOLBalance(wallet.publicKey);
            const wsolBalance = await this.getWSOLBalance(wallet.publicKey);

            const refillThreshold = this.config.idealBalance * (this.config.refillThresholdPercent / 100);
            const drainThreshold = this.config.idealBalance * this.config.drainThresholdMultiplier;

            const info: WalletInfo = {
                index: i + 1,
                keypair: wallet,
                name: `Wallet-${i + 1}`,
                balance: solBalance,
                wsolBalance: wsolBalance,
                needsRefill: balance < refillThreshold,
                needsDrain: balance > drainThreshold
            };

            walletsInfo.push(info);

            const statusIcon = info.needsRefill ? '🔴' : info.needsDrain ? '🟡' : '🟢';
            logger.info(`${statusIcon} Wallet-${i + 1}: ${balance.toFixed(4)} ${this.config.useWSOL ? 'WSOL' : 'SOL'}`);
        }

        return walletsInfo;
    }

    /**
     * Refill wallets from main wallet
     */
    private async refillWallets(wallets: WalletInfo[]): Promise<void> {
        for (const wallet of wallets) {
            try {
                // Calculate refill amount (100% - current percentage)
                const currentBalance = this.config.useWSOL ? wallet.wsolBalance : wallet.balance;
                const refillAmount = this.config.idealBalance - currentBalance;

                if (refillAmount <= 0) continue;

                logger.info(`💉 Refilling ${wallet.name}: +${refillAmount.toFixed(4)} ${this.config.useWSOL ? 'WSOL' : 'SOL'}`);

                if (this.config.useWSOL) {
                    // For WSOL: wrap SOL in main wallet, then transfer
                    await this.wsolManager.wrapSOL(refillAmount);
                    // Transfer WSOL would require token transfer logic
                    // For now, transfer SOL and let wallet wrap it
                    await this.transferSOL(this.mainWallet, wallet.keypair.publicKey, refillAmount);
                } else {
                    // Direct SOL transfer
                    await this.transferSOL(this.mainWallet, wallet.keypair.publicKey, refillAmount);
                }

                logger.info(`✅ ${wallet.name} refilled`);

            } catch (error: any) {
                logger.error(`❌ Failed to refill ${wallet.name}: ${error.message}`);
            }
        }
    }

    /**
     * Drain excess from wallets to main wallet
     */
    private async drainWallets(wallets: WalletInfo[]): Promise<void> {
        for (const wallet of wallets) {
            try {
                // Calculate drain amount (excess above ideal balance)
                const currentBalance = this.config.useWSOL ? wallet.wsolBalance : wallet.balance;
                const drainAmount = currentBalance - this.config.idealBalance;

                if (drainAmount <= 0) continue;

                logger.info(`💧 Draining ${wallet.name}: -${drainAmount.toFixed(4)} ${this.config.useWSOL ? 'WSOL' : 'SOL'}`);

                if (this.config.useWSOL) {
                    // For WSOL: unwrap to SOL, then transfer
                    // Transfer SOL back to main
                    await this.transferSOL(wallet.keypair, this.mainWallet.publicKey, drainAmount);
                } else {
                    // Direct SOL transfer
                    await this.transferSOL(wallet.keypair, this.mainWallet.publicKey, drainAmount);
                }

                logger.info(`✅ ${wallet.name} drained`);

            } catch (error: any) {
                logger.error(`❌ Failed to drain ${wallet.name}: ${error.message}`);
            }
        }
    }

    /**
     * Transfer SOL between wallets
     */
    private async transferSOL(from: Keypair, to: PublicKey, amount: number): Promise<string> {
        const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: from.publicKey,
                toPubkey: to,
                lamports
            })
        );

        const signature = await this.connection.sendTransaction(transaction, [from], {
            skipPreflight: true
        });

        const latestBlockhash = await this.connection.getLatestBlockhash();
        await this.connection.confirmTransaction({
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        });

        return signature;
    }

    /**
     * Get SOL balance
     */
    private async getSOLBalance(publicKey: PublicKey): Promise<number> {
        try {
            const balance = await this.connection.getBalance(publicKey);
            return balance / LAMPORTS_PER_SOL;
        } catch (error) {
            logger.warn(`Failed to get SOL balance for ${publicKey.toBase58()}`);
            return 0;
        }
    }

    /**
     * Get WSOL balance
     */
    private async getWSOLBalance(publicKey: PublicKey): Promise<number> {
        try {
            const wsolAccount = await getAssociatedTokenAddress(WSOL_MINT, publicKey);
            const accountInfo = await getAccount(this.connection, wsolAccount);
            return Number(accountInfo.amount) / LAMPORTS_PER_SOL;
        } catch (error) {
            // Account doesn't exist or no WSOL
            return 0;
        }
    }

    /**
     * Trigger rebalance after full token sell
     */
    async onTokenSellComplete(): Promise<void> {
        logger.info('🔄 Token sold - triggering wallet rebalance...');
        await this.rebalanceAll();
    }

    /**
     * Get current configuration
     */
    getConfig(): BalanceConfig {
        return this.config;
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<BalanceConfig>): void {
        this.config = { ...this.config, ...newConfig };
        logger.info(`📊 Balance config updated: ${JSON.stringify(newConfig)}`);
    }

    /**
     * Get main wallet balance
     */
    async getMainWalletBalance(): Promise<{ sol: number; wsol: number }> {
        return {
            sol: await this.getSOLBalance(this.mainWallet.publicKey),
            wsol: await this.getWSOLBalance(this.mainWallet.publicKey)
        };
    }

    /**
     * Get futures wallet balance (if exists)
     */
    async getFuturesWalletBalance(): Promise<{ sol: number; wsol: number } | null> {
        if (!this.futuresWallet) return null;

        return {
            sol: await this.getSOLBalance(this.futuresWallet.publicKey),
            wsol: await this.getWSOLBalance(this.futuresWallet.publicKey)
        };
    }
}
