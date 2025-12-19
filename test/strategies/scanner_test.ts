
import { IntelligentTradingSystem } from '../../src/futures/intelligentTradingSystem';
import * as dotenv from 'dotenv';
dotenv.config();

async function testScanner() {
    process.env.TEST_MODE = 'true';
    console.log('🔍 Testing Market Scanner (Autonomous Mode)...');

    // Initialize System (Dry Run)
    const tradingSystem = new IntelligentTradingSystem(undefined, true);

    // We access the scanner privately for testing or just run via startAutonmousMode
    // But since startAutonmousMode runs a loop, we might want to just test the underlying executor first
    // or run it for a few seconds.

    console.log('1️⃣ Starting Scanner...');
    tradingSystem.startAutonmousMode(1000); // 1 second interval for test

    // Let it run for 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('🛑 Stopping Scanner...');
    tradingSystem.stopAutonomousMode();

    console.log('✅ Test Complete');
}

testScanner().catch(console.error);
