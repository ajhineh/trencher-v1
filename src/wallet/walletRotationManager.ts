// src/wallet/walletRotationManager.ts

/**
 * Wallet Rotation Manager
 * Automatically rotates wallets every N days to prevent blacklisting and tracking
 */

import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { MultiWalletManager } from '../sniper/multiWalletManager';
import { logger } from '../logger';
import fs from 'fs';
import path from 'path';

export interface WalletRotationConfig {
    rotationIntervalDays: number;      // Days between rotations (default: 2)
    walletsPerRotation: number;        // Number of wallets to use (default: 10)
    minBalanceToKeep: number;          // SOL to keep in old wallets (default: 0.001)
    idealWalletBalance: number;        // Ideal balance per wallet (default: 0.05)
    autoRotate: boolean;               // Enable automatic rotation (default: true)
}

export class WalletRotationManager {
    private config: WalletRotationConfig;
    private lastRotationTime: number;
    private rotationTimer: NodeJS.Timeout | null = null;
    private initialized = false;

    constructor(
        private connection: Connection,
        private mainWallet: Keypair,
        private walletManager: MultiWalletManager,
        config: Partial<WalletRotationConfig>
    ) {
        this.config = {
            rotationIntervalDays: 2,
            walletsPerRotation: 10,
            minBalanceToKeep: 0.001,
            idealWalletBalance: 0.05,
            autoRotate: true,
            ...config
        };

        this.lastRotationTime = this.loadLastRotationTime();
    }

