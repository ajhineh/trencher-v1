// examples/jitoBundleExample.ts

/**
 * Jito Bundle - Multi-Wallet Emergency Exit Example
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { JitoBundleSystem } from '../src/sniper/jitoBundle';
import { MultiWalletManager, WalletConfig } from '../src/sniper/multiWalletManager';
import { UltraFastRugDetector } from '../src/sniper/ultraFastRugDetector';
import { QUOTE_MINT_WSOL } from '../src/constants/tokenAddresses';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   JITO BUNDLE - MULTI-WALLET EMERGENCY EXIT     ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    const connection = new Connection(process.env.RPC_URL!, 'confirmed');

    // Setup multi-wallet manager
    const walletManager = new MultiWalletManager(connection);

    // Add wallets
    const walletConfigs: WalletConfig[] = [
        {
            privateKey: process.env.TRADER_PRIVATE_KEY!,
            name: 'Wallet 1',
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

    walletManager.addWallets(walletConfigs);

    console.log('\n📊 Checking wallet balances...\n');
    await walletManager.checkBalances();

    // Setup systems
    const bundleSystem = new JitoBundleSystem(connection);
    const rugDetector = new UltraFastRugDetector(connection);

    // Example: Monitor for rug pull
    const creatorAddress = new PublicKey('CREATOR_ADDRESS_HERE');
    const poolKey = new PublicKey('POOL_KEY_HERE');
    const mint = new PublicKey('TOKEN_MINT_HERE');

    console.log('\n🔍 Starting ultra-fast rug detection...');
    console.log('   Method: WebSocket (real-time)');
    console.log('   Detection time: <500ms');
    console.log('   Response time: <1s\n');

    // Monitor creator + top holders
    const topHolders = [
        new PublicKey('HOLDER_1'),
        new PublicKey('HOLDER_2')
    ];

    const allAddresses = [creatorAddress, ...topHolders];

    const subscriptionIds = await rugDetector.monitorMultipleAddresses(
        allAddresses,
        poolKey,
        async () => {
            console.log('\n🚨🚨🚨 RUG PULL DETECTED! 🚨🚨🚨\n');
            console.log('⚡ EXECUTING JITO BUNDLE EMERGENCY EXIT...\n');

            // Get all wallets with positions
            const wallets = walletManager.getAllWallets();

            const positions = wallets.map(keypair => ({
                keypair,
                mint,
                poolKey,
                quoteMint: new PublicKey(QUOTE_MINT_WSOL),
                balance: 1000000 // TODO: Get actual balance
            }));

            // Execute bundle
            const bundleId = await bundleSystem.emergencyBundleSell(
                positions,
                0.01 // 0.01 SOL tip for HIGH PRIORITY
            );

            if (bundleId) {
                console.log('✅ BUNDLE EXECUTED!');
                console.log(`   Bundle ID: ${bundleId}`);
                console.log(`   Wallets: ${positions.length}`);
                console.log(`   Execution: ATOMIC (all or nothing)\n`);
            } else {
                console.log('❌ BUNDLE FAILED - Check logs\n');
            }

            // Cleanup
            await rugDetector.unsubscribe(subscriptionIds);
            process.exit(0);
        }
    );

    console.log('✅ Ultra-fast monitoring active');
    console.log('   Monitoring:', allAddresses.length, 'addresses');
    console.log('   Detection: Real-time via WebSocket');
    console.log('   Bundle ready: 3 wallets\n');
    console.log('Press Ctrl+C to stop\n');

    // Keep alive
    process.on('SIGINT', async () => {
        console.log('\n\n👋 Stopping...');
        await rugDetector.unsubscribe(subscriptionIds);
        process.exit(0);
    });
}

main().catch(console.error);
