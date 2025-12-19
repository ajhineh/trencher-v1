// src/wallet/multiWalletManager.ts

/**
 * Multi-Wallet Management System
 * Manages multiple wallets for security, load balancing, and scalability
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { logger } from "../logger";
import * as fs from 'fs';
import * as path from 'path';

export type WalletRole = 'PRIMARY' | 'TRADING' | 'BACKUP' | 'COLD_STORAGE';
export type WalletStatus = 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'DEPLETED';

export interface WalletConfig {
    address: string;
    privateKey: string; // Encrypted in production
    role: WalletRole;
    maxBalance: number; // Max SOL to hold
    minBalance: number; // Min SOL to maintain
    enabled: boolean;
    priority: number; // 1-10 (higher = preferred)
}

export interface WalletInfo extends WalletConfig {
    balance: number;
    status: WalletStatus;
    lastUsed: number;
    totalTrades: number;
    successRate: number;
}

export interface WalletAllocation {
    wallet: string;
    amount: number;
    reason: string;
}

export class MultiWalletManager {
    private connection: Connection;
    private wallets: Map<string, WalletInfo> = new Map();
    private configPath: string;

    constructor(connection: Connection, configPath: string = './config/wallets.json') {
        this.connection = connection;
        this.configPath = configPath;
    }

    /**
     * Initialize wallet manager
     */
    async initialize(): Promise<void> {
        logger.info('[MultiWallet] Initializing...');

        // Load wallet configurations
        await this.loadWallets();

        // Update balances
        await this.updateAllBalances();

        logger.info(`[MultiWallet] Initialized with ${this.wallets.size} wallets`);
    }

    /**
     * Load wallets from configuration file
     */
    private async loadWallets(): Promise<void> {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf8');
                const configs: WalletConfig[] = JSON.parse(data);

                for (const config of configs) {
                    this.wallets.set(config.address, {
                        ...config,
                        balance: 0,
                        status: 'ACTIVE',
                        lastUsed: 0,
                        totalTrades: 0,
                        successRate: 100,
                    });
                }

                logger.info(`[MultiWallet] Loaded ${configs.length} wallets from config`);
            } else {
                logger.warn(`[MultiWallet] Config file not found: ${this.configPath}`);
            }
        } catch (error) {
            logger.error(`[MultiWallet] Error loading wallets: ${error}`);
        }
    }

    /**
     * Add new wallet
     */
    addWallet(config: WalletConfig): void {
        const info: WalletInfo = {
            ...config,
            balance: 0,
            status: 'ACTIVE',
            lastUsed: 0,
            totalTrades: 0,
            successRate: 100,
        };

        this.wallets.set(config.address, info);
        this.saveWallets();

        logger.info(`[MultiWallet] Added wallet ${config.address.slice(0, 8)}... (${config.role})`);
    }

    /**
     * Remove wallet
     */
    removeWallet(address: string): void {
        this.wallets.delete(address);
        this.saveWallets();

        logger.info(`[MultiWallet] Removed wallet ${address.slice(0, 8)}...`);
    }

    /**
     * Save wallets to configuration file
     */
    private saveWallets(): void {
        try {
            const configs: WalletConfig[] = Array.from(this.wallets.values()).map(w => ({
                address: w.address,
                privateKey: w.privateKey,
                role: w.role,
                maxBalance: w.maxBalance,
                minBalance: w.minBalance,
                enabled: w.enabled,
                priority: w.priority,
            }));

            // Ensure directory exists
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(this.configPath, JSON.stringify(configs, null, 2));
        } catch (error) {
            logger.error(`[MultiWallet] Error saving wallets: ${error}`);
        }
    }

    /**
     * Update all wallet balances
     */
    async updateAllBalances(): Promise<void> {
        for (const [address, wallet] of this.wallets.entries()) {
            try {
                const balance = await this.getBalance(address);
                wallet.balance = balance;
                wallet.status = this.determineStatus(wallet);
            } catch (error) {
                logger.error(`[MultiWallet] Error updating balance for ${address.slice(0, 8)}...: ${error}`);
            }
        }
    }

    /**
     * Get wallet balance
     */
    async getBalance(address: string): Promise<number> {
        try {
            const pubkey = new PublicKey(address);
            const balance = await this.connection.getBalance(pubkey);
            return balance / LAMPORTS_PER_SOL;
        } catch (error) {
            logger.error(`[MultiWallet] Error getting balance: ${error}`);
            return 0;
        }
    }

    /**
     * Determine wallet status
     */
    private determineStatus(wallet: WalletInfo): WalletStatus {
        if (!wallet.enabled) return 'INACTIVE';
        if (wallet.balance < wallet.minBalance) return 'DEPLETED';
        if (wallet.balance > wallet.maxBalance) return 'LOCKED';
        return 'ACTIVE';
    }

    /**
     * Select best wallet for trading
     */
    async selectWalletForTrade(amount: number, preferredRole?: WalletRole): Promise<string | null> {
        // Filter eligible wallets
        const eligible = Array.from(this.wallets.values()).filter(w =>
            w.enabled &&
            w.status === 'ACTIVE' &&
            w.balance >= amount &&
            w.balance + amount <= w.maxBalance &&
            (!preferredRole || w.role === preferredRole)
        );

        if (eligible.length === 0) {
            logger.warn('[MultiWallet] No eligible wallets for trade');
            return null;
        }

        // Sort by priority and balance
        eligible.sort((a, b) => {
            // First by priority
            if (a.priority !== b.priority) return b.priority - a.priority;

            // Then by least recently used
            if (a.lastUsed !== b.lastUsed) return a.lastUsed - b.lastUsed;

            // Then by balance (prefer wallets with more balance)
            return b.balance - a.balance;
        });

        const selected = eligible[0];
        logger.info(
            `[MultiWallet] Selected ${selected.address.slice(0, 8)}... ` +
            `(${selected.role}, Balance: ${selected.balance.toFixed(4)} SOL)`
        );

        return selected.address;
    }

    /**
     * Distribute capital across trading wallets
     */
    async distributeCapital(totalAmount: number): Promise<WalletAllocation[]> {
        logger.info(`[MultiWallet] Distributing ${totalAmount.toFixed(4)} SOL across wallets`);

        const allocations: WalletAllocation[] = [];

        // Get primary wallet
        const primary = this.getPrimaryWallet();
        if (!primary) {
            throw new Error('No primary wallet found');
        }

        // Get trading wallets
        const tradingWallets = this.getTradingWallets();
        if (tradingWallets.length === 0) {
            throw new Error('No trading wallets found');
        }

        // Calculate allocation per wallet
        const perWallet = totalAmount / tradingWallets.length;

        for (const wallet of tradingWallets) {
            const targetBalance = Math.min(perWallet, wallet.maxBalance);
            const needed = Math.max(0, targetBalance - wallet.balance);

            if (needed > 0.01) { // Only if significant amount needed
                allocations.push({
                    wallet: wallet.address,
                    amount: needed,
                    reason: `Rebalance to ${targetBalance.toFixed(4)} SOL`,
                });
            }
        }

        logger.info(`[MultiWallet] Generated ${allocations.length} allocation actions`);
        return allocations;
    }

    /**
     * Execute capital distribution
     */
    async executeDistribution(allocations: WalletAllocation[]): Promise<void> {
        const primary = this.getPrimaryWallet();
        if (!primary) {
            throw new Error('No primary wallet found');
        }

        for (const allocation of allocations) {
            logger.info(
                `[MultiWallet] Transferring ${allocation.amount.toFixed(4)} SOL ` +
                `to ${allocation.wallet.slice(0, 8)}... (${allocation.reason})`
            );

            // TODO: Implement actual transfer
            // await this.transfer(primary.address, allocation.wallet, allocation.amount);
        }
    }

    /**
     * Consolidate funds back to primary wallet
     */
    async consolidateFunds(): Promise<number> {
        logger.info('[MultiWallet] Consolidating funds to primary wallet');

        const primary = this.getPrimaryWallet();
        if (!primary) {
            throw new Error('No primary wallet found');
        }

        let totalConsolidated = 0;
        const tradingWallets = this.getTradingWallets();

        for (const wallet of tradingWallets) {
            const excess = wallet.balance - wallet.minBalance;
            if (excess > 0.01) {
                logger.info(
                    `[MultiWallet] Consolidating ${excess.toFixed(4)} SOL ` +
                    `from ${wallet.address.slice(0, 8)}...`
                );

                // TODO: Implement actual transfer
                // await this.transfer(wallet.address, primary.address, excess);
                totalConsolidated += excess;
            }
        }

        logger.info(`[MultiWallet] Consolidated ${totalConsolidated.toFixed(4)} SOL`);
        return totalConsolidated;
    }

    /**
     * Get primary wallet
     */
    private getPrimaryWallet(): WalletInfo | undefined {
        return Array.from(this.wallets.values()).find(w => w.role === 'PRIMARY');
    }

    /**
     * Get trading wallets
     */
    private getTradingWallets(): WalletInfo[] {
        return Array.from(this.wallets.values()).filter(w => w.role === 'TRADING' && w.enabled);
    }

    /**
     * Get all wallets
     */
    getAllWallets(): WalletInfo[] {
        return Array.from(this.wallets.values());
    }

    /**
     * Get wallet by address
     */
    getWallet(address: string): WalletInfo | undefined {
        return this.wallets.get(address);
    }

    /**
     * Update wallet statistics
     */
    updateWalletStats(address: string, success: boolean): void {
        const wallet = this.wallets.get(address);
        if (!wallet) return;

        wallet.lastUsed = Date.now();
        wallet.totalTrades++;

        // Update success rate (exponential moving average)
        const alpha = 0.1;
        wallet.successRate = wallet.successRate * (1 - alpha) + (success ? 100 : 0) * alpha;
    }

    /**
     * Get wallet statistics
     */
    getStatistics(): {
        totalWallets: number;
        activeWallets: number;
        totalBalance: number;
        avgBalance: number;
        byRole: Record<WalletRole, number>;
    } {
        const wallets = Array.from(this.wallets.values());
        const active = wallets.filter(w => w.status === 'ACTIVE');
        const totalBalance = wallets.reduce((sum, w) => sum + w.balance, 0);

        const byRole: Record<WalletRole, number> = {
            PRIMARY: 0,
            TRADING: 0,
            BACKUP: 0,
            COLD_STORAGE: 0,
        };

        for (const wallet of wallets) {
            byRole[wallet.role]++;
        }

        return {
            totalWallets: wallets.length,
            activeWallets: active.length,
            totalBalance,
            avgBalance: wallets.length > 0 ? totalBalance / wallets.length : 0,
            byRole,
        };
    }

    /**
     * Display wallet report
     */
    displayReport(): void {
        const stats = this.getStatistics();

        console.log("\n" + "=".repeat(60));
        console.log("👛 MULTI-WALLET MANAGEMENT REPORT");
        console.log("=".repeat(60));
        console.log(`Total Wallets: ${stats.totalWallets}`);
        console.log(`Active Wallets: ${stats.activeWallets}`);
        console.log(`Total Balance: ${stats.totalBalance.toFixed(4)} SOL`);
        console.log(`Avg Balance: ${stats.avgBalance.toFixed(4)} SOL`);

        console.log("\n📊 BY ROLE:");
        for (const [role, count] of Object.entries(stats.byRole)) {
            if (count > 0) {
                console.log(`  ${role}: ${count}`);
            }
        }

        console.log("\n💼 WALLET DETAILS:");
        for (const wallet of this.getAllWallets()) {
            console.log(
                `  ${wallet.address.slice(0, 12).padEnd(12)} ` +
                `${wallet.role.padEnd(12)} ` +
                `${wallet.balance.toFixed(4)} SOL ` +
                `[${wallet.status}] ` +
                `(${wallet.totalTrades} trades, ${wallet.successRate.toFixed(1)}% success)`
            );
        }

        console.log("=".repeat(60) + "\n");
    }
}

// Singleton instance
let walletManagerInstance: MultiWalletManager | null = null;

export function getMultiWalletManager(connection: Connection): MultiWalletManager {
    if (!walletManagerInstance) {
        walletManagerInstance = new MultiWalletManager(connection);
    }
    return walletManagerInstance;
}
