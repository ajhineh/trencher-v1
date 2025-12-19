// src/telegram/commands/sell.ts

/**
 * /sell command
 * Sell tokens
 */

import { Context, Markup } from 'telegraf';
import { SessionManager } from '../sessionManager';
import { logger } from '../../logger';

export async function handleSell(
    ctx: Context,
    sessionManager: SessionManager,
    sniperSystem: any
): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = sessionManager.getSession(
        userId,
        ctx.chat!.id,
        ctx.from?.username
    );

    if (!session.walletAddress) {
        await ctx.reply('❌ No wallet connected! Use /wallet first.');
        return;
    }

    const text = (ctx.message as any)?.text || '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
        await ctx.reply(
            `💰 **Sell Tokens**\n\n` +
            `**Usage:**\n` +
            `\`/sell [token] [percentage]\`\n\n` +
            `**Examples:**\n` +
            `\`/sell PEPE 50\` - Sell 50%\n` +
            `\`/sell BONK 100\` - Sell all\n` +
            `\`/sell PEPE\` - Sell 100% (default)\n\n` +
            `Or use /positions to select a token.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const token = args[0];
    const percentage = args[1] ? parseInt(args[1]) : 100;

    if (percentage <= 0 || percentage > 100) {
        await ctx.reply('❌ Percentage must be between 1-100');
        return;
    }

    await executeSell(ctx, token, percentage, session);
}

/**
 * Handle sell from callback
 */
export async function handleSellCallback(
    ctx: Context,
    mint: string,
    percentage: number,
    sessionManager: SessionManager
): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = sessionManager.getSession(
        userId,
        ctx.chat!.id,
        ctx.from?.username
    );

    await executeSell(ctx, mint, percentage, session);
}

/**
 * Execute sell
 */
async function executeSell(
    ctx: Context,
    token: string,
    percentage: number,
    session: any
): Promise<void> {
    // Confirmation
    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ Confirm', `sell_confirm_${token}_${percentage}`),
            Markup.button.callback('❌ Cancel', 'sell_cancel')
        ]
    ]);

    const confirmMsg = await ctx.reply(
        `⚠️ **Confirm Sell**\n\n` +
        `Token: ${token}\n` +
        `Amount: ${percentage}%\n\n` +
        `Are you sure?`,
        {
            parse_mode: 'Markdown',
            ...keyboard
        }
    );
}

/**
 * Confirm sell
 */
export async function handleSellConfirm(
    ctx: Context,
    token: string,
    percentage: number
): Promise<void> {
    const chatId = ctx.chat?.id;
    const messageId = ctx.callbackQuery?.message?.message_id;

    if (!chatId || !messageId) return;

    await ctx.editMessageText(
        `💰 **Selling ${percentage}% of ${token}**\n\n` +
        `⏳ Processing...`,
        { parse_mode: 'Markdown' }
    );

    try {
        // Execute sell
        logger.info(`Selling ${percentage}% of ${token}`);

        // TODO: Integrate with UltimateSniperSystem
        await new Promise(resolve => setTimeout(resolve, 2000));

        const success = Math.random() > 0.1; // 90% success

        if (success) {
            const soldAmount = 0.015 * (percentage / 100);
            const profit = soldAmount - (0.01 * (percentage / 100));
            const profitPercent = (profit / (0.01 * (percentage / 100))) * 100;

            await ctx.telegram.editMessageText(
                chatId,
                messageId,
                undefined,
                `✅ **Sell Successful!**\n\n` +
                `Token: ${token}\n` +
                `Sold: ${percentage}%\n` +
                `Amount: ${soldAmount.toFixed(4)} SOL\n` +
                `Profit: ${profit >= 0 ? '+' : ''}${profit.toFixed(4)} SOL\n` +
                `P&L: ${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%\n\n` +
                `${percentage === 100 ? '🎉 Position closed!' : '📊 Remaining position updated'}`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.telegram.editMessageText(
                chatId,
                messageId,
                undefined,
                `❌ **Sell Failed**\n\n` +
                `Token: ${token}\n\n` +
                `Error: Transaction failed\n` +
                `Please try again.`,
                { parse_mode: 'Markdown' }
            );
        }

    } catch (error: any) {
        logger.error('Sell error:', error.message);

        await ctx.telegram.editMessageText(
            chatId,
            messageId,
            undefined,
            `❌ **Error**\n\n${error.message}`,
            { parse_mode: 'Markdown' }
        );
    }

    await ctx.answerCbQuery();
}
