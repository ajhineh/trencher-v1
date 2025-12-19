
import { Connection, PublicKey } from "@solana/web3.js";
import { MultiWalletManager } from "../sniper/multiWalletManager";
import { logger } from "../logger";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { fetchPoolWithConfig } from "../pumpswap/fetchOnchainPool";
import { canonicalPumpPoolPda } from "@pump-fun/pump-swap-sdk";
import BN from "bn.js";

export interface PortfolioAsset {
    mint: string;
    amount: number;
    valueSol: number;
    pctOfPortfolio: number;
    isSol: boolean;
}

export interface PortfolioRiskReport {
    totalValueSol: number;
    assetCount: number;
    assets: PortfolioAsset[];
    concentrationRisk: 'LOW' | 'MEDIUM' | 'HIGH';
    maxConcentrationPct: number;
    riskScore: number; // 0-100
}

export class PortfolioAnalyzer {
    private connection: Connection;
    private walletManager: MultiWalletManager;

    constructor(connection: Connection, walletManager: MultiWalletManager) {
        this.connection = connection;
        this.walletManager = walletManager;
    }

    /**
     * Analyze full portfolio across all wallets
     */
    async analyzePortfolio(): Promise<PortfolioRiskReport> {
        const wallets = this.walletManager.getAllWallets();
        const assetMap = new Map<string, { amount: number; valueSol: number; isSol: boolean }>();

        // 1. Scan all wallets
        for (const wallet of wallets) {
            try {
                // SOL Balance
                const solBalance = await this.connection.getBalance(wallet.publicKey);
                const currentSol = assetMap.get("SOL") || { amount: 0, valueSol: 0, isSol: true };
                currentSol.amount += solBalance / 1e9;
                currentSol.valueSol += solBalance / 1e9;
                assetMap.set("SOL", currentSol);

                // SPL Tokens
                const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                    wallet.publicKey,
                    { programId: TOKEN_PROGRAM_ID }
                );

                for (const ta of tokenAccounts.value) {
                    const info = ta.account.data.parsed.info;
                    const mint = info.mint;
                    const amount = info.tokenAmount.uiAmount;

                    if (amount > 0) {
                        const currentAsset = assetMap.get(mint) || { amount: 0, valueSol: 0, isSol: false };
                        currentAsset.amount += amount;
                        assetMap.set(mint, currentAsset);
                    }
                }
            } catch (error) {
                logger.error(`[Portfolio] Failed to scan wallet ${wallet.publicKey.toBase58()}: ${error}`);
            }
        }

        // 2. Calculate Value in SOL for tokens
        // For new tokens, fetch price via Pump.fun/RPC
        let totalValueSol = 0;
        const assets: PortfolioAsset[] = [];

        for (const [mint, data] of assetMap.entries()) {
            if (data.isSol) {
                totalValueSol += data.valueSol;
                continue;
            }

            // Fetch Price
            try {
                // Simplified: Try Pump.fun price first
                // In production, clearer routing for price source is needed
                const price = await this.fetchTokenPriceSol(mint);
                data.valueSol = data.amount * price;
                totalValueSol += data.valueSol;
            } catch (e) {
                // If price unknown, assume 0 for risk safety (or flag as unknown risk)
                data.valueSol = 0;
            }
        }

        // 3. Build Report
        for (const [mint, data] of assetMap.entries()) {
            assets.push({
                mint,
                amount: data.amount,
                valueSol: data.valueSol,
                pctOfPortfolio: totalValueSol > 0 ? (data.valueSol / totalValueSol) * 100 : 0,
                isSol: data.isSol
            });
        }

        // Sort by value
        assets.sort((a, b) => b.valueSol - a.valueSol);

        // 4. Calculate Risk Metrics
        const maxConcentration = assets.length > 0 ? assets[0].pctOfPortfolio : 0;
        let riskScore = 0;

        // Concentration penalty
        if (maxConcentration > 50) riskScore += 40;
        else if (maxConcentration > 25) riskScore += 20;

        // Asset count penalty (Diversification)
        const nonSolAssets = assets.filter(a => !a.isSol).length;
        if (nonSolAssets < 2) riskScore += 10; // Low diversification

        // Liquidity penalty (not calculated here strictly, but implied by nature of sniper tokens)
        riskScore += 20; // Base sniper risk

        return {
            totalValueSol,
            assetCount: assets.length,
            assets,
            concentrationRisk: maxConcentration > 50 ? 'HIGH' : maxConcentration > 25 ? 'MEDIUM' : 'LOW',
            maxConcentrationPct: maxConcentration,
            riskScore: Math.min(100, riskScore)
        };
    }

    /**
     * Fetch Token Price in SOL
     */
    private async fetchTokenPriceSol(mint: string): Promise<number> {
        // Try Pump.fun
        try {
            const poolKey = canonicalPumpPoolPda(new PublicKey(mint));
            const { pool } = await fetchPoolWithConfig(this.connection, poolKey);
            if (pool) {
                const vSol = new BN(pool.virtualSolReserves);
                const vToken = new BN(pool.virtualTokenReserves);
                return vSol.toNumber() / vToken.toNumber();
            }
        } catch (e) {
            // fast fail
        }
        return 0;
    }
}
