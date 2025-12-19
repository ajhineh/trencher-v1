// src/sniper/fullProtectionSystem.ts

/**
 * Full Protection System
 * AI Sniper + Rug Detection + Jito Emergency Exit
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AISniperBot } from './aiSniperBot';
import { RugPullDetector } from './rugPullDetector';
import { JitoEmergencySell } from './jitoEmergencySell';
import { SniperConfig, TokenOpportunity } from './types';
import { logger } from '../logger';
import { QUOTE_MINT_WSOL } from '../constants/tokenAddresses';

export class FullProtectionSystem {
    private connection: Connection;
    private keypair: Keypair;
    private config: SniperConfig;

    private aiSniper: AISniperBot;
    private rugDetector: RugPullDetector;
    private jitoSell: JitoEmergencySell;

    constructor(
        connection: Connection,
        keypair: Keypair,
        config: SniperConfig
    ) {
        this.connection = connection;
        this.keypair = keypair;
        this.config = config;

        // Initialize all components
        this.aiSniper = new AISniperBot(connection, keypair, config);
        this.rugDetector = new RugPullDetector(connection);
        this.jitoSell = new JitoEmergencySell(connection, keypair);

        // Setup emergency exit handler
        this.setupEmergencyHandler();

        logger.info('🛡️ Full Protection System initialized');
    }

    /**
     * Snipe with full protection
     */
    async snipeWithFullProtection(opportunity: TokenOpportunity): Promise<void> {
        logger.info('═══════════════════════════════════════════════════');
        logger.info('🎯 FULL PROTECTION SNIPE');
        logger.info('═══════════════════════════════════════════════════\n');

        // Step 1: AI Validation & Buy
        logger.info('Step 1: AI Validation & Fast Buy');
        const result = await this.aiSniper.snipeToken(opportunity);

        if (!result.success) {
            logger.info('❌ Snipe rejected or failed\n');
            return;
        }

        logger.info('✅ Token acquired!\n');

        // Step 2: Start Rug Pull Monitoring
        if (this.config.enableRugPullProtection) {
            logger.info('Step 2: Starting Rug Pull Monitoring');

            await this.rugDetector.startMonitoring(
                opportunity.mint,
                opportunity.creatorAddress,
                opportunity.poolKey,
                result.aiDecision.suggestedAmount,
                1000 // Placeholder
            );

            logger.info('✅ Monitoring active\n');
        }

        logger.info('═══════════════════════════════════════════════════');
        logger.info('🛡️ FULL PROTECTION ACTIVE');
        logger.info('═══════════════════════════════════════════════════');
        logger.info('Monitoring:');
        logger.info('  ✓ Creator wallet');
        logger.info('  ✓ Top 10 holders');
        logger.info('  ✓ Buyer count');
        logger.info('  ✓ Liquidity levels');
        logger.info('\nEmergency Exit: Ready (Jito)');
        logger.info('═══════════════════════════════════════════════════\n');
    }

    /**
     * Setup emergency exit handler
     */
    private setupEmergencyHandler(): void {
        this.rugDetector.on('rugPullDetected', async (data: any) => {
            logger.error('\n🚨🚨🚨 RUG PULL DETECTED! 🚨🚨🚨');
            logger.error('═══════════════════════════════════════════════════');
            logger.error(`Token: ${data.mint.toBase58()}`);
            logger.error(`Signal: ${data.signal.type}`);
            logger.error(`Severity: ${data.signal.severity}`);
            logger.error(`Details: ${data.signal.details}`);
            logger.error('═══════════════════════════════════════════════════\n');

            // Execute emergency exit via Jito
            logger.error('⚡ EXECUTING EMERGENCY EXIT VIA JITO...\n');

            const signature = await this.jitoSell.emergencySell(
                data.mint,
                data.poolKey,
                new PublicKey(QUOTE_MINT_WSOL),
                this.config.jitoTipAmount
            );

            if (signature) {
                logger.info('✅ EMERGENCY EXIT SUCCESSFUL!');
                logger.info(`TX: ${signature}\n`);
            } else {
                logger.error('❌ EMERGENCY EXIT FAILED!');
                logger.error('⚠️  MANUAL INTERVENTION REQUIRED!\n');
            }

            // Stop monitoring
            this.rugDetector.stopMonitoring(data.mint);
        });
    }

    /**
     * Stop monitoring a token
     */
    stopMonitoring(mint: PublicKey): void {
        this.rugDetector.stopMonitoring(mint);
    }
}
