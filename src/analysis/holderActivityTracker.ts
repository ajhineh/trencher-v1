/**
 * Holder Activity Tracker
 * Monitors recent selling activity of token holders
 * Detects coordinated dumps and insider selling patterns
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';

export interface HolderSellingActivity {
  holderAddress: string;
  tokensSold: number;
  usdValue?: number;
  lastSaleTime?: Date;
  saleFrequency: number; // Number of sales in recent period
  isActive: boolean; // Has sold in last 30 minutes
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface TokenHolderActivitySummary {
  totalTopHolderSells: number;
  averageSaleFrequency: number;
  topDumpersCount: number; // Holders selling >5% of their holdings
  lastActivityTime?: Date;
  isUnderHeavySelling: boolean;
  dumpingConfidence: number; // 0-100
  warnings: string[];
}

/**
 * Check recent selling activity of top token holders
 * Queries for recent token sales from large wallets
 */
export async function analyzeHolderSellingActivity(
  connection: Connection,
  tokenMint: string,
  topHolders: Array<{
    address: string;
    balance: number;
    percentageOfSupply: number;
  }> = []
): Promise<TokenHolderActivitySummary> {
  const summary: TokenHolderActivitySummary = {
    totalTopHolderSells: 0,
    averageSaleFrequency: 0,
    topDumpersCount: 0,
    isUnderHeavySelling: false,
    dumpingConfidence: 0,
    warnings: []
  };

  try {
    logger.info(`[HOLDER-ACTIVITY] Analyzing holder selling activity for ${tokenMint}...`);

    if (topHolders.length === 0) {
      summary.warnings.push('⚠️ No holder data provided for activity analysis');
      return summary;
    }

    const mint = new PublicKey(tokenMint);
    let totalSellingActivity = 0;
    const holderActivities: HolderSellingActivity[] = [];

    // 1. Check recent transactions for each top holder
    for (const holder of topHolders.slice(0, 10)) {
      // Only check top 10 holders
      try {
        const holderActivity = await checkHolderRecentSales(
          connection,
          holder.address,
          tokenMint,
          holder.balance
        );

        holderActivities.push(holderActivity);

        if (holderActivity.isActive) {
          totalSellingActivity++;
          summary.totalTopHolderSells += holderActivity.saleFrequency;

          if (holderActivity.riskLevel === 'CRITICAL' || holderActivity.riskLevel === 'HIGH') {
            summary.topDumpersCount++;
          }
        }
      } catch (error: any) {
        logger.debug(`[HOLDER-ACTIVITY] Could not check ${holder.address}: ${error?.message}`);
        continue;
      }
    }

    // 2. Calculate summary metrics
    if (holderActivities.length > 0) {
      summary.averageSaleFrequency = holderActivities.reduce(
        (sum, h) => sum + h.saleFrequency,
        0
      ) / holderActivities.length;

      // Find most recent activity
      const recentActivities = holderActivities
        .filter(h => h.lastSaleTime)
        .sort((a, b) => (b.lastSaleTime?.getTime() || 0) - (a.lastSaleTime?.getTime() || 0));

      if (recentActivities.length > 0) {
        summary.lastActivityTime = recentActivities[0].lastSaleTime;
      }
    }

    // 3. Determine if token is under heavy selling pressure
    const timeSinceLastActivity = summary.lastActivityTime
      ? Date.now() - summary.lastActivityTime.getTime()
      : Number.MAX_SAFE_INTEGER;

    const ACTIVITY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

    if (totalSellingActivity >= 3) {
      summary.isUnderHeavySelling = true;
      summary.dumpingConfidence = Math.min(95, 50 + totalSellingActivity * 10);
      summary.warnings.push(
        `🔴 CRITICAL: ${totalSellingActivity} major holders selling simultaneously!`
      );
    } else if (totalSellingActivity === 2) {
      summary.isUnderHeavySelling = true;
      summary.dumpingConfidence = 70;
      summary.warnings.push(`⚠️ HIGH RISK: Multiple whale wallets selling`);
    } else if (totalSellingActivity === 1 && timeSinceLastActivity < ACTIVITY_WINDOW_MS) {
      summary.dumpingConfidence = 50;
      summary.warnings.push(
        `⚠️ MEDIUM RISK: Recent selling activity from major holder (${(
          timeSinceLastActivity / 1000 / 60
        ).toFixed(1)} minutes ago)`
      );
    }

    logger.info(
      `[HOLDER-ACTIVITY] Summary: ${totalSellingActivity} sellers, confidence: ${summary.dumpingConfidence}%`
    );

    return summary;

  } catch (error: any) {
    logger.error(`[HOLDER-ACTIVITY] Error analyzing holder activity: ${error?.message}`);
    summary.warnings.push(`Error analyzing holder activity: ${error?.message}`);
    return summary;
  }
}

/**
 * Check if a specific holder has sold tokens recently
 */
