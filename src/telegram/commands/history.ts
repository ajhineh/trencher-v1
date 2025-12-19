// src/telegram/commands/history.ts

/**
 * /history command
 * Trade history
 */

import { Context, Markup } from 'telegraf';
import { SessionManager } from '../sessionManager';

interface Trade {
    id: string;
    type: 'BUY' | 'SELL';
    token: string;
    symbol: string;
    amount: number;
    price: number;
    profit?: number;
    profitPercent?: number;
    timestamp: number;
}

export async function handleHistory(
    ctx: Context,
    sessionManager: SessionManager,
    page: number = 1
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

    // Mock trade history
    const trades = getMockTrades();

    if (trades.length === 0) {
        await ctx.reply(
            `📜 **Trade History**\n\n` +
            `No trades yet.\n\n` +
            `Start trading with /snipe!`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // Pagination
    const perPage = 5;
    const totalPages = Math.ceil(trades.length / perPage);
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const pageTrades = trades.slice(start, end);

    let message = `📜 **Trade History** (Page ${page}/${totalPages})\n\n`;

    pageTrades.forEach((trade, i) => {
        const emoji = trade.type === 'BUY' ? '🟢' : '🔴';
        const date = new Date(trade.timestamp).toLocaleDateString();

        message += `${emoji} **${trade.symbol}** - ${trade.type}\n`;
        message += `   Amount: ${trade.amount.toFixed(4)} SOL\n`;
        message += `   Price: $${trade.price.toFixed(6)}\n`;

        if (trade.type === 'SELL' && trade.profitPercent !== undefined) {
            const profitSign = trade.profitPercent >= 0 ? '+' : '';
            const profitEmoji = trade.profitPercent >= 0 ? '📈' : '📉';
            message += `   P&L: ${profitSign}${trade.profitPercent.toFixed(2)}% ${profitEmoji}\n`;
        }

        message += `   Date: ${date}\n\n`;
    });

    // Navigation buttons
    const buttons = [];

    if (page > 1) {
        buttons.push(
            Markup.button.callback('⬅️ Previous', `history_page_${page - 1}`)
        );
    }

    buttons.push(
        Markup.button.callback(`${page}/${totalPages}`, 'noop')
    );

    if (page < totalPages) {
        buttons.push(
            Markup.button.callback('Next ➡️', `history_page_${page + 1}`)
        );
    }

    const keyboard = Markup.inlineKeyboard([
        buttons,
        [
            Markup.button.callback('📊 Stats', 'menu_stats'),
            Markup.button.callback('🔙 Menu', 'main_menu')
        ]
    ]);

    await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...keyboard
    });
}

/**
 * Mock trades
 */
function getMockTrades(): Trade[] {
    return [
        {
            id: '1',
            type: 'BUY',
            token: 'ABC...XYZ',
            symbol: 'PEPE',
            amount: 0.01,
            price: 0.000123,
            timestamp: Date.now() - 86400000 * 2
        },
        {
            id: '2',
            type: 'SELL',
            token: 'ABC...XYZ',
            symbol: 'PEPE',
            amount: 0.015,
            price: 0.000185,
            profit: 0.005,
            profitPercent: 50.41,
            timestamp: Date.now() - 86400000
        },
        {
            id: '3',
            type: 'BUY',
            token: 'DEF...UVW',
            symbol: 'BONK',
            amount: 0.005,
            price: 0.000089,
            timestamp: Date.now() - 43200000
        },
        {
            id: '4',
            type: 'SELL',
            token: 'DEF...UVW',
            symbol: 'BONK',
            amount: 0.00376,
            price: 0.000067,
            profit: -0.00124,
            profitPercent: -24.72,
            timestamp: Date.now() - 21600000
        },
        {
            id: '5',
            type: 'BUY',
            token: 'GHI...RST',
            symbol: 'WIF',
            amount: 0.01,
            price: 0.001234,
            timestamp: Date.now() - 10800000
        }
    ];
}
