// src/sentiment/socialSentiment.ts

/**
 * Social Sentiment Analysis
 * Analyzes social media sentiment for tokens
 */

import { logger } from "../logger";

export interface SentimentScore {
    overall: number; // -100 to +100
    positive: number; // 0-100
    negative: number; // 0-100
    neutral: number; // 0-100
    volume: number; // Number of mentions
    trending: boolean;
    confidence: number; // 0-100
}

export interface SocialMention {
    platform: 'twitter' | 'telegram' | 'discord';
    text: string;
    author: string;
    timestamp: number;
    sentiment: 'positive' | 'negative' | 'neutral';
    score: number; // -1 to +1
}

export class SocialSentimentAnalyzer {
    private cache: Map<string, { score: SentimentScore; timestamp: number }> = new Map();
    private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes

    /**
     * Analyze sentiment for a token
     */
    async analyzeSentiment(tokenAddress: string, tokenName?: string): Promise<SentimentScore> {
        // Check cache
        const cached = this.cache.get(tokenAddress);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.score;
        }

        // Collect mentions from all platforms
        const mentions: SocialMention[] = [];

        try {
            // Twitter mentions
            const twitterMentions = await this.getTwitterMentions(tokenAddress, tokenName);
            mentions.push(...twitterMentions);

            // Telegram mentions  
            const telegramMentions = await this.getTelegramMentions(tokenAddress, tokenName);
            mentions.push(...telegramMentions);

            // Calculate overall sentiment
            const score = this.calculateSentiment(mentions);

            // Cache result
            this.cache.set(tokenAddress, { score, timestamp: Date.now() });

            logger.info(
                `[Sentiment] ${tokenAddress.slice(0, 8)}... ` +
                `Score: ${score.overall.toFixed(1)}, ` +
                `Volume: ${score.volume}, ` +
                `Trending: ${score.trending}`
            );

            return score;
        } catch (error) {
            logger.error(`[Sentiment] Error analyzing ${tokenAddress}: ${error}`);

            // Return neutral score on error
            return {
                overall: 0,
                positive: 33,
                negative: 33,
                neutral: 34,
                volume: 0,
                trending: false,
                confidence: 0,
            };
        }
    }

    /**
     * Get Twitter mentions (simplified - would need Twitter API)
     */
    private async getTwitterMentions(
        tokenAddress: string,
        tokenName?: string
    ): Promise<SocialMention[]> {
        // TODO: Implement Twitter API integration
        // For now, return empty array
        // In production, you would:
        // 1. Use Twitter API v2
        // 2. Search for token address or name
        // 3. Analyze tweet sentiment

        logger.debug(`[Sentiment] Twitter search for ${tokenAddress} (not implemented)`);
        return [];
    }

    /**
     * Get Telegram mentions (simplified)
     */
    private async getTelegramMentions(
        tokenAddress: string,
        tokenName?: string
    ): Promise<SocialMention[]> {
        // TODO: Implement Telegram scraping
        // For now, return empty array
        // In production, you would:
        // 1. Monitor Telegram groups
        // 2. Search for token mentions
        // 3. Analyze message sentiment

        logger.debug(`[Sentiment] Telegram search for ${tokenAddress} (not implemented)`);
        return [];
    }

    /**
     * Calculate overall sentiment from mentions
     */
    private calculateSentiment(mentions: SocialMention[]): SentimentScore {
        if (mentions.length === 0) {
            return {
                overall: 0,
                positive: 33,
                negative: 33,
                neutral: 34,
                volume: 0,
                trending: false,
                confidence: 0,
            };
        }

        // Count sentiments
        const positive = mentions.filter(m => m.sentiment === 'positive').length;
        const negative = mentions.filter(m => m.sentiment === 'negative').length;
        const neutral = mentions.filter(m => m.sentiment === 'neutral').length;

        const total = mentions.length;

        // Calculate percentages
        const positivePercent = (positive / total) * 100;
        const negativePercent = (negative / total) * 100;
        const neutralPercent = (neutral / total) * 100;

        // Calculate overall score (-100 to +100)
        const overall = positivePercent - negativePercent;

        // Check if trending (high volume in last hour)
        const lastHour = Date.now() - 60 * 60 * 1000;
        const recentMentions = mentions.filter(m => m.timestamp > lastHour);
        const trending = recentMentions.length > 50; // Threshold

        // Confidence based on volume
        const confidence = Math.min(100, (total / 100) * 100);

        return {
            overall,
            positive: positivePercent,
            negative: negativePercent,
            neutral: neutralPercent,
            volume: total,
            trending,
            confidence,
        };
    }

    /**
     * Analyze text sentiment using simple keyword matching
     * (In production, use NLP library or AI)
     */
    private analyzeTextSentiment(text: string): { sentiment: 'positive' | 'negative' | 'neutral'; score: number } {
        const lowerText = text.toLowerCase();

        // Positive keywords
        const positiveKeywords = [
            'moon', 'bullish', 'pump', 'buy', 'gem', 'amazing',
            'great', 'good', 'profit', 'win', 'success', 'rocket',
            '🚀', '💎', '🔥', '💰', '📈'
        ];

        // Negative keywords
        const negativeKeywords = [
            'scam', 'rug', 'dump', 'sell', 'bearish', 'bad',
            'terrible', 'loss', 'fail', 'avoid', 'warning',
            '🚨', '⚠️', '📉', '💩'
        ];

        let positiveCount = 0;
        let negativeCount = 0;

        positiveKeywords.forEach(keyword => {
            if (lowerText.includes(keyword)) positiveCount++;
        });

        negativeKeywords.forEach(keyword => {
            if (lowerText.includes(keyword)) negativeCount++;
        });

        if (positiveCount > negativeCount) {
            return { sentiment: 'positive', score: 0.5 + (positiveCount * 0.1) };
        } else if (negativeCount > positiveCount) {
            return { sentiment: 'negative', score: -0.5 - (negativeCount * 0.1) };
        } else {
            return { sentiment: 'neutral', score: 0 };
        }
    }

    /**
     * Get sentiment interpretation
     */
    interpretSentiment(score: SentimentScore): string {
        if (score.volume < 10) {
            return 'Low volume - insufficient data';
        }

        if (score.overall > 50) {
            return 'Very Bullish 🚀';
        } else if (score.overall > 20) {
            return 'Bullish 📈';
        } else if (score.overall > -20) {
            return 'Neutral ➡️';
        } else if (score.overall > -50) {
            return 'Bearish 📉';
        } else {
            return 'Very Bearish 🚨';
        }
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
    }
}

// Singleton instance
let sentimentInstance: SocialSentimentAnalyzer | null = null;

export function getSocialSentiment(): SocialSentimentAnalyzer {
    if (!sentimentInstance) {
        sentimentInstance = new SocialSentimentAnalyzer();
    }
    return sentimentInstance;
}
