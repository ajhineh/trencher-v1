import { logger } from '../logger';
import { sendTelegram } from '../telegram';

export interface SignalData {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    leverage: number;
    takeProfit: number;
    stopLoss: number;
    timestamp: number;
}

export class SignalBroadcaster {
    constructor() {
        logger.info(`[SignalBroadcaster] 📡 Initialized and ready to broadcast signals.`);
    }

    public async broadcastSignal(signal: SignalData) {
        const tpPercent = Math.abs((signal.takeProfit - signal.entryPrice) / signal.entryPrice * 100).toFixed(2);
        const slPercent = Math.abs((signal.stopLoss - signal.entryPrice) / signal.entryPrice * 100).toFixed(2);
        
        const text = `🚨 <b>${signal.side.toUpperCase()} SIGNAL: ${signal.symbol}</b> 🚨\n\n` +
                     `🔹 <b>Entry:</b> ${signal.entryPrice.toFixed(6)} USDT\n` +
                     `📈 <b>Leverage:</b> ${signal.leverage}x\n` +
                     `🎯 <b>Take Profit:</b> ${signal.takeProfit.toFixed(6)} USDT (+${tpPercent}%)\n` +
                     `🛑 <b>Stop Loss:</b> ${signal.stopLoss.toFixed(6)} USDT (-${slPercent}%)\n\n` +
                     `<i>⚡️ Trencher V2 - Amiro Strategy</i>`;

        logger.info(`\n================= SIGNAL =================\n${text}\n==========================================`);

        try {
            await sendTelegram(text);
        } catch (error: any) {
            logger.error(`[SignalBroadcaster] Failed to send Telegram message: ${error.message}`);
        }
    }

    public async broadcastExit(
        symbol: string,
        side: string,
        exitPrice: number,
        pnlPercent: number,
        reason: string,
        pnlUsdt?: number
    ) {
        const pnlSign = pnlPercent >= 0 ? '📈 +' : '📉 ';
        const pnlUsdtSign = (pnlUsdt ?? 0) >= 0 ? '+' : '';
        const pnlUsdtStr = pnlUsdt !== undefined
            ? `\n💵 <b>Total PnL:</b> ${pnlUsdtSign}${pnlUsdt.toFixed(2)} USDT`
            : '';

        const text = `🚪 <b>EXIT: ${symbol}</b> 🚪\n\n` +
                     `🔹 <b>Side:</b> ${side.toUpperCase()}\n` +
                     `💰 <b>Exit Price:</b> ${exitPrice.toFixed(6)} USDT\n` +
                     `📊 <b>PnL:</b> ${pnlSign}${pnlPercent.toFixed(2)}%` +
                     pnlUsdtStr + `\n` +
                     `📝 <b>Reason:</b> ${reason}\n\n` +
                     `<i>⚡️ Trencher V2 - Amiro Strategy</i>`;

        logger.info(`\n================= EXIT =================\n${text}\n==========================================`);

        try {
            await sendTelegram(text);
        } catch (error: any) {
            logger.error(`[SignalBroadcaster] Failed to send Telegram exit message: ${error.message}`);
        }
    }

    public async sendRawMessage(text: string) {
        try {
            await sendTelegram(text);
        } catch (error: any) {
            logger.error(`[SignalBroadcaster] Failed to send raw Telegram message: ${error.message}`);
        }
    }
}
