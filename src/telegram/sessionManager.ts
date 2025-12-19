// src/telegram/sessionManager.ts

/**
 * Session Manager
 * Manages user sessions and settings
 */

import { UserSession, UserSettings } from './types';
import { logger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';

export class SessionManager {
    private sessions: Map<number, UserSession> = new Map();
    private sessionsFile: string;

    constructor() {
        this.sessionsFile = path.join(__dirname, '../../data/sessions.json');
        this.loadSessions();
    }

    /**
     * Get or create session
     */
    getSession(userId: number, chatId: number, username?: string): UserSession {
        let session = this.sessions.get(userId);

        if (!session) {
            session = this.createSession(userId, chatId, username);
            this.sessions.set(userId, session);
            this.saveSessions();
        }

        // Update last active
        session.lastActive = Date.now();

        return session;
    }

    /**
     * Create new session
     */
    private createSession(
        userId: number,
        chatId: number,
        username?: string
    ): UserSession {
        logger.info(`Creating new session for user ${userId}`);

        return {
            userId,
            chatId,
            username,
            settings: this.getDefaultSettings(),
            createdAt: Date.now(),
            lastActive: Date.now()
        };
    }

    /**
     * Get default settings
     */
    private getDefaultSettings(): UserSettings {
        return {
            aiConfidenceThreshold: 70,
            maxBuyAmount: 0.01,
            minLiquidity: 1,
            enableRugProtection: true,
            enableNotifications: true,
            trailingStopPercent: 15
        };
    }

    /**
     * Update session
     */
    updateSession(userId: number, updates: Partial<UserSession>): void {
        const session = this.sessions.get(userId);

        if (session) {
            Object.assign(session, updates);
            this.saveSessions();
        }
    }

    /**
     * Update settings
     */
    updateSettings(userId: number, settings: Partial<UserSettings>): void {
        const session = this.sessions.get(userId);

        if (session) {
            Object.assign(session.settings, settings);
            this.saveSessions();
        }
    }

    /**
     * Load sessions from file
     */
    private loadSessions(): void {
        try {
            if (fs.existsSync(this.sessionsFile)) {
                const data = fs.readFileSync(this.sessionsFile, 'utf-8');
                const sessions = JSON.parse(data);

                this.sessions = new Map(
                    Object.entries(sessions).map(([key, value]) => [
                        parseInt(key),
                        value as UserSession
                    ])
                );

                logger.info(`Loaded ${this.sessions.size} sessions`);
            }
        } catch (error: any) {
            logger.error('Failed to load sessions:', error.message);
        }
    }

    /**
     * Save sessions to file
     */
    private saveSessions(): void {
        try {
            const dir = path.dirname(this.sessionsFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const sessions = Object.fromEntries(this.sessions);
            fs.writeFileSync(
                this.sessionsFile,
                JSON.stringify(sessions, null, 2)
            );
        } catch (error: any) {
            logger.error('Failed to save sessions:', error.message);
        }
    }

    /**
     * Get all sessions
     */
    getAllSessions(): UserSession[] {
        return Array.from(this.sessions.values());
    }

    /**
     * Get session count
     */
    getSessionCount(): number {
        return this.sessions.size;
    }
}
