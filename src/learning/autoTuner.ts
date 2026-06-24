import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';
import { PatternInsight } from './patternAnalyzer';
import { TradeMemory } from './tradeMemory';
import { PatternAnalyzer } from './patternAnalyzer';

export class AutoTuner {
    private memory: TradeMemory;
    private analyzer: PatternAnalyzer;
    private readonly triggerAfterTrades: number;
    private lastAnalyzedCounts: Record<string, number> = {};

    constructor(memory: TradeMemory) {
        this.memory = memory;
        this.analyzer = new PatternAnalyzer();
        this.triggerAfterTrades = Number(process.env.AMIRO_LEARN_AFTER_TRADES || 20);
    }

    private getSymbolLastCount(symbol: string): number {
        if (this.lastAnalyzedCounts[symbol] === undefined) {
            this.lastAnalyzedCounts[symbol] = 0;
            try {
                const cleanName = symbol.replace(/[\/:]/g, '_');
                const symSuggestionsFile = path.resolve(process.cwd(), `tuning_suggestions_${cleanName}.json`);
                if (fs.existsSync(symSuggestionsFile)) {
                    const data = JSON.parse(fs.readFileSync(symSuggestionsFile, 'utf-8'));
                    this.lastAnalyzedCounts[symbol] = data.lastAnalyzedCount || 0;
                }
            } catch {
                this.lastAnalyzedCounts[symbol] = 0;
            }
        }
        return this.lastAnalyzedCounts[symbol];
    }

    /**
     * Called after every trade close. Triggers analysis on a per-symbol basis.
     */
    checkAndAnalyze(symbol: string): PatternInsight[] | null {
        const symbolTrades = this.memory.getClosedTrades().filter(t => t.context.symbol === symbol);
        const closedCount = symbolTrades.length;
        const lastCount = this.getSymbolLastCount(symbol);
        const newTrades = closedCount - lastCount;

        // In simulated testing, we want to learn more frequently. Let's make it 5 trades or triggerAfterTrades
        const triggerLimit = Math.min(5, this.triggerAfterTrades);

        if (newTrades < triggerLimit) {
            logger.info(`[AutoTuner] [${symbol}] ${newTrades}/${triggerLimit} new trades since last analysis`);
            return null;
        }

        logger.info(`[AutoTuner] [${symbol}] Triggering pattern analysis after ${closedCount} closed trades...`);
        const insights = this.analyzer.analyze(symbolTrades);

        if (insights.length > 0) {
            const autoTuningEnabled = process.env.AMIRO_AUTO_TUNING_ENABLED === 'true';
            if (autoTuningEnabled) {
                logger.info(`[AutoTuner] [${symbol}] 🚀 Auto-Tuning is ENABLED! Dynamically updating symbol configs...`);
                for (const ins of insights) {
                    if (ins.paramKey && ins.paramValue) {
                        const currentVal = String(this.getSymbolConfigValue(symbol, ins.paramKey));
                        ins.paramCurrent = currentVal;
                        const success = this.applySymbolSuggestion(symbol, ins.paramKey, ins.paramValue);
                        if (success) {
                            logger.info(`[AutoTuner] [${symbol}] Dynamically tuned: ${ins.paramKey} = ${ins.paramValue} (was: ${currentVal})`);
                        }
                    }
                }
            }
            this.saveSymbolSuggestions(symbol, insights, closedCount);
        }

        this.lastAnalyzedCounts[symbol] = closedCount;
        return insights;
    }

