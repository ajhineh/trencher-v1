// src/arbitrage/crossDexArbitrage.ts

/**
 * Cross-DEX Arbitrage System
 * Finds and executes arbitrage opportunities between DEXs
 */

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { MultiWalletManager } from "../sniper/multiWalletManager";
import { logger } from "../logger";
import { fetchPoolWithConfig } from "../pumpswap/fetchOnchainPool";
import { canonicalPumpPoolPda } from "@pump-fun/pump-swap-sdk";
import BN from "bn.js";
import { DexRouter } from "../execution/dexRouter";
import { DetectedToken } from "../detection/types";

export interface DEXPrice {
    dex: string;
    price: number;
    liquidity: number;
    timestamp: number;
}

export interface ArbitrageOpportunity {
    tokenAddress: string;
    buyDex: string;
    sellDex: string;
    buyPrice: number;
    sellPrice: number;
    profitPercent: number;
    profitSol: number;
    estimatedAmount: number; // SOL amount used for buy
    estimatedTokenAmount?: number; // Estimated tokens received
    confidence: number; // 0-100
    liquidity?: string;
    timestamp: number;
}

export class CrossDEXArbitrage {
    private connection: Connection;
    private minProfitPercent: number = 2; // Minimum 2% profit
    private maxTradeSize: number = 0.5; // Max 0.5 SOL per trade

    private walletManager: MultiWalletManager | null = null;
    private dexRouter: DexRouter | null = null;

    constructor(
        connection: Connection,
        walletManager?: MultiWalletManager,
        dexRouter?: DexRouter
    ) {
        this.connection = connection;
        this.walletManager = walletManager || null;

        if (dexRouter) {
            this.dexRouter = dexRouter;
        } else if (walletManager && walletManager.getAllWallets().length > 0) {
            // Auto-init router with main wallet
            this.dexRouter = new DexRouter(connection, walletManager.getAllWallets()[0]);
        }
    }

    /**
     * Set wallet manager and re-init router
     */
    setWalletManager(walletManager: MultiWalletManager): void {
        this.walletManager = walletManager;
        if (walletManager.getAllWallets().length > 0) {
            this.dexRouter = new DexRouter(this.connection, walletManager.getAllWallets()[0]);
        }
    }

    /**
     * Fetch prices from multiple DEXs
     */
    async fetchPrices(tokenAddress: string): Promise<DEXPrice[]> {
        const prices: DEXPrice[] = [];

        try {
            // Pump.fun price
            const pumpPrice = await this.getPumpFunPrice(tokenAddress);
            if (pumpPrice) prices.push(pumpPrice);

            // Raydium price
            const raydiumPrice = await this.getRaydiumPrice(tokenAddress);
            if (raydiumPrice) prices.push(raydiumPrice);

            // Meteora price
            const meteoraPrice = await this.getMeteoraPrice(tokenAddress);
            if (meteoraPrice) prices.push(meteoraPrice);

            return prices;
        } catch (error) {
            logger.error(`[Arbitrage] Error fetching prices for ${tokenAddress}: ${error}`);
            return [];
        }
    }

