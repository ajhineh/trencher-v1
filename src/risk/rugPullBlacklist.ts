/**
 * Rug Pull Blacklist Database
 * Maintains database of known rug pulls and scammer addresses
 * Enables quick rejection of tokens from known bad actors
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';

export interface RugPullRecord {
  tokenMint: string;
  creatorAddress: string;
  rugDate: Date;
  rugType: 'LIQUIDITY_DRAIN' | 'HONEYPOT' | 'SUPPLY_MINT' | 'FREEZE_AUTHORITY' | 'UNKNOWN';
  losses: {
    affectedWallets: number;
    estimatedUSDLoss: number;
  };
  notes?: string;
}

export interface CreatorBlacklistEntry {
  address: string;
  rugCount: number;
  totalLosses: number;
  rugTokens: string[];
  lastRugDate: Date;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface CreatorReputation {
  isBlacklisted: boolean;
  rugCount: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendation: string;
}

export interface BlacklistDatabase {
  rugPulls: Map<string, RugPullRecord>; // Key: tokenMint
  badCreators: Map<string, CreatorBlacklistEntry>; // Key: creatorAddress
  honeypotTokens: Set<string>;
  scammerWallets: Set<string>; // Known scammer wallets
  lastUpdated: Date;
}

const DB_FILE_PATH = path.join(__dirname, '../../data/rug-pull-blacklist.json');
const BACKUP_PATH = path.join(__dirname, '../../data/rug-pull-blacklist.backup.json');

// Initialize in-memory database
let blacklistDatabase: BlacklistDatabase = {
  rugPulls: new Map(),
  badCreators: new Map(),
  honeypotTokens: new Set(),
  scammerWallets: new Set(),
  lastUpdated: new Date()
};

/**
 * Load blacklist database from file
 */
