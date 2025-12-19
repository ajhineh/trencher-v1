// src/telegram/types.ts

/**
 * Telegram Bot - Type Definitions
 */

export interface UserSession {
    userId: number;
    chatId: number;
    username?: string;
    walletAddress?: string;
    settings: UserSettings;
    autoSnipeConfig?: AutoSnipeConfig;
    priceAlerts?: PriceAlert[];
    createdAt: number;
    lastActive: number;
}

export interface AutoSnipeConfig {
    enabled: boolean;
    minLiquidity: number;
    maxBuyAmount: number;
    aiThreshold: number;
    filters: {
        minHolders?: number;
        maxSupply?: number;
        blacklistedCreators: string[];
    };
}

export interface PriceAlert {
    id: string;
    token: string;
    symbol: string;
    type: 'ABOVE' | 'BELOW';
    targetPrice: number;
    currentPrice: number;
    enabled: boolean;
    createdAt: number;
}

export interface UserSettings {
    aiConfidenceThreshold: number;
    maxBuyAmount: number;
    minLiquidity: number;
    enableRugProtection: boolean;
    enableNotifications: boolean;
    trailingStopPercent: number;
}

export interface BotCommand {
    command: string;
    description: string;
    handler: (ctx: any) => Promise<void>;
}

export interface NotificationData {
    type: 'BUY' | 'SELL' | 'RUG' | 'PROFIT' | 'ALERT';
    token?: {
        symbol: string;
        mint: string;
        amount?: number;
        price?: number;
    };
    profitPercent?: number;
    action?: string;
    message?: string;
}
