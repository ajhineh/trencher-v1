// src/bridge/enhancedServer.ts

/**
 * Enhanced Bridge Server - Complete remote control system
 * Includes all advanced features
 */

import { BridgeServer } from './server';
import { FileSync } from './fileSync';
import { GitSync } from './gitSync';
import { RemoteDebugger } from './remoteDebugger';
import { PerformanceProfiler } from './performanceProfiler';
import { BridgeConfig } from './types';
import { logger } from '../logger';
import path from 'path';
import { Request, Response } from 'express';

export interface EnhancedBridgeConfig extends BridgeConfig {
    enableGit?: boolean;
    gitBranch?: string;
    backupDir?: string;
    maxBackups?: number;
}

export class EnhancedBridgeServer extends BridgeServer {
    private fileSync: FileSync;
    private gitSync?: GitSync;
    private debugger: RemoteDebugger;
    private profiler: PerformanceProfiler;

    constructor(config: EnhancedBridgeConfig) {
        super(config);

        // Initialize file sync
        this.fileSync = new FileSync({
            backupDir: config.backupDir || path.join(process.cwd(), '.backups'),
            maxBackups: config.maxBackups || 10
        });

        // Initialize Git sync if enabled
        if (config.enableGit) {
            this.gitSync = new GitSync(
                {
                    repoPath: process.cwd(),
                    branch: config.gitBranch || 'main',
                    autoCommit: false,
                    autoPush: false
                },
                this.fileSync
            );

            this.setupGitHandlers();
        }

        // Initialize debugger
        this.debugger = new RemoteDebugger();

        // Initialize profiler
        this.profiler = new PerformanceProfiler();

        this.setupEnhancedRoutes();
        this.setupEventHandlers();

        logger.info('🚀 Enhanced Bridge Server initialized');
    }

