// src/sniper-bot.ts
import dotenv from 'dotenv';
dotenv.config();
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair, Transaction, ParsedTransactionWithMeta } from '@solana/web3.js';
import { executeBuy } from './executebuy';
import { sendTelegram } from './telegram';
import { loadWalletFromEnv } from './wallet';
import { executeSell } from './executesell';
import { WSOLManager } from './wsol-manager';
import { getPriceMonitor, WebSocketPriceMonitor } from './websocket-price-monitor';
import packageJson from '../package.json';
import { logger, logTestResult, logTestRejection, logPool } from './logger';
import { runEnhancedSecurityChecks, formatSecurityReport } from './security-checks';
import pLimit from 'p-limit';
import bs58 from "bs58";
import { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda } from "@pump-fun/pump-swap-sdk";
import { getTradeHistory } from './state/tradeHistory';

// === Agent + Risk + Trading Tools ===
import { basicRiskFilter } from "./risk/basicRiskFilter";
import { askAgentForAction } from "./agent/agentClient";
import { executeBuyTool } from "./agentTools/executeBuyTool";
import { saveNewPosition } from "./state/positions";

// === Unified Architecture ===
import { UnifiedTokenDetector } from "./detection/unifiedTokenDetector";
import { TokenValidator } from "./validation/tokenValidator";
import { DexRouter } from "./execution/dexRouter";
// ENV
const RPC_URL = process.env.RPC_URL as string;
const TRADER_PRIVATE_KEY = process.env.TRADER_PRIVATE_KEY as string;
// === Constants ===
import { QUOTE_MINT_WSOL } from "./constants/tokenAddresses";
// === Types ===
import type { NewPoolEvent } from "./workflow/handleNewPool";

import { handlePriceUpdate } from "./trading/autoSell";


const DEFAULT_PUMPSWAP_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const PUMPSWAP_PROGRAM_ID = process.env.PUMPSWAP_PROGRAM_ID ?? DEFAULT_PUMPSWAP_PROGRAM_ID;
const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';

if (!RPC_URL) {
  logger.error("ERROR: Set RPC_URL in .env file.");
  process.exit(1);
}

const connection = new Connection(RPC_URL, { commitment: "confirmed" });
const limit = pLimit(5);

type TokenMetadata = {
  name: string;
  symbol: string;
  decimals: number;
  supply?: number;
};

interface ActivePosition {
  mint: string;
  symbol: string;
  decimals: number;
  purchasePrice: number;
  buyTxSignature: string;
  highestPrice: number;
  tokenAmount: number;
}

const activePositions: { [mint: string]: ActivePosition } = {};

const LOG_KEYWORDS = ['CreateAndBuy', 'initialize_pool', 'CreatePool', 'create_pool', 'finish_bond'];

const AUTO_BUY = (process.env.AUTO_BUY ?? "true").toLowerCase() === "true";
const BUY_AMOUNT_SOL = Number(process.env.BUY_AMOUNT_SOL ?? "0.00005");
const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD ?? "500");
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? "300");
const SKIP_PREFLIGHT = (process.env.SKIP_PREFLIGHT ?? "true").toLowerCase() === "true";
const PROFIT_TRANSFER_THRESHOLD = Number(process.env.PROFIT_TRANSFER_THRESHOLD ?? "0");
const BYPASS_BONDING_CURVE = (process.env.BYPASS_BONDING_CURVE ?? "true").toLowerCase() === "true";

const BUYER_MONITOR_WINDOW_SEC = Number(process.env.BUYER_MONITOR_WINDOW_SEC ?? "10");
const MIN_BUYERS_IN_WINDOW = Number(process.env.MIN_BUYERS_IN_WINDOW ?? "5");
const BUYER_MONITOR_POLL_MS = Number(process.env.BUYER_MONITOR_POLL_MS ?? "1000");

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let cachedSolPrice: number = 0;
let lastFetchTimestamp: number = 0;
const CACHE_DURATION_MS = 5000;

