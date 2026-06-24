import Transport from 'winston-transport';
import { logger } from '../logger';
import { dashboardData } from './server';
import { EventEmitter } from 'events';

export const dashboardEmitter = new EventEmitter();

class DashboardTransport extends Transport {
    constructor(opts?: Transport.TransportStreamOptions) {
        super(opts);
    }

    log(info: any, callback: () => void) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        // Parse message string into structured object for Frontend
        const parsedLog = this.parseLogMessage(info);

        if (parsedLog) {
            dashboardData.logs.unshift(parsedLog);
            dashboardEmitter.emit('newLog', parsedLog);

            // Keep log size manageable
            if (dashboardData.logs.length > 200) {
                dashboardData.logs.pop();
            }
        }

        callback();
    }

    private parseLogMessage(info: any): any | null {
        const msg = info.message || "";
        const timestamp = info.timestamp || new Date().toISOString();
        const timeStr = new Date(timestamp).toLocaleTimeString();

        // 1. SKIP / REJECT
        if (msg.includes("[SKIP]")) {
            // Format: "[SKIP] SYMBOL - Reason..."
            const match = msg.match(/\[SKIP\]\s+(\S+)\s+-\s+(.+)/);
            return {
                time: timeStr,
                token: match ? match[1] : "UNKNOWN",
                network: "System",
                reason: match ? match[2] : msg,
                status: "REJECT", // Shows red
                mint: ""
            };
        }

        // 2. BUY / TRIGGER
        if (msg.includes("[BUY]") || msg.includes("🚀 TRIGGER")) {
            const match = msg.match(/\[BUY\]\s+(.+)/) || msg.match(/🚀 TRIGGER:\s+(.+)/);
            return {
                time: timeStr,
                token: "BUY SIGNAL",
                network: "Sniper",
                reason: match ? match[1] : msg,
                status: "APPROVED", // Shows green
                mint: ""
            };
        }

        // 3. WATCHLIST
        if (msg.includes("[WATCHLIST]")) {
            // Format: "[WATCHLIST] Added MINT (Progress...)"
            const match = msg.match(/Added\s+(\S+)/);
            return {
                time: timeStr,
                token: "WATCH",
                network: "Scanner",
                reason: msg.replace("[WATCHLIST] ", ""),
                status: "WARNING", // Shows yellow/grey
                mint: match ? match[1] : ""
            };
        }

        // 4. ERROR
        if (info.level === 'error' || msg.includes("[ERROR]")) {
            return {
                time: timeStr,
                token: "ERROR",
                network: "System",
                reason: msg,
                status: "REJECT",
                mint: ""
            };
        }

        // 5. EVENT / DETECTED (Filter out to avoid noise, or map to SKIP/INFO)
        // Returning null means it won't be pushed to frontend array
        // But if user wants to see "System Online", we need *some* logs?
        // Actually, if we return null, the array is empty, which is fine, as long as it doesn't crash.
        // But let's pass meaningful info.

        if (msg.includes("[EVENT]")) {
            return null; // Too noisy
        }

        // Default fallback for other logs (WARN/INFO) 
        // ONLY if it looks important? 
        // Let's return generic object to prevent frontend crash if it slips through elsewhere?
        // Actually best to return NULL for unparsed junk.

        return null;
    }
}

export function connectDashboardToLogger() {
    logger.add(new DashboardTransport());
    logger.info('[Dashboard] Connected to internal logger.');
}
