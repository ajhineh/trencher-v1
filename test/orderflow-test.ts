// test/orderflow-test.ts

/**
 * Order Flow Analysis - Simple Test
 */

import { OrderFlowAnalyzer } from '../src/futures/orderflow';

async function testOrderFlow() {
    console.log('🚀 Starting Order Flow Test...\n');

    const analyzer = new OrderFlowAnalyzer();

    try {
        // 1. Initialize
        console.log('1️⃣ Initializing...');
        await analyzer.initialize();

        // 2. Subscribe
        console.log('2️⃣ Subscribing to BTCUSDT...');
        await analyzer.subscribeToSymbol('BTCUSDT');

        // 3. Wait for data
        console.log('3️⃣ Waiting for data (10 seconds)...\n');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // 4. Analyze
        console.log('4️⃣ Analyzing...\n');
        const signal = await analyzer.analyze('BTCUSDT', 60000);

        // 5. Display results
        console.log('═══════════════════════════════════════');
        console.log('📊 ORDER FLOW SIGNAL');
        console.log('═══════════════════════════════════════');
        console.log(`Direction:     ${signal.direction}`);
        console.log(`Confidence:    ${signal.confidence.toFixed(2)}%`);
        console.log(`Entry Price:   $${signal.entry.toFixed(2)}`);
        console.log(`Stop Loss:     $${signal.stopLoss.toFixed(2)}`);
        console.log(`Take Profit:   $${signal.takeProfit.toFixed(2)}`);
        console.log(`\nVolume Delta:  ${signal.volumeDelta.toFixed(2)}`);
        console.log(`Bid/Ask Imb:   ${(signal.bidAskImbalance * 100).toFixed(2)}%`);
        console.log('\nReasons:');
        signal.reasons.forEach(reason => console.log(`  ✓ ${reason}`));
        console.log('═══════════════════════════════════════\n');

        // 6. Continuous monitoring
        console.log('5️⃣ Starting continuous monitoring (Ctrl+C to stop)...\n');

        let count = 0;
        setInterval(async () => {
            try {
                count++;
                const newSignal = await analyzer.analyze('BTCUSDT', 60000);

                console.log(`\n[${count}] ${new Date().toLocaleTimeString()}`);
                console.log(`${newSignal.direction} | Confidence: ${newSignal.confidence.toFixed(0)}% | Entry: $${newSignal.entry.toFixed(2)}`);

                if (newSignal.confidence > 70) {
                    console.log('🔥 HIGH CONFIDENCE SIGNAL!');
                }

            } catch (error: any) {
                console.error('❌ Analysis error:', error.message);
            }
        }, 15000);  // Every 15 seconds

    } catch (error: any) {
        console.error('\n❌ Error:', error.message);
        analyzer.disconnect();
        process.exit(1);
    }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n\n👋 Stopping...');
    process.exit(0);
});

// Run test
testOrderFlow().catch(console.error);