async function getSolPriceUSD(): Promise<number> {
  const now = Date.now();
  if (cachedSolPrice > 0 && now - lastFetchTimestamp < CACHE_DURATION_MS) return cachedSolPrice;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await response.json() as { solana?: { usd?: number } };
    const newPrice = data?.solana?.usd ?? 0;
    if (newPrice > 0) {
      cachedSolPrice = newPrice;
      lastFetchTimestamp = now;
    }
    return newPrice;
  } catch (error: any) {
    logger.error(`Error fetching SOL price: ${error?.message ?? error}`);
    return cachedSolPrice || 0;
  }
}

async function getTokenMetadata(mintAddress: string): Promise<TokenMetadata> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(RPC_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'helius-get-asset',
        method: 'getAsset',
        params: { id: mintAddress },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const json = await response.json() as any;
    const result = json?.result;
    const decimals = result?.spl_token_info?.decimals ?? 6;
    return {
      name: result?.content?.metadata?.name ?? 'Unknown Name',
      symbol: result?.content?.metadata?.symbol ?? 'UNKNOWN',
      decimals,
      supply: result?.content?.metadata?.supply ? Number(result.content.metadata.supply) : undefined,
    };
  } catch (error: any) {
    logger.error(`Error fetching metadata for ${mintAddress}: ${error?.message ?? error}`);
    return { name: 'Unknown Name', symbol: 'UNKNOWN', decimals: 6 };
  }
}


// همان discriminator تعریف شده در pump_amm.json برای create_pool
const CREATE_POOL_DISCRIMINATOR = Buffer.from([
  233, 146, 209, 142, 207, 104, 64, 188,
]);

function normalizeKey(k: any): string {
  if (!k) return "undefined";

  if (typeof k === "string") return k;
  if (typeof k.toBase58 === "function") return k.toBase58();

  if (k.pubkey) {
    if (typeof k.pubkey === "string") return k.pubkey;
    if (typeof k.pubkey.toBase58 === "function")
      return k.pubkey.toBase58();
  }

  try {
    return k.toString();
  } catch {
    return JSON.stringify(k);
  }
}

/**
 * پیدا کردن instruction مربوط به create_pool روی برنامه Pump AMM
 * و برگردوندن خود instruction + message
 */
function findCreatePoolInstruction(parsedTx: ParsedTransactionWithMeta) {
  const msg: any = parsedTx.transaction.message;
  const insts: any[] = msg.instructions || [];

  const pumpAmmIdStr = PUMP_AMM_PROGRAM_ID.toBase58();

  for (const ix of insts) {
    const programIdStr = normalizeKey(ix.programId);
    if (programIdStr !== pumpAmmIdStr) continue;

    if (!ix.data || typeof ix.data !== "string") continue;

    let dataBytes: Buffer;
    try {
      dataBytes = Buffer.from(bs58.decode(ix.data));
    } catch {
      continue;
    }
    if (dataBytes.length < 8) continue;

    const disc = dataBytes.subarray(0, 8);
    if (disc.equals(CREATE_POOL_DISCRIMINATOR)) {
      // این همون create_poolـه
      return { msg, ix };
    }
  }

  return null;
}

