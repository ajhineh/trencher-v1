// src/rl/stateEncoder.ts

/**
 * State Encoder - Converts market data to normalized state vector for RL
 */

export interface MarketData {
    liquidityUsd: number;
    recentBuyers: number;
    ageMs: number;
    fdv: number;
    volatility: number;
    pumpDumpScore: number;
    whaleRisk: boolean;
    coordinatedBuying: number;
}

export interface PortfolioData {
    capitalUtilization: number;
    openPositions: number;
    winRate: number;
    currentDrawdown: number;
}

export interface PositionData {
    hasPosition: boolean;
    pnlPercent: number;
    timeInPositionMs: number;
}

export class StateEncoder {
    /**
     * Encode market, portfolio, and position data into normalized state vector
     * Returns array of 15 normalized values (0-1)
     */
    encode(
        market: MarketData,
        portfolio: PortfolioData,
        position: PositionData
    ): number[] {
        const state: number[] = [];

        // Market features (5)
        state.push(this.normalizeLiquidity(market.liquidityUsd));
        state.push(this.normalizeBuyers(market.recentBuyers));
        state.push(this.normalizeAge(market.ageMs));
        state.push(this.normalizeFDV(market.fdv));
        state.push(this.normalizeVolatility(market.volatility));

        // Pattern features (3)
        state.push(market.pumpDumpScore / 100); // Already 0-100
        state.push(market.whaleRisk ? 1 : 0);
        state.push(market.coordinatedBuying / 100); // Already 0-100

        // Portfolio features (4)
        state.push(portfolio.capitalUtilization / 100); // Already 0-100
        state.push(Math.min(portfolio.openPositions / 10, 1)); // Max 10 positions
        state.push(portfolio.winRate / 100); // Already 0-100
        state.push(Math.min(portfolio.currentDrawdown / 50, 1)); // Max 50% drawdown

        // Position features (3)
        state.push(position.hasPosition ? 1 : 0);
        state.push(this.normalizePnL(position.pnlPercent));
        state.push(this.normalizeTime(position.timeInPositionMs));

        return state;
    }

    /**
     * Normalize liquidity (0 to 100k USD)
     */
    private normalizeLiquidity(liquidity: number): number {
        return Math.min(liquidity / 100000, 1);
    }

    /**
     * Normalize buyers (0 to 100)
     */
    private normalizeBuyers(buyers: number): number {
        return Math.min(buyers / 100, 1);
    }

    /**
     * Normalize age (0 to 1 hour)
     */
    private normalizeAge(ageMs: number): number {
        return Math.min(ageMs / (60 * 60 * 1000), 1);
    }

    /**
     * Normalize FDV (0 to 1M USD)
     */
    private normalizeFDV(fdv: number): number {
        return Math.min(fdv / 1000000, 1);
    }

    /**
     * Normalize volatility (0 to 100%)
     */
    private normalizeVolatility(volatility: number): number {
        return Math.min(volatility / 100, 1);
    }

    /**
     * Normalize P/L (-100% to +200%)
     */
    private normalizePnL(pnlPercent: number): number {
        // Map -100 to +200 → 0 to 1
        return Math.max(0, Math.min((pnlPercent + 100) / 300, 1));
    }

    /**
     * Normalize time in position (0 to 24 hours)
     */
    private normalizeTime(timeMs: number): number {
        return Math.min(timeMs / (24 * 60 * 60 * 1000), 1);
    }

    /**
     * Get state dimension
     */
    getStateDimension(): number {
        return 15;
    }
}
