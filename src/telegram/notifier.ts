// src/telegram/notifier.ts

/**
 * Telegram Notifier
 * Real-time notifications to users
 */

import { Telegraf } from 'telegraf';
import { SessionManager } from './sessionManager';
import { NotificationData } from './types';
import { logger } from '../logger';

export class TelegramNotifier {
    private bot: Telegraf;
    private sessionManager: SessionManager;

    constructor(bot: Telegraf, sessionManager: SessionManager) {
        this.bot = bot;
        this.sessionManager = sessionManager;
    }

    /**
     * Send notification to user by wallet address
     */
    async notifyByWallet(
        walletAddress: string,
        data: NotificationData
    ): Promise<void> {
        // Find user session by wallet
        const sessions = this.sessionManager.getAllSessions();
        const session = sessions.find(s => s.walletAddress === walletAddress);

        if (!session) {
            logger.warn(`No session found for wallet ${walletAddress}`);
            return;
        }

        if (!session.settings.enableNotifications) {
            logger.info(`Notifications disabled for user ${session.userId}`);
            return;
        }

        await this.sendNotification(session.chatId, data);
    }

    /**
     * Send notification to user by ID
     */
    async notifyByUserId(
        userId: number,
        data: NotificationData
    ): Promise<void> {
        const sessions = this.sessionManager.getAllSessions();
        const session = sessions.find(s => s.userId === userId);

        if (!session) {
            logger.warn(`No session found for user ${userId}`);
            return;
        }

        if (!session.settings.enableNotifications) {
            return;
        }

        await this.sendNotification(session.chatId, data);
    }

    /**
     * Send notification
     */
    private async sendNotification(
        chatId: number,
        data: NotificationData
    ): Promise<void> {
        try {
            const message = this.formatNotification(data);

            await this.bot.telegram.sendMessage(chatId, message, {
                parse_mode: 'Markdown'
            });

            logger.info(`Notification sent to chat ${chatId}: ${data.type}`);

        } catch (error: any) {
            logger.error(`Failed to send notification to ${chatId}:`, error.message);
        }
    }

    /**
     * Format notification message
     */
    private formatNotification(data: NotificationData): string {
        switch (data.type) {
            case 'BUY':
                return this.formatBuyNotification(data);
            case 'SELL':
                return this.formatSellNotification(data);
            case 'RUG':
                return this.formatRugNotification(data);
            case 'PROFIT':
                return this.formatProfitNotification(data);
            case 'ALERT':
                return this.formatAlertNotification(data);
            default:
                return data.message || 'Notification';
        }
    }

    /**
     * Format buy notification
     */
    private formatBuyNotification(data: NotificationData): string {
        const { token } = data;

        return `
✅ **Token Sniped!**

**Token:** ${token?.symbol || 'Unknown'}
**Amount:** ${token?.amount || 0} SOL
**Price:** $${token?.price?.toFixed(6) || '0'}

🛡️ Protection active
📊 View: /positions
    `.trim();
    }

    /**
     * Format sell notification
     */
    private formatSellNotification(data: NotificationData): string {
        const { token, profitPercent } = data;
        const profitEmoji = (profitPercent || 0) >= 0 ? '📈' : '📉';
        const profitSign = (profitPercent || 0) >= 0 ? '+' : '';

        return `
💰 **Token Sold!**

**Token:** ${token?.symbol || 'Unknown'}
**Profit:** ${profitSign}${profitPercent?.toFixed(2) || 0}% ${profitEmoji}
**Amount:** ${token?.amount || 0} SOL

Great trade! 🎉
    `.trim();
    }

    /**
     * Format rug pull notification
     */
    private formatRugNotification(data: NotificationData): string {
        const { token, action } = data;

        return `
🚨 **RUG PULL DETECTED!**

**Token:** ${token?.symbol || 'Unknown'}
**Action:** ${action || 'Emergency exit executed'}

Your funds are safe! ✅
We detected and exited before the rug.
    `.trim();
    }

    /**
     * Format profit target notification
     */
    private formatProfitNotification(data: NotificationData): string {
        const { token, profitPercent, action } = data;

        return `
📈 **Profit Target Hit!**

**Token:** ${token?.symbol || 'Unknown'}
**Profit:** +${profitPercent?.toFixed(2) || 0}%
**Action:** ${action || 'Holding'}

Keep up the good work! 💎
    `.trim();
    }

    /**
     * Format price alert notification
     */
    private formatAlertNotification(data: NotificationData): string {
        const { token, message } = data;

        return `
🔔 **Price Alert Triggered!**

**Token:** ${token?.symbol || 'Unknown'}
**Price:** $${token?.price?.toFixed(6) || '0'}

${message || 'Your target price has been reached!'}

View: /positions
    `.trim();
    }

    /**
     * Broadcast to all users
     */
    async broadcast(message: string): Promise<void> {
        const sessions = this.sessionManager.getAllSessions();

        logger.info(`Broadcasting to ${sessions.length} users`);

        for (const session of sessions) {
            if (session.settings.enableNotifications) {
                try {
                    await this.bot.telegram.sendMessage(session.chatId, message, {
                        parse_mode: 'Markdown'
                    });
                } catch (error: any) {
                    logger.error(`Failed to broadcast to ${session.chatId}:`, error.message);
                }
            }
        }
    }
}
