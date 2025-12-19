// src/portfolio/rebalancing.ts

/**
 * Portfolio Rebalancing System
 * Optimizes capital allocation across positions
 */

import { Connection, Keypair } from "@solana/web3.js";
import { logger } from "../logger";
import { getOpenPositions, getAllPositions, Position } from "../state/positions";
import { getRiskScoringSystem } from "../risk/riskScoringSystem";
import { DexRouter } from "../execution/dexRouter";

export type RebalanceStrategy = 'EQUAL_WEIGHT' | 'RISK_PARITY' | 'DYNAMIC' | 'MOMENTUM';

export interface PositionAllocation {
    tokenAddress: string;
    currentWeight: number; // Current % of portfolio
    targetWeight: number; // Target % of portfolio
    currentValue: number; // Current value in SOL
    targetValue: number; // Target value in SOL
    adjustment: number; // Amount to buy/sell in SOL
    action: 'BUY' | 'SELL' | 'HOLD';
}

export interface RebalanceRecommendation {
    strategy: RebalanceStrategy;
    totalPortfolioValue: number; // in SOL
    positions: PositionAllocation[];
    estimatedCost: number; // Transaction fees
    expectedImprovement: string;
    shouldRebalance: boolean;
    reason: string;
    timestamp: number;
}

export interface RebalanceConfig {
    strategy: RebalanceStrategy;
    minRebalanceThreshold: number; // Minimum deviation % to trigger rebalance
    maxPositionWeight: number; // Maximum % per position
    minPositionWeight: number; // Minimum % per position
    targetPositions: number; // Target number of positions
    rebalanceInterval: number; // Minimum time between rebalances (ms)
}

export class PortfolioRebalancer {
    private connection: Connection;
    private config: RebalanceConfig;
    private lastRebalance: number = 0;
    private dexRouter: DexRouter | null = null;

    constructor(connection: Connection, config?: Partial<RebalanceConfig>, keypair?: Keypair) {
        this.connection = connection;
        this.config = {
            strategy: config?.strategy || 'RISK_PARITY',
            minRebalanceThreshold: config?.minRebalanceThreshold || 5, // 5%
            maxPositionWeight: config?.maxPositionWeight || 25, // 25%
            minPositionWeight: config?.minPositionWeight || 5, // 5%
            targetPositions: config?.targetPositions || 5,
            rebalanceInterval: config?.rebalanceInterval || 24 * 60 * 60 * 1000, // 24 hours
        };

        if (keypair) {
            this.dexRouter = new DexRouter(connection, keypair);
        }
    }

    /**
     * Analyze portfolio and generate rebalancing recommendation
     */
    async analyzeRebalancing(): Promise<RebalanceRecommendation> {
        logger.info('[Rebalancing] Analyzing portfolio...');

        const openPositions = getOpenPositions();

        if (openPositions.length === 0) {
            return {
                strategy: this.config.strategy,
                totalPortfolioValue: 0,
                positions: [],
                estimatedCost: 0,
                expectedImprovement: 'No positions to rebalance',
                shouldRebalance: false,
                reason: 'Portfolio is empty',
                timestamp: Date.now(),
            };
        }

        // Calculate total portfolio value
        const totalValue = this.calculateTotalValue(openPositions);

        // Calculate target allocations based on strategy
        const allocations = await this.calculateTargetAllocations(
            openPositions,
            totalValue
        );

        // Determine if rebalancing is needed
        const { shouldRebalance, reason } = this.shouldRebalance(allocations);

        // Estimate transaction costs
        const estimatedCost = this.estimateRebalanceCost(allocations);

        // Calculate expected improvement
        const expectedImprovement = this.calculateExpectedImprovement(allocations);

        const recommendation: RebalanceRecommendation = {
            strategy: this.config.strategy,
            totalPortfolioValue: totalValue,
            positions: allocations,
            estimatedCost,
            expectedImprovement,
            shouldRebalance,
            reason,
            timestamp: Date.now(),
        };

        logger.info(
            `[Rebalancing] Analysis complete. ` +
            `Should rebalance: ${shouldRebalance}, ` +
            `Reason: ${reason}`
        );

        return recommendation;
    }

    /**
     * Calculate total portfolio value
     */
    private calculateTotalValue(positions: Position[]): number {
        return positions.reduce((sum, pos) => {
            // Use buy amount as current value (simplified)
            // In production, you'd fetch current market value
            return sum + (pos.buyAmountLamports / 1e9);
        }, 0);
    }

