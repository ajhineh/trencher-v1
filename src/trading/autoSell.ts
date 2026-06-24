// dynamic imports used inside functions to avoid circular dependencies
import type { Position } from "../state/positions";
import { QUOTE_MINT_WSOL } from "../constants/tokenAddresses";
import { logger } from "../logger";

const RPC_URL = process.env.RPC_URL as string;
const TRADER_PRIVATE_KEY = process.env.TRADER_PRIVATE_KEY as string;

export async function handlePriceUpdate(event: {
  pool: string;
  baseMint: string;
  priceInQuote: number;
}) {
  const positionsModule = require("../state/positions");

  const getOpenPositions = positionsModule.getOpenPositions;
  if (typeof getOpenPositions !== 'function') {
    logger.error(`[CRITICAL] getOpenPositions is NOT a function! It is: ${typeof getOpenPositions}`);
    return;
  }

  const positions = getOpenPositions().filter(
    (p: Position) =>
      p.pool === event.pool &&
      p.baseMint === event.baseMint
  );

  if (positions.length === 0) return;

  // Import smart exit
  const { analyzeSmartExit, logExitDecision, calculateSellAmount } =
    await import('./smartExit');
  const { rpcManager } = await import('../network/rpcManager');
  const connection = await rpcManager.getConnection();

  for (const pos of positions) {
    const change =
      (event.priceInQuote - pos.buyPriceInQuote) / pos.buyPriceInQuote;
    const changePercent = change * 100;

    logger.debug(
      `[AUTO-SELL] pos=${pos.id} change=${changePercent.toFixed(2)}% (TP=${pos.tpPercent} SL=${pos.slPercent})`
    );

    // 🧠 استفاده از Smart Exit به جای TP/SL ساده
    const exitDecision = await analyzeSmartExit(connection, {
      baseMint: pos.baseMint,
      poolAddress: pos.pool,
      buyPriceInQuote: pos.buyPriceInQuote,
      currentPriceInQuote: event.priceInQuote,
      tpPercent: pos.tpPercent,
      slPercent: pos.slPercent,
      holdTimeMs: Date.now() - pos.openedAt,
      liquiditySol: pos.liquiditySol,
      userBin: pos.userBin,
      sysBin: pos.sysBin,
    });

    // لاگ تصمیم
    logExitDecision(exitDecision, {
      baseMint: pos.baseMint,
      poolAddress: pos.pool,
      buyPriceInQuote: pos.buyPriceInQuote,
      currentPriceInQuote: event.priceInQuote,
      tpPercent: pos.tpPercent,
      slPercent: pos.slPercent,
      holdTimeMs: Date.now() - pos.openedAt,
    });

    // اگر باید بفروشیم
    if (exitDecision.shouldExit) {
      const sellAmount = calculateSellAmount(
        pos.buyAmountLamports,
        exitDecision.suggestedAction
      );

      if (sellAmount > 0) {
        await triggerSell(
          pos,
          event.priceInQuote,
          exitDecision.reason,
          sellAmount,
          exitDecision.suggestedAction === 'SELL_PARTIAL'
        );
      }
    }
  }
}

async function triggerSell(
  pos: any,
  currentPriceInQuote: number,
  reason: string,
  sellAmount?: number,
  isPartial: boolean = false
) {
  try {
    const { executeSellTool } = await import("../agentTools/executeSellTool");
    const { closePosition } = await import("../state/positions");

    const sellRes = await executeSellTool({
      rpcUrl: RPC_URL,
      pool: pos.pool,
      baseMint: pos.baseMint,
      quoteMint: QUOTE_MINT_WSOL,
      userSecret: TRADER_PRIVATE_KEY,
      amountIn: sellAmount || pos.buyAmountLamports, // استفاده از sellAmount برای partial exit
      prioritize: true,
    });

    const closed = closePosition(pos.id, {
      closeSignature: sellRes.signature,
      closePriceInQuote: currentPriceInQuote,
    });

    if (closed) {
      const { logSignalOutcome } = await import("../logger");
      await logSignalOutcome({
        timestamp: new Date(closed.openedAt).toISOString(),
        poolAddress: closed.pool,
        tokenName: closed.tokenName || closed.baseMint.slice(0, 8),
        liquidity: closed.liquiditySol?.toFixed(1) || '?',
        userBin: closed.userBin || '-',
        sysBin: closed.sysBin || '-',
        decision: 'Buy',
        buyPrice: closed.buyPriceInQuote.toFixed(8),
        tpTarget: closed.tpPercent + '%',
        slTarget: closed.slPercent + '%',
        sellPrice: currentPriceInQuote.toFixed(8),
        sellReason: reason,
        pnl: closed.realizedPnlQuote?.toFixed(4) || '0',
        pnlPercent: `${(((currentPriceInQuote - closed.buyPriceInQuote) / closed.buyPriceInQuote) * 100).toFixed(1)}%`
      });
    }

    logger.info(
      `[AUTO-SELL] ${reason} done. pos=${pos.id} sig=${sellRes.signature} PnL=${closed?.realizedPnlQuote}`
    );
  } catch (e) {
    logger.error(`[AUTO-SELL] ${reason} failed for pos=${pos.id}`, e);
  }
}