    /**
     * Initialize wallet system
     * Check if wallets exist, create if needed, ensure proper funding
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            logger.warn('Wallet rotation already initialized');
            return;
        }

        logger.info('🔄 Initializing wallet rotation system...');

        try {
            // Step 1: Check existing wallets
            const existingWallets = this.walletManager.getAllWallets();
            const walletsNeeded = this.config.walletsPerRotation;

            logger.info(`   Current wallets: ${existingWallets.length}`);
            logger.info(`   Required wallets: ${walletsNeeded}`);

            if (existingWallets.length < walletsNeeded) {
                // Need to create new wallets
                const walletsToCreate = walletsNeeded - existingWallets.length;
                logger.info(`   Creating ${walletsToCreate} new wallets...`);

                const newWallets = await this.generateNewWallets(walletsToCreate);
                await this.fundNewWallets(newWallets);

                // Add to wallet manager
                for (let i = 0; i < newWallets.length; i++) {
                    const wallet = newWallets[i];
                    this.walletManager.addWallet({
                        privateKey: JSON.stringify(Array.from(wallet.secretKey)),
                        name: `Wallet-${i + 1}`,
                        maxBuyAmount: this.config.idealWalletBalance
                    });
                }

                logger.info(`   ✅ Created and funded ${walletsToCreate} wallets`);
            } else if (existingWallets.length > walletsNeeded) {
                // Too many wallets - keep only the first N
                logger.info(`   Trimming to ${walletsNeeded} wallets...`);
                // Note: MultiWalletManager doesn't have clearWallets, so we skip trimming for now
                logger.warn(`   Trimming not implemented - keeping all ${existingWallets.length} wallets`);
            }


            // Step 2: Check and refill balances
            await this.checkAndRefillBalances();

            // Step 3: Start auto rotation if enabled
            if (this.config.autoRotate) {
                this.startAutoRotation();
            }

            this.initialized = true;
            logger.info('✅ Wallet rotation system initialized');
            logger.info(`   Active wallets: ${this.walletManager.getAllWallets().length}`);
            logger.info(`   Next rotation: ${new Date(this.getNextRotationTime()).toLocaleString()}`);

        } catch (error: any) {
            logger.error(`❌ Wallet rotation initialization failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Check and refill wallet balances if needed
     */
    private async checkAndRefillBalances(): Promise<void> {
        logger.info('💰 Checking wallet balances...');

        const wallets = this.walletManager.getAllWallets();
        const idealBalance = this.config.idealWalletBalance * LAMPORTS_PER_SOL;
        const refillThreshold = idealBalance * 0.2; // Refill if below 20%

        for (const wallet of wallets) {
            try {
                const balance = await this.connection.getBalance(wallet.publicKey);

                if (balance < refillThreshold) {
                    const amountToAdd = idealBalance - balance;

                    logger.info(`   Refilling ${wallet.publicKey.toBase58().slice(0, 8)}...`);
                    logger.info(`   Current: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
                    logger.info(`   Adding: ${(amountToAdd / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

                    const tx = new Transaction().add(
                        SystemProgram.transfer({
                            fromPubkey: this.mainWallet.publicKey,
                            toPubkey: wallet.publicKey,
                            lamports: amountToAdd
                        })
                    );

                    await sendAndConfirmTransaction(
                        this.connection,
                        tx,
                        [this.mainWallet]
                    );

                    logger.info(`   ✅ Refilled to ${this.config.idealWalletBalance} SOL`);
                } else {
                    logger.info(`   ${wallet.publicKey.toBase58().slice(0, 8)}... OK (${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL)`);
                }
            } catch (error: any) {
                logger.warn(`   Failed to check/refill ${wallet.publicKey.toBase58()}: ${error.message}`);
            }
        }
    }

    /**
     * Start automatic rotation timer
     */
    private startAutoRotation() {
        const intervalMs = this.config.rotationIntervalDays * 24 * 60 * 60 * 1000;
        const timeUntilNext = this.getTimeUntilRotation();

        // Schedule first rotation
        this.rotationTimer = setTimeout(async () => {
            await this.performRotation();

            // Then set up recurring rotation
            this.rotationTimer = setInterval(async () => {
                await this.performRotation();
            }, intervalMs);
        }, timeUntilNext);

        logger.info(`🔄 Auto rotation enabled (every ${this.config.rotationIntervalDays} days)`);
        logger.info(`   Next rotation in: ${this.formatDuration(timeUntilNext)}`);
    }

    /**
     * Perform wallet rotation
     */
    async performRotation(): Promise<void> {
        logger.info('🔄 Starting wallet rotation...');

        try {
            // Step 1: Drain old wallets
            await this.drainOldWallets();

            // Step 2: Generate new wallets
            const newWallets = await this.generateNewWallets(this.config.walletsPerRotation);

            // Step 3: Fund new wallets
            await this.fundNewWallets(newWallets);

            // Step 4: Archive old wallets
            await this.archiveOldWallets();

            // Step 5: Update active wallets
            await this.updateActiveWallets(newWallets);

            // Step 6: Update rotation time
            this.lastRotationTime = Date.now();
            this.saveLastRotationTime();

            logger.info('✅ Wallet rotation complete!');
            logger.info(`   New wallets: ${newWallets.length}`);
            logger.info(`   Next rotation: ${new Date(this.getNextRotationTime()).toLocaleString()}`);

        } catch (error: any) {
            logger.error(`❌ Wallet rotation failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Drain old wallets to main wallet
     */
    private async drainOldWallets(): Promise<void> {
        logger.info('💸 Draining old wallets...');

        const oldWallets = this.walletManager.getAllWallets();
        let totalDrained = 0;

        for (const wallet of oldWallets) {
            try {
                const balance = await this.connection.getBalance(wallet.publicKey);
                const minBalance = this.config.minBalanceToKeep * LAMPORTS_PER_SOL;

                if (balance > minBalance) {
                    const amountToTransfer = balance - minBalance;

                    const tx = new Transaction().add(
                        SystemProgram.transfer({
                            fromPubkey: wallet.publicKey,
                            toPubkey: this.mainWallet.publicKey,
                            lamports: amountToTransfer
                        })
                    );

                    await sendAndConfirmTransaction(
                        this.connection,
                        tx,
                        [wallet]
                    );

                    totalDrained += amountToTransfer / LAMPORTS_PER_SOL;
                    logger.info(`   Drained ${(amountToTransfer / LAMPORTS_PER_SOL).toFixed(4)} SOL from ${wallet.publicKey.toBase58().slice(0, 8)}...`);
                }
            } catch (error: any) {
                logger.warn(`   Failed to drain ${wallet.publicKey.toBase58()}: ${error.message}`);
            }
        }

        logger.info(`✅ Total drained: ${totalDrained.toFixed(4)} SOL`);
    }

    /**
     * Generate new wallets
     */
    private async generateNewWallets(count: number): Promise<Keypair[]> {
        logger.info(`🔑 Generating ${count} new wallets...`);

        const newWallets: Keypair[] = [];

        for (let i = 0; i < count; i++) {
            const wallet = Keypair.generate();
            newWallets.push(wallet);
            logger.info(`   Generated: ${wallet.publicKey.toBase58()}`);
        }

        return newWallets;
    }

    /**
     * Fund new wallets from main wallet
     */
    private async fundNewWallets(wallets: Keypair[]): Promise<void> {
        logger.info('💰 Funding new wallets...');

        const amountPerWallet = this.config.idealWalletBalance * LAMPORTS_PER_SOL;

        for (const wallet of wallets) {
            try {
                const tx = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: this.mainWallet.publicKey,
                        toPubkey: wallet.publicKey,
                        lamports: amountPerWallet
                    })
                );

                await sendAndConfirmTransaction(
                    this.connection,
                    tx,
                    [this.mainWallet]
                );

                logger.info(`   Funded ${wallet.publicKey.toBase58().slice(0, 8)}... with ${this.config.idealWalletBalance} SOL`);
            } catch (error: any) {
                logger.error(`   Failed to fund ${wallet.publicKey.toBase58()}: ${error.message}`);
            }
        }
    }

    /**
     * Archive old wallets
     */
    private async archiveOldWallets(): Promise<void> {
        const archivePath = path.join(process.cwd(), '.wallet-archive');

        if (!fs.existsSync(archivePath)) {
            fs.mkdirSync(archivePath, { recursive: true });
        }

        const timestamp = Date.now();
        const archiveFile = path.join(archivePath, `wallets-${timestamp}.json`);

        const oldWallets = this.walletManager.getAllWallets().map(w => ({
            publicKey: w.publicKey.toBase58(),
            secretKey: Array.from(w.secretKey),
            archivedAt: timestamp,
            rotationNumber: this.getRotationNumber()
        }));

        fs.writeFileSync(archiveFile, JSON.stringify(oldWallets, null, 2));

        logger.info(`📁 Old wallets archived to: ${archiveFile}`);
    }

    /**
     * Update active wallets
     */
    private async updateActiveWallets(newWallets: Keypair[]): Promise<void> {
        logger.info('🔄 Updating active wallets...');

        // Note: MultiWalletManager doesn't have clearWallets
        // We'll add new wallets alongside existing ones
        for (let i = 0; i < newWallets.length; i++) {
            const wallet = newWallets[i];
            this.walletManager.addWallet({
                privateKey: JSON.stringify(Array.from(wallet.secretKey)),
                name: `Rotated-Wallet-${i + 1}`,
                maxBuyAmount: this.config.idealWalletBalance
            });
        }

        logger.info(`✅ Active wallets updated: ${newWallets.length} wallets`);
    }

    /**
     * Get next rotation time
     */
    getNextRotationTime(): number {
        const intervalMs = this.config.rotationIntervalDays * 24 * 60 * 60 * 1000;
        return this.lastRotationTime + intervalMs;
    }

    /**
     * Get time until next rotation
     */
    getTimeUntilRotation(): number {
        return Math.max(0, this.getNextRotationTime() - Date.now());
    }

    /**
     * Get rotation number
     */
    getRotationNumber(): number {
        const intervalMs = this.config.rotationIntervalDays * 24 * 60 * 60 * 1000;
        return Math.floor((Date.now() - this.lastRotationTime) / intervalMs);
    }

    /**
     * Manual rotation trigger
     */
    async triggerManualRotation(): Promise<void> {
        logger.info('🔄 Manual rotation triggered');
        await this.performRotation();
    }

    /**
     * Stop auto rotation
     */
    stopAutoRotation() {
        if (this.rotationTimer) {
            clearTimeout(this.rotationTimer);
            this.rotationTimer = null;
            logger.info('🛑 Auto rotation stopped');
        }
    }

    /**
     * Load last rotation time from file
     */
    private loadLastRotationTime(): number {
        const filePath = path.join(process.cwd(), '.wallet-rotation-state.json');

        if (fs.existsSync(filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                return data.lastRotationTime || Date.now();
            } catch {
                return Date.now();
            }
        }

        return Date.now();
    }

    /**
     * Save last rotation time to file
     */
    private saveLastRotationTime() {
        const filePath = path.join(process.cwd(), '.wallet-rotation-state.json');
        fs.writeFileSync(filePath, JSON.stringify({
            lastRotationTime: this.lastRotationTime,
            rotationNumber: this.getRotationNumber()
        }, null, 2));
    }

    /**
     * Format duration
     */
    private formatDuration(ms: number): string {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours}h ${minutes}m`;
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            initialized: this.initialized,
            activeWallets: this.walletManager.getAllWallets().length,
            rotationIntervalDays: this.config.rotationIntervalDays,
            lastRotationTime: this.lastRotationTime,
            nextRotationTime: this.getNextRotationTime(),
            timeUntilRotation: this.getTimeUntilRotation(),
            rotationNumber: this.getRotationNumber()
        };
    }
}
