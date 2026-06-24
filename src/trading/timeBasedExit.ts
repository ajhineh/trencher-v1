// src/trading/timeBasedExit.ts
/**
 * Time-Based Exit Strategy
 * 
 * Exits positions that are flat (no significant profit/loss)
 * after a specified holding period
 */

import { logger } from '../logger';

export interface TimeExitConfig {
    maxHoldTimeMinutes: number;
    flatThresholdPercent: number; // Consider "flat" if abs(profit) < this
}

/**
 * Check if position should be exited based on time
 * 
 * @param entryTime - Position entry timestamp (ms)
 * @param currentTime - Current timestamp (ms)
 * @param profitPercent - Current profit/loss percentage
 * @param config - Configuration
 * @returns true if should exit
 */
export function shouldTimeExit(
    entryTime: number,
    currentTime: number,
    profitPercent: number,
    config?: Partial<TimeExitConfig>
): boolean {
    const defaultConfig: TimeExitConfig = {
        maxHoldTimeMinutes: Number(process.env.TIME_EXIT_MINUTES ?? 15),
        flatThresholdPercent: 5, // ±5% is considered flat
    };

    const forceExitMinutes = Number(process.env.MAX_TRADE_DURATION_MINUTES ?? 2);
    const finalConfig = { ...defaultConfig, ...config };

    const elapsedMs = currentTime - entryTime;
    const elapsedMinutes = elapsedMs / (60 * 1000);

    // 1. HARD EXIT: Force exit if total duration exceeded regardless of profit
    if (elapsedMinutes >= forceExitMinutes) {
        logger.info(
            `[TIME-EXIT] 🕒 HARD EXIT: Time limit reached (${elapsedMinutes.toFixed(1)}m >= ${forceExitMinutes}m). ` +
            `Exiting regardless of profit (${profitPercent.toFixed(1)}%).`
        );
        return true;
    }

    // 2. FLAT EXIT: Exit if holding time exceeded AND position is flat
    if (elapsedMinutes < finalConfig.maxHoldTimeMinutes) {
        return false; // Not time for flat exit yet
    }

    const isFlat = Math.abs(profitPercent) < finalConfig.flatThresholdPercent;

    if (isFlat) {
        logger.info(
            `[TIME-EXIT] ⏰ Position flat after ${elapsedMinutes.toFixed(1)} minutes. ` +
            `Profit: ${profitPercent.toFixed(1)}% (threshold: ±${finalConfig.flatThresholdPercent}%)`
        );
        return true;
    }

    logger.debug(
        `[TIME-EXIT] Position active after ${elapsedMinutes.toFixed(1)} minutes. ` +
        `Profit: ${profitPercent.toFixed(1)}% - continuing to hold`
    );

    return false;
}

/**
 * Get time-based exit statistics for a position
 */
export function getTimeExitStats(
    entryTime: number,
    currentTime: number
): {
    elapsedMinutes: number;
    maxHoldMinutes: number;
    remainingMinutes: number;
    shouldCheckExit: boolean;
} {
    const maxHoldMinutes = Number(process.env.TIME_EXIT_MINUTES ?? 15);
    const elapsedMs = currentTime - entryTime;
    const elapsedMinutes = elapsedMs / (60 * 1000);
    const remainingMinutes = Math.max(0, maxHoldMinutes - elapsedMinutes);

    return {
        elapsedMinutes,
        maxHoldMinutes,
        remainingMinutes,
        shouldCheckExit: elapsedMinutes >= maxHoldMinutes,
    };
}
