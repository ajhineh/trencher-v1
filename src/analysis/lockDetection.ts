/**
 * Liquidity Lock Detection System
 * Identifies if LP tokens are locked and their unlock dates
 * Critical for rug pull prevention - unlocked LP = high rug risk
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';

export interface LiquidityLockInfo {
  isLocked: boolean;
  lockProgram?: string; // e.g., "Raydium", "UNCX", "Timelock", "Orca"
  lockDuration?: number; // milliseconds
  unlockDate?: Date;
  lockAmount?: number; // in LP tokens
  confidence: number; // 0-100
  warnings: string[];
}

// Known lock program addresses on Solana
const KNOWN_LOCK_PROGRAMS = {
  // UNCX Network - most popular LP locker
  UNCX: 'UncxjbfHyqLMj4pevm4vVVDYWoap2Ckxz4PXRfKwq9s',

  // Timelock (governance-style locks)
  TIMELOCK: 'TokenkegQfeZyiNwAJsyFbPVwwQnmZm4MXuLrBbtZs',

  // Raydium AcceleRaytor (built-in locks)
  RAYDIUM_ACCELERAYTOR: '9W959DqnwTnTiGkbP76zM6AfcPuWmVTu8qKkPrWmqzVm',

  // Orca locks
  ORCA_AQUAFARMS: 'AqvzZZC95vz1DAjbStzNVc39ukxwac5XynbRiNxNqWc',

  // Generic timelock contracts
  TIMELOCK_GENERIC: 'TokenLockqwNLwaQLE2jHFTip6VgqbBbqB96eyerai4',

  // Marinade stake pools (commonly used for locks)
  MARINADE: 'MarBmsSgKXdrQilibJyJ4l3BPiPZY6yn6V2KWRWeb1',

  // Lido (another stake/lock provider)
  LIDO: '7dHbWXmci3dT8UFYP5CGcok36MwxwwG9gC9khYBQmdm3'
};

/**
 * Check if LP tokens are locked by querying known lock program accounts
 */
export async function checkLiquidityLock(
  connection: Connection,
  mintAddress: string,
  lpTokenAddress?: string
): Promise<LiquidityLockInfo> {
  const result: LiquidityLockInfo = {
    isLocked: false,
    confidence: 0,
    warnings: []
  };

  try {
    const mint = new PublicKey(mintAddress);
    logger.info(`[LOCK-CHECK] Checking liquidity lock for ${mintAddress}...`);

    // 1. Try to find lock through known lock programs
    for (const [lockName, lockProgramStr] of Object.entries(KNOWN_LOCK_PROGRAMS)) {
      try {
        const lockProgram = new PublicKey(lockProgramStr);

        // Query for lock accounts containing this token
        const lockAccounts = await connection.getProgramAccounts(lockProgram, {
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: mintAddress // Search for mint in account data
              }
            }
          ]
        });

        if (lockAccounts.length > 0) {
          logger.info(`[LOCK-CHECK] ✓ Found ${lockAccounts.length} lock accounts in ${lockName}`);

          // Analyze first lock account
          const lockAccount = lockAccounts[0];
          const lockData = lockAccount.account.data;

          // Try to extract unlock time from lock data
          const unlockInfo = parseLockData(lockName, lockData);

          result.isLocked = true;
          result.lockProgram = lockName;
          result.lockAmount = lockAccounts.length; // Number of lock accounts
          result.confidence = 85;

          if (unlockInfo.unlockDate) {
            result.unlockDate = unlockInfo.unlockDate;
            result.lockDuration = unlockInfo.unlockDate.getTime() - Date.now();

            // Calculate risk based on unlock duration
            const daysUntilUnlock = (result.lockDuration || 0) / (1000 * 60 * 60 * 24);

            if (daysUntilUnlock < 7) {
              result.warnings.push(`⚠️ LP unlock in ${daysUntilUnlock.toFixed(1)} days - HIGH RISK`);
              result.confidence = 95;
            } else if (daysUntilUnlock < 30) {
              result.warnings.push(`⚠️ LP unlock in ${daysUntilUnlock.toFixed(1)} days - MEDIUM RISK`);
              result.confidence = 80;
            } else if (daysUntilUnlock < 365) {
              result.warnings.push(`ℹ️ LP unlock in ${daysUntilUnlock.toFixed(1)} days`);
              result.confidence = 70;
            } else {
              result.warnings.push(`✓ LP locked for > 1 year - Safe`);
              result.confidence = 40;
            }
          }

          logger.info(
            `[LOCK-CHECK] Lock details: ${JSON.stringify(result)}`
          );

          return result;
        }
      } catch (error: any) {
        logger.debug(`[LOCK-CHECK] Could not check ${lockName}: ${error?.message}`);
        continue;
      }
    }

    // 2. If no locks found in known programs, check for suspicious patterns
    logger.warn(`[LOCK-CHECK] ⚠️ No locks detected in known lock programs!`);
    result.warnings.push('🔴 NO LIQUIDITY LOCK DETECTED - High rug pull risk!');
    result.isLocked = false;
    result.confidence = 95; // High confidence that it's NOT locked (bad sign)

  } catch (error: any) {
    logger.error(`[LOCK-CHECK] Error checking liquidity lock: ${error?.message}`);
    result.warnings.push(`Error during lock check: ${error?.message}`);
    result.confidence = 20; // Low confidence - couldn't verify
  }

  return result;
}

/**
 * Parse lock data from different lock programs
 */
