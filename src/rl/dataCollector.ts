// src/rl/dataCollector.ts

/**
 * Historical Data Collector for RL Training
 * Collects real trading data and saves it for RL training
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';

export interface HistoricalTradeData {
    // Token info
    baseMint: string;
    quoteMint: string;
    coinCreator: string;
    liquidityUsd: number;
    recentBuyers: number;
    ageMs: number;
    fdv: number;
    timestamp: number;

    // Market conditions at time of decision
    volatility: number;
    pumpDumpScore: number;
    whaleRisk: boolean;
    coordinatedBuying: number;

    // Portfolio state at time of decision
    capitalUtilization: number;
    openPositions: number;
    portfolioWinRate: number;
    currentDrawdown: number;

    // Decision made
    aiDecision: 'BUY' | 'IGNORE';
    aiReason: string;
    amountSol?: number;
    tpPercent?: number;
    slPercent?: number;

    // Actual outcome (filled later)
    actualOutcome?: {
        priceChange1h: number;
        priceChange24h: number;
        priceChange7d: number;
        hitTP: boolean;
        hitSL: boolean;
        exitReason?: 'TP' | 'SL' | 'MANUAL' | 'TIME';
        finalPnL?: number;
        holdingTimeMs?: number;
    };
}

export class DataCollector {
    private dataDir: string;
    private currentFile: string;
    private data: HistoricalTradeData[] = [];
    private maxFileSize: number = 1000; // Max records per file

    constructor(dataDir: string = './data/rl-training') {
        this.dataDir = dataDir;
        this.ensureDirectoryExists();
        this.currentFile = this.getNewFilePath();
        this.loadCurrentFile();
    }

    /**
     * Ensure data directory exists
     */
    private ensureDirectoryExists(): void {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
            logger.info(`[DataCollector] Created directory: ${this.dataDir}`);
        }
    }

    /**
     * Get new file path with timestamp
     */
    private getNewFilePath(): string {
        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        return path.join(this.dataDir, `rl-data-${timestamp}.json`);
    }

    /**
     * Load current file if exists
     */
    private loadCurrentFile(): void {
        if (fs.existsSync(this.currentFile)) {
            try {
                const content = fs.readFileSync(this.currentFile, 'utf8');
                this.data = JSON.parse(content);
                logger.info(`[DataCollector] Loaded ${this.data.length} records from ${this.currentFile}`);
            } catch (error) {
                logger.error(`[DataCollector] Error loading file: ${error}`);
                this.data = [];
            }
        }
    }

    /**
     * Save current data to file
     */
    private saveToFile(): void {
        try {
            fs.writeFileSync(this.currentFile, JSON.stringify(this.data, null, 2));
            logger.info(`[DataCollector] Saved ${this.data.length} records to ${this.currentFile}`);
        } catch (error) {
            logger.error(`[DataCollector] Error saving file: ${error}`);
        }
    }

    /**
     * Record a new trading decision
     */
    recordDecision(data: Omit<HistoricalTradeData, 'timestamp'>): void {
        const record: HistoricalTradeData = {
            ...data,
            timestamp: Date.now(),
        };

        this.data.push(record);

        // Save periodically
        if (this.data.length % 10 === 0) {
            this.saveToFile();
        }

        // Create new file if current is too large
        if (this.data.length >= this.maxFileSize) {
            this.saveToFile();
            this.currentFile = this.getNewFilePath();
            this.data = [];
            logger.info(`[DataCollector] Started new file: ${this.currentFile}`);
        }
    }

    /**
     * Update outcome for a specific trade
     */
    updateOutcome(baseMint: string, outcome: HistoricalTradeData['actualOutcome']): void {
        const record = this.data.find(r => r.baseMint === baseMint && !r.actualOutcome);
        if (record) {
            record.actualOutcome = outcome;
            this.saveToFile();
            logger.info(`[DataCollector] Updated outcome for ${baseMint.slice(0, 8)}...`);
        }
    }

    /**
     * Get all collected data files
     */
    getAllDataFiles(): string[] {
        return fs.readdirSync(this.dataDir)
            .filter(file => file.startsWith('rl-data-') && file.endsWith('.json'))
            .map(file => path.join(this.dataDir, file));
    }

    /**
     * Load all historical data
     */
    loadAllData(): HistoricalTradeData[] {
        const files = this.getAllDataFiles();
        const allData: HistoricalTradeData[] = [];

        for (const file of files) {
            try {
                const content = fs.readFileSync(file, 'utf8');
                const data = JSON.parse(content) as HistoricalTradeData[];
                allData.push(...data);
            } catch (error) {
                logger.error(`[DataCollector] Error loading ${file}: ${error}`);
            }
        }

        logger.info(`[DataCollector] Loaded ${allData.length} total records from ${files.length} files`);
        return allData;
    }

    /**
     * Get statistics about collected data
     */
    getStatistics(): {
        totalRecords: number;
        recordsWithOutcome: number;
        buyDecisions: number;
        ignoreDecisions: number;
        avgPnL: number;
        winRate: number;
    } {
        const allData = this.loadAllData();
        const withOutcome = allData.filter(r => r.actualOutcome);
        const buyDecisions = allData.filter(r => r.aiDecision === 'BUY');
        const profitable = withOutcome.filter(r => (r.actualOutcome?.finalPnL || 0) > 0);

        const avgPnL = withOutcome.length > 0
            ? withOutcome.reduce((sum, r) => sum + (r.actualOutcome?.finalPnL || 0), 0) / withOutcome.length
            : 0;

        const winRate = withOutcome.length > 0
            ? (profitable.length / withOutcome.length) * 100
            : 0;

        return {
            totalRecords: allData.length,
            recordsWithOutcome: withOutcome.length,
            buyDecisions: buyDecisions.length,
            ignoreDecisions: allData.length - buyDecisions.length,
            avgPnL,
            winRate,
        };
    }

    /**
     * Export data for RL training
     */
    exportForTraining(outputFile: string = './data/rl-training-dataset.json'): void {
        const allData = this.loadAllData();
        const trainingData = allData.filter(r => r.actualOutcome); // Only complete records

        fs.writeFileSync(outputFile, JSON.stringify(trainingData, null, 2));
        logger.info(`[DataCollector] Exported ${trainingData.length} records to ${outputFile}`);
    }
}

// Singleton instance
let collectorInstance: DataCollector | null = null;

export function getDataCollector(): DataCollector {
    if (!collectorInstance) {
        collectorInstance = new DataCollector();
    }
    return collectorInstance;
}
