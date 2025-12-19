// src/futures/ai/aiTradingAgent.ts

/**
 * AI Trading Agent
 * Main class that combines all components for intelligent trading decisions
 */

import { AIService } from './aiService';
import { ContextAnalyzer } from './contextAnalyzer';
import { RiskAssessor } from './riskAssessor';
import { AnomalyDetector } from './anomalyDetector';
import {
    AIDecision,
    MarketContext,
    RiskAssessment,
    AnomalyDetection,
    RecentMarketData,
    Portfolio
} from './types';
import { OrderFlowSignal } from '../orderflow/types';

export class AITradingAgent {
    private aiService: AIService;
    private contextAnalyzer: ContextAnalyzer;
    private riskAssessor: RiskAssessor;
    private anomalyDetector: AnomalyDetector;

    constructor(openaiApiKey?: string) {
        this.aiService = new AIService(openaiApiKey);
        this.contextAnalyzer = new ContextAnalyzer();
        this.riskAssessor = new RiskAssessor();
        this.anomalyDetector = new AnomalyDetector();
    }

    /**
     * Evaluate trading signal with AI
     */
    async evaluateSignal(
        signal: OrderFlowSignal,
        recentData: RecentMarketData,
        portfolio: Portfolio
    ): Promise<AIDecision> {
        console.log('🤖 AI Agent: Starting evaluation...');

        // 1. Analyze market context
        console.log('  📊 Analyzing market context...');
        const context = await this.contextAnalyzer.analyzeMarketContext(
            'BTCUSDT', // TODO: get from signal
            recentData
        );

        // 2. Assess risk
        console.log('  ⚠️  Assessing risk...');
        const riskAssessment = await this.riskAssessor.assessRisk(
            signal,
            context,
            portfolio
        );

        // 3. Detect anomalies
        console.log('  🔍 Detecting anomalies...');
        const anomalies = await this.anomalyDetector.detectAnomalies(
            signal,
            recentData
        );

        // 4. Make AI decision
        console.log('  🧠 Making AI decision...');
        const aiDecision = await this.makeAIDecision({
            signal,
            context,
            riskAssessment,
            anomalies
        });

        console.log('✅ AI Agent: Evaluation complete');

        return aiDecision;
    }

    /**
     * Make AI-powered decision
     */
    private async makeAIDecision(data: {
        signal: OrderFlowSignal;
        context: MarketContext;
        riskAssessment: RiskAssessment;
        anomalies: AnomalyDetection;
    }): Promise<AIDecision> {
        // Build prompt
        const prompt = this.buildPrompt(data);

        // Get AI response
        const aiResponse = await this.aiService.analyze(prompt);

        // Parse response
        const parsed = this.parseAIResponse(aiResponse, data);

        return {
            ...parsed,
            context: data.context,
            riskAssessment: data.riskAssessment,
            anomalies: data.anomalies
        };
    }

