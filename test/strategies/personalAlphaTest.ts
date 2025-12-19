// test/strategies/personalAlphaTest.ts
import { IntelligentTradingSystem } from '../../src/futures/intelligentTradingSystem';
import { logger } from '../../src/logger';

async function testPersonalAlphaBot() {
    process.env.TEST_MODE = 'true'; // Enable US-Safe Mock Mode
    console.log('🧪 Starting Personal Alpha Bot Verification (CoinEx - Dry Run + US Safe Mode)...');

    // Initialize in Dry Run mode
    const system = new IntelligentTradingSystem(process.env.OPENAI_API_KEY, true);

    try {
        await system.initialize();

        // Mock symbol (CoinEx uses BTC/USDT format typically)
        const symbol = 'BTC/USDT'; // CCXT standard format
        console.log(`Analyzing ${symbol}...`);

        const result = await system.analyzeAndDecide(symbol, 60000);

        console.log('\n✅ Analysis Complete!');
        console.log(`Global Regime: (Check Logs)`);
        console.log(`Final Decision: ${result.finalDecision} `);

        if (result.executionResult) {
            console.log('Execution Result:', result.executionResult);
        } else {
            console.log('No Execution triggered (expected if confidence low or skipped)');
        }

    } catch (error) {
        console.error('❌ Verification Failed:', error);
    } finally {
        system.disconnect();
    }
}

testPersonalAlphaBot();
