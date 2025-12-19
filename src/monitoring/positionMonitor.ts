// src/monitoring/positionMonitor.ts

import { getOpenPositions, Position } from "../state/positions";
import { logger } from "../logger";

export interface PositionStatus {
    position: Position;
    currentPnL: number;
    currentPnLPercent: number;
    timeInPosition: number; // minutes
    distanceToTP: number; // percentage points
    distanceToSL: number; // percentage points
    status: 'WINNING' | 'LOSING' | 'NEUTRAL' | 'STUCK';
    recommendation: string;
}

export class PositionMonitor {
    /**
     * Get status of all open positions
     */
    async getPositionStatuses(currentPrices: Map<string, number>): Promise<PositionStatus[]> {
        const openPositions = getOpenPositions();
        const statuses: PositionStatus[] = [];

        for (const position of openPositions) {
            const currentPrice = currentPrices.get(position.baseMint) || position.buyPriceInQuote;
            const priceChange = ((currentPrice - position.buyPriceInQuote) / position.buyPriceInQuote) * 100;
            const pnl = priceChange * (position.buyAmountLamports / 1e9);
            const timeInPosition = (Date.now() - position.openedAt) / (60 * 1000);

            const distanceToTP = position.tpPercent - priceChange;
            const distanceToSL = priceChange + position.slPercent;

            let status: 'WINNING' | 'LOSING' | 'NEUTRAL' | 'STUCK';
            let recommendation: string;

            if (priceChange >= position.tpPercent * 0.8) {
                status = 'WINNING';
                recommendation = 'Consider taking profit soon';
            } else if (priceChange <= -position.slPercent * 0.8) {
                status = 'LOSING';
                recommendation = 'Close to stop loss, consider exiting';
            } else if (timeInPosition > 120 && Math.abs(priceChange) < 5) {
                status = 'STUCK';
                recommendation = 'Position stuck for 2+ hours, consider manual exit';
            } else {
                status = 'NEUTRAL';
                recommendation = 'Hold and monitor';
            }

            statuses.push({
                position,
                currentPnL: pnl,
                currentPnLPercent: priceChange,
                timeInPosition,
                distanceToTP,
                distanceToSL,
                status,
                recommendation,
            });
        }

        return statuses;
    }

    /**
     * Display position monitor dashboard
     */
    async displayMonitor(currentPrices: Map<string, number>) {
        const statuses = await this.getPositionStatuses(currentPrices);

        if (statuses.length === 0) {
            console.log("\n📊 No open positions\n");
            return;
        }

        console.log("\n" + "=".repeat(80));
        console.log("📊 POSITION MONITOR");
        console.log("=".repeat(80));

        for (const status of statuses) {
            const statusIcon = {
                'WINNING': '🟢',
                'LOSING': '🔴',
                'NEUTRAL': '🟡',
                'STUCK': '⚠️',
            }[status.status];

            console.log(`\n${statusIcon} ${status.position.baseMint.slice(0, 8)}...`);
            console.log(`   P/L: ${status.currentPnL > 0 ? '+' : ''}${status.currentPnL.toFixed(4)} SOL (${status.currentPnLPercent > 0 ? '+' : ''}${status.currentPnLPercent.toFixed(2)}%)`);
            console.log(`   Time: ${status.timeInPosition.toFixed(0)} minutes`);
            console.log(`   To TP: ${status.distanceToTP.toFixed(1)}% | To SL: ${status.distanceToSL.toFixed(1)}%`);
            console.log(`   💡 ${status.recommendation}`);
        }

        console.log("\n" + "=".repeat(80) + "\n");
    }

    /**
     * Get positions that need attention
     */
    async getAlertsNeeded(currentPrices: Map<string, number>): Promise<PositionStatus[]> {
        const statuses = await this.getPositionStatuses(currentPrices);
        return statuses.filter(s => s.status === 'LOSING' || s.status === 'STUCK');
    }

    /**
     * Get summary for logging
     */
    async getSummary(currentPrices: Map<string, number>): Promise<string> {
        const statuses = await this.getPositionStatuses(currentPrices);
        const winning = statuses.filter(s => s.status === 'WINNING').length;
        const losing = statuses.filter(s => s.status === 'LOSING').length;
        const stuck = statuses.filter(s => s.status === 'STUCK').length;
        const neutral = statuses.filter(s => s.status === 'NEUTRAL').length;

        return `Positions: ${statuses.length} (🟢${winning} 🔴${losing} ⚠️${stuck} 🟡${neutral})`;
    }
}

// Singleton instance
let monitorInstance: PositionMonitor | null = null;

export function getPositionMonitor(): PositionMonitor {
    if (!monitorInstance) {
        monitorInstance = new PositionMonitor();
    }
    return monitorInstance;
}
