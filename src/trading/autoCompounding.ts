// src/trading/autoCompounding.ts

/**
 * Auto-Compounding System
 * Automatically reinvests profits for exponential growth
 */

import { logger } from "../logger";
import { getPortfolioMetrics } from "../state/positions";

export interface CompoundingConfig {
    enabled: boolean;
    minProfitToCompound: number; // Minimum profit in SOL to reinvest
    compoundPercent: number; // Percentage of profit to reinvest (0-100)
    maxCompoundAmount: number; // Maximum amount to compound per cycle
    compoundInterval: number; // How often to check (ms)
}

export interface CompoundingStats {
    totalCompounded: number;
    compoundCount: number;
    avgCompoundAmount: number;
    totalGrowth: number;
    lastCompound: number;
}

export class AutoCompounding {
    private config: CompoundingConfig;
    private stats: CompoundingStats;
    private initialCapital: number;

    constructor(initialCapital: number, config?: Partial<CompoundingConfig>) {
        this.initialCapital = initialCapital;
        this.config = {
            enabled: true,
            minProfitToCompound: 0.1, // Min 0.1 SOL profit
            compoundPercent: 50, // Reinvest 50% of profits
            maxCompoundAmount: 1.0, // Max 1 SOL per compound
            compoundInterval: 60 * 60 * 1000, // Check every hour
            ...config,
        };

        this.stats = {
            totalCompounded: 0,
            compoundCount: 0,
            avgCompoundAmount: 0,
            totalGrowth: 0,
            lastCompound: 0,
        };
    }

    /**
     * Check if compounding should occur
     */
    shouldCompound(): { should: boolean; amount: number; reason: string } {
        if (!this.config.enabled) {
            return { should: false, amount: 0, reason: 'Compounding disabled' };
        }

        // Check interval
        if (Date.now() - this.stats.lastCompound < this.config.compoundInterval) {
            return { should: false, amount: 0, reason: 'Too soon since last compound' };
        }

        // Get current portfolio metrics
        const metrics = getPortfolioMetrics();
        const currentProfit = metrics.performance.totalPnL;

        // Check if profit meets minimum
        if (currentProfit < this.config.minProfitToCompound) {
            return {
                should: false,
                amount: 0,
                reason: `Profit ${currentProfit.toFixed(4)} SOL below minimum ${this.config.minProfitToCompound} SOL`,
            };
        }

        // Calculate compound amount
        let compoundAmount = currentProfit * (this.config.compoundPercent / 100);

        // Cap at maximum
        if (compoundAmount > this.config.maxCompoundAmount) {
            compoundAmount = this.config.maxCompoundAmount;
        }

        return {
            should: true,
            amount: compoundAmount,
            reason: `Compounding ${compoundAmount.toFixed(4)} SOL (${this.config.compoundPercent}% of ${currentProfit.toFixed(4)} SOL profit)`,
        };
    }

    /**
     * Execute compounding
     */
    compound(amount: number): void {
        // Update stats
        this.stats.totalCompounded += amount;
        this.stats.compoundCount++;
        this.stats.avgCompoundAmount = this.stats.totalCompounded / this.stats.compoundCount;
        this.stats.lastCompound = Date.now();

        // Calculate growth
        const currentCapital = this.initialCapital + this.stats.totalCompounded;
        this.stats.totalGrowth = ((currentCapital - this.initialCapital) / this.initialCapital) * 100;

        logger.info(
            `[AutoCompound] Compounded ${amount.toFixed(4)} SOL ` +
            `(Total: ${this.stats.totalCompounded.toFixed(4)} SOL, ` +
            `Growth: ${this.stats.totalGrowth.toFixed(2)}%)`
        );
    }

    /**
     * Calculate projected growth with compounding
     */
    calculateProjectedGrowth(
        monthlyReturn: number,
        months: number
    ): { withCompounding: number; withoutCompounding: number; difference: number } {
        // Without compounding (simple interest)
        const withoutCompounding = this.initialCapital * (1 + (monthlyReturn / 100) * months);

        // With compounding (compound interest)
        const monthlyRate = monthlyReturn / 100;
        const withCompounding = this.initialCapital * Math.pow(1 + monthlyRate, months);

        const difference = withCompounding - withoutCompounding;

        return {
            withCompounding,
            withoutCompounding,
            difference,
        };
    }

    /**
     * Get statistics
     */
    getStats(): CompoundingStats {
        return { ...this.stats };
    }

    /**
     * Get configuration
     */
    getConfig(): CompoundingConfig {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<CompoundingConfig>): void {
        this.config = { ...this.config, ...config };
        logger.info(`[AutoCompound] Config updated:`, this.config);
    }

    /**
     * Display compounding report
     */
    displayReport(): void {
        console.log("\n" + "=".repeat(60));
        console.log("💰 AUTO-COMPOUNDING REPORT");
        console.log("=".repeat(60));
        console.log(`Initial Capital: ${this.initialCapital.toFixed(4)} SOL`);
        console.log(`Total Compounded: ${this.stats.totalCompounded.toFixed(4)} SOL`);
        console.log(`Compound Count: ${this.stats.compoundCount}`);
        console.log(`Avg Compound: ${this.stats.avgCompoundAmount.toFixed(4)} SOL`);
        console.log(`Total Growth: ${this.stats.totalGrowth.toFixed(2)}%`);
        console.log(`Current Capital: ${(this.initialCapital + this.stats.totalCompounded).toFixed(4)} SOL`);

        // Show projection
        const projection = this.calculateProjectedGrowth(20, 12); // 20% monthly for 12 months
        console.log("\n📈 12-MONTH PROJECTION (20% monthly return):");
        console.log(`Without Compounding: ${projection.withoutCompounding.toFixed(4)} SOL`);
        console.log(`With Compounding: ${projection.withCompounding.toFixed(4)} SOL`);
        console.log(`Difference: +${projection.difference.toFixed(4)} SOL`);
        console.log("=".repeat(60) + "\n");
    }
}

// Singleton instance
let compoundingInstance: AutoCompounding | null = null;

export function getAutoCompounding(initialCapital?: number): AutoCompounding {
    if (!compoundingInstance && initialCapital) {
        compoundingInstance = new AutoCompounding(initialCapital);
    }
    if (!compoundingInstance) {
        throw new Error('AutoCompounding not initialized. Provide initial capital.');
    }
    return compoundingInstance;
}
