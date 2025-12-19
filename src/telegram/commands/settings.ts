// src/telegram/commands/settings.ts

/**
 * /settings command
 * Bot configuration
 */

import { Context, Markup } from 'telegraf';
import { SessionManager } from '../sessionManager';

export async function handleSettings(
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

    const settings = session.settings;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback(
                `🤖 AI Threshold: ${settings.aiConfidenceThreshold}%`,
                'setting_ai_threshold'
            )
        ],
        [
            Markup.button.callback(
                `💰 Max Buy: ${settings.maxBuyAmount} SOL`,
                'setting_max_buy'
            )
        ],
        [
            Markup.button.callback(
                `💧 Min Liquidity: ${settings.minLiquidity} SOL`,
                'setting_min_liquidity'
            )
        ],
        [
            Markup.button.callback(
                `🛡️ Rug Protection: ${settings.enableRugProtection ? 'ON' : 'OFF'}`,
                'setting_rug_protection'
            )
        ],
        [
            Markup.button.callback(
                `🔔 Notifications: ${settings.enableNotifications ? 'ON' : 'OFF'}`,
                'setting_notifications'
            )
        ],
        [
            Markup.button.callback(
                `📉 Trailing Stop: ${settings.trailingStopPercent}%`,
                'setting_trailing_stop'
            )
        ],
        [
            Markup.button.callback('🔙 Back', 'main_menu')
        ]
    ]);

    await ctx.reply(
        `⚙️ **Bot Settings**\n\n` +
        `Configure your bot preferences:\n\n` +
        `**AI Sniper:**\n` +
        `• Confidence Threshold: ${settings.aiConfidenceThreshold}%\n` +
        `• Max Buy Amount: ${settings.maxBuyAmount} SOL\n` +
        `• Min Liquidity: ${settings.minLiquidity} SOL\n\n` +
        `**Protection:**\n` +
        `• Rug Pull Protection: ${settings.enableRugProtection ? '✅' : '❌'}\n` +
        `• Trailing Stop: ${settings.trailingStopPercent}%\n\n` +
        `**Notifications:**\n` +
        `• Telegram Alerts: ${settings.enableNotifications ? '✅' : '❌'}\n\n` +
        `Click a setting to change it:`,
        {
            parse_mode: 'Markdown',
            ...keyboard
        }
    );
}

/**
 * Handle setting changes
 */
export async function handleSettingChange(
    ctx: Context,
    sessionManager: SessionManager,
    setting: string
): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = sessionManager.getSession(
        userId,
        ctx.chat!.id,
        ctx.from?.username
    );

    let message = '';

    switch (setting) {
        case 'ai_threshold':
            message = `🤖 **AI Confidence Threshold**\n\n` +
                `Current: ${session.settings.aiConfidenceThreshold}%\n\n` +
                `Enter new value (50-90):`;
            break;

        case 'max_buy':
            message = `💰 **Max Buy Amount**\n\n` +
                `Current: ${session.settings.maxBuyAmount} SOL\n\n` +
                `Enter new value (0.001-1.0):`;
            break;

        case 'rug_protection':
            const newValue = !session.settings.enableRugProtection;
            sessionManager.updateSettings(userId, {
                enableRugProtection: newValue
            });

            await ctx.answerCbQuery(`Rug protection ${newValue ? 'enabled' : 'disabled'}`);
            await handleSettings(ctx, sessionManager);
            return;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
}
