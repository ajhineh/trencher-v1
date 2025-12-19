import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export interface AnalysisFeedback {
    id: string;
    tokenMint: string;
    timestamp: number;
    llmResult: any;
    marketOutcome?: {
        priceAfter1h?: number;
        priceAfter24h?: number;
        maxRoi?: number;
        isRug?: boolean;
    };
    tags: string[];
}

export class FeedbackManager {
    private static instance: FeedbackManager;
    private feedbackFile: string;
    private feedbacks: AnalysisFeedback[] = [];

    private constructor() {
        this.feedbackFile = path.join(process.cwd(), 'data', 'learning', 'llm_history.json');
        this.ensureDirectory();
        this.loadFeedbacks();
    }

    public static getInstance(): FeedbackManager {
        if (!FeedbackManager.instance) {
            FeedbackManager.instance = new FeedbackManager();
        }
        return FeedbackManager.instance;
    }

    private ensureDirectory() {
        const dir = path.dirname(this.feedbackFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private loadFeedbacks() {
        try {
            if (fs.existsSync(this.feedbackFile)) {
                const data = fs.readFileSync(this.feedbackFile, 'utf-8');
                this.feedbacks = JSON.parse(data);
            }
        } catch (error) {
            logger.error(`[FeedbackManager] Failed to load feedbacks: ${error}`);
            this.feedbacks = [];
        }
    }

    private saveFeedbacks() {
        try {
            fs.writeFileSync(this.feedbackFile, JSON.stringify(this.feedbacks, null, 2));
        } catch (error) {
            logger.error(`[FeedbackManager] Failed to save feedbacks: ${error}`);
        }
    }

    public recordAnalysis(id: string, tokenMint: string, llmResult: any) {
        const feedback: AnalysisFeedback = {
            id,
            tokenMint,
            timestamp: Date.now(),
            llmResult,
            tags: ['AUTO_ANALYSIS']
        };

        this.feedbacks.push(feedback);
        // Keep last 1000 records
        if (this.feedbacks.length > 1000) {
            this.feedbacks = this.feedbacks.slice(-1000);
        }

        this.saveFeedbacks();
        logger.info(`[FeedbackManager] Recorded analysis for ${tokenMint}`);
    }

    public updateOutcome(id: string, outcome: AnalysisFeedback['marketOutcome']) {
        const feedback = this.feedbacks.find(f => f.id === id);
        if (feedback) {
            feedback.marketOutcome = { ...feedback.marketOutcome, ...outcome };
            this.saveFeedbacks();
            logger.info(`[FeedbackManager] Updated outcome for analysis ${id}`);
        }
    }
}