    private getSymbolConfigValue(symbol: string, paramKey: string): string {
        try {
            const cleanName = symbol.replace(/[\/:]/g, '_');
            const configsDir = path.resolve(process.cwd(), 'configs');
            const configPath = path.resolve(configsDir, `${cleanName}.json`);
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                if (config[paramKey] !== undefined) {
                    return String(config[paramKey]);
                }
            }
        } catch {}
        return process.env[paramKey] || 'undefined';
    }

    applySymbolSuggestion(symbol: string, paramKey: string, paramValue: string): boolean {
        try {
            const cleanName = symbol.replace(/[\/:]/g, '_');
            const configsDir = path.resolve(process.cwd(), 'configs');
            if (!fs.existsSync(configsDir)) {
                fs.mkdirSync(configsDir, { recursive: true });
            }
            const configPath = path.resolve(configsDir, `${cleanName}.json`);
            
            let config: Record<string, any> = {};
            if (fs.existsSync(configPath)) {
                config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            }
            
            config[paramKey] = paramValue;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
            logger.info(`[AutoTuner] [${symbol}] ✅ Saved to ${cleanName}.json: ${paramKey}=${paramValue}`);
            return true;
        } catch (e: any) {
            logger.error(`[AutoTuner] [${symbol}] Failed to apply symbol config suggestion: ${e.message}`);
            return false;
        }
    }

    private saveSymbolSuggestions(symbol: string, insights: PatternInsight[], count: number): void {
        try {
            const cleanName = symbol.replace(/[\/:]/g, '_');
            const symSuggestionsFile = path.resolve(process.cwd(), `tuning_suggestions_${cleanName}.json`);
            const data = {
                symbol,
                generatedAt: new Date().toISOString(),
                tradeCount: count,
                lastAnalyzedCount: count,
                pending: insights.filter(i => i.paramKey),
                informational: insights.filter(i => !i.paramKey)
            };
            fs.writeFileSync(symSuggestionsFile, JSON.stringify(data, null, 2), 'utf-8');
            logger.info(`[AutoTuner] Saved suggestions for ${symbol} to tuning_suggestions_${cleanName}.json`);
        } catch (e: any) {
            logger.error(`[AutoTuner] Save suggestions error for ${symbol}: ${e.message}`);
        }
    }

    formatTelegramMessage(symbol: string, insights: PatternInsight[], tradeCount: number): string {
        const autoTuningEnabled = process.env.AMIRO_AUTO_TUNING_ENABLED === 'true';
        const hasAppliedParams = insights.some(i => i.paramKey && i.paramValue);
        
        let msg = `🧠 *Auto-Tuner Analysis Report for ${symbol}*\n`;
        if (autoTuningEnabled && hasAppliedParams) {
            msg = `⚡️ *Auto-Tuning Dynamic Update for ${symbol}*\n`;
        }
        msg += `📊 Based on ${tradeCount} closed trades\n`;
        msg += `🕐 ${new Date().toLocaleString('en-GB')}\n\n`;
        if (autoTuningEnabled && hasAppliedParams) {
            msg += `🚀 *TOKEN DYNAMICALLY TUNED & UPDATED!*\n\n`;
        } else if (autoTuningEnabled) {
            msg += `💡 *INFORMATIONAL REPORT (No parameters changed)*\n\n`;
        }

        const high   = insights.filter(i => i.priority === 'HIGH');
        const medium = insights.filter(i => i.priority === 'MEDIUM');
        const low    = insights.filter(i => i.priority === 'LOW');

        if (high.length > 0) {
            msg += `🔴 *HIGH PRIORITY (${high.length})*\n`;
            high.forEach((ins, i) => {
                msg += `${i+1}. ${ins.description}\n`;
                msg += `   📝 ${ins.evidence}\n`;
                if (ins.paramKey) {
                    if (autoTuningEnabled) {
                        msg += `   ✅ *Auto-Applied:* ${ins.paramKey} = ${ins.paramValue} (was: ${ins.paramCurrent || 'undefined'})\n`;
                    } else {
                        msg += `   💡 Set ${ins.paramKey}=${ins.paramValue}\n`;
                    }
                }
                msg += `\n`;
            });
        }

        if (medium.length > 0) {
            msg += `🟡 *MEDIUM PRIORITY (${medium.length})*\n`;
            medium.forEach((ins, i) => {
                msg += `${i+1}. ${ins.description}\n`;
                if (ins.paramKey) {
                    if (autoTuningEnabled) {
                        msg += `   ✅ *Auto-Applied:* ${ins.paramKey} = ${ins.paramValue} (was: ${ins.paramCurrent || 'undefined'})\n`;
                    } else {
                        msg += `   💡 Set ${ins.paramKey}=${ins.paramValue}\n`;
                    }
                }
                msg += `\n`;
            });
        }

        msg += `---\n`;
        if (autoTuningEnabled && hasAppliedParams) {
            const cleanName = symbol.replace(/[\/:]/g, '_');
            msg += `✨ Parameters written to configs/${cleanName}.json and active in real-time!`;
        } else {
            msg += `To view full report: npm run analyze`;
        }

        return msg;
    }
}
