// scripts/monitor.ts
// Real-time monitoring for YouLi-AI-600

import { Connection } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.testnet.solana.com';
const connection = new Connection(SOLANA_RPC_URL);

interface MonitoringStats {
    timestamp: number;
    clusterVersion: string;
    balance: number;
    status: 'healthy' | 'warning' | 'error';
}

async function monitor() {
    console.log('📊 Starting YouLi-AI-600 Monitoring...');
    console.log('=====================================');
    console.log(`RPC URL: ${SOLANA_RPC_URL}`);
    console.log('');

    const stats: MonitoringStats[] = [];

    setInterval(async () => {
        try {
            const timestamp = Date.now();

            // Check connection
            const version = await connection.getVersion();
            const clusterVersion = version['solana-core'];

            // Check wallet balance (if wallet is configured)
            let balance = 0;
            // Add wallet balance check here if needed

            const stat: MonitoringStats = {
                timestamp,
                clusterVersion,
                balance,
                status: 'healthy'
            };

            stats.push(stat);

            // Keep only last 100 stats
            if (stats.length > 100) {
                stats.shift();
            }

            // Display status
            console.clear();
            console.log('📊 YouLi-AI-600 Monitoring Dashboard');
            console.log('=====================================');
            console.log(`Time: ${new Date(timestamp).toLocaleString()}`);
            console.log(`Cluster: ${clusterVersion}`);
            console.log(`Status: ✅ ${stat.status.toUpperCase()}`);
            console.log('');
            console.log('Recent Activity:');
            stats.slice(-5).forEach(s => {
                console.log(`  ${new Date(s.timestamp).toLocaleTimeString()} - ${s.status}`);
            });
            console.log('');
            console.log('Press Ctrl+C to stop monitoring');

            // Save stats to file
            const logPath = path.join(__dirname, '..', 'logs', 'monitor.json');
            fs.writeFileSync(logPath, JSON.stringify(stats, null, 2));

        } catch (error) {
            console.error('❌ Monitoring error:', error);
        }
    }, 60000); // Every minute
}

// Start monitoring
monitor().catch(console.error);