export async function extractTransactionInfo(
  parsedTx: ParsedTransactionWithMeta,
  connection: Connection
): Promise<{
  newPoolTokenMint: string;
  poolAddress: string;
  solAmount: number;
  tokenAmount: number;
} | null> {
  try {
    if (!parsedTx?.transaction?.message) return null;
    const rawMsg = parsedTx.transaction.message;
    logger.info("DEBUG accountKeys:\n" + JSON.stringify(rawMsg.accountKeys, null, 2));
    logger.info("DEBUG instructions:\n" + JSON.stringify(rawMsg.instructions, null, 2));


    const { msg, ix } = (() => {
      const res = findCreatePoolInstruction(parsedTx);
      if (!res) return { msg: parsedTx.transaction.message, ix: null as any };
      return res;
    })();

    const accountKeys: any[] = msg.accountKeys || [];
    const postTokenBalances = parsedTx.meta?.postTokenBalances || [];

    let newPoolTokenMint: string | null = null;
    let poolAddress: string | null = null;

    if (ix) {
      // در getParsedTransaction, ix.accounts خودش لیست pubkeyهاست (string یا PublicKey)
      const accounts: any[] = ix.accounts || [];

      const poolAcc = accounts[0];  // pool PDA
      const baseMintAcc = accounts[4]; // base mint = مینت توکن جدید

      poolAddress = normalizeKey(poolAcc);
      newPoolTokenMint = normalizeKey(baseMintAcc);
    } else {
      // همون منطق قبلی fallback برای روزای عجیب
      const positiveMints = postTokenBalances
        .filter((b: any) => (b.uiTokenAmount?.uiAmount || 0) > 0)
        .map((b: any) => b.mint);

      newPoolTokenMint =
        positiveMints.find((m: string) => m !== SOL_MINT_ADDRESS) ||
        (accountKeys[7] ? normalizeKey(accountKeys[7]) : null);

      poolAddress = null;
    }


    if (!newPoolTokenMint || !poolAddress) {
      logger.warn(
        `[extractTransactionInfo] Could not resolve mint or pool (mint=${newPoolTokenMint}, pool=${poolAddress})`
      );
      return null;
    }

    // محاسبه مقدار SOL مصرف‌شده
    const pre0 = parsedTx.meta?.preBalances?.[0] || 0;
    const post0 = parsedTx.meta?.postBalances?.[0] || 0;
    const solAmount = (pre0 - post0) / LAMPORTS_PER_SOL;

    // مقدار توکن (در صورت migrate از pumpfun)
    const tokenAmount =
      postTokenBalances.find((b: any) => b.mint === newPoolTokenMint)
        ?.uiTokenAmount?.uiAmount || 0;

    logger.info(
      `[extractTransactionInfo] ✅ New mint: ${newPoolTokenMint}, pool: ${poolAddress}, SOL: ${solAmount}, Tokens: ${tokenAmount}`
    );

    return { newPoolTokenMint, poolAddress, solAmount, tokenAmount };
  } catch (error: any) {
    logger.error(
      `Error extracting transaction info: ${error?.message ?? error}`
    );
    return null;
  }
}

/*async function buyWithPumpSwapDirect(
  mintPubkey: PublicKey,
  poolPubkey: PublicKey
): Promise<string | null> {
  try {
    const lamports = BigInt(
      Math.floor(BUY_AMOUNT_SOL * LAMPORTS_PER_SOL)
    );
    if (lamports <= 0n) {
      logger.error("[BUY-DIRECT] BUY_AMOUNT_SOL must be > 0");
      return null;
    }

    const BUY_DELAY_MS = Number(process.env.BUY_DELAY_MS || 0);
    if (BUY_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, BUY_DELAY_MS));
      logger.info(
        `[BUY-DIRECT] Applied ${BUY_DELAY_MS / 1000}-second delay — buying now!`
      );
    }

    logger.info(
      `[BUY-DIRECT] executeDirectBuy(mint=${mintPubkey.toBase58()}, pool=${poolPubkey.toBase58()}, lamports=${lamports.toString()}, slippageBps=${SLIPPAGE_BPS})`
    );

    const sig = await executeDirectBuy(
      connection,
      poolPubkey,
      mintPubkey,
      keypair,
      lamports,
      SLIPPAGE_BPS,
      SKIP_PREFLIGHT
    );

    if (!sig) {
      logger.error("[BUY-DIRECT] executeDirectBuy returned null");
      return null;
    }

    logger.info(
      `[BUY-DIRECT] ✅ Buy successful: https://solscan.io/tx/${sig}`
    );
    return sig;
  } catch (err: any) {
    logger.error(
      `[BUY-DIRECT] Error in buyWithPumpSwapDirect: ${err?.message ?? err}`
    );
    return null;
  }
}*/


