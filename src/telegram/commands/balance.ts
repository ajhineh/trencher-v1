// src/telegram/commands/balance.ts

/**
 * /balance command
 * Check wallet balance
 */

import { Context, Markup } from 'telegraf';
import { SessionManager } from '../sessionManager';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

export async function handleBalance(
    ctx: Context,
    sessionManager: SessionManager,
    connection: Connection
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

    const loadingMsg = await ctx.reply('⏳ Checking balance...');

    try {
        // Get SOL balance
        const publicKey = new PublicKey(session.walletAddress);
        const balance = await connection.getBalance(publicKey);
        const solBalance = balance / LAMPORTS_PER_SOL;

        // Mock token balances
        const tokenBalances = [
            { symbol: 'PEPE', amount: 1000000, value: 0.015 },
            { symbol: 'BONK', amount: 500000, value: 0.008 },
            { symbol: 'WIF', amount: 100000, value: 0.025 }
        ];

        const totalTokenValue = tokenBalances.reduce((sum, t) => sum + t.value, 0);
        const totalValue = solBalance + totalTokenValue;

        let message = `💼 **Wallet Balance**\n\n`;
        message += `**Address:**\n\`${session.walletAddress}\`\n\n`;
        message += `**SOL Balance:**\n`;
        message += `${solBalance.toFixed(4)} SOL\n\n`;

        if (tokenBalances.length > 0) {
            message += `**Token Holdings:**\n`;
            tokenBalances.forEach(token => {
                message += `• ${token.symbol}: ${token.amount.toLocaleString()} (${token.value.toFixed(3)} SOL)\n`;
            });
            message += `\n`;
        }

        message += `**Total Value:**\n`;
        message += `${totalValue.toFixed(4)} SOL\n`;

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('🔄 Refresh', 'balance_refresh'),
                Markup.button.callback('📊 Positions', 'menu_positions')
            ],
            [
                Markup.button.callback('🔙 Menu', 'main_menu')
            ]
        ]);

        await ctx.telegram.editMessageText(
            ctx.chat!.id,
            loadingMsg.message_id,
            undefined,
            message,
            {
                parse_mode: 'Markdown',
                ...keyboard
            }
        );

    } catch (error: any) {
        await ctx.telegram.editMessageText(
            ctx.chat!.id,
            loadingMsg.message_id,
            undefined,
            `❌ **Error**\n\nFailed to fetch balance.\n${error.message}`,
            { parse_mode: 'Markdown' }
        );
    }
}
