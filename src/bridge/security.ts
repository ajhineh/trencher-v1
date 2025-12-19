// src/bridge/security.ts

/**
 * Bridge Security - Authentication and authorization
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export class BridgeSecurity {
    private apiKeys: Set<string>;
    private allowedIPs: Set<string>;
    private rateLimitMap: Map<string, { count: number; resetTime: number }> = new Map();
    private readonly RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
    private readonly RATE_LIMIT_MAX = 100;

    constructor(apiKeys: string[], allowedIPs: string[]) {
        this.apiKeys = new Set(apiKeys);
        this.allowedIPs = new Set(allowedIPs);
    }

    /**
     * Authentication middleware
     */
    authenticate = (req: Request, res: Response, next: NextFunction) => {
        const apiKey = req.headers['x-api-key'] as string;
        const ip = this.getClientIP(req);

        // Check API key
        if (!apiKey || !this.apiKeys.has(apiKey)) {
            res.status(401).json({ error: 'Invalid API key' });
            return;
        }

        // Check IP whitelist
        if (this.allowedIPs.size > 0 && !this.allowedIPs.has(ip)) {
            res.status(403).json({ error: 'IP not allowed' });
            return;
        }

        // Check rate limit
        if (!this.checkRateLimit(ip)) {
            res.status(429).json({ error: 'Rate limit exceeded' });
            return;
        }

        next();
    };

    /**
     * Get client IP
     */
    private getClientIP(req: Request): string {
        return (
            (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
            req.socket.remoteAddress ||
            'unknown'
        );
    }

    /**
     * Check rate limit
     */
    private checkRateLimit(ip: string): boolean {
        const now = Date.now();
        const limit = this.rateLimitMap.get(ip);

        if (!limit || now > limit.resetTime) {
            // Reset or create new limit
            this.rateLimitMap.set(ip, {
                count: 1,
                resetTime: now + this.RATE_LIMIT_WINDOW
            });
            return true;
        }

        if (limit.count >= this.RATE_LIMIT_MAX) {
            return false;
        }

        limit.count++;
        return true;
    }

    /**
     * Encrypt data
     */
    encrypt(data: string, key: string): string {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(
            'aes-256-cbc',
            Buffer.from(key.padEnd(32, '0').slice(0, 32)),
            iv
        );

        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        return iv.toString('hex') + ':' + encrypted;
    }

    /**
     * Decrypt data
     */
    decrypt(encryptedData: string, key: string): string {
        const parts = encryptedData.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];

        const decipher = crypto.createDecipheriv(
            'aes-256-cbc',
            Buffer.from(key.padEnd(32, '0').slice(0, 32)),
            iv
        );

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    /**
     * Add API key
     */
    addApiKey(key: string) {
        this.apiKeys.add(key);
    }

    /**
     * Add allowed IP
     */
    addAllowedIP(ip: string) {
        this.allowedIPs.add(ip);
    }
}
