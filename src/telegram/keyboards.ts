// src/telegram/keyboards.ts

/**
 * Reusable Keyboard Layouts
 */

import { Markup } from 'telegraf';

/**
 * Main menu keyboard
 */
export function mainMenuKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('🎯 Snipe', 'menu_snipe'),
            Markup.button.callback('📊 Positions', 'menu_positions')
        ],
        [
            Markup.button.callback('💰 Wallet', 'menu_wallet'),
            Markup.button.callback('⚙️ Settings', 'menu_settings')
        ],
        [
            Markup.button.callback('🤖 Auto-Snipe', 'menu_autosnipe'),
            Markup.button.callback('🔔 Alerts', 'menu_alerts')
        ],
        [
            Markup.button.callback('📈 Stats', 'menu_stats'),
            Markup.button.callback('❓ Help', 'menu_help')
        ]
    ]);
}

/**
 * Quick actions keyboard
 */
export function quickActionsKeyboard(mint: string) {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('⚡ Quick Sell 50%', `quick_sell_${mint}_50`),
            Markup.button.callback('💎 Hold', `quick_hold_${mint}`)
        ],
        [
            Markup.button.callback('📈 Set Alert', `quick_alert_${mint}`),
            Markup.button.callback('📊 Details', `position_${mint}`)
        ]
    ]);
}

/**
 * Confirmation keyboard
 */
export function confirmationKeyboard(action: string, data: string) {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ Confirm', `confirm_${action}_${data}`),
            Markup.button.callback('❌ Cancel', `cancel_${action}`)
        ]
    ]);
}

/**
 * Percentage selector keyboard
 */
export function percentageSelectorKeyboard(action: string, mint: string) {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('25%', `${action}_${mint}_25`),
            Markup.button.callback('50%', `${action}_${mint}_50`)
        ],
        [
            Markup.button.callback('75%', `${action}_${mint}_75`),
            Markup.button.callback('100%', `${action}_${mint}_100`)
        ],
        [
            Markup.button.callback('🔙 Back', `position_${mint}`)
        ]
    ]);
}

/**
 * Navigation keyboard
 */
export function navigationKeyboard(
    currentPage: number,
    totalPages: number,
    prefix: string
) {
    const buttons = [];

    if (currentPage > 1) {
        buttons.push(
            Markup.button.callback('⬅️ Previous', `${prefix}_page_${currentPage - 1}`)
        );
    }

    buttons.push(
        Markup.button.callback(`${currentPage}/${totalPages}`, 'noop')
    );

    if (currentPage < totalPages) {
        buttons.push(
            Markup.button.callback('Next ➡️', `${prefix}_page_${currentPage + 1}`)
        );
    }

    return Markup.inlineKeyboard([
        buttons,
        [Markup.button.callback('🔙 Back', 'main_menu')]
    ]);
}
