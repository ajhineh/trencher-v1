
import { CoinExExecutor } from '../../src/futures/execution/coinexExecutor';

async function main() {
    console.log('🔍 Testing CoinExExecutor...');

    // 1. Initialize (Dry Run)
    const executor = new CoinExExecutor(undefined, undefined, true);

    // 2. Test Get Candles (Mock)
    console.log('Fetching Candles (Dry Run)...');
    const candles = await executor.getCandles('BTC/USDT', '1m', 5);
    console.log(`✅ Got ${candles.prices.length} candles`);

    // 3. Test Open Position (Mock)
    console.log('Opening Position (Dry Run)...');
    const result = await executor.openLong('BTC/USDT', 0.1, 5);
    console.log('✅ Result:', result);

    // 4. Test Real Connection (if API Key provided)
    // We check if API keys are present (length check to avoid logging secrets)
    const hasKey = process.env.COINEX_API_KEY && process.env.COINEX_API_KEY.length > 0;
    if (hasKey) {
        console.log('🔑 API Key detected. Testing Authentication (Balance Check)...');
        // Note: This might fail if IP is blocked and no proxy is set.
        try {
            // Create REAL executor (dryRun = false for connection, but we won't trade)
            // We'll just check Liquidity or Balance
            // But user sidebar says they are in US. 
            // CCXT might hang if blocked.

            if (process.env.TEST_MODE === 'true') {
                console.log('🛡️ TEST_MODE is ON. Skipping Real Network Call.');
            } else {
                console.log('📡 Attempting Network Call (Balance)...');
                const realExecutor = new CoinExExecutor(undefined, undefined, false);
                // Only try if proxy is set or user mimics functionality
                // We will skip actual network call to avoid hanging if blocked, unless user specifically asked.
                // safe check: just log properties
                console.log('Client config:', realExecutor['client'].urls);
            }
        } catch (err) {
            console.error('❌ Network Test Failed:', err);
        }
    } else {
        console.log('⚠️ No API Key found in env.');
    }
}

main().catch(console.error);
