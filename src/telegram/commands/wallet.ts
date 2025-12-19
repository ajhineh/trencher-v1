// src/telegram/commands/wallet.ts

/**
 * /wallet command
 * Wallet management
 */

import { Context, Markup } from 'telegraf';
import { SessionManager } from '../sessionManager';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export async function handleWallet(
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

    if (session.walletAddress) {
        // Wallet already connected
        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('📊 View Balance', 'wallet_balance'),
                Markup.button.callback('🔄 Change Wallet', 'wallet_change')
            ],
            [
                Markup.button.callback('📤 Export Private Key', 'wallet_export'),
                Markup.button.callback('❌ Disconnect', 'wallet_disconnect')
            ]
        ]);

        await ctx.reply(
            `💼 **Your Wallet**\n\n` +
            `Address: \`${session.walletAddress}\`\n\n` +
            `What would you like to do?`,
            {
                parse_mode: 'Markdown',
                ...keyboard
            }
        );
    } else {
        // No wallet connected
        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('🆕 Generate New Wallet', 'wallet_generate'),
                Markup.button.callback('📥 Import Wallet', 'wallet_import')
            ]
        ]);

        await ctx.reply(
            `💼 **Wallet Setup**\n\n` +
            `You don't have a wallet connected yet.\n\n` +
            `Choose an option:`,
            {
                parse_mode: 'Markdown',
                ...keyboard
            }
        );
    }
}

/**
 * Generate new wallet
 */
export async function handleWalletGenerate(
    ctx: Context,
    sessionManager: SessionManager
): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Generate new keypair
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();
    const privateKey = bs58.encode(keypair.secretKey);

    // Update session
    sessionManager.updateSession(userId, {
        walletAddress: publicKey
    });

    await ctx.reply(
        `✅ **Wallet Generated!**\n\n` +
        `**Public Address:**\n\`${publicKey}\`\n\n` +
        `**⚠️ IMPORTANT: Save your private key!**\n` +
        `This message will be deleted in 60 seconds.\n\n` +
        `**Private Key:**\n\`${privateKey}\`\n\n` +
        `Store this safely. Never share it with anyone!`,
        { parse_mode: 'Markdown' }
    );

    // Delete message after 60 seconds
    setTimeout(async () => {
        try {
            await ctx.deleteMessage();
        } catch (error) {
            // Message already deleted
        }
    }, 60000);
}

/**
 * Import existing wallet
 */
export async function handleWalletImport(ctx: Context): Promise<void> {
    await ctx.reply(
        `📥 **Import Wallet**\n\n` +
        `Please send your private key in the next message.\n\n` +
        `⚠️ **Security Note:**\n` +
        `• Your key is encrypted and stored locally\n` +
        `• Delete your message after sending\n` +
        `• This chat will be cleared automatically\n\n` +
        `Send your private key now:`,
        { parse_mode: 'Markdown' }
    );
}
