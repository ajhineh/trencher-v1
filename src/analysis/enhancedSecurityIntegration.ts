/**
 * Enhanced Security Checks Integration
 * Combines all rug pull prevention mechanisms into unified security scoring system
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';
import { checkHoneypot, comprehensiveHoneypotCheck } from './honeypotDetector';
import { checkLiquidityLock, comprehensiveLiquidityAnalysis } from './lockDetection';
import {
  analyzeHolderSellingActivity,
  calculateHolderActivityRiskScore,
  detectCoordinatedDumping
} from './holderActivityTracker';
import { getDynamicThresholds, evaluateTokenWithDynamicThresholds } from '../risk/dynamicThresholds';
import {
  isTokenBlacklisted,
  checkCreatorReputation,
  comprehensiveBlacklistCheck,
  loadBlacklistDatabase
} from '../risk/rugPullBlacklist';

export interface EnhancedSecurityCheckResult {
  overallRiskScore: number; // 0-100
  isApproved: boolean;
  recommendations: string;
  detailedAnalysis: {
    honeypotCheck: any;
    lockCheck: any;
    holderActivityCheck: any;
    blacklistCheck: any;
    dynamicThresholdEvaluation: any;
  };
  flags: string[];
  timestamp: Date;
}

/**
 * Run comprehensive enhanced security checks for a token
 * Integrates all detection mechanisms
 */