async function checkHolderRecentSales(
  connection: Connection,
  holderAddress: string,
  tokenMint: string,
  currentBalance: number
): Promise<HolderSellingActivity> {
  const activity: HolderSellingActivity = {
    holderAddress,
    tokensSold: 0,
    lastSaleTime: undefined,
    saleFrequency: 0,
    isActive: false,
    riskLevel: 'LOW'
  };

  try {
    const holderPubkey = new PublicKey(holderAddress);

    // Get recent signatures for this holder
    // We'd ideally want to filter by specific token, but need to check all transactions
    const signatures = await connection.getSignaturesForAddress(holderPubkey, {
      limit: 20 // Last 20 transactions
    });

    let recentSalesCount = 0;
    const RECENT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
    const now = Date.now();

    for (const sig of signatures) {
      if (sig.blockTime) {
        const blockTime = new Date(sig.blockTime * 1000);
        const ageMs = now - blockTime.getTime();

        // Skip if older than 1 hour
        if (ageMs > RECENT_WINDOW_MS) {
          continue;
        }

        // Try to get transaction details
        try {
          const tx = await connection.getTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0
          });

          if (tx && tx.meta) {
            // Check if this transaction involves token transfer (likely a sell)
            // Use postTokenBalances which is present on ConfirmedTransactionMeta
            const tokenBalances = tx.meta?.postTokenBalances || [];
            const involvesMint = (tokenBalances as any[]).some((t: any) => t.mint === tokenMint);

            if (involvesMint) {
              recentSalesCount++;
              activity.lastSaleTime = blockTime;
              activity.saleFrequency = recentSalesCount;

              logger.debug(
                `[HOLDER-ACTIVITY] ${holderAddress} sold at ${blockTime.toISOString()}`
              );
            }
          }
        } catch (txError: any) {
          logger.debug(`Could not fetch transaction details: ${txError?.message}`);
          continue;
        }
      }
    }

    // Determine risk level based on selling frequency
    activity.isActive = recentSalesCount > 0;

    if (recentSalesCount >= 5) {
      activity.riskLevel = 'CRITICAL'; // Actively dumping
    } else if (recentSalesCount >= 3) {
      activity.riskLevel = 'HIGH'; // Frequent sales
    } else if (recentSalesCount >= 1) {
      activity.riskLevel = 'MEDIUM'; // Recent sale
    }

    // Check if holder is selling a significant portion
    if (currentBalance > 0 && activity.tokensSold > currentBalance * 0.05) {
      // Sold more than 5% = dump indicator
      activity.riskLevel = 'CRITICAL';
    }

  } catch (error: any) {
    logger.debug(`[HOLDER-ACTIVITY] Error checking sales for ${holderAddress}: ${error?.message}`);
  }

  return activity;
}

/**
 * Detect coordinated buying/selling attacks
 * Identifies if multiple addresses are selling simultaneously (coordinated dump)
 */
export async function detectCoordinatedDumping(
  holderActivities: HolderSellingActivity[],
  timeWindowMs: number = 5 * 60 * 1000 // 5-minute window
): Promise<{
  isCoordinated: boolean;
  confidence: number;
  participantCount: number;
  warnings: string[];
}> {
  const result = {
    isCoordinated: false,
    confidence: 0,
    participantCount: 0,
    warnings: [] as string[]
  };

  try {
    // Find sales within time window
    const now = Date.now();
    const activitiesInWindow = holderActivities.filter(activity => {
      if (!activity.lastSaleTime) return false;
      const ageMs = now - activity.lastSaleTime.getTime();
      return ageMs < timeWindowMs && activity.isActive;
    });

    if (activitiesInWindow.length >= 2) {
      result.isCoordinated = true;
      result.participantCount = activitiesInWindow.length;

      // Calculate confidence based on number of participants and timing
      result.confidence = Math.min(95, 50 + activitiesInWindow.length * 15);

      result.warnings.push(
        `🔴 COORDINATED DUMP: ${activitiesInWindow.length} holders selling simultaneously!`
      );

      logger.warn(`[HOLDER-ACTIVITY] Coordinated dump detected: ${activitiesInWindow.length} participants`);
    }

  } catch (error: any) {
    logger.error(`Error detecting coordinated dumping: ${error?.message}`);
  }

  return result;
}

/**
 * Get risk metrics for token based on holder activity
 */
export function calculateHolderActivityRiskScore(
  summary: TokenHolderActivitySummary
): {
  riskScore: number; // 0-100
  recommendation: string;
} {
  let riskScore = summary.dumpingConfidence;

  // Adjust based on multiple sellers
  if (summary.topDumpersCount >= 2) {
    riskScore = Math.min(95, riskScore + 20);
  }

  // Adjust based on frequency
  if (summary.averageSaleFrequency > 3) {
    riskScore = Math.min(95, riskScore + 15);
  }

  const recommendation =
    riskScore >= 75
      ? '❌ DUMP IN PROGRESS: Multiple holders selling - RUN'
      : riskScore >= 50
      ? '⚠️ HIGH RISK: Active seller detected - Exit or reduce position'
      : riskScore >= 25
      ? '⚠️ MEDIUM RISK: Some selling activity observed'
      : '✅ SAFE: No active selling pressure from major holders';

  return { riskScore, recommendation };
}

// Types exported via declarations above
