// examples/aiTradingExample.ts

/**
 * AI Trading System - Usage Example
 */

import { IntelligentTradingSystem } from '../src/futures/intelligentTradingSystem';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    console.log('🤖 AI Trading System Example\n');

    // Create system with OpenAI API key (optional)
    const system = new IntelligentTradingSystem(
        process.env.OPENAI_API_KEY
    );

    try {
        // Initialize
        await system.initialize();

        // Subscribe to BTC/USDT
        await system.subscribeToSymbol('BTCUSDT');

        // Wait for data
        console.log('⏳ Waiting for data (10 seconds)...\n');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Analyze with AI
        const result = await system.analyzeAndDecide('BTCUSDT', 60000);

        // Display results
        if (result.finalDecision === 'EXECUTE') {
            console.log('✅ TRADE APPROVED BY AI');
            console.log('\nTrade Details:');
            console.log(`  Symbol: BTCUSDT`);
            console.log(`  Direction: ${result.orderFlowSignal.direction}`);
            console.log(`  Entry: $${result.orderFlowSignal.entry.toFixed(2)}`);
            console.log(`  Leverage: ${result.aiDecision.adjustedParams.leverage}x`);
            console.log(`  Position Size: ${result.aiDecision.adjustedParams.positionSize}`);
            console.log(`  Stop Loss: $${result.aiDecision.adjustedParams.stopLoss.toFixed(2)}`);
            console.log(`  Take Profit: $${result.aiDecision.adjustedParams.takeProfit[0].toFixed(2)}`);
        } else {
            console.log('❌ TRADE REJECTED BY AI');
            console.log('\nReasons:');
            result.aiDecision.reasoning.forEach((r: string) => console.log(`  - ${r}`));
        }

        // Continuous monitoring
        console.log('\n\n🔄 Starting continuous monitoring (Ctrl+C to stop)...\n');

        setInterval(async () => {
            try {
                const result = await system.analyzeAndDecide('BTCUSDT', 60000);

                if (result.finalDecision === 'EXECUTE') {
                    console.log('🔥 NEW TRADE OPPORTUNITY!');
                }

            } catch (error: any) {
                console.error('❌ Error:', error.message);
            }
        }, 30000); // Every 30 seconds

    } catch (error: any) {
        console.error('\n❌ Error:', error.message);
        system.disconnect();
        process.exit(1);
    }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n\n👋 Stopping...');
    process.exit(0);
});

// Run
main().catch(console.error);
