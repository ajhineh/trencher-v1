/**
 * Dynamic Risk Thresholds
 * Adjusts security parameters based on token age
 * Newer tokens = stricter rules. Older tokens = more lenient
 */

import { logger } from '../logger';

export interface DynamicThresholds {
  minLiquidityUSD: number; // Minimum liquidity in USD
  maxWhalePercentSingle: number; // Max % for single holder
  maxWhalePercentTop5: number; // Max % for top 5 holders
  minBuyersInWindow: number; // Minimum buyers in recent period
  maxSlippagePercent: number; // Maximum acceptable slippage
  honeypotSuspicionLevel: 'STRICT' | 'NORMAL' | 'LENIENT'; // Honeypot detection sensitivity
  requiresLPLock: boolean; // Whether LP lock is required
  minLPLockDays: number; // Minimum lock duration in days
  maxCreatorRugHistoryCount: number; // Max previous rugs for creator
  sellSimulationRequired: boolean; // Whether to simulate sells
  confidenceRequired: number; // Minimum confidence score (0-100)
  riskScoreThreshold: number; // Max security risk score (0-100)
  description: string;
}

// Phase of token age
type TokenAge = 'BRAND_NEW' | 'VERY_EARLY' | 'EARLY' | 'MATURE' | 'OLD';

/**
 * Determine token age phase from creation time
 */
function getTokenAgePhase(tokenCreationMs: number): TokenAge {
  const ageMs = Date.now() - tokenCreationMs;
  const ageMinutes = ageMs / (1000 * 60);

  if (ageMinutes < 1) return 'BRAND_NEW'; // < 1 minute
  if (ageMinutes < 5) return 'VERY_EARLY'; // < 5 minutes
  if (ageMinutes < 30) return 'EARLY'; // < 30 minutes
  if (ageMinutes < 24 * 60) return 'MATURE'; // < 24 hours
  return 'OLD'; // > 24 hours
}

/**
 * Get dynamic thresholds based on token age
 * More lenient for older tokens, stricter for brand new ones
 */
export function getDynamicThresholds(
  tokenCreationMs: number,
  overrides?: Partial<DynamicThresholds>
): DynamicThresholds {
  const agePhase = getTokenAgePhase(tokenCreationMs);
  const ageMinutes = (Date.now() - tokenCreationMs) / (1000 * 60);

  logger.info(
    `[THRESHOLDS] Token age: ${ageMinutes.toFixed(1)} min (${agePhase}) - Adjusting thresholds`
  );

  // Base thresholds - will be overridden per age phase
  let thresholds: DynamicThresholds = {
    minLiquidityUSD: 10000,
    maxWhalePercentSingle: 20,
    maxWhalePercentTop5: 50,
    minBuyersInWindow: 10,
    maxSlippagePercent: 50,
    honeypotSuspicionLevel: 'NORMAL',
    requiresLPLock: true,
    minLPLockDays: 30,
    maxCreatorRugHistoryCount: 0,
    sellSimulationRequired: true,
    confidenceRequired: 70,
    riskScoreThreshold: 50,
    description: 'DEFAULT'
  };

  // BRAND NEW: < 1 minute (MOST RISKY - PUMP PHASE)
  if (agePhase === 'BRAND_NEW') {
    thresholds = {
      minLiquidityUSD: 50000, // High liquidity requirement
      maxWhalePercentSingle: 10, // Very strict whale limits
      maxWhalePercentTop5: 30,
      minBuyersInWindow: 50, // Many buyers required
      maxSlippagePercent: 20, // Low slippage tolerance
      honeypotSuspicionLevel: 'STRICT', // Maximum sensitivity
      requiresLPLock: true,
      minLPLockDays: 90, // Require 3-month lock minimum
      maxCreatorRugHistoryCount: 0, // NO previous rug tokens allowed
      sellSimulationRequired: true, // Always test sells
      confidenceRequired: 90, // Very high confidence needed
      riskScoreThreshold: 25, // Very restrictive
      description: `BRAND_NEW (< 1 min): PUMP phase - maximum restrictions`
    };
  }

  // VERY EARLY: 1-5 minutes (VERY RISKY)
  else if (agePhase === 'VERY_EARLY') {
    thresholds = {
      minLiquidityUSD: 30000,
      maxWhalePercentSingle: 12,
      maxWhalePercentTop5: 35,
      minBuyersInWindow: 30,
      maxSlippagePercent: 25,
      honeypotSuspicionLevel: 'STRICT',
      requiresLPLock: true,
      minLPLockDays: 60,
      maxCreatorRugHistoryCount: 0,
      sellSimulationRequired: true,
      confidenceRequired: 85,
      riskScoreThreshold: 30,
      description: `VERY_EARLY (1-5 min): Early pump - strict checks`
    };
  }

  // EARLY: 5-30 minutes (HIGH RISK - GROWTH PHASE)
  else if (agePhase === 'EARLY') {
    thresholds = {
      minLiquidityUSD: 15000,
      maxWhalePercentSingle: 15,
      maxWhalePercentTop5: 40,
      minBuyersInWindow: 20,
      maxSlippagePercent: 35,
      honeypotSuspicionLevel: 'STRICT',
      requiresLPLock: true,
      minLPLockDays: 30,
      maxCreatorRugHistoryCount: 0,
      sellSimulationRequired: true,
      confidenceRequired: 80,
      riskScoreThreshold: 35,
      description: `EARLY (5-30 min): Growth phase - enhanced caution`
    };
  }

  // MATURE: 30 min - 24 hours (MODERATE RISK)
  else if (agePhase === 'MATURE') {
    thresholds = {
      minLiquidityUSD: 5000, // More lenient
      maxWhalePercentSingle: 20,
      maxWhalePercentTop5: 50,
      minBuyersInWindow: 10,
      maxSlippagePercent: 50,
      honeypotSuspicionLevel: 'NORMAL', // Normal sensitivity
      requiresLPLock: true,
      minLPLockDays: 14, // 2-week minimum
      maxCreatorRugHistoryCount: 1, // Allow one previous rug
      sellSimulationRequired: true,
      confidenceRequired: 70,
      riskScoreThreshold: 50,
      description: `MATURE (30min-24h): Settling phase - standard rules`
    };
  }

  // OLD: > 24 hours (LOW RISK - ESTABLISHED)
  else {
    thresholds = {
      minLiquidityUSD: 2000, // Lower requirement
      maxWhalePercentSingle: 25, // More lenient
      maxWhalePercentTop5: 60,
      minBuyersInWindow: 5,
      maxSlippagePercent: 75,
      honeypotSuspicionLevel: 'LENIENT', // Less strict
      requiresLPLock: false, // Optional lock
      minLPLockDays: 0,
      maxCreatorRugHistoryCount: 5, // More tolerance
      sellSimulationRequired: false, // Optional sell test
      confidenceRequired: 50, // Lower threshold
      riskScoreThreshold: 75, // More lenient
      description: `OLD (> 24h): Established token - standard/lenient rules`
    };
  }

  // Apply any user overrides
  if (overrides) {
    thresholds = { ...thresholds, ...overrides };
  }

  logger.info(`[THRESHOLDS] Applied: ${thresholds.description}`);

  return thresholds;
}

