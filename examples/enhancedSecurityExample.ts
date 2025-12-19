/**
 * Example: Integrating Enhanced Security Checks into Sniper Bot
 * Shows how to use the new rug prevention system in real trading
 */

import { Connection } from '@solana/web3.js';
import { logger } from '../src/logger';
import { runEnhancedSecurityChecksV2, quickSecurityCheckV2 } from '../src/analysis/enhancedSecurityIntegration';
import { getDynamicThresholds, getThresholdsSummary } from '../src/risk/dynamicThresholds';

/**
 * Example 1: Quick approval check (for speed)
 * Use this in the main token scanning loop for fast rejection
 */
export async function ex_quickTokenApprovalCheck(
  connection: Connection,
  tokenMint: string,
  creatorAddress: string,
  metadata: any
): Promise<{ approved: boolean; reason: string }> {
  try {
    const check = await quickSecurityCheckV2(connection, tokenMint, creatorAddress, metadata);

    if (check.isApproved) {
      logger.info(
        `✅ [${tokenMint.slice(0, 8)}] Quick security check PASSED (risk: ${check.riskScore}/100)`
      );
      return { approved: true, reason: check.reason };
    } else {
      logger.warn(`❌ [${tokenMint.slice(0, 8)}] Quick security check FAILED: ${check.reason}`);
      return { approved: false, reason: check.reason };
    }
  } catch (error: any) {
    logger.error(`Error in quick security check: ${error?.message}`);
    return { approved: false, reason: 'Security check error' };
  }
}

/**
 * Example 2: Comprehensive token evaluation (for confirmed purchases)
 * Use this before actually buying when you're serious about a token
 */
