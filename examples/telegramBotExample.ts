// examples/telegramBotExample.ts

/**
 * Telegram Bot - Usage Example
 */

import dotenv from 'dotenv';
dotenv.config();

import { TelegramBot } from '../src/telegram/bot';

async function main() {
    console.log('🤖 Starting Telegram Bot...\n');

    // Get configuration from environment
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const rpcUrl = process.env.RPC_URL;

    if (!token) {
        console.error('❌ TELEGRAM_BOT_TOKEN not found in .env');
        console.error('   Get your token from @BotFather on Telegram');
        process.exit(1);
    }

    if (!rpcUrl) {
        console.error('❌ RPC_URL not found in .env');
        process.exit(1);
    }

    // Create and start bot
    const bot = new TelegramBot(token, rpcUrl);

    await bot.start();

    console.log('✅ Bot is running!');
    console.log('   Open Telegram and send /start to your bot\n');
    console.log('📚 Available commands:');
    console.log('  Core:');
    console.log('    /start - Welcome message');
    console.log('    /menu - Main menu');
    console.log('    /wallet - Wallet management');
    console.log('    /balance - Check balance');
    console.log('    /settings - Configuration');
    console.log('    /help - Help menu\n');
    console.log('  Trading:');
    console.log('    /snipe - Manual snipe');
    console.log('    /positions - View positions');
    console.log('    /buy - Buy tokens');
    console.log('    /sell - Sell tokens');
    console.log('    /history - Trade history\n');
    console.log('  Advanced:');
    console.log('    /autosnipe - Auto-snipe config');
    console.log('    /alerts - Price alerts\n');
    console.log('Press Ctrl+C to stop\n');

    // Example: Send test notification
    setTimeout(async () => {
        console.log('\n📬 Sending test notification...');

        const notifier = bot.getNotifier();

        // This would normally be triggered by actual events
        // await notifier.notifyByWallet('wallet_address', {
        //   type: 'BUY',
        //   token: {
        //     symbol: 'TEST',
        //     mint: 'ABC...XYZ',
        //     amount: 0.01,
        //     price: 0.000123
        //   }
        // });

    }, 5000);
}

main().catch(console.error);
