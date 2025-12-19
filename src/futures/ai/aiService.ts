// src/futures/ai/aiService.ts

/**
 * AI Service - OpenAI Integration
 */

import OpenAI from 'openai';

export class AIService {
    private client: OpenAI | null = null;
    private enabled: boolean = false;

    constructor(apiKey?: string) {
        if (apiKey) {
            this.client = new OpenAI({ apiKey });
            this.enabled = true;
            console.log('✅ AI Service initialized with OpenAI');
        } else {
            console.log('⚠️  AI Service running without OpenAI (rule-based mode)');
        }
    }

    /**
     * Analyze with AI or fallback to rule-based
     */
    async analyze(prompt: string, systemPrompt?: string): Promise<string> {
        if (!this.enabled || !this.client) {
            return this.ruleBasedFallback(prompt);
        }

        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-4-turbo-preview',
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt || this.getDefaultSystemPrompt()
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,  // Lower for more consistent decisions
                max_tokens: 1000,
                response_format: { type: 'json_object' }
            });

            return response.choices[0].message.content || '{}';

        } catch (error: any) {
            console.error('❌ AI Service error:', error.message);
            return this.ruleBasedFallback(prompt);
        }
    }

    /**
     * Default system prompt
     */
    private getDefaultSystemPrompt(): string {
        return `You are an expert cryptocurrency futures trader with deep knowledge of:
- Order flow analysis and market microstructure
- Risk management and position sizing
- Technical analysis and pattern recognition
- Market psychology and sentiment analysis
- Institutional trading strategies

Provide concise, actionable analysis in JSON format.
Focus on risk management and capital preservation.
Be conservative in volatile or uncertain conditions.`;
    }

    /**
     * Rule-based fallback when AI is not available
     */
    private ruleBasedFallback(prompt: string): string {
        // Simple rule-based decision
        return JSON.stringify({
            shouldTrade: true,
            confidence: 60,
            reasoning: ['Rule-based analysis (AI not available)'],
            adjustedLeverage: 3,
            adjustedPositionSize: 0.3,
            warnings: ['AI service not available, using conservative defaults']
        });
    }

    /**
     * Check if AI is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }
}
