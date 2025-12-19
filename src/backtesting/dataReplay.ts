// src/backtesting/dataReplay.ts

import { logger } from "../logger";

export interface HistoricalToken {
    baseMint: string;
    quoteMint: string;
    coinCreator: string;
    liquidityUsd: number;
    recentBuyers: number;
    ageMs: number;
    fdv: number;
    timestamp: number;
    actualOutcome?: {
        priceChange24h: number;
        survived: boolean;
        rugPull: boolean;
    };
}

export interface BacktestConfig {
    startDate: Date;
    endDate: Date;
    initialCapital: number; // in SOL
    dataSource: 'file' | 'generated';
}

export class DataReplay {
    private historicalData: HistoricalToken[] = [];
    private currentIndex: number = 0;

    /**
     * Load historical data from file or generate sample data
     */
    async loadData(config: BacktestConfig): Promise<void> {
        if (config.dataSource === 'file') {
            // Load from file (implement later)
            logger.info('[Backtest] Loading historical data from file...');
            // this.historicalData = JSON.parse(fs.readFileSync('historical-data.json', 'utf8'));
        } else {
            // Generate sample data for testing
            logger.info('[Backtest] Generating sample historical data...');
            this.historicalData = this.generateSampleData(config);
        }

        logger.info(`[Backtest] Loaded ${this.historicalData.length} historical tokens`);
    }

    /**
     * Generate sample historical data for testing
     */
    private generateSampleData(config: BacktestConfig): HistoricalToken[] {
        const tokens: HistoricalToken[] = [];
        const startTime = config.startDate.getTime();
        const endTime = config.endDate.getTime();
        const interval = (endTime - startTime) / 100; // 100 tokens

        for (let i = 0; i < 100; i++) {
            const timestamp = startTime + (i * interval);

            // Random token characteristics
            const liquidityUsd = Math.random() * 50000 + 1000;
            const recentBuyers = Math.floor(Math.random() * 50) + 1;
            const ageMs = Math.random() * 3600000; // 0-1 hour
            const fdv = liquidityUsd * (Math.random() * 10 + 1);

            // Simulate outcome
            const isGood = Math.random() > 0.6; // 40% good tokens
            const priceChange24h = isGood
                ? Math.random() * 200 - 20 // -20% to +180%
                : Math.random() * 50 - 80; // -80% to -30%

            tokens.push({
                baseMint: `token_${i}_${Date.now()}`,
                quoteMint: 'SOL',
                coinCreator: `creator_${Math.floor(Math.random() * 20)}`,
                liquidityUsd,
                recentBuyers,
                ageMs,
                fdv,
                timestamp,
                actualOutcome: {
                    priceChange24h,
                    survived: priceChange24h > -50,
                    rugPull: priceChange24h < -70,
                },
            });
        }

        return tokens.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Get next token in sequence
     */
    getNextToken(): HistoricalToken | null {
        if (this.currentIndex >= this.historicalData.length) {
            return null;
        }
        return this.historicalData[this.currentIndex++];
    }

    /**
     * Reset replay to beginning
     */
    reset(): void {
        this.currentIndex = 0;
    }

    /**
     * Get all tokens
     */
    getAllTokens(): HistoricalToken[] {
        return this.historicalData;
    }

    /**
     * Get progress
     */
    getProgress(): { current: number; total: number; percent: number } {
        return {
            current: this.currentIndex,
            total: this.historicalData.length,
            percent: (this.currentIndex / this.historicalData.length) * 100,
        };
    }
}
