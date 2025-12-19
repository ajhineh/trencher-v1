// src/dataSources/marketContext.ts

import { logger } from '../logger';

export interface MarketContext {
    solPrice: number;
    solPriceChange24h: number; // percentage
    marketTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    volatility: 'LOW' | 'MEDIUM' | 'HIGH';
}

let cachedContext: MarketContext | null = null;
let lastFetchTime: number = 0;
const CACHE_DURATION_MS = 60000; // 1 minute

export async function getMarketContext(): Promise<MarketContext> {
    const now = Date.now();

    // Return cached data if still valid
    if (cachedContext && now - lastFetchTime < CACHE_DURATION_MS) {
        return cachedContext;
    }

    try {
        // Fetch SOL price and 24h change from CoinGecko
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true',
            { signal: controller.signal }
        );
        clearTimeout(timeoutId);

        const data = await response.json() as any;
        const solPrice = data?.solana?.usd ?? 0;
        const solPriceChange24h = data?.solana?.usd_24h_change ?? 0;

        // Determine market trend
        let marketTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
        if (solPriceChange24h > 3) {
            marketTrend = 'BULLISH';
        } else if (solPriceChange24h < -3) {
            marketTrend = 'BEARISH';
        } else {
            marketTrend = 'NEUTRAL';
        }

        // Determine volatility based on price change magnitude
        let volatility: 'LOW' | 'MEDIUM' | 'HIGH';
        const absChange = Math.abs(solPriceChange24h);
        if (absChange > 10) {
            volatility = 'HIGH';
        } else if (absChange > 5) {
            volatility = 'MEDIUM';
        } else {
            volatility = 'LOW';
        }

        cachedContext = {
            solPrice,
            solPriceChange24h,
            marketTrend,
            volatility,
        };
        lastFetchTime = now;

        return cachedContext;
    } catch (error: any) {
        logger.error(`[MarketContext] Error fetching market data: ${error?.message ?? error}`);

        // Return default/cached data on error
        return cachedContext || {
            solPrice: 0,
            solPriceChange24h: 0,
            marketTrend: 'NEUTRAL',
            volatility: 'MEDIUM',
        };
    }
}
