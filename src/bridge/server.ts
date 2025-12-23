// src/bridge/server.ts

/**
 * Bridge Server - Main server for remote control
 */

import express, { Express } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server as HTTPServer } from 'http';
import { LogStreamer } from './logStreamer';
import { MetricsCollector } from './metricsCollector';
import { BridgeSecurity } from './security';
import { BridgeConfig, RemoteCommand, RemoteResponse, WebSocketMessage } from './types';
import { logger } from '../logger';

export class BridgeServer {
    protected app: Express;
    private httpServer: HTTPServer;
    private wss: WebSocketServer;
    private logStreamer: LogStreamer;
    private metricsCollector: MetricsCollector;
    private security: BridgeSecurity;
    private config: BridgeConfig;
    private clients: Set<WebSocket> = new Set();
    private botInstance: any;

    constructor(config: BridgeConfig) {
        this.config = config;
        this.app = express();
        this.httpServer = createServer(this.app);
        this.wss = new WebSocketServer({ server: this.httpServer });

        this.logStreamer = new LogStreamer();
        this.metricsCollector = new MetricsCollector();
        this.security = new BridgeSecurity(
            [config.apiKey],
            config.allowedIPs
        );

        this.setupExpress();
        this.setupWebSocket();
        this.setupLogStreaming();
    }

