// src/sniper/smartFeeManager.ts

/**
 * Smart Fee Manager
 * Dynamically calculates optimal priority fees using Helius API
 */

import { logger } from '../logger';

export type FeeUrgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export interface FeeConfig {
    enableSmartFees: boolean;
    urgency: FeeUrgency;
    maxFeeMicroLamports: number;  // Safety cap
    fallbackFeeMicroLamports: number; // If API fails
}

export interface FeeEstimate {
    microLamports: number;
    source: 'HELIUS_API' | 'FALLBACK' | 'CACHED';
    timestamp: number;
}

export class SmartFeeManager {
    private config: FeeConfig;
    private rpcUrl: string;
    private cache: Map<FeeUrgency, { fee: number; timestamp: number }> = new Map();
    private readonly CACHE_DURATION_MS = 10000; // 10 seconds

    constructor(rpcUrl: string, config: FeeConfig) {
        this.rpcUrl = rpcUrl;
        this.config = config;

        logger.info(`💰 Smart Fee Manager initialized`);
        logger.info(`   Enabled: ${config.enableSmartFees}`);
        logger.info(`   Max Fee: ${config.maxFeeMicroLamports} microlamports`);
    }

    /**
     * Get optimal priority fee
     */
    async getOptimalFee(urgency?: FeeUrgency): Promise<FeeEstimate> {
        const targetUrgency = urgency || this.config.urgency;

        // If smart fees disabled, return fallback
        if (!this.config.enableSmartFees) {
            return {
                microLamports: this.config.fallbackFeeMicroLamports,
                source: 'FALLBACK',
                timestamp: Date.now()
            };
        }

        // Check cache first
        const cached = this.getCachedFee(targetUrgency);
        if (cached) {
            return {
                microLamports: cached,
                source: 'CACHED',
                timestamp: Date.now()
            };
        }

        // Fetch from Helius API
        try {
            const fee = await this.fetchFromHelius(targetUrgency);

            // Apply safety cap
            const cappedFee = Math.min(fee, this.config.maxFeeMicroLamports);

            // Cache the result
            this.cache.set(targetUrgency, {
                fee: cappedFee,
                timestamp: Date.now()
            });

            logger.info(`💰 Fee: ${cappedFee} microlamports (${targetUrgency}, ${cappedFee !== fee ? 'CAPPED' : 'OK'})`);

            return {
                microLamports: cappedFee,
                source: 'HELIUS_API',
                timestamp: Date.now()
            };

        } catch (error: any) {
            logger.warn(`⚠️ Failed to fetch fee from Helius: ${error.message}`);
            logger.info(`   Using fallback: ${this.config.fallbackFeeMicroLamports} microlamports`);

            return {
                microLamports: this.config.fallbackFeeMicroLamports,
                source: 'FALLBACK',
                timestamp: Date.now()
            };
        }
    }

    /**
     * Fetch priority fee from Helius API
     */
    private async fetchFromHelius(urgency: FeeUrgency): Promise<number> {
        // Map urgency to Helius priority level
        const priorityLevel = this.mapUrgencyToPriorityLevel(urgency);

        const response = await fetch(this.rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getPriorityFeeEstimate',
                params: [{
                    accountKeys: [], // Empty for general estimate
                    options: {
                        priorityLevel: priorityLevel
                    }
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || 'Unknown API error');
        }

        // Helius returns priorityFeeEstimate in microlamports
        const baseFee = data.result?.priorityFeeEstimate || this.config.fallbackFeeMicroLamports;

        // Apply multiplier based on urgency
        return this.applyUrgencyMultiplier(baseFee, urgency);
    }

    /**
     * Map urgency to Helius priority level
     */
    private mapUrgencyToPriorityLevel(urgency: FeeUrgency): string {
        switch (urgency) {
            case 'LOW':
                return 'Min';
            case 'MEDIUM':
                return 'Medium';
            case 'HIGH':
                return 'High';
            case 'VERY_HIGH':
                return 'VeryHigh';
            default:
                return 'Medium';
        }
    }

    /**
     * Apply urgency multiplier to base fee
     */
    private applyUrgencyMultiplier(baseFee: number, urgency: FeeUrgency): number {
        const multipliers = {
            'LOW': 1.0,
            'MEDIUM': 1.2,
            'HIGH': 1.5,
            'VERY_HIGH': 2.0
        };

        return Math.floor(baseFee * multipliers[urgency]);
    }

    /**
     * Get cached fee if still valid
     */
    private getCachedFee(urgency: FeeUrgency): number | null {
        const cached = this.cache.get(urgency);

        if (!cached) return null;

        const age = Date.now() - cached.timestamp;

        if (age > this.CACHE_DURATION_MS) {
            this.cache.delete(urgency);
            return null;
        }

        return cached.fee;
    }

    /**
     * Clear cache (useful for testing or manual refresh)
     */
    clearCache(): void {
        this.cache.clear();
        logger.info('🔄 Fee cache cleared');
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<FeeConfig>): void {
        this.config = { ...this.config, ...newConfig };
        logger.info(`💰 Fee config updated: ${JSON.stringify(newConfig)}`);
    }

    /**
     * Get current configuration
     */
    getConfig(): FeeConfig {
        return this.config;
    }
}
