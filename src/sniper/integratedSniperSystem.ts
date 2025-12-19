// src/sniper/integratedSniperSystem.ts

/**
 * Integrated Sniper System
 * Combines AI Sniper + Rug Pull Detection
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AISniperBot } from './aiSniperBot';
import { RugPullDetector } from './rugPullDetector';
import { SniperConfig, TokenOpportunity } from './types';
import { logger } from '../logger';

export class IntegratedSniperSystem {
    private connection: Connection;
    private keypair: Keypair;
    private config: SniperConfig;
    private aiSniper: AISniperBot;
    private rugDetector: RugPullDetector;

    constructor(
        connection: Connection,
        keypair: Keypair,
        config: SniperConfig
    ) {
        this.connection = connection;
        this.keypair = keypair;
        this.config = config;

        // Initialize components
        this.aiSniper = new AISniperBot(connection, keypair, config);
        this.rugDetector = new RugPullDetector(connection);

        // Setup rug pull event handler
        this.setupRugPullHandler();
    }

    /**
     * Snipe token with full protection
     */
    async snipeWithProtection(opportunity: TokenOpportunity): Promise<void> {
        logger.info('🎯 Starting protected snipe...');

        // 1. AI Snipe
        const result = await this.aiSniper.snipeToken(opportunity);

        if (!result.success) {
            logger.info('Snipe failed or rejected by AI');
            return;
        }

        logger.info('✅ Snipe successful!');

        // 2. Start rug pull monitoring if enabled
        if (this.config.enableRugPullProtection) {
            logger.info('🛡️ Starting rug pull protection...');

            await this.rugDetector.startMonitoring(
                opportunity.mint,
                opportunity.creatorAddress,
                opportunity.poolKey,
                result.aiDecision.suggestedAmount, // Purchase price
                1000 // Token amount (placeholder - should get from tx)
            );
        }
    }

    /**
     * Setup rug pull event handler
     */
    private setupRugPullHandler(): void {
        this.rugDetector.on('rugPullDetected', async (data: any) => {
            logger.error('🚨🚨🚨 RUG PULL DETECTED! 🚨🚨🚨');
            logger.error(`Token: ${data.mint.toBase58()}`);
            logger.error(`Signal: ${data.signal.type}`);
            logger.error(`Severity: ${data.signal.severity}`);

            // Emergency action will be handled in Week 3 (Jito)
            logger.warn('⚠️ Emergency exit not yet implemented (Week 3)');
            logger.warn('⚠️ Manual intervention required!');

            // Stop monitoring this token
            this.rugDetector.stopMonitoring(data.mint);
        });
    }

    /**
     * Stop monitoring a token
     */
    stopMonitoring(mint: PublicKey): void {
        this.rugDetector.stopMonitoring(mint);
    }

    /**
     * Get monitoring status
     */
    getMonitoringStatus(): string[] {
        // Return list of monitored tokens
        return []; // Placeholder
    }
}
