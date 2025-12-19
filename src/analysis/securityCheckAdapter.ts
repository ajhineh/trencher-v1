/**
 * Adapter: Integrating Enhanced Security into existing security-checks.ts
 * This file shows how to wrap the original security checks with the new enhanced system
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';
import { FullSecurityCheckResult } from '../security-checks';
import { runEnhancedSecurityChecksV2 } from './enhancedSecurityIntegration';

/**
 * Enhanced wrapper for runEnhancedSecurityChecks
 * Takes original security check result and enriches it with new detection systems
 *
 * USE THIS INSTEAD OF calling runEnhancedSecurityChecks directly
 */
export async function runEnhancedSecurityChecksWithIntegration(
  connection: Connection,
  mintAddress: string,
  originalCheckResult: FullSecurityCheckResult
): Promise<{
  original: FullSecurityCheckResult;
  enhanced: any;
  combinedRiskScore: number;
  finalRecommendation: string;
  isApproved: boolean;
}> {
  try {
    logger.info(`[SECURITY-INTEGRATION] Running enhanced security checks for ${mintAddress}...`);

    // Get token creation time (estimate from supply if needed)
    const createdAtMs = Date.now() - 30 * 1000; // Placeholder - in real code, get actual creation time

    // Extract data from original check result
    const topHolderPercent = originalCheckResult.topHolderPercentage || 0;
    const top5HolderPercent = originalCheckResult.top5HolderPercentage || 0;
    const originalRiskScore = originalCheckResult.riskScore || 0;

    // Run new enhanced checks
    const enhanced = await runEnhancedSecurityChecksV2(connection, {
      mintAddress,
      creatorAddress: 'Unknown', // Would need to extract from metadata
      createdAtMs,
      liquidityUSD: 0, // Would need to calculate from pool state
      topHolderPercent,
      top5HolderPercent,
      buyerCountLast5Min: 0, // Would need from market data
      slippagePercent: 0, // Would need to calculate
      securityRiskScore: originalRiskScore,
      metadata: originalCheckResult.metadata
    });

    // Combine results
    const combinedRiskScore = Math.max(originalRiskScore, enhanced.overallRiskScore);

    let finalRecommendation = '';
    let isApproved = true;

    if (combinedRiskScore >= 75) {
      finalRecommendation = `❌ REJECT: Combined risk score ${combinedRiskScore}/100`;
      isApproved = false;
    } else if (combinedRiskScore >= 50) {
      finalRecommendation = `⚠️ CAUTION: Risk score ${combinedRiskScore}/100 - small position recommended`;
      isApproved = true;
    } else {
      finalRecommendation = `✅ APPROVED: Risk score ${combinedRiskScore}/100`;
      isApproved = true;
    }

    return {
      original: originalCheckResult,
      enhanced,
      combinedRiskScore,
      finalRecommendation,
      isApproved
    };

  } catch (error: any) {
    logger.error(`[SECURITY-INTEGRATION] Error: ${error?.message}`);
    throw error;
  }
}

/**
 * Quick integration check - use this in fast scanning loops
 * Returns true/false without detailed analysis
 */
export async function quickSecurityCheckIntegration(
  connection: Connection,
  mintAddress: string,
  originalCheckResult: FullSecurityCheckResult
): Promise<boolean> {
  try {
    // If original check already failed, reject immediately
    if (!originalCheckResult.ok || originalCheckResult.status === 'DANGER') {
      return false;
    }

    // If original check looks good but has high risk score, run quick enhanced check
    if (originalCheckResult.riskScore >= 50) {
      const { quickSecurityCheckV2 } = await import('./enhancedSecurityIntegration');

      const quickCheck = await quickSecurityCheckV2(
        connection,
        mintAddress,
        'unknown',
        originalCheckResult.metadata
      );

      return quickCheck.isApproved;
    }

    // Original check passed and risk score is good
    return true;

  } catch (error: any) {
    logger.error(`[SECURITY-QUICK-CHECK] Error: ${error?.message}`);
    return false; // Fail safely
  }
}

/**
 * Detailed comparison report for debugging/logging
 */
export function generateSecurityCheckComparison(
  original: FullSecurityCheckResult,
  enhanced: any,
  combined: number
): string {
  return `
┌─────────────────────────────────────────────────────────────┐
│ SECURITY CHECK COMPARISON REPORT                            │
└─────────────────────────────────────────────────────────────┘

ORIGINAL SECURITY CHECKS:
  Status:          ${original.status}
  Risk Score:      ${original.riskScore}/100
  Pass Count:      ${original.passCount}/${original.passCount + original.failCount}
  Warnings:        ${original.warnings?.length || 0}
  
  Details:
    • Can Mint More:      ${original.details.canMintMore ? '❌ YES (risky)' : '✅ NO (safe)'}
    • Freeze Authority:   ${original.details.hasFreezeAuthority ? '⚠️ YES' : '✅ NO'}
    • Supply Analysis:    ${original.details.supplyAnalysis ? '✅ PASS' : '❌ FAIL'}
    • Creator Analysis:   ${original.details.creatorAnalysis ? '✅ PASS' : '❌ FAIL'}
    • Distribution:       ${original.details.distributionAnalysis ? '✅ PASS' : '❌ FAIL'}
    • Liquidity:          ${original.details.liquidityAnalysis ? '✅ PASS' : '❌ FAIL'}

ENHANCED SECURITY CHECKS:
  Overall Risk:    ${enhanced.overallRiskScore}/100
  Approved:        ${enhanced.isApproved ? '✅ YES' : '❌ NO'}
  Flags:           ${enhanced.flags?.length || 0}
  
  Breakdown:
${enhanced.flags?.map((f: string) => `    • ${f}`).join('\n')}

COMBINED ANALYSIS:
  Combined Score:  ${combined}/100
  Final Status:    ${combined >= 75 ? '❌ REJECT' : combined >= 50 ? '⚠️ CAUTION' : '✅ APPROVED'}
  Recommendation:  ${combined >= 75 ? 'DO NOT BUY' : combined >= 50 ? 'SMALL POSITION' : 'STANDARD POSITION'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}

export type { FullSecurityCheckResult };
