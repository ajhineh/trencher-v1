// src/news/newsEventsIntegration.ts

/**
 * News & Events Integration
 * Integrates crypto news and events to inform trading decisions
 */

import { logger } from "../logger";

export type NewsSource = 'CryptoPanic' | 'CoinTelegraph' | 'CoinDesk' | 'Twitter' | 'Reddit';
export type NewsSentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
export type NewsImpact = 'HIGH' | 'MEDIUM' | 'LOW';
export type EventType = 'LISTING' | 'PARTNERSHIP' | 'UPGRADE' | 'HACK' | 'REGULATION' | 'AIRDROP' | 'BURN';

export interface NewsItem {
    id: string;
    title: string;
    content: string;
    source: NewsSource;
    url: string;
    timestamp: number;
    sentiment: NewsSentiment;
    sentimentScore: number; // -100 to +100
    relevance: number; // 0-100
    tokens: string[]; // Mentioned token addresses
    impact: NewsImpact;
    verified: boolean;
}

export interface EventItem {
    id: string;
    type: EventType;
    title: string;
    description: string;
    timestamp: number;
    scheduledTime?: number; // For future events
    tokens: string[];
    impact: NewsImpact;
    source: string;
    verified: boolean;
}

export interface NewsAnalysis {
    token: string;
    timestamp: number;

    // News summary
    totalNews: number;
    recentNews: NewsItem[]; // Last 24h

    // Sentiment analysis
    overallSentiment: NewsSentiment;
    sentimentScore: number; // -100 to +100
    sentimentTrend: 'IMPROVING' | 'DECLINING' | 'STABLE';

    // Impact assessment
    highImpactNews: NewsItem[];
    upcomingEvents: EventItem[];

    // Trading recommendation
    recommendation: {
        action: 'BUY' | 'SELL' | 'HOLD' | 'AVOID';
        confidence: number; // 0-100
        reason: string;
        urgency: 'HIGH' | 'MEDIUM' | 'LOW';
    };
}

export class NewsEventsAnalyzer {
    private newsCache: Map<string, NewsItem[]> = new Map();
    private eventsCache: Map<string, EventItem[]> = new Map();
    private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes

    /**
     * Analyze news and events for a token
     */
    async analyze(tokenAddress: string, tokenName?: string): Promise<NewsAnalysis> {
        logger.info(`[News] Analyzing news for ${tokenAddress.slice(0, 8)}...`);

        try {
            // Fetch news
            const news = await this.fetchNews(tokenAddress, tokenName);

            // Fetch events
            const events = await this.fetchEvents(tokenAddress, tokenName);

            // Filter recent news (last 24h)
            const recentNews = news.filter(n => Date.now() - n.timestamp < 24 * 60 * 60 * 1000);

            // Calculate overall sentiment
            const { sentiment, score, trend } = this.calculateSentiment(recentNews);

            // Identify high impact news
            const highImpactNews = recentNews.filter(n => n.impact === 'HIGH');

            // Get upcoming events
            const upcomingEvents = events.filter(e =>
                e.scheduledTime && e.scheduledTime > Date.now()
            );

            // Generate recommendation
            const recommendation = this.generateRecommendation(
                sentiment,
                score,
                highImpactNews,
                upcomingEvents
            );

            const analysis: NewsAnalysis = {
                token: tokenAddress,
                timestamp: Date.now(),
                totalNews: news.length,
                recentNews,
                overallSentiment: sentiment,
                sentimentScore: score,
                sentimentTrend: trend,
                highImpactNews,
                upcomingEvents,
                recommendation,
            };

            logger.info(
                `[News] ${tokenAddress.slice(0, 8)}... ` +
                `Sentiment: ${sentiment} (${score.toFixed(0)}), ` +
                `Action: ${recommendation.action}`
            );

            return analysis;
        } catch (error) {
            logger.error(`[News] Error analyzing ${tokenAddress}: ${error}`);
            throw error;
        }
    }