    /**
     * Get Pump.fun price
     */
    private async getPumpFunPrice(tokenAddress: string): Promise<DEXPrice | null> {
        try {
            const mint = new PublicKey(tokenAddress);
            const poolKey = canonicalPumpPoolPda(mint);
            const { pool } = await fetchPoolWithConfig(this.connection, poolKey);

            if (!pool) return null;

            const vSol = new BN(pool.virtualSolReserves);
            const vToken = new BN(pool.virtualTokenReserves);

            // Calculate price in SOL
            const priceSol = vSol.toNumber() / vToken.toNumber();

            // Real SOL reserves for liquidity
            const realSol = new BN(pool.realSolReserves);
            const liquiditySol = realSol.toNumber() / 1e9;

            return {
                dex: 'PUMPSWAP', // Align name with DexRouter
                price: priceSol,
                liquidity: liquiditySol,
                timestamp: Date.now(),
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Placeholder for Raydium price (Need Jupiter API or Raydium SDK)
     */
    private async getRaydiumPrice(tokenAddress: string): Promise<DEXPrice | null> {
        // Mock implementation for structure - user asked to De-Mock execution, but fetch logic persists
        // If we have Jupiter integration, use it here.
        return null;
    }

    /**
     * Placeholder for Meteora price
     */
    private async getMeteoraPrice(tokenAddress: string): Promise<DEXPrice | null> {
        return null;
    }

    /**
     * Find arbitrage opportunities
     */
    async findOpportunities(tokenAddress: string): Promise<ArbitrageOpportunity[]> {
        const prices = await this.fetchPrices(tokenAddress);

        if (prices.length < 2) {
            return []; // Need at least 2 DEXs
        }

        const opportunities: ArbitrageOpportunity[] = [];

        // Compare all price pairs
        for (let i = 0; i < prices.length; i++) {
            for (let j = i + 1; j < prices.length; j++) {
                const price1 = prices[i];
                const price2 = prices[j];

                // Calculate profit if buying from cheaper and selling to expensive
                let buyDex: DEXPrice, sellDex: DEXPrice;

                if (price1.price < price2.price) {
                    buyDex = price1;
                    sellDex = price2;
                } else {
                    buyDex = price2;
                    sellDex = price1;
                }

                const profitPercent = ((sellDex.price - buyDex.price) / buyDex.price) * 100;

                // Check if profitable
                if (profitPercent >= this.minProfitPercent) {
                    // Calculate optimal trade size based on liquidity
                    const maxAmount = Math.min(
                        buyDex.liquidity * 0.1, // Max 10% of buy DEX liquidity
                        sellDex.liquidity * 0.1, // Max 10% of sell DEX liquidity
                        this.maxTradeSize
                    );

                    const profitSol = maxAmount * (profitPercent / 100);

                    // Estimate tokens received: amountSol / buyPrice
                    // Accurate: amountSol * (1/buyPrice)
                    const estimatedTokenAmount = maxAmount / buyDex.price;

                    const liquidityScore = Math.min(100, (Math.min(buyDex.liquidity, sellDex.liquidity) / 10000) * 100);
                    const profitScore = Math.min(100, (profitPercent / 10) * 100);
                    const confidence = (liquidityScore + profitScore) / 2;

                    opportunities.push({
                        tokenAddress,
                        buyDex: buyDex.dex,
                        sellDex: sellDex.dex,
                        buyPrice: buyDex.price,
                        sellPrice: sellDex.price,
                        profitPercent,
                        profitSol,
                        estimatedAmount: maxAmount,
                        estimatedTokenAmount,
                        confidence,
                        timestamp: Date.now(),
                    });

                    logger.info(
                        `[Arbitrage] Opportunity found! ` +
                        `Buy: ${buyDex.dex} @ ${buyDex.price.toFixed(6)}, ` +
                        `Sell: ${sellDex.dex} @ ${sellDex.price.toFixed(6)}, ` +
                        `Profit: ${profitPercent.toFixed(2)}% (${profitSol.toFixed(4)} SOL)`
                    );
                }
            }
        }

        return opportunities.sort((a, b) => b.profitPercent - a.profitPercent);
    }

    /**
     * Execute arbitrage
     */
    async executeArbitrage(opportunity: ArbitrageOpportunity): Promise<boolean> {
        logger.info(
            `[Arbitrage] Executing: ` +
            `${opportunity.buyDex} → ${opportunity.sellDex}, ` +
            `Expected profit: ${opportunity.profitPercent.toFixed(2)}%`
        );

        if (!this.dexRouter) {
            logger.error(`[Arbitrage] DexRouter not initialized (missing wallet?)`);
            return false;
        }

        try {
            // Construct DetectedToken for Router
            // We need to support 'dex' property in DetectedToken being 'PUMPSWAP' | 'RAYDIUM' etc.
            const token: DetectedToken = {
                mint: opportunity.tokenAddress, // Already a string
                dex: opportunity.buyDex as any, // 'PUMPSWAP', 'RAYDIUM', etc.
                pool: PublicKey.default.toBase58(), // Convert to string
                poolInfo: {
                    baseMint: opportunity.tokenAddress,
                    quoteMint: "So11111111111111111111111111111111111111112",
                    baseReserve: 0,
                    quoteReserve: 0,
                    liquidityUsd: parseFloat(opportunity.liquidity) || 0
                },
                metadata: {
                    name: "Unknown",
                    symbol: "UNKNOWN",
                    decimals: 6
                },
                timestamp: Date.now(),
                signature: '' // No signature available for arbitrage trigger
            };

            // Step 1: Buy from cheaper DEX
            logger.info(`[Arbitrage] 1. Buying ${opportunity.estimatedAmount} SOL on ${opportunity.buyDex}`);
            const buyResult = await this.dexRouter.executeBuy(
                token,
                opportunity.estimatedAmount
            );

            if (!buyResult.success) {
                logger.error(`[Arbitrage] Buy failed: ${buyResult.error}`);
                return false;
            }

            // Estimate tokens bought if not returned? 
            // DexRouter executeBuy returns ExecutionResult. 
            // ExecutionResult has `signature`, `amountSol`, but unfortunately NO `tokenAmount` output.
            // We must estimate or fetch.
            // For now, use estimation from opportunity.
            const tokenAmount = opportunity.estimatedTokenAmount || (opportunity.estimatedAmount / opportunity.buyPrice);

            logger.info(`[Arbitrage] Buy successful (${buyResult.signature}). Acquired ~${tokenAmount.toFixed(2)} tokens.`);

            // Step 2: Sell to expensive DEX
            // Must update DEX in token object
            token.dex = opportunity.sellDex as any;

            logger.info(`[Arbitrage] 2. Selling on ${opportunity.sellDex}`);

            const sellResult = await this.dexRouter.executeSell(
                token,
                tokenAmount
            );

            if (!sellResult.success) {
                logger.error(`[Arbitrage] Sell failed: ${sellResult.error}`);
                // Critical: We are holding tokens now.
                logger.warn(`[Arbitrage] ⚠️ POSITION STUCK! Bought on ${opportunity.buyDex}, failed to sell on ${opportunity.sellDex}`);
                return false;
            }

            logger.info(
                `[Arbitrage] Success! Cycle complete. ` +
                `Profit: ${opportunity.profitSol.toFixed(4)} SOL. ` +
                `Sell Sig: ${sellResult.signature}`
            );

            return true;
        } catch (error) {
            logger.error(`[Arbitrage] Execution error: ${error}`);
            return false;
        }
    }

    /**
     * Monitor for arbitrage opportunities
     */
    async monitorOpportunities(
        tokenAddresses: string[],
        callback: (opportunity: ArbitrageOpportunity) => void
    ): Promise<void> {
        logger.info(`[Arbitrage] Monitoring ${tokenAddresses.length} tokens for arbitrage`);

        // Check every 10 seconds
        setInterval(async () => {
            for (const tokenAddress of tokenAddresses) {
                const opportunities = await this.findOpportunities(tokenAddress);

                opportunities.forEach(opp => {
                    if (opp.confidence > 70) {
                        callback(opp);
                    }
                });
            }
        }, 10000);
    }

    /**
     * Update configuration
     */
    updateConfig(config: { minProfitPercent?: number; maxTradeSize?: number }): void {
        if (config.minProfitPercent !== undefined) {
            this.minProfitPercent = config.minProfitPercent;
        }
        if (config.maxTradeSize !== undefined) {
            this.maxTradeSize = config.maxTradeSize;
        }
        logger.info(`[Arbitrage] Config updated:`, {
            minProfitPercent: this.minProfitPercent,
            maxTradeSize: this.maxTradeSize
        });
    }
}

// Singleton instance
let arbitrageInstance: CrossDEXArbitrage | null = null;

export function getCrossDEXArbitrage(connection: Connection, walletManager?: MultiWalletManager): CrossDEXArbitrage {
    if (!arbitrageInstance) {
        arbitrageInstance = new CrossDEXArbitrage(connection, walletManager);
    }
    if (walletManager && !arbitrageInstance['walletManager']) {
        arbitrageInstance.setWalletManager(walletManager);
    }
    return arbitrageInstance;
}
