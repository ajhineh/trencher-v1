// examples/integratedSniperExample.ts

/**
 * Integrated Sniper System - Usage Example
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { IntegratedSniperSystem } from '../src/sniper/integratedSniperSystem';
import { SniperConfig, TokenOpportunity } from '../src/sniper/types';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('🤖 Integrated Sniper System Example\n');
    console.log('Features:');
    console.log('  ✅ AI-powered token validation');
    console.log('  ✅ Fast buy execution');
    console.log('  ✅ Rug pull monitoring');
    console.log('  ✅ Creator wallet watch');
    console.log('  ✅ Top holders watch');
    console.log('  ✅ Buyer count tracking\n');

    // Setup
    const connection = new Connection(process.env.RPC_URL!, 'confirmed');
    const keypair = Keypair.fromSecretKey(
        Buffer.from(JSON.parse(process.env.TRADER_PRIVATE_KEY!))
    );

    // Configuration
    const config: SniperConfig = {
        maxBuyAmount: 0.01,
        minLiquidity: 1,
        maxSlippage: 500,
        aiConfidenceThreshold: 70,
        enableRugPullProtection: true,
        jitoTipAmount: 0.001
    };

    // Create integrated system
    const sniper = new IntegratedSniperSystem(connection, keypair, config);

    // Example token opportunity
    const opportunity: TokenOpportunity = {
        mint: new PublicKey('YOUR_TOKEN_MINT'),
        poolKey: new PublicKey('YOUR_POOL_KEY'),
        liquidity: 5 * 1e9,
        creatorAddress: new PublicKey('CREATOR_ADDRESS'),
        timestamp: Date.now()
    };

    console.log('Starting protected snipe...\n');

    // Snipe with full protection
    await sniper.snipeWithProtection(opportunity);

    console.log('\n✅ System is now monitoring for rug pulls...');
    console.log('Press Ctrl+C to stop\n');

    // Keep running
    process.on('SIGINT', () => {
        console.log('\n\n👋 Stopping monitoring...');
        sniper.stopMonitoring(opportunity.mint);
        process.exit(0);
    });
}

main().catch(console.error);