export async function ex_comprehensiveTokenEvaluation(
  connection: Connection,
  tokenMint: string,
  creatorAddress: string,
  tokenData: {
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
): Promise<{
  approved: boolean;
  positionSize: 'NONE' | 'MICRO' | 'SMALL' | 'STANDARD' | 'LARGE';
  recommendation: string;
  riskScore: number;
  details: any;
}> {
  try {
    logger.info(`🔍 [${tokenMint.slice(0, 8)}] Starting comprehensive evaluation...`);

    // Show what thresholds are being applied for this token's age
    const thresholdInfo = getThresholdsSummary(tokenData.createdAtMs);
    logger.info(thresholdInfo);

    // Run full security check
    const securityCheck = await runEnhancedSecurityChecksV2(connection, {
      mintAddress: tokenMint,
      creatorAddress,
      ...tokenData
    });

    // Determine position size based on risk score
    let positionSize: 'NONE' | 'MICRO' | 'SMALL' | 'STANDARD' | 'LARGE';

    if (securityCheck.overallRiskScore >= 75) {
      positionSize = 'NONE'; // Reject completely
    } else if (securityCheck.overallRiskScore >= 60) {
      positionSize = 'MICRO'; // 0.01 SOL only
    } else if (securityCheck.overallRiskScore >= 45) {
      positionSize = 'SMALL'; // 0.05-0.1 SOL
    } else if (securityCheck.overallRiskScore >= 30) {
      positionSize = 'STANDARD'; // 0.2-0.5 SOL
    } else {
      positionSize = 'LARGE'; // 0.5-1 SOL (approved)
    }

    // Build recommendation
    let recommendation = securityCheck.recommendations;

    if (positionSize === 'STANDARD' || positionSize === 'LARGE') {
      recommendation += ` | Position size: ${positionSize}`;
    } else if (positionSize === 'NONE') {
      recommendation += ` | ❌ DO NOT BUY`;
    } else {
      recommendation += ` | Position size: ${positionSize} (higher risk)`;
    }

    logger.info(
      `📊 [${tokenMint.slice(0, 8)}] Evaluation complete: ${securityCheck.isApproved ? 'APPROVED' : 'REJECTED'} | Risk: ${securityCheck.overallRiskScore}/100 | Size: ${positionSize}`
    );

    return {
      approved: securityCheck.isApproved,
      positionSize,
      recommendation,
      riskScore: securityCheck.overallRiskScore,
      details: securityCheck.detailedAnalysis
    };

  } catch (error: any) {
    logger.error(`Error in comprehensive evaluation: ${error?.message}`);

    return {
      approved: false,
      positionSize: 'NONE',
      recommendation: `❌ ERROR: Could not complete security evaluation: ${error?.message}`,
      riskScore: 100,
      details: { error: error?.message }
    };
  }
}

/**
 * Example 3: Position sizing based on token age and risk
 * Returns SOL amount to invest based on security evaluation
 */
export function ex_calculatePositionSize(
  riskScore: number,
  tokenAgeMs: number,
  walletBalance: number,
  riskTolerance: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE' = 'MODERATE'
): number {
  const basePositions = {
    CONSERVATIVE: { MICRO: 0.005, SMALL: 0.01, STANDARD: 0.05, LARGE: 0.1 },
    MODERATE: { MICRO: 0.01, SMALL: 0.05, STANDARD: 0.2, LARGE: 0.5 },
    AGGRESSIVE: { MICRO: 0.05, SMALL: 0.1, STANDARD: 0.5, LARGE: 1.0 }
  };

  const positions = basePositions[riskTolerance];

  // Determine position size from risk score
  let positionSize = 0;

  if (riskScore >= 75) {
    positionSize = 0; // No position
  } else if (riskScore >= 60) {
    positionSize = positions.MICRO;
  } else if (riskScore >= 45) {
    positionSize = positions.SMALL;
  } else if (riskScore >= 30) {
    positionSize = positions.STANDARD;
  } else {
    positionSize = positions.LARGE;
  }

  // Adjust for wallet balance (don't risk more than 5% of wallet)
  const maxRisk = walletBalance * 0.05;
  positionSize = Math.min(positionSize, maxRisk);

  // For brand new tokens, reduce position by 50%
  const tokenAgeMinutes = tokenAgeMs / (1000 * 60);
  if (tokenAgeMinutes < 5) {
    positionSize *= 0.5;
  }

  return Math.max(positionSize, 0);
}

/**
 * Example 4: Real-world usage in sniper-bot main loop
 * Shows how to integrate into existing bot flow
 */
export async function exampleSniperBotIntegration(
  connection: Connection,
  tokenMint: string,
  creatorAddress: string,
  poolState: any // From your token detection system
): Promise<void> {
  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`NEW TOKEN DETECTED: ${tokenMint}`);
  logger.info(`${'='.repeat(60)}\n`);

  // STEP 1: Quick rejection check (fast)
  const quickCheck = await ex_quickTokenApprovalCheck(
    connection,
    tokenMint,
    creatorAddress,
    poolState.metadata
  );

  if (!quickCheck.approved) {
    logger.warn(`SKIP: ${quickCheck.reason}`);
    return; // Don't bother with comprehensive check
  }

  logger.info('✅ Passed quick security checks, proceeding to comprehensive evaluation...\n');

  // STEP 2: Comprehensive evaluation (thorough)
  const evaluation = await ex_comprehensiveTokenEvaluation(
    connection,
    tokenMint,
    creatorAddress,
    {
      createdAtMs: poolState.createdAt || Date.now(),
      liquidityUSD: poolState.liquidityUSD || 0,
      topHolderPercent: poolState.topHolderPercent || 0,
      top5HolderPercent: poolState.top5HolderPercent || 0,
      buyerCountLast5Min: poolState.buyerCount || 0,
      slippagePercent: poolState.slippage || 0,
      securityRiskScore: poolState.existingRiskScore || 0,
      metadata: poolState.metadata,
      topHolders: poolState.topHolders
    }
  );

  if (!evaluation.approved) {
    logger.warn(`REJECT: ${evaluation.recommendation}`);
    return;
  }

  // STEP 3: Calculate position size
  const walletBalance = 5.0; // Example: 5 SOL wallet
  const positionSize = ex_calculatePositionSize(
    evaluation.riskScore,
    poolState.createdAt ? Date.now() - poolState.createdAt : 0,
    walletBalance,
    'MODERATE'
  );

  logger.info(`
✅ TOKEN APPROVED FOR PURCHASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Token:           ${tokenMint}
  Creator:         ${creatorAddress}
  Risk Score:      ${evaluation.riskScore}/100
  Position Size:   ${positionSize.toFixed(4)} SOL
  Recommendation:  ${evaluation.recommendation}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DETAILED ANALYSIS:
${JSON.stringify(evaluation.details, null, 2)}
`);

  // STEP 4: Execute buy with calculated position size
  if (positionSize > 0.001) {
    // Proceed with purchase
    logger.info(`🚀 Executing buy order for ${positionSize} SOL...`);

    // Your existing buy logic here
    // await executeBuy(connection, tokenMint, positionSize);
  } else {
    logger.warn(`Position size too small (${positionSize} SOL), skipping purchase`);
  }
}

