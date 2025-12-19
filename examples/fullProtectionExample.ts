// examples/fullProtectionExample.ts

/**
 * Full Protection System - Complete Example
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { FullProtectionSystem } from '../src/sniper/fullProtectionSystem';
import { SniperConfig, TokenOpportunity } from '../src/sniper/types';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('🛡️ Full Protection Sniper System\n');
    console.log('Features:');
    console.log('  ✅ AI-powered validation');
    console.log('  ✅ Fast buy execution');
    console.log('  ✅ Real-time rug pull monitoring');
    console.log('  ✅ Jito emergency exit');
    console.log('  ✅ MEV protection\n');

    // Setup
    const connection = new Connection(process.env.RPC_URL!, 'confirmed');
    const keypair = Keypair.fromSecretKey(
        Buffer.from(JSON.parse(process.env.TRADER_PRIVATE_KEY!))
    );

    // Configuration
    const config: SniperConfig = {
        maxBuyAmount: 0.01,              // 0.01 SOL max
        minLiquidity: 1,                 // 1 SOL minimum
        maxSlippage: 500,                // 5% slippage
        aiConfidenceThreshold: 70,       // 70% AI confidence
        enableRugPullProtection: true,   // Enable protection
        jitoTipAmount: 0.001            // 0.001 SOL Jito tip
    };

    // Create system
    const system = new FullProtectionSystem(connection, keypair, config);

    // Example token
    const opportunity: TokenOpportunity = {
        mint: new PublicKey('YOUR_TOKEN_MINT'),
        poolKey: new PublicKey('YOUR_POOL_KEY'),
        liquidity: 5 * 1e9,
        creatorAddress: new PublicKey('CREATOR_ADDRESS'),
        timestamp: Date.now(),
        metadata: {
            name: 'Example Token',
            symbol: 'EXAMPLE',
            decimals: 9
        }
    };

    console.log('Starting full protection snipe...\n');

    // Snipe with full protection
    await system.snipeWithFullProtection(opportunity);

    console.log('\n✅ System active - monitoring for rug pulls');
    console.log('Press Ctrl+C to stop\n');

    // Handle exit
    process.on('SIGINT', () => {
        console.log('\n\n👋 Stopping system...');
        system.stopMonitoring(opportunity.mint);
        process.exit(0);
    });
}

main().catch(console.error);
