// src/rl/rewardCalculator.ts

/**
 * Reward Calculator - Computes rewards for RL agent
 */

export type Action = 'IGNORE' | 'BUY' | 'SELL';

export interface TradeOutcome {
    action: Action;
    pnlPercent?: number;
    pnlSol?: number;
    timeHeld?: number; // hours
    hitTP?: boolean;
    hitSL?: boolean;
}

export class RewardCalculator {
    /**
     * Calculate reward for an action and its outcome
     */
    calculateReward(action: Action, outcome: TradeOutcome): number {
        switch (action) {
            case 'BUY':
                return this.calculateBuyReward(outcome);
            case 'SELL':
                return this.calculateSellReward(outcome);
            case 'IGNORE':
                return this.calculateIgnoreReward(outcome);
            default:
                return 0;
        }
    }

    /**
     * Calculate reward for BUY action
     */
    private calculateBuyReward(outcome: TradeOutcome): number {
        // Immediate small penalty for using capital
        let reward = -0.01;

        // If trade completed, add P/L-based reward
        if (outcome.pnlPercent !== undefined) {
            // Scale P/L to reward
            reward += (outcome.pnlPercent / 100) * 10;

            // Bonus for hitting TP
            if (outcome.hitTP) {
                reward += 0.5;
            }

            // Penalty for hitting SL
            if (outcome.hitSL) {
                reward -= 0.3;
            }

            // Penalty for holding too long without profit
            if (outcome.timeHeld && outcome.timeHeld > 12 && outcome.pnlPercent < 10) {
                reward -= 0.2;
            }

            // Bonus for quick profitable exits
            if (outcome.timeHeld && outcome.timeHeld < 2 && outcome.pnlPercent > 20) {
                reward += 0.3;
            }
        }

        return reward;
    }

    /**
     * Calculate reward for SELL action
     */
    private calculateSellReward(outcome: TradeOutcome): number {
        if (outcome.pnlPercent === undefined) {
            return 0; // No position to sell
        }

        // Reward based on P/L
        let reward = (outcome.pnlPercent / 100) * 10;

        // Bonus for profitable exit
        if (outcome.pnlPercent > 0) {
            reward += 0.2;
        }

        return reward;
    }

    /**
     * Calculate reward for IGNORE action
     */
    private calculateIgnoreReward(outcome: TradeOutcome): number {
        // Neutral reward
        let reward = 0;

        // Small penalty if we missed a very profitable opportunity
        // (This would require knowing the actual outcome, which we don't have in real-time)
        // For now, keep it neutral
        if (outcome.pnlPercent && outcome.pnlPercent > 50) {
            reward = -0.001; // Tiny opportunity cost
        }

        return reward;
    }

    /**
     * Calculate shaped reward with additional heuristics
     */
    calculateShapedReward(
        action: Action,
        outcome: TradeOutcome,
        portfolioWinRate: number,
        capitalUtilization: number
    ): number {
        let reward = this.calculateReward(action, outcome);

        // Encourage trading when win rate is high
        if (action === 'BUY' && portfolioWinRate > 70) {
            reward += 0.1;
        }

        // Discourage trading when capital is over-utilized
        if (action === 'BUY' && capitalUtilization > 80) {
            reward -= 0.2;
        }

        // Encourage IGNORE when capital is very high
        if (action === 'IGNORE' && capitalUtilization > 90) {
            reward += 0.1;
        }

        return reward;
    }
}