/**
 * Example 5: Monitoring active positions for sell signals
 */
export async function monitorPositionRisks(
  connection: Connection,
  tokenMint: string,
  currentHolders: any[]
): Promise<'HOLD' | 'TAKE_PROFIT' | 'EMERGENCY_EXIT'> {
  try {
    // Re-check holder activity while holding
    const { analyzeHolderSellingActivity } = await import(
      '../src/analysis/holderActivityTracker'
    );

    const activity = await analyzeHolderSellingActivity(
      connection,
      tokenMint,
      currentHolders
    );

    if (activity.isUnderHeavySelling) {
      logger.warn(`🚨 WHALE DUMP DETECTED: ${activity.topDumpersCount} major holders selling`);
      logger.warn(`Confidence: ${activity.dumpingConfidence}%`);
      return 'EMERGENCY_EXIT'; // Sell immediately
    }

    if (activity.totalTopHolderSells >= 2) {
      logger.info(`⚠️ Multiple sellers detected, consider taking profit`);
      return 'TAKE_PROFIT';
    }

    logger.info(`✅ Position still safe, holding...`);
    return 'HOLD';

  } catch (error: any) {
    logger.error(`Error monitoring position: ${error?.message}`);
    return 'HOLD'; // Default to hold if we can't check
  }
}

/**
 * Example 6: Blacklist management
 */
export async function manageBlacklist(): Promise<void> {
  const { getDatabaseStats, addRugPullRecord, exportDatabase } = await import(
    '../src/risk/rugPullBlacklist'
  );

  // Show current blacklist stats
  const stats = getDatabaseStats();
  logger.info(`
📊 BLACKLIST DATABASE STATS:
   Total rug pulls recorded: ${stats.totalRugPulls}
   Known bad creators: ${stats.totalBadCreators}
   Known honeypots: ${stats.totalHoneypots}
   Scammer wallets: ${stats.totalScammers}
   Avg loss per rug: $${stats.averageLossPerRug.toFixed(0)}
   Last updated: ${stats.lastUpdated}
`);

  // Export for backup/sync
  const exportedData = exportDatabase();
  logger.info(`Blacklist database exported: ${exportedData.length} bytes`);

  // Example: Add new rug pull to record
  // addRugPullRecord({
  //   tokenMint: 'YourTokenMint123...',
  //   creatorAddress: 'CreatorAddress123...',
  //   rugDate: new Date(),
  //   rugType: 'LIQUIDITY_DRAIN',
  //   losses: { affectedWallets: 100, estimatedUSDLoss: 50000 }
  // });
}

// Export examples for use elsewhere
export { ex_calculatePositionSize as calculatePositionSize, ex_quickTokenApprovalCheck as quickTokenApprovalCheck, ex_comprehensiveTokenEvaluation as comprehensiveTokenEvaluation };
