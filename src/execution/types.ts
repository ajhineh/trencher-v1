// src/execution/types.ts

/**
 * Execution layer types
 */

import { DexType } from '../detection/types';

export interface ExecutionResult {
    success: boolean;
    signature?: string;
    error?: string;
    dex: DexType;
    mint: string;
    amountSol: number;
    timestamp: number;
}

export interface ExecutionConfig {
    slippageBps: number;
    skipPreflight: boolean;
    buyDelayMs: number;
    maxRetries: number;
}