    /**
     * Build comprehensive prompt for AI
     */
    private buildPrompt(data: any): string {
        const signal = data.signal;
        const context = data.context;
        const risk = data.riskAssessment;
        const anomalies = data.anomalies;

        return `
Analyze this cryptocurrency futures trading signal and provide a decision.

═══════════════════════════════════════════════════
SIGNAL DETAILS
═══════════════════════════════════════════════════
Direction: ${signal.direction}
Confidence: ${signal.confidence}%
Entry Price: $${signal.entry}
Stop Loss: $${signal.stopLoss}
Take Profit: $${signal.takeProfit}
Suggested Leverage: ${signal.leverage || 5}x

ORDER FLOW ANALYSIS:
- Volume Delta: ${signal.volumeDelta}
- Bid/Ask Imbalance: ${(signal.bidAskImbalance * 100).toFixed(2)}%
- Component Scores: ${JSON.stringify(signal.componentScores || {})}

Reasons for signal:
${signal.reasons?.map((r: string) => `- ${r}`).join('\n') || 'N/A'}

═══════════════════════════════════════════════════
MARKET CONTEXT
═══════════════════════════════════════════════════
Trend: ${context.trend}
Volatility: ${context.volatility}
Volume: ${context.volume}
Market Phase: ${context.marketPhase}
Sentiment: ${context.sentiment}

═══════════════════════════════════════════════════
RISK ASSESSMENT
═══════════════════════════════════════════════════
Overall Risk: ${risk.overallRisk}
Liquidation Risk: ${risk.liquidationRisk.toFixed(0)}%
Portfolio Risk: ${risk.portfolioRisk.toFixed(0)}%
Market Risk: ${risk.marketRisk.toFixed(0)}%
Recommendation: ${risk.recommendation}
Max Safe Leverage: ${risk.maxLeverage}x
Max Position Size: ${risk.maxPositionSize.toFixed(4)}

Risk Reasoning:
${risk.reasoning.map((r: string) => `- ${r}`).join('\n')}

═══════════════════════════════════════════════════
ANOMALY DETECTION
═══════════════════════════════════════════════════
Anomalies Detected: ${anomalies.detected ? 'YES' : 'NO'}
Type: ${anomalies.type}
Severity: ${anomalies.severity}
Recommendation: ${anomalies.recommendation}
${anomalies.detected ? `Details: ${anomalies.details.join(', ')}` : ''}

═══════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════
As an expert futures trader, analyze all the above information and decide:

1. Should I execute this trade? (YES/NO)
2. What is your confidence level? (0-100)
3. Should I adjust the leverage? (suggest optimal leverage)
4. Should I adjust the position size? (suggest optimal size as decimal)
5. What are the top 3 reasons for your decision?
6. What warnings should I be aware of?

Consider:
- Capital preservation is priority #1
- Risk/reward ratio
- Market conditions
- Potential for liquidation
- Any detected anomalies

Provide your response in the following JSON format:
{
  "shouldTrade": true or false,
  "confidence": number between 0-100,
  "adjustedLeverage": number,
  "adjustedPositionSize": number,
  "reasoning": ["reason1", "reason2", "reason3"],
  "warnings": ["warning1", "warning2"]
}
`;
    }

    /**
     * Parse AI response
     */
    private parseAIResponse(
        aiResponse: string,
        data: any
    ): Omit<AIDecision, 'context' | 'riskAssessment' | 'anomalies'> {
        try {
            const parsed = JSON.parse(aiResponse);

            return {
                shouldTrade: parsed.shouldTrade || false,
                confidence: Math.min(100, Math.max(0, parsed.confidence || 0)),
                reasoning: Array.isArray(parsed.reasoning) ? parsed.reasoning : ['AI analysis complete'],
                adjustedParams: {
                    leverage: Math.min(10, Math.max(1, parsed.adjustedLeverage || 3)),
                    positionSize: Math.min(1, Math.max(0.1, parsed.adjustedPositionSize || 0.3)),
                    stopLoss: data.signal.stopLoss,
                    takeProfit: Array.isArray(data.signal.takeProfit)
                        ? data.signal.takeProfit
                        : [data.signal.takeProfit]
                },
                warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
            };

        } catch (error) {
            console.error('❌ Failed to parse AI response:', error);

            // Fallback to conservative decision
            return {
                shouldTrade: false,
                confidence: 50,
                reasoning: ['Failed to parse AI response, using conservative defaults'],
                adjustedParams: {
                    leverage: 2,
                    positionSize: 0.2,
                    stopLoss: data.signal.stopLoss,
                    takeProfit: [data.signal.takeProfit]
                },
                warnings: ['AI response parsing failed']
            };
        }
    }

    /**
     * Get a simple yes/no decision
     */
    async shouldTrade(
        signal: OrderFlowSignal,
        recentData: RecentMarketData,
        portfolio: Portfolio
    ): Promise<boolean> {
        const decision = await this.evaluateSignal(signal, recentData, portfolio);
        return decision.shouldTrade && decision.confidence > 70;
    }

    /**
     * Check if AI is enabled
     */
    isAIEnabled(): boolean {
        return this.aiService.isEnabled();
    }
}