    /**
     * Calculate target allocations based on strategy
     */
    private async calculateTargetAllocations(
        positions: Position[],
        totalValue: number
    ): Promise<PositionAllocation[]> {
        switch (this.config.strategy) {
            case 'EQUAL_WEIGHT':
                return this.calculateEqualWeight(positions, totalValue);
            case 'RISK_PARITY':
                return await this.calculateRiskParity(positions, totalValue);
            case 'DYNAMIC':
                return await this.calculateDynamic(positions, totalValue);
            case 'MOMENTUM':
                return this.calculateMomentum(positions, totalValue);
            default:
                return this.calculateEqualWeight(positions, totalValue);
        }
    }

    /**
     * Equal weight strategy - distribute equally
     */
    private calculateEqualWeight(
        positions: Position[],
        totalValue: number
    ): PositionAllocation[] {
        const targetWeight = 100 / positions.length;

        return positions.map(pos => {
            const currentValue = pos.buyAmountLamports / 1e9;
            const currentWeight = (currentValue / totalValue) * 100;
            const targetValue = (targetWeight / 100) * totalValue;
            const adjustment = targetValue - currentValue;

            return {
                tokenAddress: pos.baseMint,
                currentWeight,
                targetWeight,
                currentValue,
                targetValue,
                adjustment,
                action: this.determineAction(adjustment),
            };
        });
    }

    /**
     * Risk parity strategy - allocate based on inverse risk
     */
    private async calculateRiskParity(
        positions: Position[],
        totalValue: number
    ): Promise<PositionAllocation[]> {
        const riskScoring = getRiskScoringSystem(this.connection);

        // Calculate risk scores for all positions
        const positionsWithRisk = await Promise.all(
            positions.map(async (pos) => {
                try {
                    const riskScore = await riskScoring.calculateRisk(pos.baseMint, pos.pool);
                    return {
                        position: pos,
                        riskScore: riskScore.overall,
                    };
                } catch (error) {
                    logger.error(`[Rebalancing] Error calculating risk for ${pos.baseMint}: ${error}`);
                    return {
                        position: pos,
                        riskScore: 50, // Default medium risk
                    };
                }
            })
        );

        // Calculate inverse risk weights (lower risk = higher allocation)
        const inverseRisks = positionsWithRisk.map(p => 100 - p.riskScore);
        const totalInverseRisk = inverseRisks.reduce((sum, r) => sum + r, 0);

        return positionsWithRisk.map((item, index) => {
            const pos = item.position;
            const currentValue = pos.buyAmountLamports / 1e9;
            const currentWeight = (currentValue / totalValue) * 100;

            // Weight based on inverse risk
            const targetWeight = Math.min(
                (inverseRisks[index] / totalInverseRisk) * 100,
                this.config.maxPositionWeight
            );

            const targetValue = (targetWeight / 100) * totalValue;
            const adjustment = targetValue - currentValue;

            return {
                tokenAddress: pos.baseMint,
                currentWeight,
                targetWeight,
                currentValue,
                targetValue,
                adjustment,
                action: this.determineAction(adjustment),
            };
        });
    }

    /**
     * Dynamic strategy - based on performance and risk
     */
    private async calculateDynamic(
        positions: Position[],
        totalValue: number
    ): Promise<PositionAllocation[]> {
        const riskScoring = getRiskScoringSystem(this.connection);

        // Calculate scores combining performance and risk
        const positionsWithScores = await Promise.all(
            positions.map(async (pos) => {
                try {
                    const riskScore = await riskScoring.calculateRisk(pos.baseMint, pos.pool);

                    // Calculate performance score
                    const pnl = pos.realizedPnlQuote || 0;
                    const performanceScore = pnl > 0 ? 70 : 30; // Simplified

                    // Combined score (60% performance, 40% inverse risk)
                    const combinedScore =
                        (performanceScore * 0.6) +
                        ((100 - riskScore.overall) * 0.4);

                    return {
                        position: pos,
                        score: combinedScore,
                    };
                } catch (error) {
                    logger.error(`[Rebalancing] Error calculating score for ${pos.baseMint}: ${error}`);
                    return {
                        position: pos,
                        score: 50,
                    };
                }
            })
        );

        const totalScore = positionsWithScores.reduce((sum, p) => sum + p.score, 0);

        return positionsWithScores.map(item => {
            const pos = item.position;
            const currentValue = pos.buyAmountLamports / 1e9;
            const currentWeight = (currentValue / totalValue) * 100;

            const targetWeight = Math.min(
                (item.score / totalScore) * 100,
                this.config.maxPositionWeight
            );

            const targetValue = (targetWeight / 100) * totalValue;
            const adjustment = targetValue - currentValue;

            return {
                tokenAddress: pos.baseMint,
                currentWeight,
                targetWeight,
                currentValue,
                targetValue,
                adjustment,
                action: this.determineAction(adjustment),
            };
        });
    }

