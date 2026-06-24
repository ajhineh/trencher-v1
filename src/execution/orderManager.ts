import ccxt from 'ccxt';
import { logger } from '../logger';

export interface OrderResult {
    id: string;
    symbol: string;
    side: string;
    price: number;
    amount: number;
    status: string;
}

export class OrderManager {
    private exchange: any;
    private paperTradingMode: boolean;

    constructor() {
        const exchangeId = process.env.EXCHANGE_ID || 'binance'; // Default to binance
        const exchangeClass = ccxt[exchangeId as keyof typeof ccxt] as any;
        
        if (!exchangeClass) {
            throw new Error(`Exchange ${exchangeId} is not supported by ccxt.`);
        }

        this.exchange = new exchangeClass({
            apiKey: process.env.EXCHANGE_API_KEY,
            secret: process.env.EXCHANGE_API_SECRET,
            enableRateLimit: true,
            options: {
                defaultType: 'future', // Set to futures market
                adjustForTimeDifference: true,
            }
        });

        this.paperTradingMode = process.env.PAPER_TRADING_MODE === 'true';

        if (this.paperTradingMode) {
            logger.info(`[OrderManager] 🚀 Initialized in PAPER TRADING mode (Pure Simulation). No API keys or real funds required.`);
        } else {
            logger.warn(`[OrderManager] ⚠️ Initialized in LIVE mode. Real orders will be placed!`);
        }
    }

    public async checkConnection(): Promise<boolean> {
        try {
            await this.exchange.fetchTime();
            logger.info(`[OrderManager] ✅ Connected to ${this.exchange.id} Futures successfully.`);
            return true;
        } catch (error: any) {
            logger.error(`[OrderManager] ❌ Connection failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Set the leverage for a specific symbol
     */
    public async setLeverage(symbol: string, leverage: number): Promise<void> {
        if (this.paperTradingMode) {
            logger.info(`[OrderManager] [PAPER] Simulated setting leverage to ${leverage}x for ${symbol}`);
            return;
        }
        try {
            await this.exchange.setLeverage(leverage, symbol);
            logger.info(`[OrderManager] Set leverage to ${leverage}x for ${symbol}`);
        } catch (error: any) {
            logger.warn(`[OrderManager] Failed to set leverage for ${symbol} (might already be set): ${error.message}`);
        }
    }

    /**
     * Create a market order
     */
    public async executeMarketOrder(symbol: string, side: 'buy' | 'sell', amount: number): Promise<OrderResult | null> {
        try {
            logger.info(`[OrderManager] Executing ${side.toUpperCase()} MARKET order for ${amount} ${symbol}...`);
            
            if (this.paperTradingMode) {
                // Simulate order locally to bypass exchange API credential requirements
                logger.info(`[OrderManager] [PAPER] ✅ Order Simulated: ${side.toUpperCase()} ${amount} ${symbol}`);
                return {
                    id: `sim_${Date.now()}`,
                    symbol,
                    side,
                    price: 0, 
                    amount,
                    status: 'closed'
                };
            }

            const order = await this.exchange.createMarketOrder(symbol, side, amount);
            logger.info(`[OrderManager] ✅ Order Successful: ID ${order.id}`);
            
            return {
                id: order.id,
                symbol: order.symbol,
                side: order.side,
                price: order.average || order.price,
                amount: order.amount,
                status: order.status
            };
        } catch (error: any) {
            logger.error(`[OrderManager] ❌ Order Failed: ${error.message}`);
            return null;
        }
    }

    /**
     * Fetch open positions
     */
    public async getPositions(symbols?: string[]) {
        if (this.paperTradingMode) {
            return [];
        }
        try {
            const positions = await this.exchange.fetchPositions(symbols);
            return positions.filter((p: any) => p.contracts && p.contracts > 0);
        } catch (error: any) {
            logger.error(`[OrderManager] Error fetching positions: ${error.message}`);
            return [];
        }
    }
}
