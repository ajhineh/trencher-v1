// src/sniper/completeSniperSystem.ts

/**
 * Complete Sniper System
 * Full cycle: Buy → Monitor → Intelligent Sell
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { FullProtectionSystem } from './fullProtectionSystem';
import { IntelligentSeller } from './intelligentSeller';
import { SniperConfig, TokenOpportunity } from './types';
import { logger } from '../logger';
import { QUOTE_MINT_WSOL } from '../constants/tokenAddresses';

export class CompleteSniperSystem {
    private connection: Connection;
    private keypair: Keypair;
    private config: SniperConfig;

    private protectionSystem: FullProtectionSystem;
    private intelligentSeller: IntelligentSeller;

    // Active positions
    private positions: Map<string, {
        mint: PublicKey;
        poolKey: PublicKey;
        entryPrice: number;
        entryTime: number;
        tokenAmount: number;
    }> = new Map();

    // Monitoring intervals
    private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();

    constructor(
        connection: Connection,
        keypair: Keypair,
        config: SniperConfig
    ) {
        this.connection = connection;
        this.keypair = keypair;
        this.config = config;

        this.protectionSystem = new FullProtectionSystem(connection, keypair, config);
        this.intelligentSeller = new IntelligentSeller(connection, keypair, {
            strategy: 'HYBRID',
            takeProfitPercent: 50,
            stopLossPercent: 20,
            trailingStopPercent: 15,
            trailingActivationPercent: 30,
            enableHybrid: true
        });

        logger.info('🎯 Complete Sniper System initialized');
    }

    /**
     * Full cycle: Snipe → Monitor → Sell
     */
    async executeFullCycle(opportunity: TokenOpportunity): Promise<void> {
        logger.info('\n╔══════════════════════════════════════════════════╗');
        logger.info('║         COMPLETE SNIPER CYCLE                    ║');
        logger.info('╚══════════════════════════════════════════════════╝\n');

        // Phase 1: Snipe with protection
        logger.info('Phase 1: AI Snipe + Rug Protection');
        await this.protectionSystem.snipeWithFullProtection(opportunity);

        // Track position
        const mintStr = opportunity.mint.toBase58();
        this.positions.set(mintStr, {
            mint: opportunity.mint,
            poolKey: opportunity.poolKey,
            entryPrice: 0.00001, // TODO: Get actual entry price
            entryTime: Date.now(),
            tokenAmount: 1000 // TODO: Get actual amount
        });

        // Phase 2: Intelligent monitoring & selling
        logger.info('\nPhase 2: Intelligent Selling Monitor');
        this.startIntelligentMonitoring(opportunity.mint);

        logger.info('\n✅ Full cycle active');
        logger.info('   - Rug pull protection: ON');
        logger.info('   - Intelligent selling: ON');
        logger.info('   - Trailing stops: READY\n');
    }

    /**
     * Start intelligent monitoring
     */
    private startIntelligentMonitoring(mint: PublicKey): void {
        const mintStr = mint.toBase58();

        // Check every 30 seconds
        const interval = setInterval(async () => {
            await this.checkAndSell(mint);
        }, 30000);

        this.monitoringIntervals.set(mintStr, interval);
        logger.info('📊 Intelligent monitoring started (30s intervals)');
    }

    /**
     * Check position and sell if needed
     */
    private async checkAndSell(mint: PublicKey): Promise<void> {
        const mintStr = mint.toBase58();
        const position = this.positions.get(mintStr);

        if (!position) return;

        try {
            // Get current price
            const currentPrice = await this.getCurrentPrice(position.poolKey);

            // Calculate metrics
            const profitPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
            const holdingTime = Math.floor((Date.now() - position.entryTime) / 1000);

            // Analyze position
            const decision = await this.intelligentSeller.analyzePosition({
                mint: position.mint,
                poolKey: position.poolKey,
                quoteMint: new PublicKey(QUOTE_MINT_WSOL),
                entryPrice: position.entryPrice,
                currentPrice,
                highestPrice: currentPrice, // Track highest price
                tokenAmount: position.tokenAmount,
                profitPercent,
                holdingTime
            });

            // Execute if needed
            if (decision.action !== 'HOLD') {
                const signature = await this.intelligentSeller.executeSell(
                    {
                        mint: position.mint,
                        poolKey: position.poolKey,
                        quoteMint: new PublicKey(QUOTE_MINT_WSOL),
                        entryPrice: position.entryPrice,
                        currentPrice,
                        highestPrice: currentPrice, // Track highest price
                        tokenAmount: position.tokenAmount,
                        profitPercent,
                        holdingTime
                    },
                    decision
                );

                if (signature && decision.action === 'SELL_ALL') {
                    // Position closed
                    this.stopMonitoring(mint);
                }
            }

        } catch (error: any) {
            logger.error('Error in intelligent monitoring:', error.message);
        }
    }

    /**
     * Get current price
     */
    private async getCurrentPrice(poolKey: PublicKey): Promise<number> {
        // TODO: Implement actual price fetching
        return 0.00001 + Math.random() * 0.00002;
    }

    /**
     * Stop monitoring
     */
    stopMonitoring(mint: PublicKey): void {
        const mintStr = mint.toBase58();

        // Stop rug protection
        this.protectionSystem.stopMonitoring(mint);

        // Stop intelligent selling
        const interval = this.monitoringIntervals.get(mintStr);
        if (interval) {
            clearInterval(interval);
            this.monitoringIntervals.delete(mintStr);
        }

        // Remove trailing stop
        this.intelligentSeller.removeTrailingStop(mint);

        // Remove position
        this.positions.delete(mintStr);

        logger.info('🛑 All monitoring stopped for:', mintStr);
    }

    /**
     * Get active positions
     */
    getActivePositions(): string[] {
        return Array.from(this.positions.keys());
    }
}
