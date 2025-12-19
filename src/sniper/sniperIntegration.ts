// src/sniper/sniperIntegration.ts

/**
 * Integration layer between sniper-bot.ts and Ultimate Sniper System
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { UltimateSniperSystem } from './ultimateSniperSystem';
import { WalletConfig } from './multiWalletManager';
import { SniperConfig, TokenOpportunity } from './types';
import { logger } from '../logger';

export class SniperIntegration {
    private ultimateSniper: UltimateSniperSystem | null = null;
    private enabled: boolean;

    constructor(
        connection: Connection,
        mainKeypair: Keypair,
        config?: {
            enabled?: boolean;
            walletConfigs?: WalletConfig[];
            sniperConfig?: Partial<SniperConfig>;
        }
    ) {
        this.enabled = config?.enabled ?? false;

        if (!this.enabled) {
            logger.info('Ultimate Sniper System: DISABLED');
            return;
        }

        // Default wallet config
        const walletConfigs: WalletConfig[] = config?.walletConfigs || [
            {
                privateKey: JSON.stringify(Array.from(mainKeypair.secretKey)),
                name: 'Main Wallet',
                maxBuyAmount: 0.01
            }
        ];

        // Default sniper config
        const sniperConfig: SniperConfig = {
            maxBuyAmount: config?.sniperConfig?.maxBuyAmount || 0.01,
            minLiquidity: config?.sniperConfig?.minLiquidity || 1,
            maxSlippage: config?.sniperConfig?.maxSlippage || 500,
            aiConfidenceThreshold: config?.sniperConfig?.aiConfidenceThreshold || 70,
            enableRugPullProtection: config?.sniperConfig?.enableRugPullProtection ?? true,
            jitoTipAmount: config?.sniperConfig?.jitoTipAmount || 0.001,
            mode: 'NORMAL',
            conservativeThresholds: {
                minConfidence: 85,
                minLiquidity: 20,
                maxRiskLevel: 'LOW'
            },
            normalThresholds: {
                minConfidence: 60,
                minLiquidity: 10,
                maxRiskLevel: 'MEDIUM',
                minActiveBuyers: 5,
                buyerWindowSeconds: 60
            },
            enableDuplicateBuy: false,
            duplicateBuyWalletCount: 1,
            duplicateBuyAmount: 0.01,
            exitStrategy: 'HYBRID',
            takeProfitPercent: 50,
            stopLossPercent: 20,
            trailingStopPercent: 15,
            trailingActivationPercent: 30,
            enableSmartFees: true,
            feeUrgency: 'HIGH',
            maxFeeMicroLamports: 100000,
            fallbackFeeMicroLamports: 50000
        };

        // Initialize Ultimate Sniper
        this.ultimateSniper = new UltimateSniperSystem(
            connection,
            walletConfigs,
            sniperConfig
        );

        logger.info('✅ Ultimate Sniper System: ENABLED');
    }

    /**
     * Handle new token detection
     */
    async handleNewToken(
        mint: string,
        poolKey: string,
        creatorAddress: string,
        liquidity: number
    ): Promise<boolean> {
        if (!this.enabled || !this.ultimateSniper) {
            return false; // Use legacy system
        }

        try {
            const opportunity: TokenOpportunity = {
                mint: new PublicKey(mint),
                poolKey: new PublicKey(poolKey),
                liquidity: liquidity * 1e9, // SOL to lamports
                creatorAddress: new PublicKey(creatorAddress),
                timestamp: Date.now()
            };

            // Execute complete cycle with Ultimate Sniper
            await this.ultimateSniper.executeCompleteCycle(opportunity);

            return true; // Handled by Ultimate Sniper

        } catch (error: any) {
            logger.error('Ultimate Sniper error:', error.message);
            return false; // Fallback to legacy
        }
    }

    /**
     * Stop monitoring a token
     */
    stopMonitoring(mint: string): void {
        if (this.ultimateSniper) {
            this.ultimateSniper.stopMonitoring(new PublicKey(mint));
        }
    }

    /**
     * Get system status
     */
    getStatus() {
        if (!this.ultimateSniper) {
            return { enabled: false };
        }

        return {
            enabled: true,
            ...this.ultimateSniper.getStatus()
        };
    }
}