export function loadBlacklistDatabase(): BlacklistDatabase {
  try {
    if (fs.existsSync(DB_FILE_PATH)) {
      const data = fs.readFileSync(DB_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(data);

      // Convert back to Maps/Sets
      blacklistDatabase = {
        rugPulls: new Map(parsed.rugPulls || []),
        badCreators: new Map(parsed.badCreators || []),
        honeypotTokens: new Set(parsed.honeypotTokens || []),
        scammerWallets: new Set(parsed.scammerWallets || []),
        lastUpdated: new Date(parsed.lastUpdated || Date.now())
      };

      logger.info(
        `[BLACKLIST-DB] Loaded ${blacklistDatabase.rugPulls.size} rug pull records, ${blacklistDatabase.badCreators.size} bad creators`
      );

      return blacklistDatabase;
    }
  } catch (error: any) {
    logger.error(`[BLACKLIST-DB] Error loading blacklist: ${error?.message}`);
  }

  // If file doesn't exist or load fails, return empty database
  return blacklistDatabase;
}

/**
 * Save blacklist database to file
 */
function saveBlacklistDatabase(): void {
  try {
    // Create data directory if it doesn't exist
    const dataDir = path.dirname(DB_FILE_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Create backup of existing file
    if (fs.existsSync(DB_FILE_PATH)) {
      fs.copyFileSync(DB_FILE_PATH, BACKUP_PATH);
    }

    // Convert Maps/Sets to serializable format
    const serialized = {
      rugPulls: Array.from(blacklistDatabase.rugPulls.entries()),
      badCreators: Array.from(blacklistDatabase.badCreators.entries()),
      honeypotTokens: Array.from(blacklistDatabase.honeypotTokens),
      scammerWallets: Array.from(blacklistDatabase.scammerWallets),
      lastUpdated: blacklistDatabase.lastUpdated.toISOString()
    };

    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(serialized, null, 2));
    logger.info(`[BLACKLIST-DB] Database saved with ${blacklistDatabase.rugPulls.size} records`);
  } catch (error: any) {
    logger.error(`[BLACKLIST-DB] Error saving blacklist: ${error?.message}`);
  }
}

/**
 * Add a rug pull record to the database
 */
export function addRugPullRecord(record: RugPullRecord): void {
  try {
    const tokenMint = record.tokenMint;

    // Add to rug pulls map
    blacklistDatabase.rugPulls.set(tokenMint, record);

    // Update creator blacklist
    const creatorAddress = record.creatorAddress;
    const existing = blacklistDatabase.badCreators.get(creatorAddress) || {
      address: creatorAddress,
      rugCount: 0,
      totalLosses: 0,
      rugTokens: [],
      lastRugDate: new Date(),
      confidence: 'MEDIUM' as const
    };

    existing.rugCount++;
    existing.totalLosses += record.losses.estimatedUSDLoss;
    existing.rugTokens.push(tokenMint);
    existing.lastRugDate = record.rugDate;

    // Update confidence based on rug count
    if (existing.rugCount >= 10) {
      existing.confidence = 'CRITICAL';
    } else if (existing.rugCount >= 5) {
      existing.confidence = 'HIGH';
    } else if (existing.rugCount >= 2) {
      existing.confidence = 'MEDIUM';
    }

    blacklistDatabase.badCreators.set(creatorAddress, existing);
    blacklistDatabase.lastUpdated = new Date();

    logger.info(
      `[BLACKLIST-DB] Added rug pull record: ${tokenMint} by ${creatorAddress} (creator now has ${existing.rugCount} rugs)`
    );

    saveBlacklistDatabase();
  } catch (error: any) {
    logger.error(`[BLACKLIST-DB] Error adding rug pull record: ${error?.message}`);
  }
}

/**
 * Add honeypot token to database
 */
export function addHoneypotToken(tokenMint: string): void {
  blacklistDatabase.honeypotTokens.add(tokenMint);
  blacklistDatabase.lastUpdated = new Date();
  logger.info(`[BLACKLIST-DB] Added honeypot token: ${tokenMint}`);
  saveBlacklistDatabase();
}

/**
 * Add scammer wallet to database
 */
export function addScammerWallet(walletAddress: string): void {
  blacklistDatabase.scammerWallets.add(walletAddress);
  blacklistDatabase.lastUpdated = new Date();
  logger.info(`[BLACKLIST-DB] Added scammer wallet: ${walletAddress}`);
  saveBlacklistDatabase();
}

/**
 * Check if token is in blacklist
 */
export function isTokenBlacklisted(tokenMint: string): {
  isBlacklisted: boolean;
  reason?: string;
  record?: RugPullRecord;
} {
  // Check rug pull records
  const rugRecord = blacklistDatabase.rugPulls.get(tokenMint);
  if (rugRecord) {
    return {
      isBlacklisted: true,
      reason: `Known rug pull (${rugRecord.rugType})`,
      record: rugRecord
    };
  }

  // Check honeypot list
  if (blacklistDatabase.honeypotTokens.has(tokenMint)) {
    return {
      isBlacklisted: true,
      reason: 'Known honeypot token'
    };
  }

  return { isBlacklisted: false };
}

/**
 * Check if creator is a known bad actor
 */
export function checkCreatorReputation(creatorAddress: string): CreatorReputation {
  const creator = blacklistDatabase.badCreators.get(creatorAddress);

  if (creator) {
    const recommendation =
      creator.confidence === 'CRITICAL'
        ? `❌ CRITICAL: ${creator.rugCount} previous rug pulls - BLACKLIST`
        : creator.confidence === 'HIGH'
          ? `🔴 HIGH RISK: ${creator.rugCount} rug pulls - Avoid`
          : creator.confidence === 'MEDIUM'
            ? `⚠️ CAUTION: ${creator.rugCount} rug pulls - Small position only`
            : `ℹ️ INFO: ${creator.rugCount} rug pull(s) - Monitor`;

    return {
      isBlacklisted: creator.confidence === 'CRITICAL',
      rugCount: creator.rugCount,
      confidence: creator.confidence,
      recommendation
    };
  }

  return {
    isBlacklisted: false,
    rugCount: 0,
    confidence: 'LOW',
    recommendation: '✅ Creator not found in blacklist'
  };
}

/**
 * Check if wallet address is associated with scams
 */
export function isScammerWallet(walletAddress: string): boolean {
  return blacklistDatabase.scammerWallets.has(walletAddress);
}

/**
 * Get comprehensive token check against blacklist
 */
export function comprehensiveBlacklistCheck(tokenData: {
  mintAddress: string;
  creatorAddress: string;
  buyerAddresses?: string[];
}): {
  isApproved: boolean;
  flags: string[];
  overallRisk: number; // 0-100
  recommendation: string;
} {
  const flags: string[] = [];
  let riskScore = 0;

  // 1. Check token blacklist
  const tokenCheck = isTokenBlacklisted(tokenData.mintAddress);
  if (tokenCheck.isBlacklisted) {
    flags.push(`🔴 TOKEN BLACKLIST: ${tokenCheck.reason}`);
    riskScore += 100; // Automatic rejection
  }

  // 2. Check creator reputation
  const creatorCheck = checkCreatorReputation(tokenData.creatorAddress);
  if (creatorCheck.isBlacklisted) {
    flags.push(`🔴 CREATOR BLACKLIST: ${creatorCheck.recommendation}`);
    riskScore += 80;
  } else if (creatorCheck.rugCount >= 2) {
    flags.push(`⚠️ CREATOR HISTORY: ${creatorCheck.recommendation}`);
    riskScore += creatorCheck.rugCount * 20;
  }

  // 3. Check buyer wallets
  if (tokenData.buyerAddresses && tokenData.buyerAddresses.length > 0) {
    const scammerCount = tokenData.buyerAddresses.filter(addr =>
      isScammerWallet(addr)
    ).length;

    if (scammerCount > 0) {
      flags.push(`⚠️ SCAMMER WALLETS: ${scammerCount} scammer wallet(s) involved`);
      riskScore += Math.min(50, scammerCount * 10);
    }
  }

  const isApproved = riskScore < 50 && !tokenCheck.isBlacklisted;

  const recommendation =
    riskScore >= 80
      ? '❌ CRITICAL: Multiple blacklist flags - REJECT'
      : riskScore >= 50
        ? '⚠️ HIGH RISK: Blacklist indicators found - Avoid'
        : riskScore >= 25
          ? '⚠️ MEDIUM RISK: Some history concerns'
          : '✅ SAFE: Not in blacklist database';

  return {
    isApproved,
    flags,
    overallRisk: Math.min(riskScore, 100),
    recommendation
  };
}

/**
 * Get database statistics
 */
export function getDatabaseStats(): {
  totalRugPulls: number;
  totalBadCreators: number;
  totalHoneypots: number;
  totalScammers: number;
  averageLossPerRug: number;
  lastUpdated: Date;
} {
  const totalLosses = Array.from(blacklistDatabase.rugPulls.values()).reduce(
    (sum, record) => sum + record.losses.estimatedUSDLoss,
    0
  );

  const avgLoss =
    blacklistDatabase.rugPulls.size > 0
      ? totalLosses / blacklistDatabase.rugPulls.size
      : 0;

  return {
    totalRugPulls: blacklistDatabase.rugPulls.size,
    totalBadCreators: blacklistDatabase.badCreators.size,
    totalHoneypots: blacklistDatabase.honeypotTokens.size,
    totalScammers: blacklistDatabase.scammerWallets.size,
    averageLossPerRug: avgLoss,
    lastUpdated: blacklistDatabase.lastUpdated
  };
}

/**
 * Initialize sample data for testing
 */
export function initializeSampleData(): void {
  logger.info('[BLACKLIST-DB] Initializing sample blacklist data...');

  // Add some sample rug pulls (these would come from real sources in production)
  addRugPullRecord({
    tokenMint: 'SampleRugToken1234567890123456789012',
    creatorAddress: 'BadCreator1111111111111111111111111111',
    rugDate: new Date(),
    rugType: 'LIQUIDITY_DRAIN',
    losses: {
      affectedWallets: 150,
      estimatedUSDLoss: 45000
    },
    notes: 'Sample rug pull for testing'
  });

  // Add honeypot token
  addHoneypotToken('HoneypotToken23456789012345678901234');

  // Add scammer wallet
  addScammerWallet('ScammerWallet111111111111111111111111');

  logger.info('[BLACKLIST-DB] Sample data initialized');
}

/**
 * Export database for external use (sync with other systems)
 */
export function exportDatabase(): string {
  const stats = getDatabaseStats();

  return JSON.stringify({
    stats,
    rugPulls: Array.from(blacklistDatabase.rugPulls.values()),
    badCreators: Array.from(blacklistDatabase.badCreators.values()),
    honeypotTokens: Array.from(blacklistDatabase.honeypotTokens),
    scammerWallets: Array.from(blacklistDatabase.scammerWallets),
    exportedAt: new Date().toISOString()
  }, null, 2);
}

// Initialize on module load
export const initializeBlacklistModule = (() => {
  loadBlacklistDatabase();
  logger.info('[BLACKLIST-DB] Blacklist module initialized');
})();

// Types exported via declarations above
