// examples/aiSniperExample.ts

/**
 * AI Sniper Bot - Usage Example
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AISniperBot } from '../src/sniper/aiSniperBot';
import { SniperConfig, TokenOpportunity } from '../src/sniper/types';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('🤖 AI Sniper Bot Example\n');

    // Setup
    const connection = new Connection(process.env.RPC_URL!, 'confirmed');
    const keypair = Keypair.fromSecretKey(
        Buffer.from(JSON.parse(process.env.TRADER_PRIVATE_KEY!))
    );

    // Configuration
    const config: SniperConfig = {
        maxBuyAmount: 0.01,              // 0.01 SOL max
        minLiquidity: 1,                 // 1 SOL minimum liquidity
        maxSlippage: 500,                // 5% slippage
        aiConfidenceThreshold: 70,       // 70% confidence minimum
        enableRugPullProtection: true,
        jitoTipAmount: 0.001            // 0.001 SOL for Jito tips
    };

    // Create sniper bot
    const sniper = new AISniperBot(connection, keypair, config);

    // Example: Snipe a token
    const opportunity: TokenOpportunity = {
        mint: new PublicKey('YOUR_TOKEN_MINT_HERE'),
        poolKey: new PublicKey('YOUR_POOL_KEY_HERE'),
        liquidity: 5 * 1e9, // 5 SOL in lamports
        creatorAddress: new PublicKey('CREATOR_ADDRESS_HERE'),
        timestamp: Date.now(),
        metadata: {
            name: 'Example Token',
            symbol: 'EXAMPLE',
            decimals: 9
        }
    };

    console.log('Attempting to snipe token...\n');

    const result = await sniper.snipeToken(opportunity);

    if (result.success) {
        console.log('\n✅ SNIPE SUCCESSFUL!');
        console.log(`TX: ${result.txSignature}`);
        console.log(`AI Confidence: ${result.aiDecision.confidence}%`);
        console.log(`Amount: ${result.aiDecision.suggestedAmount} SOL`);
        console.log('\nReasons:');
        result.aiDecision.reasons.forEach(r => console.log(`  ${r}`));
    } else {
        console.log('\n❌ SNIPE FAILED');
        console.log(`Reason: ${result.error || 'AI rejected'}`);
        console.log('\nAI Analysis:');
        result.aiDecision.reasons.forEach(r => console.log(`  ${r}`));
    }
}

main().catch(console.error);
