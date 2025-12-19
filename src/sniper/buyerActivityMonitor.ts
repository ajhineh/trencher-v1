// src/sniper/buyerActivityMonitor.ts

/**
 * Buyer Activity Monitor
 * Tracks real-time buyer activity with sliding window algorithm
 * Detects pump & dump (quick sellers)
 */

import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import { logger } from '../logger';

interface BuyerTransaction {
    wallet: string;
    amount: number;
    timestamp: number;
    signature: string;
}

export class BuyerActivityMonitor {
    private connection: Connection;
    private buyerCache: Map<string, { count: number; timestamp: number }> = new Map();
    private readonly CACHE_DURATION_MS = 30000; // 30 seconds

    constructor(connection: Connection) {
        this.connection = connection;
    }

    /**
     * Get active REAL buyers count using sliding window
     */
    async getActiveBuyersCount(
        mint: PublicKey,
        windowSeconds: number = 60
    ): Promise<number> {
        const mintStr = mint.toBase58();

        // Check cache
        const cached = this.buyerCache.get(mintStr);
        if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
            return cached.count;
        }

        try {
            const signatures = await this.connection.getSignaturesForAddress(mint, { limit: 100 });

            const buyTransactions: BuyerTransaction[] = [];
            const sellTransactions: BuyerTransaction[] = [];

            for (const sig of signatures.slice(0, 50)) {
                try {
                    const tx = await this.connection.getParsedTransaction(
                        sig.signature,
                        { maxSupportedTransactionVersion: 0 }
                    );

                    if (!tx || tx.meta?.err) continue;

                    const txInfo = this.extractTransactionInfo(tx, mintStr);
                    if (txInfo) {
                        const txData: BuyerTransaction = {
                            wallet: txInfo.wallet,
                            amount: Math.abs(txInfo.amount),
                            timestamp: sig.blockTime || 0,
                            signature: sig.signature
                        };

                        if (txInfo.amount > 0) {
                            buyTransactions.push(txData);
                        } else {
                            sellTransactions.push(txData);
                        }
                    }
                } catch (error) {
                    continue;
                }
            }

            // Filter quick sellers
            const realBuyers = this.filterQuickSellers(buyTransactions, sellTransactions, windowSeconds);

            // Apply sliding window
            const maxConcurrentBuyers = this.applySlidingWindow(realBuyers, windowSeconds);

            this.buyerCache.set(mintStr, { count: maxConcurrentBuyers, timestamp: Date.now() });

            logger.info(`👥 Real buyers (sliding window): ${maxConcurrentBuyers} (filtered ${buyTransactions.length - realBuyers.length} quick sellers)`);

            return maxConcurrentBuyers;

        } catch (error: any) {
            logger.warn(`Failed to get buyer count: ${error.message}`);
            return 0;
        }
    }

    /**
     * Check if token has enough active buyers
     */
    async hasActiveBuyers(
        mint: PublicKey,
        minBuyers: number,
        windowSeconds: number = 60
    ): Promise<boolean> {
        const count = await this.getActiveBuyersCount(mint, windowSeconds);
        const hasEnough = count >= minBuyers;

        if (!hasEnough) {
            logger.warn(`⚠️ Not enough real buyers: ${count} < ${minBuyers}`);
        } else {
            logger.info(`✅ Sufficient real buyers: ${count} >= ${minBuyers}`);
        }

        return hasEnough;
    }

    /**
     * Extract transaction info (positive = buy, negative = sell)
     */
    private extractTransactionInfo(
        tx: ParsedTransactionWithMeta,
        mintStr: string
    ): { wallet: string; amount: number } | null {
        try {
            const preBalances = tx.meta?.preTokenBalances || [];
            const postBalances = tx.meta?.postTokenBalances || [];

            for (const post of postBalances) {
                if (post.mint !== mintStr) continue;

                const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
                const preAmount = pre?.uiTokenAmount?.uiAmount || 0;
                const postAmount = post.uiTokenAmount?.uiAmount || 0;
                const change = postAmount - preAmount;

                if (Math.abs(change) < 0.000001) continue;

                const accountKeys = tx.transaction.message.accountKeys;
                const accountIndex = post.accountIndex;

                if (accountIndex === undefined || accountIndex >= accountKeys.length) continue;

                const accountKey = accountKeys[accountIndex];
                const wallet = typeof accountKey === 'string' ? accountKey : accountKey.pubkey.toBase58();

                return { wallet, amount: change };
            }

            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Filter out quick sellers (pump & dump detection)
     */
    private filterQuickSellers(
        buys: BuyerTransaction[],
        sells: BuyerTransaction[],
        windowSeconds: number
    ): BuyerTransaction[] {
        const realBuyers: BuyerTransaction[] = [];

        for (const buy of buys) {
            const quickSell = sells.find(sell =>
                sell.wallet === buy.wallet &&
                sell.timestamp > buy.timestamp &&
                (sell.timestamp - buy.timestamp) < windowSeconds
            );

            if (quickSell) {
                logger.warn(`🚨 Quick seller: ${buy.wallet.slice(0, 8)} (sold after ${quickSell.timestamp - buy.timestamp}s)`);
            } else {
                realBuyers.push(buy);
            }
        }

        return realBuyers;
    }

    /**
     * Sliding window algorithm to find max concurrent buyers
     */
    private applySlidingWindow(
        buyers: BuyerTransaction[],
        windowSeconds: number
    ): number {
        if (buyers.length === 0) return 0;

        buyers.sort((a, b) => a.timestamp - b.timestamp);

        let maxBuyers = 0;
        let windowStart = 0;

        for (let windowEnd = 0; windowEnd < buyers.length; windowEnd++) {
            while (windowStart < windowEnd &&
                buyers[windowEnd].timestamp - buyers[windowStart].timestamp > windowSeconds) {
                windowStart++;
            }

            const buyersInWindow = buyers.slice(windowStart, windowEnd + 1);
            const uniqueBuyers = new Set(buyersInWindow.map(b => b.wallet));

            maxBuyers = Math.max(maxBuyers, uniqueBuyers.size);
        }

        return maxBuyers;
    }

    clearCache(mint: PublicKey): void {
        this.buyerCache.delete(mint.toBase58());
    }

    clearAllCache(): void {
        this.buyerCache.clear();
    }
}