export async function runEnhancedSecurityChecksV2(
  connection: Connection,
  tokenData: {
    mintAddress: string;
    creatorAddress: string;
    createdAtMs: number;
    liquidityUSD: number;
    topHolderPercent: number;
    top5HolderPercent: number;
    buyerCountLast5Min: number;
    slippagePercent: number;
    securityRiskScore: number; // From original security-checks.ts
    metadata?: any;
    topHolders?: Array<{
      address: string;
      balance: number;
      percentageOfSupply: number;
    }>;
  }
): Promise<EnhancedSecurityCheckResult> {
  const result: EnhancedSecurityCheckResult = {
    overallRiskScore: tokenData.securityRiskScore,
    isApproved: false,
    recommendations: '',
    detailedAnalysis: {
      honeypotCheck: null,
      lockCheck: null,
      holderActivityCheck: null,
      blacklistCheck: null,
      dynamicThresholdEvaluation: null
    },
    flags: [],
    timestamp: new Date()
  };

  try {
    logger.info(
      `[ENHANCED-SECURITY] Starting comprehensive check for ${tokenData.mintAddress}...`
    );

    // Load blacklist database
    loadBlacklistDatabase();

    // 1. BLACKLIST CHECK (fastest - do first)
    logger.info('[ENHANCED-SECURITY] Running blacklist check...');
    const blacklistCheck = comprehensiveBlacklistCheck({
      mintAddress: tokenData.mintAddress,
      creatorAddress: tokenData.creatorAddress,
      buyerAddresses: tokenData.topHolders?.map(h => h.address)
    });

    result.detailedAnalysis.blacklistCheck = blacklistCheck;
    result.overallRiskScore = Math.max(result.overallRiskScore, blacklistCheck.overallRisk);

    if (!blacklistCheck.isApproved) {
      result.flags.push(...blacklistCheck.flags);
      logger.warn(`[ENHANCED-SECURITY] ❌ Blacklist check failed: ${blacklistCheck.recommendation}`);

      if (blacklistCheck.overallRisk >= 80) {
        // Critical - reject immediately
        result.isApproved = false;
        result.recommendations = blacklistCheck.recommendation;
        return result;
      }
    }

    // 2. HONEYPOT CHECK (important for sell ability)
    logger.info('[ENHANCED-SECURITY] Running honeypot detection...');
    try {
      const honeypotCheck = await comprehensiveHoneypotCheck(
        connection,
        tokenData.mintAddress,
        tokenData.metadata
      );

      result.detailedAnalysis.honeypotCheck = honeypotCheck;

      if (honeypotCheck.isHoneypot) {
        result.overallRiskScore = Math.min(100, result.overallRiskScore + 40);
        result.flags.push(`🔴 HONEYPOT: ${honeypotCheck.recommendations}`);
        logger.warn('[ENHANCED-SECURITY] ❌ Honeypot detected');
      } else {
        result.flags.push('✅ Not a honeypot');
      }
    } catch (error: any) {
      logger.warn(`[ENHANCED-SECURITY] Could not complete honeypot check: ${error?.message}`);
      result.flags.push(`⚠️ Honeypot check inconclusive: ${error?.message}`);
      result.overallRiskScore = Math.min(100, result.overallRiskScore + 15);
    }

    // 3. LIQUIDITY LOCK CHECK
    logger.info('[ENHANCED-SECURITY] Running liquidity lock analysis...');
    try {
      const lockCheck = await comprehensiveLiquidityAnalysis(
        connection,
        tokenData.mintAddress,
        tokenData.creatorAddress
      );

      result.detailedAnalysis.lockCheck = lockCheck;

      if (!lockCheck.liquiditySafe) {
        result.overallRiskScore = Math.min(100, result.overallRiskScore + lockCheck.riskScore);
        result.flags.push(`🔴 LIQUIDITY LOCK: ${lockCheck.recommendation}`);
        logger.warn('[ENHANCED-SECURITY] ❌ Liquidity lock issues detected');
      } else {
        result.flags.push('✅ Liquidity properly locked');
      }
    } catch (error: any) {
      logger.warn(`[ENHANCED-SECURITY] Could not complete lock check: ${error?.message}`);
      result.flags.push(`⚠️ Lock check inconclusive`);
      result.overallRiskScore = Math.min(100, result.overallRiskScore + 10);
    }

    // 4. HOLDER ACTIVITY CHECK
    if (tokenData.topHolders && tokenData.topHolders.length > 0) {
      logger.info('[ENHANCED-SECURITY] Running holder activity analysis...');
      try {
        const activityCheck = await analyzeHolderSellingActivity(
          connection,
          tokenData.mintAddress,
          tokenData.topHolders
        );

        result.detailedAnalysis.holderActivityCheck = activityCheck;

        const activityRisk = calculateHolderActivityRiskScore(activityCheck);

        if (activityRisk.riskScore > 50) {
          result.overallRiskScore = Math.min(100, result.overallRiskScore + 20);
          result.flags.push(`⚠️ HOLDER ACTIVITY: ${activityRisk.recommendation}`);
          logger.warn('[ENHANCED-SECURITY] ⚠️ Active selling detected');
        } else {
          result.flags.push('✅ No active whale selling');
        }
      } catch (error: any) {
        logger.debug(`[ENHANCED-SECURITY] Could not complete activity check: ${error?.message}`);
        result.flags.push(`ℹ️ Holder activity check incomplete`);
      }
    }

    // 5. DYNAMIC THRESHOLD EVALUATION
    logger.info('[ENHANCED-SECURITY] Evaluating against dynamic thresholds...');
    const dynamicEval = evaluateTokenWithDynamicThresholds({
      mintAddress: tokenData.mintAddress,
      createdAtMs: tokenData.createdAtMs,
      liquidityUSD: tokenData.liquidityUSD,
      topHolderPercent: tokenData.topHolderPercent,
      top5HolderPercent: tokenData.top5HolderPercent,
      buyerCountLast5Min: tokenData.buyerCountLast5Min,
      slippagePercent: tokenData.slippagePercent,
      isHoneypot: result.detailedAnalysis.honeypotCheck?.isHoneypot || false,
      securityRiskScore: tokenData.securityRiskScore,
      lpLocked: result.detailedAnalysis.lockCheck?.liquiditySafe || false,
      lpLockDaysRemaining: result.detailedAnalysis.lockCheck?.details?.lockStatus?.lockDuration
        ? result.detailedAnalysis.lockCheck.details.lockStatus.lockDuration / (1000 * 60 * 60 * 24)
        : 0,
      creatorRugCount: checkCreatorReputation(tokenData.creatorAddress).rugCount
    });

    result.detailedAnalysis.dynamicThresholdEvaluation = dynamicEval;

    if (!dynamicEval.isApproved) {
      result.flags.push(`🔴 THRESHOLD CHECKS: Failed ${dynamicEval.failedChecks.length} checks`);
      result.flags.push(...(dynamicEval.failedChecks || []).map((c: string) => `  • ${c}`));
      result.overallRiskScore = Math.min(100, result.overallRiskScore + 15);
    } else {
      result.flags.push(`✅ THRESHOLD CHECKS: Passed all checks`);
      result.flags.push(...(dynamicEval.passedChecks || []).map((c: string) => `  • ${c}`));
    }

    // FINAL DECISION
    logger.info(
      `[ENHANCED-SECURITY] Final risk score: ${result.overallRiskScore}/100, Failed checks: ${dynamicEval.failedChecks.length}`
    );

    // Determine approval based on comprehensive analysis
    const hasBlockingIssue =
      blacklistCheck.overallRisk >= 75 ||
      (result.detailedAnalysis.honeypotCheck?.isHoneypot &&
        result.detailedAnalysis.honeypotCheck.confidence > 70) ||
      (result.detailedAnalysis.lockCheck && !result.detailedAnalysis.lockCheck.liquiditySafe &&
        result.detailedAnalysis.lockCheck.riskScore > 70);

    if (hasBlockingIssue) {
      result.isApproved = false;
      result.recommendations = '❌ REJECTED: Critical security issues detected';
    } else if (result.overallRiskScore >= 75) {
      result.isApproved = false;
      result.recommendations = '❌ REJECTED: Overall risk score too high (≥75)';
    } else if (result.overallRiskScore >= 50) {
      result.isApproved = true; // Conditional approval
      result.recommendations = '⚠️ CONDITIONAL: High risk - Use smaller position size';
    } else {
      result.isApproved = true;
      result.recommendations = '✅ APPROVED: Security checks passed';
    }

    logger.info(
      `[ENHANCED-SECURITY] ✓ Comprehensive check complete: ${result.isApproved ? 'APPROVED' : 'REJECTED'}`
    );

    return result;

  } catch (error: any) {
    logger.error(`[ENHANCED-SECURITY] Critical error during checks: ${error?.message}`);

    result.isApproved = false;
    result.recommendations = `❌ ERROR: Could not complete security checks - Reject to be safe`;
    result.flags.push(`🔴 CRITICAL ERROR: ${error?.message}`);
    result.overallRiskScore = 85; // Default to high risk on error

    return result;
  }
}

