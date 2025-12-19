// src/detection/unifiedTokenDetector.ts

/**
 * Unified Token Detector
 * Coordinates all DEX-specific detectors
 */

import { Connection, ParsedTransactionWithMeta } from '@solana/web3.js';
import { DetectedToken, DetectionResult } from './types';
import { PumpSwapDetector } from './pumpswapDetector';
import { MeteoraDetector } from './meteoraDetector';
import { logger } from '../logger';

export class UnifiedTokenDetector {
    private connection: Connection;
    private detectors: Map<string, any>;

    constructor(connection: Connection) {
        this.connection = connection;

        // Initialize all detectors
        this.detectors = new Map([
            ['PUMPSWAP', new PumpSwapDetector(connection)],
            ['METEORA', new MeteoraDetector(connection)],
            // Add more detectors here as needed
        ]);

        logger.info('[DETECTOR] Initialized with detectors:', Array.from(this.detectors.keys()));
    }

    /**
     * Detect token launch from any supported DEX
     */
    async detectTokenLaunch(
        parsedTx: ParsedTransactionWithMeta,
        signature: string
    ): Promise<DetectedToken | null> {
        // Try each detector in priority order
        for (const [name, detector] of this.detectors.entries()) {
            try {
                const result: DetectionResult = await detector.detect(parsedTx);

                if (result.detected && result.token) {
                    // Set signature
                    result.token.signature = signature;

                    // Enrich with metadata
                    await this.enrichTokenMetadata(result.token);

                    logger.info(`[DETECTOR] Token detected via ${name}: ${result.token.mint}`);
                    return result.token;
                }
            } catch (error: any) {
                logger.error(`[DETECTOR] Error in ${name} detector: ${error.message}`);
            }
        }

        logger.debug('[DETECTOR] No token detected');
        return null;
    }

    /**
     * Enrich token with metadata from RPC
     */
    private async enrichTokenMetadata(token: DetectedToken): Promise<void> {
        try {
            // Fetch metadata using Helius DAS API
            const response = await fetch(this.connection.rpcEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'get-asset',
                    method: 'getAsset',
                    params: { id: token.mint },
                }),
            });

            const json = await response.json() as any;
            const result = json?.result;

            if (result) {
                token.metadata.name = result?.content?.metadata?.name || token.metadata.name;
                token.metadata.symbol = result?.content?.metadata?.symbol || token.metadata.symbol;
                token.metadata.decimals = result?.spl_token_info?.decimals || token.metadata.decimals;
                token.metadata.supply = result?.content?.metadata?.supply
                    ? Number(result.content.metadata.supply)
                    : undefined;
                token.metadata.uri = result?.content?.json_uri;
            }
        } catch (error: any) {
            logger.warn(`[DETECTOR] Could not fetch metadata for ${token.mint}: ${error.message}`);
        }
    }

    /**
     * Calculate liquidity in USD
     */
    async calculateLiquidityUsd(
        token: DetectedToken,
        solPriceUsd: number
    ): Promise<void> {
        // For AMM pools: liquidity = 2 * quote_reserve * price
        token.poolInfo.liquidityUsd = 2 * token.poolInfo.quoteReserve * solPriceUsd;
    }
}
