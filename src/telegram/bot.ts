// src/telegram/bot.ts

/**
 * Telegram Bot - Main Entry Point
 */

import { Telegraf, Context } from 'telegraf';
import { SessionManager } from './sessionManager';
import { handleStart } from './commands/start';
import { handleWallet, handleWalletGenerate, handleWalletImport } from './commands/wallet';
import { handleHelp } from './commands/help';
import { handleSettings, handleSettingChange } from './commands/settings';
import { handleSnipe } from './commands/snipe';
import { handlePositions, handlePositionDetail } from './commands/positions';
import { handleBuy } from './commands/buy';
import { handleSell, handleSellCallback, handleSellConfirm } from './commands/sell';
import { handleAutoSnipe, handleAutoSnipeToggle, handleAutoSnipeStats } from './commands/autosnipe';
import { handleAlerts, handleAlertDetail, handleAlertToggle, handleAlertDelete, handleAlertCreate } from './commands/alerts';
import { handleMenu, handleMenuNavigation } from './commands/menu';
import { handleBalance } from './commands/balance';
import { handleHistory } from './commands/history';
import { TelegramNotifier } from './notifier';
import { logger } from '../logger';
import { Connection } from '@solana/web3.js';
import { IntelligentTradingSystem } from '../futures/intelligentTradingSystem';
import { handleScan } from './commands/scan'; // Import

export class TelegramBot {
    private bot: Telegraf;
    private sessionManager: SessionManager;
    private notifier: TelegramNotifier;
    private connection: Connection;
    private tradingSystem?: IntelligentTradingSystem; // Add property

    constructor(token: string, rpcUrl: string, tradingSystem?: IntelligentTradingSystem) { // Update constructor
        this.bot = new Telegraf(token);
        this.sessionManager = new SessionManager();
        this.notifier = new TelegramNotifier(this.bot, this.sessionManager);
        this.connection = new Connection(rpcUrl, 'confirmed');
        this.tradingSystem = tradingSystem; // Assign

        this.setupCommands();
        this.setupCallbacks();
        this.setupMiddleware();
    }

    /**
     * Setup command handlers
     */
    private setupCommands(): void {
        // /scan
        this.bot.command('scan', async (ctx) => {
            await handleScan(ctx, this.tradingSystem);
        });

        // /start
        this.bot.command('start', async (ctx) => {
            await handleStart(ctx, this.sessionManager);
        });

        // /wallet
        this.bot.command('wallet', async (ctx) => {
            await handleWallet(ctx, this.sessionManager);
        });

        // /help
        this.bot.command('help', async (ctx) => {
            await handleHelp(ctx);
        });

        // /settings
        this.bot.command('settings', async (ctx) => {
            await handleSettings(ctx, this.sessionManager);
        });

        // /snipe
        this.bot.command('snipe', async (ctx) => {
            await handleSnipe(ctx, this.sessionManager, null);
        });

        // /positions
        this.bot.command('positions', async (ctx) => {
            await handlePositions(ctx, this.sessionManager, null);
        });

        // /buy
        this.bot.command('buy', async (ctx) => {
            await handleBuy(ctx, this.sessionManager, null);
        });

        // /sell
        this.bot.command('sell', async (ctx) => {
            await handleSell(ctx, this.sessionManager, null);
        });

        // /menu
        this.bot.command('menu', async (ctx) => {
            await handleMenu(ctx, this.sessionManager);
        });

        // /autosnipe
        this.bot.command('autosnipe', async (ctx) => {
            await handleAutoSnipe(ctx, this.sessionManager);
        });

        // /alerts
        this.bot.command('alerts', async (ctx) => {
            await handleAlerts(ctx, this.sessionManager);
        });

        // /balance
        this.bot.command('balance', async (ctx) => {
            await handleBalance(ctx, this.sessionManager, this.connection);
        });

        // /history
        this.bot.command('history', async (ctx) => {
            await handleHistory(ctx, this.sessionManager, 1);
        });

        logger.info('✅ Commands registered');
    }

