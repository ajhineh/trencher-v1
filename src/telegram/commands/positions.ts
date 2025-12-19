// src/telegram/commands/positions.ts

/**
 * /positions command
 * View active positions
 */

import { Context, Markup } from 'telegraf';
import { SessionManager } from '../sessionManager';

interface Position {
    mint: string;
    symbol: string;
    entryPrice: number;
    currentPrice: number;
    profitPercent: number;
    tokenAmount: number;
    solInvested: number;
    currentValue: number;
    holdingTime: number; // seconds
}

export async function handlePositions(
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

    // Check wallet
    if (!session.walletAddress) {
        await ctx.reply('❌ No wallet connected! Use /wallet first.');
        return;
    }

    // Get positions
    // TODO: Get from UltimateSniperSystem
    const positions = getMockPositions();

    if (positions.length === 0) {
        await ctx.reply(
            `📊 **No Active Positions**\n\n` +
            `You don't have any active positions.\n\n` +
            `Use /snipe to start sniping tokens!`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // Calculate totals
    const totalInvested = positions.reduce((sum, p) => sum + p.solInvested, 0);
    const totalValue = positions.reduce((sum, p) => sum + p.currentValue, 0);
    const totalProfitPercent = ((totalValue - totalInvested) / totalInvested) * 100;

    // Create message
    let message = `📊 **Active Positions** (${positions.length})\n\n`;
    message += `**Portfolio:**\n`;
    message += `Invested: ${totalInvested.toFixed(3)} SOL\n`;
    message += `Current: ${totalValue.toFixed(3)} SOL\n`;
    message += `P&L: ${totalProfitPercent >= 0 ? '+' : ''}${totalProfitPercent.toFixed(2)}% `;
    message += totalProfitPercent >= 0 ? '📈\n\n' : '📉\n\n';

    // Create buttons for each position
    const keyboard = positions.map((pos, i) => {
        const profitEmoji = pos.profitPercent >= 0 ? '📈' : '📉';
        const profitSign = pos.profitPercent >= 0 ? '+' : '';

        return [
            Markup.button.callback(
                `${i + 1}. ${pos.symbol} ${profitSign}${pos.profitPercent.toFixed(1)}% ${profitEmoji}`,
                `position_${pos.mint}`
            )
        ];
    });

    keyboard.push([
        Markup.button.callback('🔄 Refresh', 'positions_refresh'),
        Markup.button.callback('📊 Stats', 'positions_stats')
    ]);

    await ctx.reply(
        message,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(keyboard)
        }
    );
}

/**
 * Handle position detail view
 */
export async function handlePositionDetail(
    ctx: Context,
    mint: string
): Promise<void> {
    // Get position details
    const position = getMockPositions().find(p => p.mint === mint);

    if (!position) {
        await ctx.answerCbQuery('Position not found');
        return;
    }

    const profitEmoji = position.profitPercent >= 0 ? '📈' : '📉';
    const profitSign = position.profitPercent >= 0 ? '+' : '';

    const holdingHours = Math.floor(position.holdingTime / 3600);
    const holdingMins = Math.floor((position.holdingTime % 3600) / 60);

    const message = `
💎 **${position.symbol}**

**Entry:**
• Price: $${position.entryPrice.toFixed(6)}
• Amount: ${position.tokenAmount.toLocaleString()} tokens
• Invested: ${position.solInvested.toFixed(3)} SOL

**Current:**
• Price: $${position.currentPrice.toFixed(6)}
• Value: ${position.currentValue.toFixed(3)} SOL
• P&L: ${profitSign}${position.profitPercent.toFixed(2)}% ${profitEmoji}

**Info:**
• Holding: ${holdingHours}h ${holdingMins}m
• Protection: ✅ Active
• Trailing Stop: 15%

**Token:**
\`${mint}\`
  `.trim();

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('📈 Sell 25%', `sell_${mint}_25`),
            Markup.button.callback('📈 Sell 50%', `sell_${mint}_50`)
        ],
        [
            Markup.button.callback('📈 Sell 75%', `sell_${mint}_75`),
            Markup.button.callback('📈 Sell 100%', `sell_${mint}_100`)
        ],
        [
            Markup.button.callback('📊 Chart', `chart_${mint}`),
            Markup.button.callback('🔄 Refresh', `position_${mint}`)
        ],
        [
            Markup.button.callback('🔙 Back', 'positions')
        ]
    ]);

    await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...keyboard
    });

    await ctx.answerCbQuery();
}

/**
 * Mock positions for demo
 */
function getMockPositions(): Position[] {
    return [
        {
            mint: 'ABC123...XYZ789',
            symbol: 'PEPE',
            entryPrice: 0.000123,
            currentPrice: 0.000185,
            profitPercent: 50.41,
            tokenAmount: 1000000,
            solInvested: 0.01,
            currentValue: 0.015,
            holdingTime: 3600 * 2 + 1800 // 2.5 hours
        },
        {
            mint: 'DEF456...UVW012',
            symbol: 'BONK',
            entryPrice: 0.000089,
            currentPrice: 0.000067,
            profitPercent: -24.72,
            tokenAmount: 500000,
            solInvested: 0.005,
            currentValue: 0.00376,
            holdingTime: 3600 * 5 // 5 hours
        },
        {
            mint: 'GHI789...RST345',
            symbol: 'WIF',
            entryPrice: 0.001234,
            currentPrice: 0.002468,
            profitPercent: 100.0,
            tokenAmount: 100000,
            solInvested: 0.01,
            currentValue: 0.02,
            holdingTime: 3600 * 24 // 24 hours
        }
    ];
}