/**
 * Quick integration function for existing sniper-bot.ts
 * Can be called in place of original security checks
 */
export async function quickSecurityCheckV2(
  connection: Connection,
  tokenMint: string,
  creatorAddress: string,
  metadata?: any
): Promise<{
  isApproved: boolean;
  riskScore: number;
  reason: string;
}> {
  // Quick checks - don't do full analysis for speed
  
  // 1. Check blacklist
  if (isTokenBlacklisted(tokenMint).isBlacklisted) {
    return {
      isApproved: false,
      riskScore: 100,
      reason: 'Token in rug pull blacklist'
    };
  }

  // 2. Check creator
  const creatorCheck = checkCreatorReputation(creatorAddress);
  if (creatorCheck.isBlacklisted) {
    return {
      isApproved: false,
      riskScore: 90,
      reason: `Creator with ${creatorCheck.rugCount} previous rug pulls`
    };
  }

  // 3. Quick honeypot check
  try {
    const honeypotResult = await checkHoneypot(connection, tokenMint);
    if (honeypotResult.isHoneypot) {
      return {
        isApproved: false,
        riskScore: 85,
        reason: `Honeypot detected: ${honeypotResult.reason}`
      };
    }
  } catch (error) {
    logger.debug('Could not complete quick honeypot check');
  }

  // If all quick checks pass
  return {
    isApproved: true,
    riskScore: 20, // Default low risk if passes quick checks
    reason: 'Passed quick security checks'
  };
}

// EnhancedSecurityCheckResult exported via declaration above
