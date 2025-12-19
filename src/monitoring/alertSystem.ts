// src/monitoring/alertSystem.ts

import { logger } from "../logger";
import { sendTelegram } from "../telegram";
import { getPerformanceMetrics } from "./performanceMetrics";
import { getPositionMonitor } from "./positionMonitor";

export type AlertLevel = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Alert {
    level: AlertLevel;
    title: string;
    message: string;
    timestamp: number;
}

export class AlertSystem {
    private alerts: Alert[] = [];
    private lastDrawdownAlert: number = 0;
    private lastStuckAlert: Map<string, number> = new Map();

    /**
     * Send an alert
     */
    async sendAlert(level: AlertLevel, title: string, message: string) {
        const alert: Alert = {
            level,
            title,
            message,
            timestamp: Date.now(),
        };

        this.alerts.push(alert);
        // Keep only last 100 alerts
        if (this.alerts.length > 100) {
            this.alerts = this.alerts.slice(-100);
        }

        // Log to console
        const icon = {
            'INFO': 'ℹ️',
            'WARNING': '⚠️',
            'CRITICAL': '🚨',
        }[level];

        logger.warn(`${icon} [ALERT] ${title}: ${message}`);

        // Send to Telegram for WARNING and CRITICAL
        if (level === 'WARNING' || level === 'CRITICAL') {
            try {
                await sendTelegram(`${icon} *${title}*\n${message}`);
            } catch (error) {
                logger.error(`[Alert] Failed to send Telegram: ${error}`);
            }
        }
    }

    /**
     * Check for performance alerts
     */
    async checkPerformanceAlerts() {
        const metrics = getPerformanceMetrics();
        const snapshot = await metrics.getSnapshot();

        // Large drawdown alert (>10%)
        if (snapshot.currentDrawdown > 10) {
            const now = Date.now();
            // Only alert once per hour
            if (now - this.lastDrawdownAlert > 60 * 60 * 1000) {
                await this.sendAlert(
                    'CRITICAL',
                    'Large Drawdown Detected',
                    `Current drawdown: ${snapshot.currentDrawdown.toFixed(2)}%\nConsider reducing position sizes or pausing trading.`
                );
                this.lastDrawdownAlert = now;
            }
        }

        // Low win rate alert (<40% with >10 trades)
        if (snapshot.totalTrades > 10 && snapshot.winRate < 40) {
            await this.sendAlert(
                'WARNING',
                'Low Win Rate',
                `Win rate: ${snapshot.winRate.toFixed(1)}% (${snapshot.totalTrades} trades)\nStrategy may need adjustment.`
            );
        }

        // High capital utilization (>85%)
        if (snapshot.capitalUtilization > 85) {
            await this.sendAlert(
                'WARNING',
                'High Capital Utilization',
                `Capital utilization: ${snapshot.capitalUtilization.toFixed(1)}%\nLimited room for new positions.`
            );
        }
    }

    /**
     * Check for position alerts
     */
    async checkPositionAlerts(currentPrices: Map<string, number>) {
        const monitor = getPositionMonitor();
        const alertPositions = await monitor.getAlertsNeeded(currentPrices);

        for (const posStatus of alertPositions) {
            const posId = posStatus.position.id;
            const now = Date.now();
            const lastAlert = this.lastStuckAlert.get(posId) || 0;

            // Stuck position alert (only once per hour per position)
            if (posStatus.status === 'STUCK' && now - lastAlert > 60 * 60 * 1000) {
                await this.sendAlert(
                    'WARNING',
                    'Position Stuck',
                    `Token: ${posStatus.position.baseMint.slice(0, 8)}...\nTime: ${posStatus.timeInPosition.toFixed(0)} minutes\nP/L: ${posStatus.currentPnLPercent.toFixed(2)}%\n${posStatus.recommendation}`
                );
                this.lastStuckAlert.set(posId, now);
            }

            // Near stop loss alert
            if (posStatus.status === 'LOSING' && posStatus.distanceToSL < 2) {
                await this.sendAlert(
                    'CRITICAL',
                    'Near Stop Loss',
                    `Token: ${posStatus.position.baseMint.slice(0, 8)}...\nP/L: ${posStatus.currentPnLPercent.toFixed(2)}%\nDistance to SL: ${posStatus.distanceToSL.toFixed(1)}%`
                );
            }
        }
    }

    /**
     * System health check
     */
    async checkSystemHealth() {
        // Check if bot is still running
        // This would be called periodically
        await this.sendAlert(
            'INFO',
            'System Health Check',
            'Bot is running normally'
        );
    }

    /**
     * Get recent alerts
     */
    getRecentAlerts(count: number = 10): Alert[] {
        return this.alerts.slice(-count);
    }

    /**
     * Run all checks
     */
    async runAllChecks(currentPrices: Map<string, number>) {
        await this.checkPerformanceAlerts();
        await this.checkPositionAlerts(currentPrices);
    }
}

// Singleton instance
let alertInstance: AlertSystem | null = null;

export function getAlertSystem(): AlertSystem {
    if (!alertInstance) {
        alertInstance = new AlertSystem();
    }
    return alertInstance;
}
