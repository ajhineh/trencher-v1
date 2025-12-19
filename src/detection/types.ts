// src/detection/types.ts

/**
 * Unified types for token detection across all DEXs
 */

export type DexType = 'PUMPFUN' | 'PUMPSWAP' | 'METEORA' | 'RAYDIUM' | 'JUPITER' | 'UNKNOWN';

export interface TokenMetadata {
    name: string;
    symbol: string;
    decimals: number;
    supply?: number;
    uri?: string;
}

export interface PoolInfo {
    baseMint: string;
    quoteMint: string;
    baseReserve: number;
    quoteReserve: number;
    liquidityUsd: number;
    lpSupply?: number;
}

export interface DetectedToken {
    // Basic Info
    mint: string;
    pool: string;
    dex: DexType;

    // Metadata
    metadata: TokenMetadata;

    // Pool Info
    poolInfo: PoolInfo;

    // Creator Info
    creator?: string;

    // Timing
    timestamp: number;
    blockTime?: number;

    // Transaction
    signature: string;

    // DEX-Specific Data
    dexSpecific?: {
        // PumpFun
        bondingCurveCompleted?: boolean;
        migratedFromPumpFun?: boolean;

        // PumpSwap
        directLaunch?: boolean;

        // Meteora
        poolType?: string;

        // Others...
        [key: string]: any;
    };
}

export interface DetectionResult {
    detected: boolean;
    token?: DetectedToken;
    reason?: string;
}
