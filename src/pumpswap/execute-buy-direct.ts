// src/execute-buy-direct.ts
import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  OnlinePumpAmmSdk,
  PUMP_AMM_SDK,
} from "@pump-fun/pump-swap-sdk";
import { logger } from "../logger";

export async function executeDirectBuy(
  connection: Connection,
  poolKey: PublicKey,
  mint: PublicKey,
  keypair: Keypair,
  quoteLamports: bigint,   // مقدار SOL به lamports
  slippageBps: number,     // مثلا 300 = 3%
  skipPreflight: boolean
): Promise<string | null> {
  try {
    if (quoteLamports <= 0n) {
      logger.warn("[BUY-DIRECT] quoteLamports must be > 0");
      return null;
    }

    const onlineSdk = new OnlinePumpAmmSdk(connection);
    const user = keypair.publicKey;

    // ۱) گرفتن state استخر واقعی
    const swapState = await onlineSdk.swapSolanaState(poolKey, user);

    const quote = new BN(quoteLamports.toString());
    const slippagePercent = slippageBps / 100; // 300bps → 3٪

    logger.info(
      `[BUY-DIRECT] swapState loaded for pool=${poolKey.toBase58()}, quote=${quote.toString()}, slippage=${slippagePercent}%`
    );

    // ۲) ساخت instructions خرید با SOL (quote-side)
    const ixs = await PUMP_AMM_SDK.buyQuoteInput(
      swapState,
      quote,
      slippagePercent
    );

    if (!ixs || ixs.length === 0) {
      logger.error(
        "[BUY-DIRECT] PUMP_AMM_SDK.buyQuoteInput returned no instructions"
      );
      return null;
    }

    logger.info(
      `[BUY-DIRECT] SDK produced ${ixs.length} instructions for pool=${poolKey.toBase58()}`
    );

    // ۳) ساخت و ارسال تراکنش
    const latest = await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction({
      feePayer: user,
      recentBlockhash: latest.blockhash,
    }).add(...ixs);

    tx.sign(keypair);

    const raw = tx.serialize();
    const sig = await connection.sendRawTransaction(raw, { skipPreflight });

    logger.info(`[BUY-DIRECT] Sent tx: ${sig}`);

    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );

    logger.info(
      `[BUY-DIRECT] ✅ Confirmed: https://solscan.io/tx/${sig}`
    );

    return sig;
  } catch (e: any) {
    logger.error(
      `[BUY-DIRECT] executeDirectBuy error for pool=${poolKey.toBase58()} mint=${mint.toBase58()}: ${e?.message ?? e
      }`
    );
    return null;
  }
}