    /**
     * Setup callback handlers
     */
    private setupCallbacks(): void {
        // Wallet callbacks
        this.bot.action('wallet_generate', async (ctx) => {
            await handleWalletGenerate(ctx, this.sessionManager);
            await ctx.answerCbQuery();
        });

        this.bot.action('wallet_import', async (ctx) => {
            await handleWalletImport(ctx);
            await ctx.answerCbQuery();
        });

        // Settings callbacks
        this.bot.action(/setting_(.+)/, async (ctx) => {
            const setting = ctx.match[1];
            await handleSettingChange(ctx, this.sessionManager, setting);
            await ctx.answerCbQuery();
        });

        // Position callbacks
        this.bot.action(/position_(.+)/, async (ctx) => {
            const mint = ctx.match[1];
            if (mint === 'refresh' || mint === 'stats') {
                await ctx.answerCbQuery('Feature coming soon!');
                return;
            }
            await handlePositionDetail(ctx, mint);
        });

        this.bot.action('positions', async (ctx) => {
            await handlePositions(ctx, this.sessionManager, null);
            await ctx.answerCbQuery();
        });

        // Sell callbacks
        this.bot.action(/sell_(.+)_(\d+)/, async (ctx) => {
            const mint = ctx.match[1];
            const percentage = parseInt(ctx.match[2]);
            await handleSellCallback(ctx, mint, percentage, this.sessionManager);
            await ctx.answerCbQuery();
        });

        this.bot.action(/sell_confirm_(.+)_(\d+)/, async (ctx) => {
            const mint = ctx.match[1];
            const percentage = parseInt(ctx.match[2]);
            await handleSellConfirm(ctx, mint, percentage);
        });

        this.bot.action('sell_cancel', async (ctx) => {
            await ctx.editMessageText('❌ Sell cancelled');
            await ctx.answerCbQuery();
        });

        // Menu callbacks
        this.bot.action(/menu_(.+)/, async (ctx) => {
            const action = ctx.match[1];
            await handleMenuNavigation(ctx, action, this.sessionManager);
        });

        // Auto-snipe callbacks
        this.bot.action('autosnipe', async (ctx) => {
            await handleAutoSnipe(ctx, this.sessionManager);
            await ctx.answerCbQuery();
        });

        this.bot.action('autosnipe_toggle', async (ctx) => {
            await handleAutoSnipeToggle(ctx, this.sessionManager);
        });

        this.bot.action('autosnipe_stats', async (ctx) => {
            await handleAutoSnipeStats(ctx);
        });

        // Alert callbacks
        this.bot.action('alerts', async (ctx) => {
            await handleAlerts(ctx, this.sessionManager);
            await ctx.answerCbQuery();
        });

        this.bot.action(/alert_(.+)/, async (ctx) => {
            const alertId = ctx.match[1];
            if (alertId === 'create') {
                await handleAlertCreate(ctx);
            } else {
                await handleAlertDetail(ctx, alertId, this.sessionManager);
            }
        });

        this.bot.action(/alert_toggle_(.+)/, async (ctx) => {
            const alertId = ctx.match[1];
            await handleAlertToggle(ctx, alertId, this.sessionManager);
        });

        this.bot.action(/alert_delete_(.+)/, async (ctx) => {
            const alertId = ctx.match[1];
            await handleAlertDelete(ctx, alertId, this.sessionManager);
        });

        // History pagination
        this.bot.action(/history_page_(\d+)/, async (ctx) => {
            const page = parseInt(ctx.match[1]);
            await handleHistory(ctx, this.sessionManager, page);
            await ctx.answerCbQuery();
        });

        // Balance refresh
        this.bot.action('balance_refresh', async (ctx) => {
            await handleBalance(ctx, this.sessionManager, this.connection);
            await ctx.answerCbQuery();
        });

        logger.info('✅ Callbacks registered');
    }

    /**
     * Setup middleware
     */
    private setupMiddleware(): void {
        // Error handling
        this.bot.catch((err: any, ctx: Context) => {
            logger.error(`Telegram bot error for ${ctx.updateType}:`, err);
            ctx.reply('❌ An error occurred. Please try again.');
        });

        // Logging
        this.bot.use(async (ctx, next) => {
            const start = Date.now();
            await next();
            const ms = Date.now() - start;
            logger.info(`${ctx.updateType} processed in ${ms}ms`);
        });
    }

    /**
     * Start bot
     */
    async start(): Promise<void> {
        try {
            await this.bot.launch();
            logger.info('🤖 Telegram Bot started successfully');
            logger.info(`   Active sessions: ${this.sessionManager.getSessionCount()}`);

            // Graceful shutdown
            process.once('SIGINT', () => this.stop('SIGINT'));
            process.once('SIGTERM', () => this.stop('SIGTERM'));

        } catch (error: any) {
            logger.error('Failed to start Telegram bot:', error.message);
            throw error;
        }
    }

    /**
     * Stop bot
     */
    async stop(signal: string): Promise<void> {
        logger.info(`Stopping Telegram bot (${signal})...`);
        this.bot.stop(signal);
    }

    /**
     * Get notifier
     */
    getNotifier(): TelegramNotifier {
        return this.notifier;
    }
}