    /**
     * Momentum strategy - favor recent winners
     */
    private calculateMomentum(
        positions: Position[],
        totalValue: number
    ): Promise<PositionAllocation[]> {
        // Calculate momentum scores based on recent P&L
        const positionsWithMomentum = positions.map(pos => {
            const pnl = pos.realizedPnlQuote || 0;
            const momentum = pnl > 0 ? 70 : 30; // Simplified momentum

            return {
                position: pos,
                momentum,
            };
        });

        const totalMomentum = positionsWithMomentum.reduce((sum, p) => sum + p.momentum, 0);

        const allocations = positionsWithMomentum.map(item => {
            const pos = item.position;
            const currentValue = pos.buyAmountLamports / 1e9;
            const currentWeight = (currentValue / totalValue) * 100;

            const targetWeight = Math.min(
                (item.momentum / totalMomentum) * 100,
                this.config.maxPositionWeight
            );

            const targetValue = (targetWeight / 100) * totalValue;
            const adjustment = targetValue - currentValue;

            return {
                tokenAddress: pos.baseMint,
                currentWeight,
                targetWeight,
                currentValue,
                targetValue,
                adjustment,
                action: this.determineAction(adjustment),
            };
        });

        return Promise.resolve(allocations);
    }

    /**
     * Determine action based on adjustment amount
     */
    private determineAction(adjustment: number): 'BUY' | 'SELL' | 'HOLD' {
        const threshold = 0.01; // 0.01 SOL threshold

        if (Math.abs(adjustment) < threshold) {
            return 'HOLD';
        }

        return adjustment > 0 ? 'BUY' : 'SELL';
    }

    /**
     * Check if rebalancing is needed
     */
    private shouldRebalance(allocations: PositionAllocation[]): {
        shouldRebalance: boolean;
        reason: string;
    } {
        // Check if enough time has passed
        const timeSinceLastRebalance = Date.now() - this.lastRebalance;
        if (timeSinceLastRebalance < this.config.rebalanceInterval) {
            return {
                shouldRebalance: false,
                reason: `Too soon since last rebalance (${Math.round(timeSinceLastRebalance / 1000 / 60)} minutes ago)`,
            };
        }

        // Check if any position deviates significantly
        const significantDeviations = allocations.filter(alloc => {
            const deviation = Math.abs(alloc.currentWeight - alloc.targetWeight);
            return deviation > this.config.minRebalanceThreshold;
        });

        if (significantDeviations.length === 0) {
            return {
                shouldRebalance: false,
                reason: 'All positions within target range',
            };
        }

        // Check if any position violates constraints
        const violations = allocations.filter(alloc =>
            alloc.currentWeight > this.config.maxPositionWeight ||
            alloc.currentWeight < this.config.minPositionWeight
        );

        if (violations.length > 0) {
            return {
                shouldRebalance: true,
                reason: `${violations.length} position(s) violate weight constraints`,
            };
        }

        return {
            shouldRebalance: true,
            reason: `${significantDeviations.length} position(s) deviate by >${this.config.minRebalanceThreshold}%`,
        };
    }

    /**
     * Estimate cost of rebalancing
     */
    private estimateRebalanceCost(allocations: PositionAllocation[]): number {
        const transactionsNeeded = allocations.filter(
            alloc => alloc.action !== 'HOLD'
        ).length;

        // Estimate 0.000005 SOL per transaction (Solana fee)
        const baseFee = 0.000005;

        // Add slippage estimate (0.1% of trade value)
        const slippageCost = allocations.reduce((sum, alloc) => {
            if (alloc.action === 'HOLD') return sum;
            return sum + (Math.abs(alloc.adjustment) * 0.001);
        }, 0);

        return (transactionsNeeded * baseFee) + slippageCost;
    }

