// src/bridge/metricsCollector.ts

/**
 * Metrics Collector - Collects system and bot metrics
 */

import os from 'os';
import { SystemMetrics, BotMetrics } from './types';

export class MetricsCollector {
    private lastCpuUsage = process.cpuUsage();
    private lastCheck = Date.now();

    /**
     * Collect system metrics
     */
    getSystemMetrics(): SystemMetrics {
        const cpuUsage = process.cpuUsage(this.lastCpuUsage);
        const now = Date.now();
        const elapsed = (now - this.lastCheck) * 1000; // microseconds

        // Calculate CPU percentage
        const cpuPercent = ((cpuUsage.user + cpuUsage.system) / elapsed) * 100;

        // Memory
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        // Update for next call
        this.lastCpuUsage = process.cpuUsage();
        this.lastCheck = now;

        return {
            cpu: Math.min(cpuPercent, 100),
            memory: {
                used: usedMem,
                total: totalMem,
                percentage: (usedMem / totalMem) * 100
            },
            disk: {
                used: 0, // TODO: Implement disk usage
                total: 0,
                percentage: 0
            },
            network: {
                rx: 0, // TODO: Implement network stats
                tx: 0
            },
            uptime: process.uptime()
        };
    }

    /**
     * Collect bot metrics
     * This will be called with bot instance
     */
    getBotMetrics(botInstance?: any): BotMetrics {
        // Default empty metrics
        const metrics: BotMetrics = {
            activeTrades: 0,
            totalTrades: 0,
            winRate: 0,
            profitLoss: 0,
            positions: []
        };

        // If bot instance provided, extract real metrics
        if (botInstance) {
            // TODO: Extract from actual bot instance
            // This depends on your bot's structure
        }

        return metrics;
    }

    /**
     * Get combined metrics
     */
    getAllMetrics(botInstance?: any) {
        return {
            system: this.getSystemMetrics(),
            bot: this.getBotMetrics(botInstance),
            timestamp: Date.now()
        };
    }
}