/**
 * Get comprehensive risk evaluation based on dynamic thresholds
 */
export function evaluateTokenWithDynamicThresholds(tokenData: {
  mintAddress: string;
  createdAtMs: number;
  liquidityUSD: number;
  topHolderPercent: number;
  top5HolderPercent: number;
  buyerCountLast5Min: number;
  slippagePercent: number;
  isHoneypot: boolean;
  securityRiskScore: number; // 0-100
  lpLocked: boolean;
  lpLockDaysRemaining: number;
  creatorRugCount: number;
}): {
  isApproved: boolean;
  overallRisk: number; // 0-100
  failedChecks: string[];
  passedChecks: string[];
  recommendations: string;
} {
  const thresholds = getDynamicThresholds(tokenData.createdAtMs);

  const failedChecks: string[] = [];
  const passedChecks: string[] = [];

  // 1. Liquidity check
  if (tokenData.liquidityUSD < thresholds.minLiquidityUSD) {
    failedChecks.push(
      `Liquidity too low: $${tokenData.liquidityUSD} < $${thresholds.minLiquidityUSD}`
    );
  } else {
    passedChecks.push(`Liquidity sufficient: $${tokenData.liquidityUSD}`);
  }

  // 2. Whale concentration checks
  if (tokenData.topHolderPercent > thresholds.maxWhalePercentSingle) {
    failedChecks.push(
      `Single holder too large: ${tokenData.topHolderPercent}% > ${thresholds.maxWhalePercentSingle}%`
    );
  } else {
    passedChecks.push(`Single holder acceptable: ${tokenData.topHolderPercent}%`);
  }

  if (tokenData.top5HolderPercent > thresholds.maxWhalePercentTop5) {
    failedChecks.push(
      `Top 5 holders too large: ${tokenData.top5HolderPercent}% > ${thresholds.maxWhalePercentTop5}%`
    );
  } else {
    passedChecks.push(`Top 5 holders acceptable: ${tokenData.top5HolderPercent}%`);
  }

  // 3. Buyer diversity
  if (tokenData.buyerCountLast5Min < thresholds.minBuyersInWindow) {
    failedChecks.push(
      `Insufficient buyers: ${tokenData.buyerCountLast5Min} < ${thresholds.minBuyersInWindow}`
    );
  } else {
    passedChecks.push(`Buyer count adequate: ${tokenData.buyerCountLast5Min}`);
  }

  // 4. Slippage check
  if (tokenData.slippagePercent > thresholds.maxSlippagePercent) {
    failedChecks.push(
      `Slippage too high: ${tokenData.slippagePercent}% > ${thresholds.maxSlippagePercent}%`
    );
  } else {
    passedChecks.push(`Slippage acceptable: ${tokenData.slippagePercent}%`);
  }

  // 5. Honeypot check
  if (tokenData.isHoneypot && thresholds.honeypotSuspicionLevel !== 'LENIENT') {
    failedChecks.push('Detected as honeypot');
  } else if (!tokenData.isHoneypot) {
    passedChecks.push('Not a honeypot');
  }

  // 6. Security risk score
  if (tokenData.securityRiskScore > thresholds.riskScoreThreshold) {
    failedChecks.push(
      `Security risk too high: ${tokenData.securityRiskScore} > ${thresholds.riskScoreThreshold}`
    );
  } else {
    passedChecks.push(`Security check passed: ${tokenData.securityRiskScore}`);
  }

  // 7. LP lock check
  if (thresholds.requiresLPLock && !tokenData.lpLocked) {
    failedChecks.push(`LP not locked (required for ${thresholds.minLPLockDays}+ days)`);
  } else if (
    thresholds.requiresLPLock &&
    tokenData.lpLockDaysRemaining < thresholds.minLPLockDays
  ) {
    failedChecks.push(
      `LP lock too short: ${tokenData.lpLockDaysRemaining} < ${thresholds.minLPLockDays} days`
    );
  } else if (!thresholds.requiresLPLock || tokenData.lpLocked) {
    passedChecks.push(`LP lock status acceptable`);
  }

  // 8. Creator history
  if (tokenData.creatorRugCount > thresholds.maxCreatorRugHistoryCount) {
    failedChecks.push(
      `Creator has too many previous rugs: ${tokenData.creatorRugCount} > ${thresholds.maxCreatorRugHistoryCount}`
    );
  } else {
    passedChecks.push(`Creator history acceptable`);
  }

  // Calculate overall risk
  let overallRisk = tokenData.securityRiskScore;

  // Adjust based on age phase for additional risk
  const agePhase = getTokenAgePhase(tokenData.createdAtMs);
  if (agePhase === 'BRAND_NEW') {
    overallRisk = Math.min(95, overallRisk + 15); // Brand new adds risk
  } else if (agePhase === 'VERY_EARLY') {
    overallRisk = Math.min(90, overallRisk + 10);
  }

  const isApproved = failedChecks.length === 0;

  let recommendations = '';
  if (isApproved) {
    if (agePhase === 'BRAND_NEW' || agePhase === 'VERY_EARLY') {
      recommendations =
        '✅ APPROVED but RISKY: Small position recommended (pump phase - exit target 3-5x)';
    } else if (agePhase === 'EARLY') {
      recommendations = '✅ APPROVED: Standard position size acceptable';
    } else {
      recommendations = '✅ APPROVED: Established token - normal trading rules apply';
    }
  } else {
    recommendations = `❌ REJECTED: ${failedChecks.length} checks failed\n${failedChecks.map(c => `  • ${c}`).join('\n')}`;
  }

  return {
    isApproved,
    overallRisk,
    failedChecks,
    passedChecks,
    recommendations
  };
}

/**
 * Get threshold summary for logging/debugging
 */
export function getThresholdsSummary(tokenCreationMs: number): string {
  const thresholds = getDynamicThresholds(tokenCreationMs);

  return `
📊 DYNAMIC THRESHOLDS: ${thresholds.description}
  • Min Liquidity: $${thresholds.minLiquidityUSD}
  • Max Single Holder: ${thresholds.maxWhalePercentSingle}%
  • Max Top 5: ${thresholds.maxWhalePercentTop5}%
  • Min Buyers: ${thresholds.minBuyersInWindow}
  • Max Slippage: ${thresholds.maxSlippagePercent}%
  • Honeypot Detection: ${thresholds.honeypotSuspicionLevel}
  • LP Lock Required: ${thresholds.requiresLPLock ? `Yes (${thresholds.minLPLockDays} days)` : 'No'}
  • Risk Score Limit: ${thresholds.riskScoreThreshold}/100
  `;
}

// DynamicThresholds exported via declaration above
