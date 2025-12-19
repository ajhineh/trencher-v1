// src/trading/autoSell.ts
import { executeSellTool } from "../agentTools/executeSellTool";
import { getOpenPositions, closePosition } from "../state/positions";
import { QUOTE_MINT_WSOL } from "../constants/tokenAddresses";
import { logger } from "../logger";

const RPC_URL = process.env.RPC_URL as string;
const TRADER_PRIVATE_KEY = process.env.TRADER_PRIVATE_KEY as string;

export async function handlePriceUpdate(event: {
  pool: string;
  baseMint: string;
  priceInQuote: number; // قیمت فعلی توکن
}) {
  const positions = getOpenPositions().filter(
    (p) =>
      p.pool === event.pool &&
      p.baseMint === event.baseMint
  );

  if (positions.length === 0) return;

  for (const pos of positions) {
    const change =
      (event.priceInQuote - pos.buyPriceInQuote) / pos.buyPriceInQuote;
    const changePercent = change * 100;

    logger.debug(
      `[AUTO-SELL] pos=${pos.id} change=${changePercent.toFixed(2)}% (TP=${pos.tpPercent} SL=${pos.slPercent})`
    );

    // تریگر TP
    if (changePercent >= pos.tpPercent) {
      logger.info(
        `[AUTO-SELL] Trigger TP for pos=${pos.id} at ${changePercent.toFixed(2)}%`
      );
      await triggerSell(pos, event.priceInQuote, "TP");
    }

    // تریگر SL
    if (changePercent <= -Math.abs(pos.slPercent)) {
      logger.info(
        `[AUTO-SELL] Trigger SL for pos=${pos.id} at ${changePercent.toFixed(2)}%`
      );
      await triggerSell(pos, event.priceInQuote, "SL");
    }
  }
}

async function triggerSell(
  pos: any,
  currentPriceInQuote: number,
  reason: "TP" | "SL",
) {
  try {
    const sellRes = await executeSellTool({
      rpcUrl: RPC_URL,
      pool: pos.pool,
      baseMint: pos.baseMint,
      quoteMint: QUOTE_MINT_WSOL,
      userSecret: TRADER_PRIVATE_KEY,
      amountIn: pos.buyAmountLamports, // کل پوزیشن. بعدا می‌تونی partial کنی
      prioritize: true,
    });

    const closed = closePosition(pos.id, {
      closeSignature: sellRes.signature,
      closePriceInQuote: currentPriceInQuote,
    });

    logger.info(
      `[AUTO-SELL] ${reason} done. pos=${pos.id} sig=${sellRes.signature} PnL=${closed?.realizedPnlQuote}`
    );
  } catch (e) {
    logger.error(`[AUTO-SELL] ${reason} failed for pos=${pos.id}`, e);
  }
}