    /**
     * Calculate expected improvement from rebalancing
     */
    private calculateExpectedImprovement(allocations: PositionAllocation[]): string {
        const totalDeviation = allocations.reduce((sum, alloc) => {
            return sum + Math.abs(alloc.currentWeight - alloc.targetWeight);
        }, 0);

        const avgDeviation = totalDeviation / allocations.length;

        if (avgDeviation < 2) {
            return 'Minimal improvement expected';
        } else if (avgDeviation < 5) {
            return 'Moderate improvement in risk distribution';
        } else if (avgDeviation < 10) {
            return 'Significant improvement in portfolio balance';
        } else {
            return 'Major improvement in risk-adjusted returns';
        }
    }

    /**
     * Execute rebalancing
     */
    async executeRebalancing(recommendation: RebalanceRecommendation): Promise<boolean> {
        if (!recommendation.shouldRebalance) {
            logger.info('[Rebalancing] Skipping - not needed');
            return false;
        }

        if (!this.dexRouter) {
            logger.warn('[Rebalancing] Cannot execute - trading keypair not provided');
            return false;
        }

        logger.info('[Rebalancing] Executing rebalancing...');

        try {
            // Sort by action - SELL first, then BUY
            const sells = recommendation.positions.filter(p => p.action === 'SELL');
            const buys = recommendation.positions.filter(p => p.action === 'BUY');

            // Execute sells first to free up capital
            for (const position of sells) {
                const amountSol = Math.abs(position.adjustment);
                logger.info(
                    `[Rebalancing] SELL ~${amountSol.toFixed(4)} SOL worth ` +
                    `of ${position.tokenAddress.slice(0, 8)}...`
                );

                // Convert SOL value to approx token amount (using currentValue which is in SOL)
                // tokenAmount = (adjustment_in_sol / current_value_in_sol) * total_token_balance
                // For simplicity, we can fetch balance or use position data.
                // Assuming we want to sell proportional amount:
                // amountToSell = totalTokens * (adjustment_sol / total_value_sol)
                // Need to fetch current position token balance.

                // For now, construct a minimal object for router (assuming router handles details or we do)
                const tokenForSell = {
                    mint: position.tokenAddress,
                    dex: 'PUMPSWAP', // Default to PumpSwap for now, or infer from somewhere
                    metadata: { symbol: 'UNKNOWN' }
                };

                // Note: Router executeSell expects TOKEN amount, but we have SOL value adjustment.
                // We need to estimate token amount.
                // Approximation: if pos has X tokens worth Y SOL, and we want to sell Z SOL worth.
                // Tokens to sell = X * (Z / Y)

                // Find original position to get token quantity
                const originalPos = getOpenPositions().find(p => p.baseMint === position.tokenAddress);
                if (!originalPos) continue;

                const ratio = amountSol / position.currentValue;
                const tokenAmountToSell = (originalPos.tokenAmount || 0) * ratio; // Assuming tokenAmount is tracked in position

                await this.dexRouter.executeSell(tokenForSell as any, tokenAmountToSell);
                await new Promise(r => setTimeout(r, 2000)); // Delay between trades
            }

            // Execute buys
            for (const position of buys) {
                const amountSol = position.adjustment;
                logger.info(
                    `[Rebalancing] BUY ${amountSol.toFixed(4)} SOL ` +
                    `of ${position.tokenAddress.slice(0, 8)}...`
                );

                const tokenForBuy = {
                    mint: position.tokenAddress,
                    dex: 'PUMPSWAP',
                    metadata: { symbol: 'UNKNOWN' }
                };

                await this.dexRouter.executeBuy(tokenForBuy as any, amountSol);
                await new Promise(r => setTimeout(r, 2000)); // Delay between trades
            }

            this.lastRebalance = Date.now();
            logger.info('[Rebalancing] Rebalancing complete!');

            return true;
        } catch (error) {
            logger.error(`[Rebalancing] Error executing: ${error}`);
            return false;
        }
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<RebalanceConfig>): void {
        this.config = { ...this.config, ...config };
        logger.info('[Rebalancing] Configuration updated:', this.config);
    }

    /**
     * Get current configuration
     */
    getConfig(): RebalanceConfig {
        return { ...this.config };
    }
}

// Singleton instance
let rebalancerInstance: PortfolioRebalancer | null = null;

export function getPortfolioRebalancer(
    connection?: Connection,
    config?: Partial<RebalanceConfig>,
    keypair?: Keypair
): PortfolioRebalancer {
    if (!rebalancerInstance) {
        // Allow tests to call without a real Connection by providing a stub
        const conn = connection ?? ({} as unknown as Connection);
        rebalancerInstance = new PortfolioRebalancer(conn, config, keypair);
    }
    return rebalancerInstance;
}
