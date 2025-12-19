// examples/bridge-client-example.ts

/**
 * Example: How to use Bridge Client
 * This shows how to connect from Antigravity or any client
 */

import { BridgeClient } from '../src/bridge/client';

async function main() {
    // Create client
    const client = new BridgeClient({
        url: 'ws://your-vps-ip:3001',
        apiKey: 'your-api-key-here',
        reconnect: true
    });

    // Listen for logs
    client.on('log', (log) => {
        console.log(`[${log.level.toUpperCase()}] ${log.message}`);
    });

    // Listen for metrics
    client.on('metrics', (metrics) => {
        console.log('📊 Metrics:', {
            cpu: `${metrics.system.cpu.toFixed(2)}%`,
            memory: `${(metrics.system.memory.percentage).toFixed(2)}%`,
            activeTrades: metrics.bot.activeTrades
        });
    });

    // Connect
    console.log('🔗 Connecting to bridge server...');
    await client.connect();

    // Get status
    const status = await client.getStatus();
    console.log('📊 Bot Status:', status.data);

    // Update config example
    // const result = await client.updateConfig({
    //     SNIPER_MODE: 'CONSERVATIVE',
    //     MAX_BUY_AMOUNT: 0.2
    // });
    // console.log('⚙️ Config updated:', result);

    // Execute code example (DANGEROUS!)
    // const codeResult = await client.executeCode(`
    //     console.log('Hello from remote!');
    //     return { message: 'Code executed' };
    // `);
    // console.log('💻 Code result:', codeResult);

    // Keep alive
    console.log('✅ Connected! Press Ctrl+C to exit.');

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n👋 Disconnecting...');
        client.disconnect();
        process.exit(0);
    });
}

main().catch(console.error);
