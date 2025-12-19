// src/telegram/commands/snipe.ts

/**
 * /snipe command
 * Manual token sniping
 */

import { Context } from 'telegraf';
import { SessionManager } from '../sessionManager';
import { PublicKey } from '@solana/web3.js';
import { logger } from '../../logger';

export async function handleSnipe(
    ctx: Context,
    sessionManager: SessionManager,
    sniperSystem: any // UltimateSniperSystem
): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = sessionManager.getSession(
        userId,
        ctx.chat!.id,
        ctx.from?.username
    );

    // Check wallet
    if (!session.walletAddress) {
        await ctx.reply(
            '❌ No wallet connected!\n\n' +
            'Use /wallet to connect your wallet first.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // Parse command
    const text = (ctx.message as any)?.text || '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
        await ctx.reply(
            '🎯 **Manual Snipe**\n\n' +
            '**Usage:**\n' +
            '`/snipe [token_address] [amount]`\n\n' +
            '**Examples:**\n' +
            '`/snipe ABC...XYZ 0.01`\n' +
            '`/snipe ABC...XYZ` (uses default)\n\n' +
            '**Current Settings:**\n' +
            `• Max Buy: ${session.settings.maxBuyAmount} SOL\n` +
            `• AI Threshold: ${session.settings.aiConfidenceThreshold}%\n` +
            `• Rug Protection: ${session.settings.enableRugProtection ? 'ON' : 'OFF'}`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const tokenAddress = args[0];
    const amount = args[1] ? parseFloat(args[1]) : session.settings.maxBuyAmount;

    // Validate token address
    try {
        new PublicKey(tokenAddress);
    } catch {
        await ctx.reply('❌ Invalid token address!');
        return;
    }

    // Validate amount
    if (amount <= 0 || amount > session.settings.maxBuyAmount) {
        await ctx.reply(
            `❌ Invalid amount!\n\n` +
            `Must be between 0 and ${session.settings.maxBuyAmount} SOL`
        );
        return;
    }

    // Send confirmation
    const confirmMsg = await ctx.reply(
        `⚡ **Sniping Token**\n\n` +
        `Token: \`${tokenAddress}\`\n` +
        `Amount: ${amount} SOL\n\n` +
        `🔍 AI validating...`,
        { parse_mode: 'Markdown' }
    );

    try {
        // Execute snipe
        logger.info(`Manual snipe requested by user ${userId}`);
        logger.info(`  Token: ${tokenAddress}`);
        logger.info(`  Amount: ${amount} SOL`);

        // Execute snipe cycle
        await sniperSystem.manualSnipe(
            new PublicKey(tokenAddress),
            amount
        );

        await ctx.telegram.editMessageText(
            ctx.chat!.id,
            confirmMsg.message_id,
            undefined,
            `✅ **Snipe Cycle Started!**\n\n` +
            `Token: \`${tokenAddress.slice(0, 8)}...${tokenAddress.slice(-8)}\`\n` +
            `Amount: ${amount} SOL\n` +
            `Status: 🔄 Analyzing & Buying...`,
            { parse_mode: 'Markdown' }
        );

    } catch (error: any) {
        logger.error('Snipe error:', error.message);

        await ctx.telegram.editMessageText(
            ctx.chat!.id,
            confirmMsg.message_id,
            undefined,
            `❌ **Error**\n\n` +
            `Failed to snipe token.\n` +
            `Error: ${error.message}\n\n` +
            `Try again or contact support.`,
            { parse_mode: 'Markdown' }
        );
    }
}