async function buyWithPumpSdk(
  mintPubkey: PublicKey,
  poolInfo?: { solAmount: number; tokenAmount: number }   // فعلاً نگه می‌داریم ولی استفاده نمی‌کنیم
): Promise<string | null> {
  try {
    const lamportsBigInt = BigInt(Math.floor(BUY_AMOUNT_SOL * LAMPORTS_PER_SOL));
    if (lamportsBigInt <= 0n) {
      logger.error('[BUY] BUY_AMOUNT_SOL must be > 0');
      return null;
    }

    const BUY_DELAY_MS = Number(process.env.BUY_DELAY_MS || 0);

    if (BUY_DELAY_MS > 0) {
      await new Promise(resolve => setTimeout(resolve, BUY_DELAY_MS));
      logger.info(`[BUY] Applied ${BUY_DELAY_MS / 1000}-second delay — buying now!`);
    }

    logger.info(
      `[BUY] executeBuy(mint=${mintPubkey.toBase58()}, lamports=${lamportsBigInt.toString()}, slippageBps=${SLIPPAGE_BPS})`
    );

    const sig = await executeBuy(
      connection,
      mintPubkey,
      keypair,
      lamportsBigInt,
      SLIPPAGE_BPS,
      SKIP_PREFLIGHT,
    );

    return sig;
  } catch (err: any) {
    logger.error(`[BUY] Error in buyWithPumpSdk: ${err?.message ?? err}`);
    return null;
  }
}


async function verifyBuyTransaction(
  conn: Connection,
  signature: string,
  walletPubkey: PublicKey,
  tokenMint: string,
  expectedSolAmount: number
): Promise<{ success: boolean; tokenAmount: number; purchasePrice: number }> {
  try {
    const tx = await conn.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx || tx.meta?.err)
      return { success: false, tokenAmount: 0, purchasePrice: 0 };

    const postBalances = tx.meta?.postTokenBalances ?? [];
    const ourTokenAccounts = postBalances.filter(
      (b: any) => b.owner === walletPubkey.toBase58() && b.mint === tokenMint
    );

    if (ourTokenAccounts.length === 0)
      return { success: false, tokenAmount: 0, purchasePrice: 0 };

    const tokenAccount = ourTokenAccounts[0];

    const pre =
      tx.meta?.preTokenBalances?.find((b: any) => b.accountIndex === tokenAccount.accountIndex)
        ?.uiTokenAmount?.uiAmount ?? 0;
    const post = tokenAccount.uiTokenAmount?.uiAmount ?? 0;

    const tokenAmount = post - pre;
    if (tokenAmount <= 0) return { success: false, tokenAmount: 0, purchasePrice: 0 };

    const purchasePrice = expectedSolAmount / tokenAmount;

    return { success: true, tokenAmount, purchasePrice };
  } catch (error: any) {
    logger.error(`[VERIFY] Error: ${error?.message ?? String(error)}`);
    return { success: false, tokenAmount: 0, purchasePrice: 0 };
  }
}

const buyerCache: Map<string, { count: number; timestamp: number }> = new Map();

async function getRecentBuyersCount(mint: string, windowSec: number): Promise<number> {
  try {
    const mintPubkey = new PublicKey(mint);
    const limit = 50; // Fetch last 50 txs to estimate activity
    const signatures = await connection.getSignaturesForAddress(mintPubkey, { limit });

    if (signatures.length === 0) return 0;

    const now = Date.now() / 1000;
    const windowStart = now - windowSec;

    // Count transactions within the time window
    const recentActivity = signatures.filter(sig =>
      (sig.blockTime || 0) >= windowStart && !sig.err
    );

    const count = recentActivity.length;

    // Cache for display/logging if needed
    buyerCache.set(mint, { count, timestamp: Date.now() });

    // If we hit the limit (50), the actual count is likely higher
    if (count === limit) {
      logger.info(`[Market] High activity detected for ${mint} (>=${limit} txs in ${windowSec}s)`);
    }

    return count;
  } catch (error: any) {
    logger.warn(`[Market] Failed to fetch buyer count for ${mint}: ${error.message}`);
    return 0; // Fail safe
  }
}