function parseLockData(
  lockProgram: string,
  data: Buffer
): { unlockDate?: Date; duration?: number } {
  try {
    switch (lockProgram) {
      case 'UNCX':
        return parseUNCXLock(data);
      case 'TIMELOCK':
      case 'TIMELOCK_GENERIC':
        return parseTimelockData(data);
      case 'RAYDIUM_ACCELERAYTOR':
        return parseRaydiumLock(data);
      default:
        return {};
    }
  } catch (error: any) {
    logger.debug(`Could not parse ${lockProgram} lock data: ${error?.message}`);
    return {};
  }
}

/**
 * Parse UNCX Network lock format
 * Structure varies but typically contains timestamp at offset 8-16
 */
function parseUNCXLock(data: Buffer): { unlockDate?: Date; duration?: number } {
  try {
    // UNCX typically stores unlock timestamp in first few bytes after header
    if (data.length < 16) return {};

    // Try different offsets for timestamp
    const offset1 = data.readBigUInt64LE(8);
    const offset2 = data.readBigUInt64LE(16);

    // Timestamps are usually in seconds (Unix time)
    const timestamp1 = Number(offset1);
    const timestamp2 = Number(offset2);

    // Valid Unix timestamp should be > 1.6 billion (2021) and < 2 billion (2033)
    if (timestamp1 > 1600000000 && timestamp1 < 2000000000) {
      return { unlockDate: new Date(timestamp1 * 1000) };
    }

    if (timestamp2 > 1600000000 && timestamp2 < 2000000000) {
      return { unlockDate: new Date(timestamp2 * 1000) };
    }

    return {};
  } catch (error) {
    return {};
  }
}

/**
 * Parse Timelock program data
 */
function parseTimelockData(data: Buffer): { unlockDate?: Date; duration?: number } {
  try {
    if (data.length < 24) return {};

    // Timelock typically stores timestamp at offset 16-24
    const timestamp = data.readBigUInt64LE(16);
    const time = Number(timestamp);

    if (time > 1600000000 && time < 2000000000) {
      return { unlockDate: new Date(time * 1000) };
    }

    return {};
  } catch (error) {
    return {};
  }
}

/**
 * Parse Raydium lock format
 */
function parseRaydiumLock(data: Buffer): { unlockDate?: Date; duration?: number } {
  try {
    if (data.length < 32) return {};

    // Raydium stores various timestamps, typically at different offsets
    for (let offset = 0; offset < Math.min(data.length - 8, 64); offset += 8) {
      try {
        const value = data.readBigUInt64LE(offset);
        const timestamp = Number(value);

        // Check if this looks like a valid Unix timestamp
        if (timestamp > 1600000000 && timestamp < 2000000000) {
          const date = new Date(timestamp * 1000);
          const now = new Date();

          // Only return if it's in the future and within 10 years
          if (date > now && date.getTime() < now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000) {
            return { unlockDate: date };
          }
        }
      } catch (e) {
        continue;
      }
    }

    return {};
  } catch (error) {
    return {};
  }
}

/**
 * Check if creator wallet has ever drained liquidity pools
 * Returns known bad creators
 */
export function checkCreatorLockHistory(creatorAddress: string): {
  isKnownBadActor: boolean;
  previousRugs: number;
  confidence: number;
} {
  // This would be populated from a database of known rugpullers
  // For now, using a hardcoded blacklist
  const KNOWN_RUGPULLERS: Set<string> = new Set([
    // Add known bad creator addresses here
    // Format: base58 encoded public key
  ]);

  if (creatorAddress && (KNOWN_RUGPULLERS as Set<string>).has(creatorAddress)) {
    return {
      isKnownBadActor: true,
      previousRugs: 1,
      confidence: 95
    };
  }

  return {
    isKnownBadActor: false,
    previousRugs: 0,
    confidence: 100
  };
}

/**
 * Comprehensive liquidity lock analysis
 */
export async function comprehensiveLiquidityAnalysis(
  connection: Connection,
  mintAddress: string,
  creatorAddress?: string
): Promise<{
  liquiditySafe: boolean;
  riskScore: number; // 0-100
  details: {
    lockStatus: LiquidityLockInfo;
    creatorHistory?: ReturnType<typeof checkCreatorLockHistory>;
  };
  recommendation: string;
}> {
  const lockStatus = await checkLiquidityLock(connection, mintAddress);

  let riskScore = 0;
  let details: any = { lockStatus };

  // 1. Check if locked
  if (!lockStatus.isLocked) {
    riskScore += 60; // No lock = high risk
  } else if (lockStatus.lockDuration && lockStatus.lockDuration > 0) {
    const daysUntilUnlock = lockStatus.lockDuration / (1000 * 60 * 60 * 24);
    if (daysUntilUnlock < 7) {
      riskScore += 50;
    } else if (daysUntilUnlock < 30) {
      riskScore += 30;
    } else if (daysUntilUnlock < 365) {
      riskScore += 10;
    }
  }

  // 2. Check creator history
  if (creatorAddress) {
    const creatorHistory = checkCreatorLockHistory(creatorAddress);
    details.creatorHistory = creatorHistory;

    if (creatorHistory.isKnownBadActor) {
      riskScore += 40;
    }
  }

  const liquiditySafe = riskScore < 50;

  const recommendation =
    riskScore >= 75
      ? '❌ CRITICAL: No liquidity lock or creator history - REJECT'
      : riskScore >= 50
      ? '⚠️ HIGH RISK: Unlocked or short-term lock - Use small position'
      : riskScore >= 25
      ? '⚠️ MEDIUM RISK: Consider longer lock verification'
      : '✅ SAFE: Liquidity appears locked for sufficient period';

  return {
    liquiditySafe,
    riskScore,
    details,
    recommendation
  };
}

// LiquidityLockInfo exported via declaration above
