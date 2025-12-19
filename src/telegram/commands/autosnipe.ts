// src/telegram/commands/autosnipe.ts

/**
 * /autosnipe command
 * Toggle auto-snipe mode
 */

import { Context, Markup } from 'telegraf';
import { SessionManager } from '../sessionManager';
import { logger } from '../../logger';

interface AutoSnipeConfig {
    enabled: boolean;
    minLiquidity: number;
    maxBuyAmount: number;
    aiThreshold: number;
    filters: {
        minHolders?: number;
        maxSupply?: number;
        blacklistedCreators: string[];
    };
}

export async function handleAutoSnipe(
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

    if (!session.walletAddress) {
        await ctx.reply('❌ No wallet connected! Use /wallet first.');
        return;
    }

    // Get or create auto-snipe config
    const config = getAutoSnipeConfig(session);

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback(
                `${config.enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
                'autosnipe_toggle'
            )
        ],
        [
            Markup.button.callback(
                `💧 Min Liquidity: ${config.minLiquidity} SOL`,
                'autosnipe_min_liquidity'
            )
        ],
        [
            Markup.button.callback(
                `💰 Max Buy: ${config.maxBuyAmount} SOL`,
                'autosnipe_max_buy'
            )
        ],
        [
            Markup.button.callback(
                `🤖 AI Threshold: ${config.aiThreshold}%`,
                'autosnipe_ai_threshold'
            )
        ],
        [
            Markup.button.callback('🔧 Advanced Filters', 'autosnipe_filters'),
            Markup.button.callback('📊 Stats', 'autosnipe_stats')
        ],
        [
            Markup.button.callback('🔙 Back', 'main_menu')
        ]
    ]);

    await ctx.reply(
        `🎯 **Auto-Snipe Configuration**\n\n` +
        `**Status:** ${config.enabled ? '🟢 Active' : '🔴 Inactive'}\n\n` +
        `**Settings:**\n` +
        `• Min Liquidity: ${config.minLiquidity} SOL\n` +
        `• Max Buy: ${config.maxBuyAmount} SOL\n` +
        `• AI Threshold: ${config.aiThreshold}%\n\n` +
        `**How it works:**\n` +
        `When enabled, the bot will automatically snipe new tokens that meet your criteria.\n\n` +
        `${config.enabled ? '⚠️ Auto-snipe is currently ACTIVE!' : '💡 Enable to start auto-sniping'}`,
        {
            parse_mode: 'Markdown',
            ...keyboard
        }
    );
}

/**
 * Toggle auto-snipe
 */
export async function handleAutoSnipeToggle(
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

    const config = getAutoSnipeConfig(session);
    config.enabled = !config.enabled;

    // Save config
    saveAutoSnipeConfig(session, config);

    await ctx.answerCbQuery(
        config.enabled ? '✅ Auto-snipe enabled!' : '⏸️ Auto-snipe disabled'
    );

    // Refresh display
    await handleAutoSnipe(ctx, sessionManager);

    logger.info(`User ${userId} ${config.enabled ? 'enabled' : 'disabled'} auto-snipe`);
}

/**
 * Show auto-snipe stats
 */
export async function handleAutoSnipeStats(ctx: Context): Promise<void> {
    // Mock stats
    const stats = {
        totalSniped: 12,
        successful: 9,
        failed: 3,
        totalProfit: 0.045,
        avgProfit: 15.3,
        bestTrade: 125.5
    };

    await ctx.editMessageText(
        `📊 **Auto-Snipe Statistics**\n\n` +
        `**Performance:**\n` +
        `• Total Sniped: ${stats.totalSniped}\n` +
        `• Successful: ${stats.successful} (${((stats.successful / stats.totalSniped) * 100).toFixed(1)}%)\n` +
        `• Failed: ${stats.failed}\n\n` +
        `**Profit:**\n` +
        `• Total: ${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(3)} SOL\n` +
        `• Average: ${stats.avgProfit >= 0 ? '+' : ''}${stats.avgProfit.toFixed(1)}%\n` +
        `• Best Trade: +${stats.bestTrade.toFixed(1)}%\n\n` +
        `Keep auto-snipe enabled for more opportunities!`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Back', 'autosnipe')]
            ])
        }
    );

    await ctx.answerCbQuery();
}

/**
 * Get auto-snipe config
 */
function getAutoSnipeConfig(session: any): AutoSnipeConfig {
    if (!session.autoSnipeConfig) {
        session.autoSnipeConfig = {
            enabled: false,
            minLiquidity: session.settings.minLiquidity,
            maxBuyAmount: session.settings.maxBuyAmount,
            aiThreshold: session.settings.aiConfidenceThreshold,
            filters: {
                blacklistedCreators: []
            }
        };
    }
    return session.autoSnipeConfig;
}

/**
 * Save auto-snipe config
 */
function saveAutoSnipeConfig(session: any, config: AutoSnipeConfig): void {
    session.autoSnipeConfig = config;
    // SessionManager will auto-save
}