    /**
     * Fetch news from multiple sources
     */
    /**
     * Fetch news from multiple sources
     */
    private async fetchNews(tokenAddress: string, tokenName?: string): Promise<NewsItem[]> {
        // Check cache
        const cached = this.newsCache.get(tokenAddress);
        if (cached && cached.length > 0 && Date.now() - cached[0]?.timestamp < this.cacheTimeout) {
            return cached;
        }

        const news: NewsItem[] = [];

        // 1. CryptoPanic (Best for aggregated crypto news)
        try {
            if (process.env.CRYPTOPANIC_API_KEY) {
                const cryptoPanicNews = await this.fetchFromCryptoPanic(tokenAddress, tokenName);
                news.push(...cryptoPanicNews);
            }
        } catch (error) {
            logger.error(`[News] CryptoPanic error: ${error}`);
        }

        // 2. RSS Feeds (Fallback/Supplement)
        if (process.env.ENABLE_RSS_NEWS === 'true') {
            try {
                // Fetch general market news if token specific news is scarce, 
                // OR filter RSS for token name
                const rssNews = await this.fetchFromRSS(tokenName);
                news.push(...rssNews);
            } catch (error) {
                logger.error(`[News] RSS error: ${error}`);
            }
        }

        // Sort by timestamp (newest first)
        news.sort((a, b) => b.timestamp - a.timestamp);

        // Cache results
        this.newsCache.set(tokenAddress, news);

        return news;
    }