async function startStrategyMonitor(
  mint: string,
  entryPrice: number,
  tokenAmount: number,
  symbol: string,
  decimals: number,
  buySig: string
): Promise<void> {
  logger.info(`[STRAT] Monitoring started for ${mint} (${symbol}) at ${new Date().toISOString()}`);

  const tpFactor = Number(process.env.TAKE_PROFIT_PERCENT ?? "200") / 100 + 1;
  const slPercent = Number(process.env.STOP_LOSS_PERCENT ?? "50") / 100;

  const startTime = Date.now();
  let highestPrice = entryPrice;
  let lastPriceChange = Date.now();
  let pollMs = 1500;

  // Track active position for graceful shutdown
  activePositions[mint] = {
    mint,
    symbol,
    decimals,
    purchasePrice: entryPrice,
    buyTxSignature: buySig,
    highestPrice,
    tokenAmount,
  };

  const buyerCheckInterval = setInterval(async () => {
    try {
      const recentBuyers = await getRecentBuyersCount(mint, BUYER_MONITOR_WINDOW_SEC);
      if (recentBuyers < MIN_BUYERS_IN_WINDOW) {
        logger.info(
          `[STRAT] BuyerActivityMonitor triggered for ${symbol} (${mint}) - ` +
          `${recentBuyers} buys in last ${BUYER_MONITOR_WINDOW_SEC}s (min: ${MIN_BUYERS_IN_WINDOW}). Selling...`
        );
        await executeSell(mint, tokenAmount, connection, keypair, SLIPPAGE_BPS, SKIP_PREFLIGHT);
        await checkAndTransferProfitsIfNeeded(PROFIT_TRANSFER_THRESHOLD);
        clearInterval(buyerCheckInterval);
      }
    } catch (error: any) {
      logger.warn(`[STRAT] Buyer monitor error for ${mint}: ${error?.message ?? error}`);
    }
  }, BUYER_MONITOR_POLL_MS);

  try {
    while (true) {
      await sleep(pollMs);
      const currentPrice = await priceMonitor.getCurrentPrice(mint);
      if (!currentPrice) continue;

      const priceChange = Math.abs(currentPrice - highestPrice);
      if (priceChange > 0.01 * entryPrice) {
        pollMs = 500;
        lastPriceChange = Date.now();
      } else if (Date.now() - lastPriceChange > 5000) {
        pollMs = 2000;
      }

      highestPrice = Math.max(highestPrice, currentPrice);

      if (currentPrice >= entryPrice * tpFactor) {
        logger.info(`[STRAT] TP reached for ${symbol} (${mint}). Selling...`);
        await executeSell(mint, tokenAmount, connection, keypair, SLIPPAGE_BPS, SKIP_PREFLIGHT);
        await checkAndTransferProfitsIfNeeded(PROFIT_TRANSFER_THRESHOLD);
        break;
      }

      if (currentPrice <= entryPrice * (1 - slPercent)) {
        logger.info(`[STRAT] SL reached for ${symbol} (${mint}). Selling...`);
        await executeSell(mint, tokenAmount, connection, keypair, SLIPPAGE_BPS, SKIP_PREFLIGHT);
        await checkAndTransferProfitsIfNeeded(PROFIT_TRANSFER_THRESHOLD);
        break;
      }
    }
  } finally {
    logger.info(`[STRAT] Monitor finished for ${mint}`);
    clearInterval(buyerCheckInterval);
    delete activePositions[mint];
  }
}