    /**
     * Setup enhanced API routes
     */
    private setupEnhancedRoutes() {
        const app = (this as any).app;

        // File operations
        app.get('/api/file', async (req: Request, res: Response) => {
            try {
                const filePath = req.query.path as string;
                const content = await this.fileSync.getFile(filePath);
                res.json({ success: true, content });
            } catch (error: any) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        app.post('/api/file', async (req: Request, res: Response) => {
            try {
                const { path, content } = req.body;
                await this.fileSync.updateFile(path, content);
                res.json({ success: true, message: 'File updated' });
            } catch (error: any) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        app.post('/api/file/rollback', async (req: Request, res: Response) => {
            try {
                const { path, version } = req.body;
                await this.fileSync.rollback(path, version);
                res.json({ success: true, message: 'File rolled back' });
            } catch (error: any) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        app.get('/api/file/backups', async (req: Request, res: Response) => {
            try {
                const filePath = req.query.path as string;
                const backups = await this.fileSync.listBackups(filePath);
                res.json({ success: true, backups });
            } catch (error: any) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Git operations
        if (this.gitSync) {
            app.post('/api/git/pull', async (req: Request, res: Response) => {
                try {
                    const result = await this.gitSync!.pullLatest();
                    res.json(result);
                } catch (error: any) {
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            app.post('/api/git/commit', async (req: Request, res: Response) => {
                try {
                    const { message, files } = req.body;
                    const success = await this.gitSync!.commit(message, files);
                    res.json({ success });
                } catch (error: any) {
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            app.post('/api/git/push', async (req: Request, res: Response) => {
                try {
                    const success = await this.gitSync!.push();
                    res.json({ success });
                } catch (error: any) {
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            app.get('/api/git/status', async (req: Request, res: Response) => {
                try {
                    const status = await this.gitSync!.getStatus();
                    res.json({ success: true, status });
                } catch (error: any) {
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            app.get('/api/git/log', async (req: Request, res: Response) => {
                try {
                    const count = parseInt(req.query.count as string) || 10;
                    const log = await this.gitSync!.getLog(count);
                    res.json({ success: true, log });
                } catch (error: any) {
                    res.status(500).json({ success: false, error: error.message });
                }
            });
        }

        // Debug operations
        app.get('/api/debug/snapshots', (req: Request, res: Response) => {
            const count = parseInt(req.query.count as string) || 10;
            const snapshots = this.debugger.getSnapshots(count);
            res.json({ success: true, snapshots });
        });

        app.post('/api/debug/snapshot', (req: Request, res: Response) => {
            const snapshot = this.debugger.takeSnapshot(req.body.context);
            res.json({ success: true, snapshot });
        });

        app.post('/api/debug/breakpoint', (req: Request, res: Response) => {
            const { file, line, action } = req.body;

            if (action === 'set') {
                this.debugger.setBreakpoint(file, line);
            } else if (action === 'remove') {
                this.debugger.removeBreakpoint(file, line);
            }

            res.json({ success: true });
        });

        app.get('/api/debug/breakpoints', (req: Request, res: Response) => {
            const breakpoints = this.debugger.getBreakpoints();
            res.json({ success: true, breakpoints });
        });

        app.post('/api/debug/evaluate', (req: Request, res: Response) => {
            const { expression, context } = req.body;
            const result = this.debugger.evaluate(expression, context);
            res.json({ success: true, result });
        });

        // Performance profiling
        app.get('/api/profile/report', (req: Request, res: Response) => {
            const name = req.query.name as string;

            if (name) {
                const report = this.profiler.getReport(name);
                res.json({ success: true, report });
            } else {
                const reports = Object.fromEntries(this.profiler.getAllReports());
                res.json({ success: true, reports });
            }
        });

        app.get('/api/profile/slow', (req: Request, res: Response) => {
            const threshold = parseInt(req.query.threshold as string) || 1000;
            const slow = this.profiler.findSlowOperations(threshold);
            res.json({ success: true, slow });
        });

        app.get('/api/profile/recommendations', (req: Request, res: Response) => {
            const recommendations = this.profiler.getRecommendations();
            res.json({ success: true, recommendations });
        });

        app.delete('/api/profile', (req: Request, res: Response) => {
            const name = req.query.name as string;
            this.profiler.clear(name);
            res.json({ success: true });
        });
    }

    /**
     * Setup Git event handlers
     */
    private setupGitHandlers() {
        if (!this.gitSync) return;

        this.gitSync.on('pulled', (data) => {
            logger.info(`📥 Git pulled: ${data.changes.length} files changed`);
            this.broadcast({
                type: 'git',
                data: { event: 'pulled', changes: data.changes }
            });
        });

        this.gitSync.on('committed', (data) => {
            logger.info(`💾 Git committed: ${data.message}`);
            this.broadcast({
                type: 'git',
                data: { event: 'committed', message: data.message }
            });
        });

        this.gitSync.on('pushed', () => {
            logger.info('📤 Git pushed');
            this.broadcast({
                type: 'git',
                data: { event: 'pushed' }
            });
        });
    }

    /**
     * Setup event handlers
     */
    private setupEventHandlers() {
        // File sync events
        this.fileSync.on('fileUpdated', (filePath) => {
            logger.info(`📝 File updated: ${filePath}`);
            this.broadcast({
                type: 'file',
                data: { event: 'updated', path: filePath }
            });
        });

        this.fileSync.on('hotReloaded', (filePath) => {
            logger.info(`🔥 Hot reloaded: ${filePath}`);
            this.broadcast({
                type: 'file',
                data: { event: 'hotReloaded', path: filePath }
            });
        });

        this.fileSync.on('restartRequired', (filePath) => {
            logger.warn(`⚠️ Restart required for: ${filePath}`);
            this.broadcast({
                type: 'file',
                data: { event: 'restartRequired', path: filePath }
            });
        });

        // Debug events
        this.debugger.on('snapshot', (snapshot) => {
            this.broadcast({
                type: 'debug',
                data: { event: 'snapshot', snapshot }
            });
        });

        // Performance events
        this.profiler.on('metric', (metric) => {
            // Only broadcast slow metrics
            if (metric.duration > 1000) {
                this.broadcast({
                    type: 'performance',
                    data: { event: 'slowMetric', metric }
                });
            }
        });
    }



    /**
     * Get file sync instance
     */
    getFileSync(): FileSync {
        return this.fileSync;
    }

    /**
     * Get Git sync instance
     */
    getGitSync(): GitSync | undefined {
        return this.gitSync;
    }

    /**
     * Get debugger instance
     */
    getDebugger(): RemoteDebugger {
        return this.debugger;
    }

    /**
     * Get profiler instance
     */
    getProfiler(): PerformanceProfiler {
        return this.profiler;
    }
}
