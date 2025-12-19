// src/telegram/commands/buy.ts

/**
 * /buy command
 * Buy tokens manually
 */

import { Context } from 'telegraf';
import { SessionManager } from '../sessionManager';
import { PublicKey } from '@solana/web3.js';
import { logger } from '../../logger';

export async function handleBuy(
    ctx: Context,
    sessionManager: SessionManager,
    sniperSystem: any
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

    const text = (ctx.message as any)?.text || '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
        await ctx.reply(
            `💰 **Buy Tokens**\n\n` +
            `**Usage:**\n` +
            `\`/buy [token_address] [amount]\`\n\n` +
            `**Examples:**\n` +
            `\`/buy ABC...XYZ 0.01\`\n` +
            `\`/buy ABC...XYZ\` (uses default)\n\n` +
            `**Note:** Use /snipe for AI-validated buys\n` +
            `/buy bypasses AI validation`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const tokenAddress = args[0];
    const amount = args[1] ? parseFloat(args[1]) : session.settings.maxBuyAmount;

    // Validate
    try {
        new PublicKey(tokenAddress);
    } catch {
        await ctx.reply('❌ Invalid token address!');
        return;
    }

    if (amount <= 0 || amount > session.settings.maxBuyAmount) {
        await ctx.reply(
            `❌ Invalid amount!\n\n` +
            `Must be between 0 and ${session.settings.maxBuyAmount} SOL`
        );
        return;
    }

    const confirmMsg = await ctx.reply(
        `💰 **Buying Token**\n\n` +
        `Token: \`${tokenAddress}\`\n` +
        `Amount: ${amount} SOL\n\n` +
        `⚠️ **Warning:** Bypassing AI validation\n` +
        `⏳ Processing...`,
        { parse_mode: 'Markdown' }
    );

    try {
        logger.info(`Manual buy by user ${userId}`);
        logger.info(`  Token: ${tokenAddress}`);
        logger.info(`  Amount: ${amount} SOL`);

        // Execute buy
        const signature = await sniperSystem.manualBuy(
            new PublicKey(tokenAddress),
            amount,
            session.walletAddress
        );

        if (signature) {
            await ctx.telegram.editMessageText(
                ctx.chat!.id,
                confirmMsg.message_id,
                undefined,
                `✅ **Token Purchased!**\n\n` +
                `Token: \`${tokenAddress.slice(0, 8)}...${tokenAddress.slice(-8)}\`\n` +
                `Amount: ${amount} SOL\n` +
                `Sig: [View](https://solscan.io/tx/${signature})\n\n` +
                `📊 View: /positions`,
                { parse_mode: 'Markdown' }
            );
        } else {
            throw new Error('Transaction failed or returned null signature.');
        }

    } catch (error: any) {
        logger.error('Buy error:', error.message);

        await ctx.telegram.editMessageText(
            ctx.chat!.id,
            confirmMsg.message_id,
            undefined,
            `❌ **Error**\n\n${error.message}`,
            { parse_mode: 'Markdown' }
        );
    }
}