async function handleLogNotification(logInfo: any, source: string) {
  if (process.env.ONE_TRADE_MODE === "true" && Object.keys(activePositions).length > 0) return;

  try {
    const logs = logInfo.logs ?? [];
    const joinedLogs = logs.join(' ').toLowerCase();
    if (!LOG_KEYWORDS.some(k => joinedLogs.includes(k.toLowerCase()))) return;

    const signature = logInfo.signature;
    logger.info(`[EVENT] Detected from ${source}! Signature: ${signature}`);

    let parsedTx: ParsedTransactionWithMeta | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        parsedTx = await connection.getParsedTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        if (parsedTx) break;
      } catch (e) {
        if (attempt === 2) throw e;
        await sleep(500);
      }
    }
    if (!parsedTx) {
      logger.warn(`[WARN] Could not fetch parsed transaction for ${signature}`);
      return;
    }


    /**
     * 🔥 فیلتر مستقیم PumpSwap:
     * فقط تراکنش‌هایی که create_pool REAL دارند اجازه ادامه دارند.
     */
    const createPool = findCreatePoolInstruction(parsedTx);
    if (!createPool) {
      logger.info(`[SKIP] Not a create_pool event → ignoring`);
      return;
    }

    const info = await extractTransactionInfo(parsedTx, connection);
    if (!info) return;

    const { newPoolTokenMint, solAmount, tokenAmount, poolAddress } = info;

    const [tokenMetadata, solPrice, security] = await Promise.all([
      limit(() => getTokenMetadata(newPoolTokenMint)),
      limit(() => getSolPriceUSD()),
      limit(() => runEnhancedSecurityChecks(connection, newPoolTokenMint, tokenAmount, 6))
    ]);

    const totalLiquidityUSD = 2 * solAmount * solPrice;

    if (process.env.DISABLE_SECURITY_CHECK === "true") {
      logger.warn("[TEST] Security checks bypassed for testing.");
    } else {
      if (totalLiquidityUSD < MIN_LIQUIDITY_USD) {
        logger.info(
          `[SKIP] ${tokenMetadata.symbol} - Low liquidity: ${totalLiquidityUSD} < ${MIN_LIQUIDITY_USD}`
        );
        await logTestRejection({
          symbol: tokenMetadata.symbol,
          tokenMint: newPoolTokenMint,
          rejectionReason: `Low liquidity: ${totalLiquidityUSD} < ${MIN_LIQUIDITY_USD}`,
        });
        return;
      }

      const securityReport = formatSecurityReport(security);
      if (!security.ok) {
        logger.info(
          `[SKIP] ${tokenMetadata.symbol} - Security issues:\n${securityReport}`
        );
        await logTestRejection({
          symbol: tokenMetadata.symbol,
          tokenMint: newPoolTokenMint,
          rejectionReason: `Security issues: ${securityReport}`,
        });
        return;
      }
    }

    await logPool(
      signature,
      tokenMetadata.name,
      tokenMetadata.symbol,
      solPrice,
      totalLiquidityUSD
    );

    if (AUTO_BUY) {
      const mintPubkey = new PublicKey(newPoolTokenMint);
      const poolPubkey = new PublicKey(info.poolAddress);
      logger.info(`[BUY] New PumpSwap token detected: mint=${mintPubkey.toBase58()}, pool=${poolPubkey.toBase58()}`);

      const canonicalPool = canonicalPumpPoolPda(mintPubkey);
      const canonicalStr = canonicalPool.toBase58();

      const isPumpfunPool = (canonicalStr === info.poolAddress);
      // مقادیر لازم برای Risk و Agent را از داده‌های موجود می‌سازیم

      // سازنده توکن – این فیلد را با توجه به ساختار info خودت اصلاح کن
      const raw = info as any;
      const coinCreatorAddress = raw.creator || raw.coinCreator || "";

      // تعداد اعشار توکن – از متادیتای توکن
      const tokenDecimals: number = (tokenMetadata.decimals as number) ?? 9;

      // زمان ایجاد pool – اگر blockTime در info هست از آن استفاده کن
      const poolCreationMs = (raw.blockTime ?? (Date.now() / 1000)) * 1000;


      // نقدینگی بر اساس همان چیزی که بالا حساب کردی
      const poolLiquidityInfo = {
        liquidityUsd: totalLiquidityUSD,
      };

      // تعداد خریداران اخیر – فعلاً placeholder تا بعداً به مانیتور واقعی وصلش کنی
      const recentBuyers = 1;

      // تخمین FDV – موقت، بعداً می‌تونی جدی‌تر حساب کنی
      const fdvEstimate = totalLiquidityUSD * 2;


      let buySig: string | null = null;

      // ------------------------------------------
      // 🔥 مسیر دوحالته دقیقاً همینجاست
      // ------------------------------------------
      if (isPumpfunPool) {
        logger.info(`[BUY] pumpfun-style detected → TEMPORARILY DISABLED`);
        return;
      } else {

        logger.info(`[BUY] Direct PumpSwap detected → Passing through Risk Filter...`);

        // 1) مرحله اول: سخت‌گیرانه‌ترین فیلتر ریسک
        const risk = await basicRiskFilter({
          pool: poolPubkey.toBase58(),
          baseMint: mintPubkey.toBase58(),
          quoteMint: QUOTE_MINT_WSOL,
          coinCreator: coinCreatorAddress,
          liquidityUsd: poolLiquidityInfo?.liquidityUsd ?? 0,
          recentBuyers: recentBuyers,
          ageMs: Date.now() - poolCreationMs,
          decimals: tokenDecimals,
        });

        if (!risk.approved) {
          logger.warn(`[RISK] REJECTED → ${risk.reason}`);
          return;
        }

        logger.info(`[RISK] Approved → Handing decision to Agent...`);

        // 2) مرحله دوم: Agent تصمیم می‌گیرد که بخریم یا نه
        const agentDecision = await askAgentForAction({
          type: "NEW_POOL",
          pool: poolPubkey.toBase58(),
          baseMint: mintPubkey.toBase58(),
          quoteMint: QUOTE_MINT_WSOL,
          coinCreator: coinCreatorAddress,
          liquidityUsd: poolLiquidityInfo?.liquidityUsd ?? 0,
          recentBuyers: recentBuyers,
          ageMs: Date.now() - poolCreationMs,
          fdv: fdvEstimate,
        });

        if (agentDecision.action !== "BUY") {
          logger.warn(`[AGENT] Rejected BUY → ${agentDecision.reason}`);
          return;
        }

        logger.info(`[AGENT] Approved BUY → amount: ${agentDecision.amountInLamports}`);

        // 3) مرحله سوم: اجرای خرید واقعی با Tool
        const buyResult = await executeBuyTool({
          rpcUrl: RPC_URL,
          pool: poolPubkey.toBase58(),
          baseMint: mintPubkey.toBase58(),
          quoteMint: QUOTE_MINT_WSOL,
          userSecret: TRADER_PRIVATE_KEY,
          amountIn: agentDecision.amountInLamports,
          prioritize: true,
        });

        buySig = buyResult.signature;


        if (!buySig) {
          logger.error(`[ERROR] executeBuyTool did not return signature`);
          return;
        }

        logger.info(`[BUY] SUCCESS — Signature: ${buySig}`);

        // 4) مرحله چهارم: ذخیره پوزیشن برای Auto-Sell

        const buyPriceInQuote = priceMonitor.getCurrentPrice(mintPubkey.toBase58()) ?? 0;

        const pos = saveNewPosition({
          pool: poolPubkey.toBase58(),
          baseMint: mintPubkey.toBase58(),
          quoteMint: QUOTE_MINT_WSOL,
          buySignature: buySig,
          buyAmountLamports: agentDecision.amountInLamports,
          buyPriceInQuote,
          tpPercent: agentDecision.tpPercent,
          slPercent: agentDecision.slPercent,
          openedAt: Date.now(),
        });
      }



      if (!buySig) return;

      // ------------------------------------------
      // 🔍 VERIFY — مشترک برای هر دو مدل launch
      // ------------------------------------------
      const verifyRes = await verifyBuyTransaction(
        connection,
        buySig,
        keypair.publicKey,
        newPoolTokenMint,
        BUY_AMOUNT_SOL
      );

      if (!verifyRes.success) {
        logger.warn(`[BUY] Verification failed for ${newPoolTokenMint}`);
        return;
      }

      // ------------------------------------------
      // 📈 آغاز مانیتور کردن وضعیت توکن
      // ------------------------------------------
      await startStrategyMonitor(
        newPoolTokenMint,
        verifyRes.purchasePrice,
        verifyRes.tokenAmount,
        tokenMetadata.symbol,
        tokenMetadata.decimals,
        buySig
      );

      // ------------------------------------------
      // 🧾 لاگ زدن برای تست
      // ------------------------------------------
      await logTestResult({
        symbol: tokenMetadata.symbol,
        tokenMint: newPoolTokenMint,
        entryTime: new Date().toISOString(),
        buyPrice: verifyRes.purchasePrice,
        entryLiquidity: totalLiquidityUSD,
        solPrice,
        exitTime: '',
        sellPrice: 0,
        exitLiquidity: 0,
        exitReason: '',
        removeLiqTime: '',
      });
    }

  } catch (e: any) {
    logger.error(`[ERROR] handleLogNotification: ${e?.message ?? e}`);
  }
}

