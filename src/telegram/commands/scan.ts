
import { Context } from 'telegraf';
import { IntelligentTradingSystem } from '../../futures/intelligentTradingSystem';

export const handleScan = async (ctx: Context, tradingSystem?: IntelligentTradingSystem) => {
    if (!tradingSystem) {
        await ctx.reply('⚠️ Trading System not initialized or not available.');
        return;
    }

    const message = (ctx.message as any)?.text || '';
    const parts = message.split(' ');
    // Command format: /scan [on|off|status]

    if (parts.length < 2) {
        await ctx.reply('ℹ️ Usage: /scan [on|off|status]');
        return;
    }

    const action = parts[1].toLowerCase();

    try {
        if (action === 'on') {
            tradingSystem.startAutonmousMode();
            await ctx.reply('✅ Market Scanner STARTED. Searching for opportunities...');
        } else if (action === 'off') {
            tradingSystem.stopAutonomousMode();
            await ctx.reply('🛑 Market Scanner STOPPED.');
        } else if (action === 'status') {
            // We might want to expose a public method in ITS to check status, for now just reply
            await ctx.reply('ℹ️ Check the logs for scanner status (Status check not fully implemented yet).');
        } else {
            await ctx.reply('❌ Invalid argument. Use: on, off, or status.');
        }
    } catch (error) {
        console.error('Error in /scan command:', error);
        await ctx.reply('❌ Failed to execute command.');
    }
};
