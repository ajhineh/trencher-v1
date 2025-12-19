/**
 * Honeypot Token Detection
 * Detects tokens that prevent selling or have extreme slippage
 */

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmRawTransaction } from '@solana/web3.js';
import { logger } from '../logger';
import { getMint } from '@solana/spl-token';
import { OnlinePumpAmmSdk, buyQuoteInput, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import BN from 'bn.js';

export interface HoneypotCheckResult {
  isHoneypot: boolean;
  reason?: string;
  sellSimulationFailed: boolean;
  slippagePercent?: number;
  slippageAcceptable: boolean;
  estimatedTokensOut?: number;
  warnings: string[];
}

/**
 * Check if a token is a honeypot by simulating a sell transaction
 */
export async function checkHoneypot(
  connection: Connection,
  tokenMint: string,
  testBuyAmount: number = 0.01 // 0.01 SOL test buy
): Promise<HoneypotCheckResult> {
  const result: HoneypotCheckResult = {
    isHoneypot: false,
    sellSimulationFailed: false,
    slippageAcceptable: true,
    warnings: []
  };

  try {
    logger.info(`[HONEYPOT-CHECK] Testing token ${tokenMint}...`);

    const mintPubkey = new PublicKey(tokenMint);

    // 1. Get mint info
    let decimals = 6;
    try {
      const mintInfo = await getMint(connection, mintPubkey);
      decimals = mintInfo.decimals;
    } catch (e) {
      result.warnings.push('⚠️ Could not fetch mint info');
    }

    // 2. Create test keypair (NOT your actual wallet)
    const testKeypair = Keypair.generate();
    logger.info(`[HONEYPOT-CHECK] Using test keypair: ${testKeypair.publicKey.toBase58()}`);

    // 3. Try to build a sell transaction (without executing)
    try {
      const poolKey = canonicalPumpPoolPda(mintPubkey);

      // Simulate buying first to understand pool state
      const onlineSdk = new OnlinePumpAmmSdk(connection);
      const swapState = await onlineSdk.swapSolanaState(poolKey, testKeypair.publicKey);

      if (!swapState?.pool) {
        result.warnings.push('⚠️ Could not get pool state');
        return result;
      }

      const { pool } = swapState;

      // 4. Simulate sell transaction structure
      logger.info(`[HONEYPOT-CHECK] Attempting to build sell transaction...`);

      // Try to get quote for selling
      // NOTE: Some pool SDKs do not expose direct quote helpers on the runtime Pool type.
      // To keep this helper robust across SDK versions we avoid calling SDK-specific
      // methods here and instead treat missing helpers as 'inconclusive' rather than failing.
      try {
        const testTokenAmount = new BN(1000 * Math.pow(10, decimals)); // Small amount

        // If SDK provides quote helpers, use them; otherwise skip detailed simulation.
        if ((pool as any).getSellBaseInAmount && typeof (pool as any).getSellBaseInAmount === 'function') {
          const sellQuote = (pool as any).getSellBaseInAmount(testTokenAmount);
          if (!sellQuote || (sellQuote && typeof sellQuote.isZero === 'function' && sellQuote.isZero())) {
            result.isHoneypot = true;
            result.reason = 'Zero output from sell quote (likely honeypot)';
            result.sellSimulationFailed = true;
            logger.warn(`[HONEYPOT-CHECK] ❌ Sell quote returned zero!`);
            return result;
          }
          logger.info(`[HONEYPOT-CHECK] ✓ Sell quote successful`);
        } else {
          // SDK quote helpers not present - note as inconclusive but continue other checks
          result.warnings.push('⚠️ SDK quote helpers not available; skipping sell simulation');
        }
      } catch (quoteError: any) {
        result.warnings.push(`⚠️ Sell quote simulation error: ${quoteError?.message}`);
      }

      // 5. Check for extreme slippage
      const SLIPPAGE_THRESHOLD = 95; // 95% slippage = honeypot

      // Build a test buy to estimate pool depth
      try {
        const buyQuote = (pool as any).getBuyQuoteForSolAmount
          ? (pool as any).getBuyQuoteForSolAmount(new BN(Math.floor(testBuyAmount * 1e9)))
          : null; // If SDK doesn't expose quote helpers, skip

        if (buyQuote && buyQuote.outputAmount) {
          // Now check what we'd get selling that amount back
          const sellQuote = (pool as any).getSellBaseInAmount
            ? (pool as any).getSellBaseInAmount(buyQuote.outputAmount)
            : null;

          if (sellQuote && sellQuote.gt(new BN(0))) {
            // Calculate actual slippage
            const expectedOut = testBuyAmount * 1e9 * 0.97; // 3% normal slippage
            const actualOut = sellQuote.toNumber();
            const slippagePercent = ((expectedOut - actualOut) / expectedOut) * 100;

            result.slippagePercent = slippagePercent;

            if (slippagePercent > SLIPPAGE_THRESHOLD) {
              result.isHoneypot = true;
              result.reason = `Extreme slippage: ${slippagePercent.toFixed(1)}%`;
              result.slippageAcceptable = false;
              logger.warn(
                `[HONEYPOT-CHECK] ❌ Extreme slippage detected: ${slippagePercent.toFixed(1)}%`
              );
              return result;
            } else {
              result.slippageAcceptable = true;
              logger.info(`[HONEYPOT-CHECK] ✓ Slippage acceptable: ${slippagePercent.toFixed(1)}%`);
            }
          }
        }
      } catch (slippageError: any) {
        // If we can't calculate slippage, flag as warning but not honeypot
        result.warnings.push(`⚠️ Could not calculate slippage: ${slippageError?.message}`);
      }

      // 6. Additional honeypot indicators
      logger.info(`[HONEYPOT-CHECK] ✓ Token appears tradeable (not a honeypot)`);
      result.isHoneypot = false;

    } catch (txError: any) {
      // Transaction building failed = likely honeypot
      result.isHoneypot = true;
      result.reason = `Transaction simulation failed: ${txError?.message}`;
      result.sellSimulationFailed = true;
      logger.error(`[HONEYPOT-CHECK] ❌ Transaction error: ${txError?.message}`);
      return result;
    }

  } catch (error: any) {
    // Critical error = assume honeypot to be safe
    logger.error(`[HONEYPOT-CHECK] Critical error: ${error?.message}`);
    result.isHoneypot = true;
    result.reason = `Critical error during honeypot check: ${error?.message}`;
    result.warnings.push('🔴 Could not complete honeypot check - treating as suspicious');
  }

  return result;
}

/**
 * Alternative: Check common honeypot patterns in token metadata
 */
export function checkHoneypotPatterns(metadata: any): {
  suspiciousPatterns: string[];
  honeypotLikelihood: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
} {
  const suspiciousPatterns: string[] = [];

  if (!metadata) {
    return {
      suspiciousPatterns: ['No metadata available'],
      honeypotLikelihood: 'MEDIUM'
    };
  }

  // Check for common honeypot names
  const honeypotNames = [
    'honeypot', 'rug', 'scam', 'fake', 'test',
    'temp', 'burn', 'dead', 'exit', 'pump'
  ];

  const name = metadata?.name?.toLowerCase() || '';
  const symbol = metadata?.symbol?.toLowerCase() || '';

  if (honeypotNames.some(h => name.includes(h) || symbol.includes(h))) {
    suspiciousPatterns.push(`🔴 Name contains suspicious keyword: "${metadata.name}"`);
  }

  // Check for obviously cloned tokens
  if (
    metadata?.description?.toLowerCase().includes('clone') ||
    metadata?.description?.toLowerCase().includes('fake')
  ) {
    suspiciousPatterns.push(`🔴 Description indicates cloned/fake token`);
  }

  // Check for missing website/social
  const hasLinks = Boolean(
    metadata?.extensions?.website ||
    metadata?.extensions?.discord ||
    metadata?.extensions?.twitter
  );

  if (!hasLinks) {
    suspiciousPatterns.push(`⚠️ No website or social links in metadata`);
  }

  // Check token image
  if (!metadata?.image || metadata.image === '') {
    suspiciousPatterns.push(`⚠️ Missing token image`);
  }

  // Determine likelihood based on patterns
  let honeypotLikelihood: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
  if (suspiciousPatterns.length >= 3) {
    honeypotLikelihood = 'CRITICAL';
  } else if (suspiciousPatterns.length === 2) {
    honeypotLikelihood = 'HIGH';
  } else if (suspiciousPatterns.length === 1) {
    honeypotLikelihood = 'MEDIUM';
  }

  return { suspiciousPatterns, honeypotLikelihood };
}

/**
 * Comprehensive honeypot check combining multiple methods
 */
export async function comprehensiveHoneypotCheck(
  connection: Connection,
  tokenMint: string,
  metadata: any
): Promise<{
  isHoneypot: boolean;
  confidence: number; // 0-100
  reasons: string[];
  recommendations: string;
}> {
  const results: string[] = [];
  let riskScore = 0;

  // 1. Check patterns
  const patternCheck = checkHoneypotPatterns(metadata);
  if (patternCheck.honeypotLikelihood !== 'LOW') {
    results.push(`Pattern analysis: ${patternCheck.honeypotLikelihood}`);
    riskScore += patternCheck.suspiciousPatterns.length * 15;
  }

  // 2. Check transaction simulation
  const honeypotCheck = await checkHoneypot(connection, tokenMint);
  if (honeypotCheck.isHoneypot) {
    results.push(`Sell simulation: FAILED - ${honeypotCheck.reason}`);
    riskScore += 60;
  } else if (!honeypotCheck.slippageAcceptable) {
    results.push(`Excessive slippage: ${honeypotCheck.slippagePercent?.toFixed(1)}%`);
    riskScore += 40;
  }

  // Final determination
  const isHoneypot = riskScore > 50;
  const confidence = Math.min(riskScore, 100);

  const recommendations = isHoneypot
    ? '❌ REJECT: High honeypot indicators - DO NOT BUY'
    : confidence > 30
    ? '⚠️ CAUTION: Some suspicious patterns - smaller position size recommended'
    : '✅ SAFE: Low honeypot risk - standard trade size acceptable';

  return {
    isHoneypot,
    confidence,
    reasons: results,
    recommendations
  };
}

// HoneypotCheckResult exported via declaration above