// wallet.ts's loadWalletFromEnv returns a Keypair
const keypair: Keypair = loadWalletFromEnv();
const walletWrapper = { keypair, publicKey: keypair.publicKey };

// WSOL manager and price monitor
const wsolManager = new WSOLManager(connection, keypair);

const priceMonitor = getPriceMonitor();
priceMonitor.connect();

priceMonitor.onPriceUpdateFromPumpSwap((update) => {
  handlePriceUpdate({
    pool: update.tokenMint,
    baseMint: update.tokenMint,
    priceInQuote: update.priceInSol,
  });
});

let ctrlCCount = 0;

async function ensureWsolInitialized(required: number) {
  try {
    if (typeof (wsolManager as any).initializeIfNeeded === "function") {
      await (wsolManager as any).initializeIfNeeded(required);
      return true;
    }
    // fallback to original initialize if exists
    if (typeof (wsolManager as any).initialize === "function") {
      await (wsolManager as any).initialize(required);
      return true;
    }
    return true;
  } catch (e) {
    logger.warn(`[WSOL] initialize fallback failed: ${(e as Error).message}`);
    return false;
  }
}

async function checkAndTransferProfitsIfNeeded(threshold: number) {
  try {
    if (typeof (wsolManager as any).checkAndTransferProfits === "function") {
      await (wsolManager as any).checkAndTransferProfits(threshold);
    }
  } catch (e) {
    logger.warn(`[WSOL] checkAndTransferProfits failed: ${(e as Error).message}`);
  }
}

