// examples/completeSniperExample.ts

/**
 * Complete Sniper System - Full Example
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { CompleteSniperSystem } from '../src/sniper/completeSniperSystem';
import { SniperConfig, TokenOpportunity } from '../src/sniper/types';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║     COMPLETE AI SNIPER SYSTEM                    ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    console.log('🎯 Full Features:');
    console.log('  ✅ AI-powered validation (<1s)');
    console.log('  ✅ Fast buy execution');
    console.log('  ✅ Rug pull monitoring (5s)');
    console.log('  ✅ Jito emergency exit (<1s)');
    console.log('  ✅ Intelligent selling (30s)');
    console.log('  ✅ Trailing stops (15%)');
    console.log('  ✅ AI-optimized exits\n');

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

    // Create complete system
    const sniper = new CompleteSniperSystem(connection, keypair, config);

    // Example opportunity
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

    console.log('Starting complete sniper cycle...\n');

    // Execute full cycle
    await sniper.executeFullCycle(opportunity);

    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║     SYSTEM ACTIVE                                ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('\n📊 Monitoring:');
    console.log('  - Rug pull detection: Every 5s');
    console.log('  - Intelligent selling: Every 30s');
    console.log('  - Trailing stops: Active\n');
    console.log('Press Ctrl+C to stop\n');

    // Handle exit
    process.on('SIGINT', () => {
        console.log('\n\n👋 Stopping system...');
        sniper.stopMonitoring(opportunity.mint);
        process.exit(0);
    });
}

main().catch(console.error);
