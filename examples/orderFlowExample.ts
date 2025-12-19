// examples/orderFlowExample.ts

/**
 * Order Flow Analysis - Usage Example
 */

import { OrderFlowAnalyzer } from '../src/futures/orderflow';

async function main() {
    // Create analyzer
    const analyzer = new OrderFlowAnalyzer();

    try {
        // Initialize and connect
        await analyzer.initialize();

        // Subscribe to BTC/USDT futures
        await analyzer.subscribeToSymbol('BTCUSDT');

        // Wait for data to accumulate
        console.log('⏳ Waiting for data...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Analyze every 10 seconds
        setInterval(async () => {
            try {
                const signal = await analyzer.analyze('BTCUSDT', 60000);

                console.log('\n📊 Order Flow Signal:');
                console.log(`Direction: ${signal.direction}`);
                console.log(`Confidence: ${signal.confidence.toFixed(2)}%`);
                console.log(`Entry: $${signal.entry.toFixed(2)}`);
                console.log(`Stop Loss: $${signal.stopLoss.toFixed(2)}`);
                console.log(`Take Profit: $${signal.takeProfit.toFixed(2)}`);
                console.log(`\nReasons:`);
                signal.reasons.forEach(reason => console.log(`  - ${reason}`));

            } catch (error) {
                console.error('❌ Analysis error:', error);
            }
        }, 10000);

    } catch (error) {
        console.error('❌ Error:', error);
        analyzer.disconnect();
    }
}

// Run example
main().catch(console.error);