async function main() {
  const botName = packageJson.name.charAt(0).toUpperCase() + packageJson.name.slice(1);
  const botVersion = packageJson.version;
  logger.info(`${botName} v${botVersion} 🦅 STARTING at ${new Date().toISOString()}...`);
  await sendTelegram(`🦅 *${botName} v${botVersion} STARTED* at ${new Date().toISOString()}`);

  if (process.env.AUTO_WRAP_SOL === "true") {
    await wsolManager.initialize(Number(process.env.WRAP_AMOUNT_SOL ?? "0.005"));
  }

  await priceMonitor.connect();

  connection.onLogs(
    new PublicKey(PUMPSWAP_PROGRAM_ID),
    (logInfo) => {
      void handleLogNotification(logInfo, 'PumpSwap');
    },
    'confirmed'
  );

  logger.info(`Subscribed to PumpSwap logs at ${new Date().toISOString()}`);

  // Enhanced Ctrl+C handling: First press = graceful shutdown, Second press = force exit
  process.on('SIGINT', async () => {
    ctrlCCount++;

    if (ctrlCCount === 1) {
      logger.info('⚠️ Ctrl+C pressed once. Initiating graceful shutdown...');
      await sendTelegram(`⚠️ *${botName} v${botVersion}* received Ctrl+C. Graceful shutdown...`);

      // Close WebSocket connection
      if (priceMonitor) {
        priceMonitor.close();
        logger.info('✅ WebSocket connection closed');
      }

      // If no active positions, exit immediately
      if (Object.keys(activePositions).length === 0) {
        logger.info('No active positions. Exiting now.');
        process.exit(0);
      } else {
        logger.info(`Waiting for ${Object.keys(activePositions).length} active position(s) to close...`);
        logger.info('Press Ctrl+C again to force exit and abandon positions.');
      }
    } else {
      // Second Ctrl+C = force exit
      logger.warn('⚠️⚠️ Ctrl+C pressed twice! Force exiting NOW...');
      await sendTelegram(`🚨 *${botName} v${botVersion} FORCE STOPPED* 🚨`);
      process.exit(0);
    }
  });
}

main().catch((e) => {
  logger.error(`Fatal error in main(): ${e?.message ?? e}`);
});
