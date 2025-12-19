// src/bridge-start.ts

/**
 * Bridge Server Startup Script
 * Start this alongside your trading bot
 */

import dotenv from 'dotenv';
dotenv.config();

import { BridgeServer } from './bridge';
import { logger } from './logger';

// Load configuration from environment
const bridgeConfig = {
    port: Number(process.env.BRIDGE_PORT || 3001),
    apiKey: process.env.BRIDGE_API_KEY || 'your-secret-api-key-change-this',
    allowedIPs: (process.env.BRIDGE_ALLOWED_IPS || '').split(',').filter(ip => ip.trim()),
    enableSSL: process.env.BRIDGE_ENABLE_SSL === 'true',
    sslCert: process.env.BRIDGE_SSL_CERT,
    sslKey: process.env.BRIDGE_SSL_KEY
};

// Validate configuration
if (bridgeConfig.apiKey === 'your-secret-api-key-change-this') {
    logger.warn('⚠️ WARNING: Using default API key! Please set BRIDGE_API_KEY in .env');
}

if (bridgeConfig.allowedIPs.length === 0) {
    logger.warn('⚠️ WARNING: No IP whitelist configured. All IPs will be allowed!');
}

// Create and start bridge server
const bridge = new BridgeServer(bridgeConfig);

logger.info('🌉 Starting Bridge Server...');
logger.info(`   Port: ${bridgeConfig.port}`);
logger.info(`   API Key: ${bridgeConfig.apiKey.slice(0, 10)}...`);
logger.info(`   Allowed IPs: ${bridgeConfig.allowedIPs.length > 0 ? bridgeConfig.allowedIPs.join(', ') : 'ALL'}`);

bridge.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
    logger.info('\n🛑 Shutting down bridge server...');
    bridge.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('\n🛑 Shutting down bridge server...');
    bridge.stop();
    process.exit(0);
});

// Export for use in main bot
export default bridge;