    /**
     * Fetch from CryptoPanic API
     */
    private async fetchFromCryptoPanic(tokenAddress: string, tokenName?: string): Promise<NewsItem[]> {
        const apiKey = process.env.CRYPTOPANIC_API_KEY;
        if (!apiKey) return [];

        // Search by symbol (ticker) usually better for CryptoPanic
        // Assuming tokenName might be "Solana" or symbol "SOL"
        // Let's rely on filter by currency if possible, or simple search

        // Simpler: search for the token symbol/name
        const query = tokenName || tokenAddress;
        const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${apiKey}&kind=news&filter=hot&public=true&currencies=${query}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.results) {
                return data.results.map((item: any) => ({
                    id: `cp-${item.id}`,
                    title: item.title,
                    content: item.slug,
                    source: 'CryptoPanic',
                    url: item.url,
                    timestamp: new Date(item.created_at).getTime(),
                    sentiment: this.mapSentiment(item.votes),
                    sentimentScore: this.calculateVoteScore(item.votes),
                    relevance: 90,
                    tokens: [tokenAddress],
                    impact: item.votes?.important > 5 ? 'HIGH' : 'MEDIUM',
                    verified: true
                }));
            }
        } catch (e) {
            logger.warn(`CryptoPanic fetch failed: ${e}`);
        }
        return [];
    }

    /**
     * Fetch from RSS Feeds (CoinTelegraph, CoinDesk)
     */
    private async fetchFromRSS(tokenName?: string): Promise<NewsItem[]> {
        // Simple XML parsing not available in vanilla JS without DOMParser or library in Node.
        // We will use a regex approach for simple RSS parsing to avoid adding heavy dependencies just for this.

        const feeds = [
            'https://cointelegraph.com/rss',
            'https://www.coindesk.com/arc/outboundfeeds/rss/'
        ];

        const allNews: NewsItem[] = [];

        for (const feed of feeds) {
            try {
                const res = await fetch(feed);
                const text = await res.text();

                // Simple Regex to extract items
                const itemRegex = /<item>([\s\S]*?)<\/item>/g;
                let match;

                while ((match = itemRegex.exec(text)) !== null) {
                    const itemContent = match[1];
                    const titleMatch = /<title>(.*?)<\/title>/.exec(itemContent);
                    const linkMatch = /<link>(.*?)<\/link>/.exec(itemContent);
                    const pubDateMatch = /<pubDate>(.*?)<\/pubDate>/.exec(itemContent);

                    if (titleMatch && linkMatch) {
                        const title = titleMatch[1].replace('<![CDATA[', '').replace(']]>', '');
                        // Filter by token name if provided
                        if (tokenName && !title.toLowerCase().includes(tokenName.toLowerCase())) {
                            continue;
                        }

                        allNews.push({
                            id: `rss-${Math.random().toString(36).substr(2, 9)}`,
                            title: title,
                            content: title,
                            source: feed.includes('cointelegraph') ? 'CoinTelegraph' : 'CoinDesk',
                            url: linkMatch[1],
                            timestamp: pubDateMatch ? new Date(pubDateMatch[1]).getTime() : Date.now(),
                            sentiment: 'NEUTRAL', // Hard to determine without NLP
                            sentimentScore: 0,
                            relevance: tokenName ? 100 : 50,
                            tokens: [],
                            impact: 'LOW',
                            verified: true
                        });
                    }
                }
            } catch (e) {
                // Ignore specific feed errors
            }
        }
        return allNews;
    }

    private mapSentiment(votes: any): NewsSentiment {
        if (!votes) return 'NEUTRAL';
        if (votes.positive > votes.negative) return 'POSITIVE';
        if (votes.negative > votes.positive) return 'NEGATIVE';
        return 'NEUTRAL';
    }

    private calculateVoteScore(votes: any): number {
        if (!votes) return 0;
        const total = votes.positive + votes.negative + votes.important;
        if (total === 0) return 0;
        return ((votes.positive - votes.negative) / total) * 100;
    }

    // ... rest of class functions ... (fetchFromTwitter etc - keeping empty/mocked for now as they require harder Auth)

    /**
     * Fetch from Twitter API
     */
    private async fetchFromTwitter(tokenAddress: string, tokenName?: string): Promise<NewsItem[]> {
        // Placeholder for future implementation
        return [];
    }

    /**
     * Fetch from Reddit API
     */
    private async fetchFromReddit(tokenAddress: string, tokenName?: string): Promise<NewsItem[]> {
        // Placeholder for future implementation
        return [];
    }

    /**
     * Fetch events
     */
    private async fetchEvents(tokenAddress: string, tokenName?: string): Promise<EventItem[]> {
        // Check cache
        const cached = this.eventsCache.get(tokenAddress);
        if (cached) {
            return cached;
        }

        // Real implementation would go here (CoinMarketCal API etc)
        // Returning empty real array instead of mock data to clear "Fake" data from system
        const events: EventItem[] = [];
        this.eventsCache.set(tokenAddress, events);

        return events;
    }

    /**
     * Calculate overall sentiment
     */
    private calculateSentiment(news: NewsItem[]): {
        sentiment: NewsSentiment;
        score: number;
        trend: 'IMPROVING' | 'DECLINING' | 'STABLE';
    } {
        if (news.length === 0) {
            return { sentiment: 'NEUTRAL', score: 0, trend: 'STABLE' };
        }

        // Calculate weighted average sentiment
        let totalScore = 0;
        let totalWeight = 0;

        for (const item of news) {
            const weight = item.relevance / 100;
            totalScore += item.sentimentScore * weight;
            totalWeight += weight;
        }

        const avgScore = totalWeight > 0 ? totalScore / totalWeight : 0;

        // Determine sentiment category
        let sentiment: NewsSentiment;
        if (avgScore > 20) sentiment = 'POSITIVE';
        else if (avgScore < -20) sentiment = 'NEGATIVE';
        else sentiment = 'NEUTRAL';

        // Calculate trend (compare recent vs older news)
        const recentScore = this.getAverageSentiment(news.slice(0, Math.ceil(news.length / 2)));
        const olderScore = this.getAverageSentiment(news.slice(Math.ceil(news.length / 2)));

        let trend: 'IMPROVING' | 'DECLINING' | 'STABLE';
        if (recentScore > olderScore + 10) trend = 'IMPROVING';
        else if (recentScore < olderScore - 10) trend = 'DECLINING';
        else trend = 'STABLE';

        return { sentiment, score: avgScore, trend };
    }

    /**
     * Get average sentiment score
     */
    private getAverageSentiment(news: NewsItem[]): number {
        if (news.length === 0) return 0;
        return news.reduce((sum, n) => sum + n.sentimentScore, 0) / news.length;
    }

    /**
     * Generate trading recommendation
     */
    private generateRecommendation(
        sentiment: NewsSentiment,
        score: number,
        highImpactNews: NewsItem[],
        upcomingEvents: EventItem[]
    ): {
        action: 'BUY' | 'SELL' | 'HOLD' | 'AVOID';
        confidence: number;
        reason: string;
        urgency: 'HIGH' | 'MEDIUM' | 'LOW';
    } {
        let action: 'BUY' | 'SELL' | 'HOLD' | 'AVOID' = 'HOLD';
        let confidence = 50;
        let reason = 'Neutral news sentiment';
        let urgency: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';

        // Check for critical negative news
        const criticalNegative = highImpactNews.filter(n => n.sentiment === 'NEGATIVE');
        if (criticalNegative.length > 0) {
            action = 'AVOID';
            confidence = 90;
            reason = `Critical negative news: ${criticalNegative[0].title}`;
            urgency = 'HIGH';
            return { action, confidence, reason, urgency };
        }

        // Check for major positive news
        const majorPositive = highImpactNews.filter(n => n.sentiment === 'POSITIVE');
        if (majorPositive.length > 0 && score > 50) {
            action = 'BUY';
            confidence = 80;
            reason = `Strong positive news: ${majorPositive[0].title}`;
            urgency = 'HIGH';
            return { action, confidence, reason, urgency };
        }

        // Check upcoming events
        const positiveEvents = upcomingEvents.filter(e =>
            ['LISTING', 'PARTNERSHIP', 'UPGRADE', 'AIRDROP'].includes(e.type)
        );
        if (positiveEvents.length > 0) {
            action = 'BUY';
            confidence = 70;
            reason = `Upcoming positive event: ${positiveEvents[0].title}`;
            urgency = 'MEDIUM';
            return { action, confidence, reason, urgency };
        }

        // Based on overall sentiment
        if (sentiment === 'POSITIVE' && score > 40) {
            action = 'BUY';
            confidence = 60 + Math.min(score / 2, 20);
            reason = `Positive sentiment (${score.toFixed(0)})`;
            urgency = 'MEDIUM';
        } else if (sentiment === 'NEGATIVE' && score < -40) {
            action = 'SELL';
            confidence = 60 + Math.min(Math.abs(score) / 2, 20);
            reason = `Negative sentiment (${score.toFixed(0)})`;
            urgency = 'MEDIUM';
        }

        return { action, confidence, reason, urgency };
    }

    /**
     * Monitor news in real-time
     */
    async monitorNews(
        tokens: string[],
        callback: (token: string, analysis: NewsAnalysis) => void,
        interval: number = 5 * 60 * 1000 // 5 minutes
    ): Promise<void> {
        logger.info(`[News] Monitoring ${tokens.length} tokens for news updates`);

        const check = async () => {
            for (const token of tokens) {
                try {
                    const analysis = await this.analyze(token);

                    // Only callback if there's significant news
                    if (analysis.highImpactNews.length > 0 || analysis.upcomingEvents.length > 0) {
                        callback(token, analysis);
                    }
                } catch (error) {
                    logger.error(`[News] Error monitoring ${token}: ${error}`);
                }
            }
        };

        // Initial check
        await check();

        // Periodic checks
        setInterval(check, interval);
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.newsCache.clear();
        this.eventsCache.clear();
    }
}

// Singleton instance
let newsAnalyzerInstance: NewsEventsAnalyzer | null = null;

export function getNewsEventsAnalyzer(): NewsEventsAnalyzer {
    if (!newsAnalyzerInstance) {
        newsAnalyzerInstance = new NewsEventsAnalyzer();
    }
    return newsAnalyzerInstance;
}
