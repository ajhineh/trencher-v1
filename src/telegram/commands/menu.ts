// src/telegram/commands/menu.ts

/**
 * Main menu command
 * Central navigation hub
 */

import { Context } from 'telegraf';
import { SessionManager } from '../sessionManager';
import { mainMenuKeyboard } from '../keyboards';

export async function handleMenu(
    ctx: Context,
    sessionManager: SessionManager
): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = sessionManager.getSession(
        userId,
        ctx.chat!.id,
        ctx.from?.username
    );

    const walletStatus = session.walletAddress
        ? `✅ Connected\n\`${session.walletAddress.slice(0, 8)}...${session.walletAddress.slice(-8)}\``
        : '❌ Not connected';

    const autoSnipeStatus = session.autoSnipeConfig?.enabled
        ? '🟢 Active'
        : '🔴 Inactive';

    const message = `
🤖 **YouLi-AI Sniper Bot**

**Wallet:** ${walletStatus}
**Auto-Snipe:** ${autoSnipeStatus}

**Quick Access:**
Choose an option below to get started.
  `.trim();

    await ctx.reply(
        message,
        {
            parse_mode: 'Markdown',
            ...mainMenuKeyboard()
        }
    );
}

/**
 * Handle menu navigation
 */
export async function handleMenuNavigation(
    ctx: Context,
    action: string,
    sessionManager: SessionManager
): Promise<void> {
    await ctx.answerCbQuery();

    switch (action) {
        case 'snipe':
            await ctx.editMessageText(
                `🎯 **Manual Snipe**\n\n` +
                `Use: \`/snipe [token] [amount]\`\n\n` +
                `Example:\n\`/snipe ABC...XYZ 0.01\``,
                { parse_mode: 'Markdown' }
            );
            break;

        case 'positions':
            // Redirect to positions command
            const { handlePositions } = await import('./positions');
            await handlePositions(ctx, sessionManager, null);
            break;

        case 'wallet':
            const { handleWallet } = await import('./wallet');
            await handleWallet(ctx, sessionManager);
            break;

        case 'settings':
            const { handleSettings } = await import('./settings');
            await handleSettings(ctx, sessionManager);
            break;

        case 'autosnipe':
            const { handleAutoSnipe } = await import('./autosnipe');
            await handleAutoSnipe(ctx, sessionManager);
            break;

        case 'alerts':
            const { handleAlerts } = await import('./alerts');
            await handleAlerts(ctx, sessionManager);
            break;

        case 'stats':
            await handleStats(ctx, sessionManager);
            break;

        case 'help':
            const { handleHelp } = await import('./help');
            await handleHelp(ctx);
            break;
    }
}

/**
 * Show stats
 */
async function handleStats(
    ctx: Context,
    sessionManager: SessionManager
): Promise<void> {
    // Mock stats
    const stats = {
        totalTrades: 25,
        winRate: 72,
        totalProfit: 0.125,
        bestTrade: 245.5,
        avgHoldTime: '4h 32m'
    };

    await ctx.editMessageText(
        `📈 **Your Statistics**\n\n` +
        `**Trading:**\n` +
        `• Total Trades: ${stats.totalTrades}\n` +
        `• Win Rate: ${stats.winRate}%\n` +
        `• Avg Hold Time: ${stats.avgHoldTime}\n\n` +
        `**Performance:**\n` +
        `• Total Profit: ${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(3)} SOL\n` +
        `• Best Trade: +${stats.bestTrade.toFixed(1)}%\n\n` +
        `Keep trading to improve your stats!`,
        {
            parse_mode: 'Markdown',
            ...mainMenuKeyboard()
        }
    );
}