    /**
     * Setup Express middleware and routes
     */
    private setupExpress() {
        this.app.use(express.json());

        // Health check (no auth required)
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', uptime: process.uptime() });
        });

        // All other routes require authentication
        this.app.use(this.security.authenticate);

        // Get recent logs
        this.app.get('/api/logs', (req, res) => {
            const count = parseInt(req.query.count as string) || 100;
            const logs = this.logStreamer.getRecentLogs(count);
            res.json({ logs });
        });

        // Get metrics
        this.app.get('/api/metrics', (req, res) => {
            const metrics = this.metricsCollector.getAllMetrics(this.botInstance);
            res.json(metrics);
        });

        // Execute command
        this.app.post('/api/command', async (req, res) => {
            try {
                const command: RemoteCommand = req.body;
                const response = await this.executeCommand(command);
                res.json(response);
            } catch (error: any) {
                res.status(500).json({
                    success: false,
                    error: error.message,
                    timestamp: Date.now()
                });
            }
        });

        // Get bot status
        this.app.get('/api/status', (req, res) => {
            res.json({
                running: !!this.botInstance,
                uptime: process.uptime(),
                version: process.env.npm_package_version || '1.0.0',
                timestamp: Date.now()
            });
        });
    }

    /**
     * Setup WebSocket server
     */
    private setupWebSocket() {
        this.wss.on('connection', (ws: WebSocket, req) => {
            // Verify API key from query params
            const url = new URL(req.url!, `http://${req.headers.host}`);
            const apiKey = url.searchParams.get('apiKey');

            if (!apiKey || apiKey !== this.config.apiKey) {
                ws.close(1008, 'Invalid API key');
                return;
            }

            logger.info('🔗 Bridge client connected');
            this.clients.add(ws);

            // Send initial data
            this.sendToClient(ws, {
                type: 'response',
                data: {
                    message: 'Connected to bridge server',
                    recentLogs: this.logStreamer.getRecentLogs(50)
                }
            });

            // Handle messages from client
            ws.on('message', async (data: Buffer) => {
                try {
                    const message: WebSocketMessage = JSON.parse(data.toString());
                    await this.handleClientMessage(ws, message);
                } catch (error: any) {
                    this.sendToClient(ws, {
                        type: 'response',
                        data: { error: error.message }
                    });
                }
            });

            // Handle disconnect
            ws.on('close', () => {
                logger.info('🔌 Bridge client disconnected');
                this.clients.delete(ws);
            });

            // Start metrics streaming
            this.startMetricsStream(ws);
        });
    }

    /**
     * Setup log streaming
     */
    private setupLogStreaming() {
        this.logStreamer.on('log', (log) => {
            this.broadcast({
                type: 'log',
                data: log
            });
        });
    }

    /**
     * Start metrics streaming for a client
     */
    private startMetricsStream(ws: WebSocket) {
        const interval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                const metrics = this.metricsCollector.getAllMetrics(this.botInstance);
                this.sendToClient(ws, {
                    type: 'metrics',
                    data: metrics
                });
            } else {
                clearInterval(interval);
            }
        }, 2000); // Every 2 seconds
    }

    /**
     * Handle client message
     */
    private async handleClientMessage(ws: WebSocket, message: WebSocketMessage) {
        switch (message.type) {
            case 'command':
                const response = await this.executeCommand(message.data);
                this.sendToClient(ws, {
                    type: 'response',
                    data: response,
                    id: message.id
                });
                break;

            case 'heartbeat':
                this.sendToClient(ws, {
                    type: 'heartbeat',
                    data: { timestamp: Date.now() }
                });
                break;

            default:
                this.sendToClient(ws, {
                    type: 'response',
                    data: { error: 'Unknown message type' }
                });
        }
    }

    /**
     * Execute remote command
     */
    private async executeCommand(command: RemoteCommand): Promise<RemoteResponse> {
        logger.info(`📡 Executing command: ${command.type}`);

        try {
            switch (command.type) {
                case 'restart':
                    return await this.restartBot();

                case 'stop':
                    return await this.stopBot();

                case 'updateConfig':
                    return await this.updateConfig(command.data);

                case 'executeCode':
                    return await this.executeCode(command.code!);

                case 'getStatus':
                    return {
                        success: true,
                        data: {
                            running: !!this.botInstance,
                            uptime: process.uptime()
                        },
                        timestamp: Date.now()
                    };

                case 'emergencyExit':
                    return await this.emergencyExit();

                default:
                    return {
                        success: false,
                        error: 'Unknown command type',
                        timestamp: Date.now()
                    };
            }
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Restart bot
     */
    private async restartBot(): Promise<RemoteResponse> {
        logger.info('🔄 Restarting bot...');

        // TODO: Implement actual restart logic
        // This depends on how your bot is structured

        return {
            success: true,
            data: { message: 'Bot restart initiated' },
            timestamp: Date.now()
        };
    }

    /**
     * Stop bot
     */
    private async stopBot(): Promise<RemoteResponse> {
        logger.info('🛑 Stopping bot...');

        // TODO: Implement actual stop logic

        return {
            success: true,
            data: { message: 'Bot stopped' },
            timestamp: Date.now()
        };
    }

    /**
     * Update configuration
     */
    private async updateConfig(newConfig: any): Promise<RemoteResponse> {
        logger.info('⚙️ Updating configuration...');

        // TODO: Implement config update logic
        // Update .env or config file

        return {
            success: true,
            data: { message: 'Configuration updated', config: newConfig },
            timestamp: Date.now()
        };
    }

    /**
     * Execute arbitrary code (DANGEROUS - use with caution!)
     */
    private async executeCode(code: string): Promise<RemoteResponse> {
        logger.warn('⚠️ Executing remote code...');

        try {
            // Sandboxed execution
            const result = eval(code);

            return {
                success: true,
                data: { result },
                timestamp: Date.now()
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Emergency exit
     */
    private async emergencyExit(): Promise<RemoteResponse> {
        logger.error('🚨 EMERGENCY EXIT TRIGGERED!');

        // TODO: Close all positions, stop trading, etc.

        return {
            success: true,
            data: { message: 'Emergency exit executed' },
            timestamp: Date.now()
        };
    }

    /**
     * Send message to specific client
     */
    private sendToClient(ws: WebSocket, message: WebSocketMessage) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    /**
     * Broadcast to all clients
     */
    protected broadcast(message: WebSocketMessage) {
        this.clients.forEach(client => {
            this.sendToClient(client, message);
        });
    }

    /**
     * Set bot instance for metrics
     */
    setBotInstance(bot: any) {
        this.botInstance = bot;
    }

    /**
     * Start server
     */
    start() {
        this.httpServer.listen(this.config.port, '0.0.0.0', () => {
            logger.info(`🌉 Bridge Server started on port ${this.config.port}`);
            logger.info(`   WebSocket: ws://0.0.0.0:${this.config.port}`);
            logger.info(`   HTTP API: http://0.0.0.0:${this.config.port}/api`);
        });
    }

    /**
     * Stop server
     */
    stop() {
        this.wss.close();
        this.httpServer.close();
        this.logStreamer.restore();
        logger.info('🌉 Bridge Server stopped');
    }
}
