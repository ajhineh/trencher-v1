// examples/ultimateSniperExample.ts

/**
 * Ultimate Sniper System - Complete Example
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { UltimateSniperSystem } from '../src/sniper/ultimateSniperSystem';
import { WalletConfig } from '../src/sniper/multiWalletManager';
import { SniperConfig, TokenOpportunity } from '../src/sniper/types';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   ULTIMATE SNIPER SYSTEM                         ║');
    console.log('║   Complete Protection + Pre-Built Bundles        ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    const connection = new Connection(process.env.RPC_URL!, 'confirmed');

    // Wallet configurations
    const walletConfigs: WalletConfig[] = [
        {
            privateKey: process.env.TRADER_PRIVATE_KEY!,
            name: 'Main Wallet',
            maxBuyAmount: 0.01
        },
        {
            privateKey: process.env.WALLET_2_PRIVATE_KEY || process.env.TRADER_PRIVATE_KEY!,
            name: 'Wallet 2',
            maxBuyAmount: 0.01
        },
        {
            privateKey: process.env.WALLET_3_PRIVATE_KEY || process.env.TRADER_PRIVATE_KEY!,
            name: 'Wallet 3',
            maxBuyAmount: 0.01
        }
    ];

    // Sniper configuration
    const config: SniperConfig = {
        maxBuyAmount: 0.01,
        minLiquidity: 1,
        maxSlippage: 500,
        aiConfidenceThreshold: 70,
        enableRugPullProtection: true,
        jitoTipAmount: 0.01
    };

    // Create ultimate system
    const sniper = new UltimateSniperSystem(
        connection,
        walletConfigs,
        config
    );

    console.log('🎯 System Features:\n');
    console.log('AI Validation:');
    console.log('  • Quick analysis (<1s)');
    console.log('  • Confidence scoring');
    console.log('  • Risk-adjusted sizing\n');

    console.log('Multi-Wallet:');
    console.log('  • 3 wallets configured');
    console.log('  • Better Jito bundles');
    console.log('  • Distributed risk\n');

    console.log('Pre-Built Bundle:');
    console.log('  • Built immediately after buy');
    console.log('  • Auto-updates on sells');
    console.log('  • Instant execution ready\n');

    console.log('Ultra-Fast Detection:');
    console.log('  • WebSocket real-time');
    console.log('  • <500ms detection');
    console.log('  • Creator + 5 top holders\n');

    console.log('Intelligent Selling:');
    console.log('  • AI-optimized exits');
    console.log('  • Trailing stops (15%)');
    console.log('  • Auto bundle updates\n');

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

    console.log('Starting complete cycle...\n');
    console.log('═══════════════════════════════════════════════════\n');

    // Execute complete cycle
    await sniper.executeCompleteCycle(opportunity);

    console.log('\n═══════════════════════════════════════════════════');
    console.log('\n📊 Timeline Breakdown:\n');
    console.log('0ms:      AI validates token');
    console.log('100ms:    Multi-wallet buy executed');
    console.log('200ms:    Emergency bundle PRE-BUILT ✅');
    console.log('300ms:    WebSocket monitoring started ✅');
    console.log('400ms:    Intelligent selling monitor started ✅');
    console.log('\n--- System Ready ---\n');
    console.log('If rug detected:');
    console.log('  500ms:  WebSocket detection');
    console.log('  600ms:  Pre-built bundle sent');
    console.log('  800ms:  We\'re OUT! ✅');
    console.log('  2000ms: Creator tx lands (too late!)\n');
    console.log('═══════════════════════════════════════════════════\n');

    console.log('Press Ctrl+C to stop\n');

    // Handle exit
    process.on('SIGINT', () => {
        console.log('\n\n👋 Stopping system...');
        sniper.stopMonitoring(opportunity.mint);

        const status = sniper.getStatus();
        console.log(`\nFinal Status:`);
        console.log(`  Active positions: ${status.activePositions}`);
        console.log(`  Wallets ready: ${status.walletsReady}\n`);

        process.exit(0);
    });
}

main().catch(console.error);
