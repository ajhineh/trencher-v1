// src/telegram/commands/alerts.ts

/**
 * /alerts command
 * Price alerts and notifications
 */

import { Context, Markup } from 'telegraf';
import { SessionManager } from '../sessionManager';
import { logger } from '../../logger';

interface PriceAlert {
    id: string;
    token: string;
    symbol: string;
    type: 'ABOVE' | 'BELOW';
    targetPrice: number;
    currentPrice: number;
    enabled: boolean;
    createdAt: number;
}

export async function handleAlerts(
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

    // Get alerts
    const alerts = getAlerts(session);

    if (alerts.length === 0) {
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('➕ Create Alert', 'alert_create')],
            [Markup.button.callback('🔙 Back', 'main_menu')]
        ]);

        await ctx.reply(
            `🔔 **Price Alerts**\n\n` +
            `You don't have any active alerts.\n\n` +
            `**Create alerts to:**\n` +
            `• Get notified when price reaches target\n` +
            `• Auto-sell at profit targets\n` +
            `• Track multiple tokens\n\n` +
            `Click below to create your first alert!`,
            {
                parse_mode: 'Markdown',
                ...keyboard
            }
        );
        return;
    }

    // Show alerts list
    let message = `🔔 **Active Price Alerts** (${alerts.length})\n\n`;

    const keyboard = alerts.map((alert, i) => {
        const emoji = alert.type === 'ABOVE' ? '📈' : '📉';
        const status = alert.enabled ? '🟢' : '🔴';

        return [
            Markup.button.callback(
                `${status} ${i + 1}. ${alert.symbol} ${emoji} $${alert.targetPrice}`,
                `alert_${alert.id}`
            )
        ];
    });

    keyboard.push([
        Markup.button.callback('➕ New Alert', 'alert_create'),
        Markup.button.callback('🗑️ Clear All', 'alert_clear_all')
    ]);

    keyboard.push([
        Markup.button.callback('🔙 Back', 'main_menu')
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
 * Show alert detail
 */
export async function handleAlertDetail(
    ctx: Context,
    alertId: string,
    sessionManager: SessionManager
): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = sessionManager.getSession(
        userId,
        ctx.chat!.id,
        ctx.from?.username
    );

    const alerts = getAlerts(session);
    const alert = alerts.find(a => a.id === alertId);

    if (!alert) {
        await ctx.answerCbQuery('Alert not found');
        return;
    }

    const emoji = alert.type === 'ABOVE' ? '📈' : '📉';
    const status = alert.enabled ? '🟢 Active' : '🔴 Disabled';
    const progress = alert.type === 'ABOVE'
        ? (alert.currentPrice / alert.targetPrice) * 100
        : (alert.targetPrice / alert.currentPrice) * 100;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback(
                alert.enabled ? '⏸️ Disable' : '▶️ Enable',
                `alert_toggle_${alertId}`
            ),
            Markup.button.callback('🗑️ Delete', `alert_delete_${alertId}`)
        ],
        [
            Markup.button.callback('🔙 Back', 'alerts')
        ]
    ]);

    await ctx.editMessageText(
        `🔔 **Price Alert Details**\n\n` +
        `**Token:** ${alert.symbol}\n` +
        `**Status:** ${status}\n\n` +
        `**Alert:**\n` +
        `• Type: ${alert.type === 'ABOVE' ? 'Above' : 'Below'} ${emoji}\n` +
        `• Target: $${alert.targetPrice.toFixed(6)}\n` +
        `• Current: $${alert.currentPrice.toFixed(6)}\n` +
        `• Progress: ${progress.toFixed(1)}%\n\n` +
        `**Created:** ${new Date(alert.createdAt).toLocaleString()}\n\n` +
        `You'll be notified when the price ${alert.type === 'ABOVE' ? 'goes above' : 'drops below'} $${alert.targetPrice.toFixed(6)}`,
        {
            parse_mode: 'Markdown',
            ...keyboard
        }
    );

    await ctx.answerCbQuery();
}

/**
 * Create alert prompt
 */
export async function handleAlertCreate(ctx: Context): Promise<void> {
    await ctx.editMessageText(
        `➕ **Create Price Alert**\n\n` +
        `To create an alert, use:\n` +
        `\`/alert [token] [above/below] [price]\`\n\n` +
        `**Examples:**\n` +
        `\`/alert PEPE above 0.000150\`\n` +
        `\`/alert BONK below 0.000080\`\n\n` +
        `Or select a token from your positions.`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('📊 From Positions', 'alert_from_positions')],
                [Markup.button.callback('🔙 Back', 'alerts')]
            ])
        }
    );

    await ctx.answerCbQuery();
}

/**
 * Toggle alert
 */
export async function handleAlertToggle(
    ctx: Context,
    alertId: string,
    sessionManager: SessionManager
): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = sessionManager.getSession(
        userId,
        ctx.chat!.id,
        ctx.from?.username
    );

    const alerts = getAlerts(session);
    const alert = alerts.find(a => a.id === alertId);

    if (alert) {
        alert.enabled = !alert.enabled;
        saveAlerts(session, alerts);

        await ctx.answerCbQuery(
            alert.enabled ? '✅ Alert enabled' : '⏸️ Alert disabled'
        );

        await handleAlertDetail(ctx, alertId, sessionManager);
    }
}

/**
 * Delete alert
 */
export async function handleAlertDelete(
    ctx: Context,
    alertId: string,
    sessionManager: SessionManager
): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = sessionManager.getSession(
        userId,
        ctx.chat!.id,
        ctx.from?.username
    );

    const alerts = getAlerts(session);
    const newAlerts = alerts.filter(a => a.id !== alertId);
    saveAlerts(session, newAlerts);

    await ctx.answerCbQuery('🗑️ Alert deleted');
    await handleAlerts(ctx, sessionManager);
}

/**
 * Get alerts
 */
function getAlerts(session: any): PriceAlert[] {
    if (!session.priceAlerts) {
        session.priceAlerts = [];
    }
    return session.priceAlerts;
}

/**
 * Save alerts
 */
function saveAlerts(session: any, alerts: PriceAlert[]): void {
    session.priceAlerts = alerts;
}
