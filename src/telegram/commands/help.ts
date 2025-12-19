// src/telegram/commands/help.ts

/**
 * /help command
 * Show all available commands
 */

import { Context } from 'telegraf';

export async function handleHelp(ctx: Context): Promise<void> {
    const helpMessage = `
📚 **YouLi-AI Sniper Bot - Commands**

**🎯 Getting Started**
/start - Welcome message & setup
/wallet - Manage your wallet
/settings - Configure bot settings

**💰 Trading**
/snipe [token] [amount] - Snipe a token
/positions - View active positions
/sell [token] [%] - Sell tokens
/buy [token] [amount] - Buy tokens

**📊 Information**
/balance - Check wallet balance
/history - Trade history
/stats - Performance statistics

**⚙️ Configuration**
/settings - Bot configuration
/alerts - Notification settings
/help - This help message

**🛡️ Protection Features**
• AI validation (70%+ confidence)
• Rug pull detection (real-time)
• Emergency exit (<800ms)
• Multi-layer protection

**💡 Tips**
• Start with small amounts
• Enable rug protection
• Monitor notifications
• Review settings regularly

**Need help?** Contact @youli_support
  `.trim();

    await ctx.replyWithMarkdown(helpMessage);
}
