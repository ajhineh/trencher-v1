// src/telegram/commands/start.ts

/**
 * /start command
 * Welcome message and initial setup
 */

import { Context } from 'telegraf';
import { SessionManager } from '../sessionManager';

export async function handleStart(
    ctx: Context,
    sessionManager: SessionManager
): Promise<void> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const username = ctx.from?.username;

    if (!userId || !chatId) return;

    // Get or create session
    const session = sessionManager.getSession(userId, chatId, username);

    const welcomeMessage = `
🤖 **Welcome to YouLi-AI Sniper Bot!**

The most advanced AI-powered token sniper on Solana.

✨ **Features:**
• AI-validated token sniping
• 4-layer rug pull protection
• <800ms emergency exit
• Multi-wallet support
• Intelligent selling

🚀 **Quick Start:**
1. /wallet - Connect your wallet
2. /settings - Configure bot
3. /snipe - Start sniping!

📚 **Commands:**
/help - View all commands
/positions - Active positions
/settings - Configuration

**Status:** ${session.walletAddress ? '✅ Ready' : '⚠️ Wallet not connected'}

Let's start by connecting your wallet!
Use /wallet to get started.
  `.trim();

    await ctx.replyWithMarkdown(welcomeMessage);
}
