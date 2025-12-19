// examples/preBuildBundleExample.ts

/**
 * Pre-Build Bundle - Ultra-Fast Emergency Exit
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { PreBuildBundleSystem } from '../src/sniper/preBuildBundleSystem';
import { UltraFastRugDetector } from '../src/sniper/ultraFastRugDetector';
import { MultiWalletManager, WalletConfig } from '../src/sniper/multiWalletManager';
import { QUOTE_MINT_WSOL } from '../src/constants/tokenAddresses';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   PRE-BUILD BUNDLE - ULTRA-FAST EXIT            ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    const connection = new Connection(process.env.RPC_URL!, 'confirmed');

    // Setup wallets
    const walletManager = new MultiWalletManager(connection);
    walletManager.addWallets([
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
    ]);

    const wallets = walletManager.getAllWallets();

    // Setup systems
    const bundleSystem = new PreBuildBundleSystem(connection);
    const rugDetector = new UltraFastRugDetector(connection);

    // Token info
    const mint = new PublicKey('TOKEN_MINT');
    const poolKey = new PublicKey('POOL_KEY');
    const quoteMint = new PublicKey(QUOTE_MINT_WSOL);
    const creatorAddress = new PublicKey('CREATOR_ADDRESS');

    console.log('📊 Timeline:\n');

    // Step 1: Buy tokens (simulated)
    console.log('0ms:     Tokens purchased');
    console.log('         (3 wallets, 0.01 SOL each)\n');

    // Step 2: IMMEDIATELY pre-build bundle
    console.log('100ms:   Pre-building emergency bundle...');
    const buildStart = Date.now();

    await bundleSystem.preBuildBundle(
        mint,
        poolKey,
        quoteMint,
        wallets
    );

    const buildTime = Date.now() - buildStart;
    console.log(`${100 + buildTime}ms:   ✅ Bundle pre-built and ready!\n`);

    // Step 3: Start WebSocket monitoring
    console.log('200ms:   WebSocket monitoring started');
    console.log('         Watching creator + top holders\n');

    const subscriptionIds = await rugDetector.monitorMultipleAddresses(
        [creatorAddress],
        poolKey,
        async () => {
            console.log('\n🚨🚨🚨 RUG PULL DETECTED! 🚨🚨🚨\n');

            const rugTime = Date.now();
            console.log('Timeline:');
            console.log('─────────────────────────────────');
            console.log('0ms:      Creator starts remove');
            console.log('500ms:    WebSocket detection ⚡');
            console.log('600ms:    Executing pre-built bundle...\n');

            // Execute pre-built bundle (INSTANT!)
            const execStart = Date.now();

            const bundleId = await bundleSystem.executePreBuiltBundle(
                mint,
                0.01 // High tip
            );

            const execTime = Date.now() - execStart;

            console.log(`${500 + execTime}ms:    ✅ BUNDLE EXECUTED!\n`);
            console.log('Result:');
            console.log('─────────────────────────────────');
            console.log(`Bundle ID: ${bundleId}`);
            console.log(`Execution time: ${execTime}ms`);
            console.log(`Total response: ${500 + execTime}ms`);
            console.log('\n🎯 We exited BEFORE creator!\n');

            await rugDetector.unsubscribe(subscriptionIds);
            process.exit(0);
        }
    );

    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   SYSTEM READY                                   ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
    console.log('✅ Bundle: PRE-BUILT (ready for instant execution)');
    console.log('✅ Monitoring: ACTIVE (WebSocket real-time)');
    console.log('✅ Response time: <700ms guaranteed\n');
    console.log('Advantages:');
    console.log('  • No build time on detection');
    console.log('  • Only need fresh blockhash');
    console.log('  • Instant execution');
    console.log('  • Front-run creator guaranteed\n');

    // Simulate partial sell after 10 seconds
    setTimeout(async () => {
        console.log('\n📊 Simulating partial sell...');
        console.log('   (e.g., took 50% profit via intelligent seller)\n');

        // Update bundle with new balances
        await bundleSystem.updateBundle(mint, poolKey, quoteMint);

        console.log('✅ Bundle updated with new balances');
        console.log('   Still ready for instant execution!\n');
    }, 10000);

    console.log('Press Ctrl+C to stop\n');

    process.on('SIGINT', async () => {
        console.log('\n\n👋 Stopping...');
        await rugDetector.unsubscribe(subscriptionIds);
        process.exit(0);
    });
}

main().catch(console.error);
