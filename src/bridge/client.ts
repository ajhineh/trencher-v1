// src/bridge/client.ts

/**
 * Bridge Client - Connect to remote bridge server
 * This runs in Antigravity or any client that wants to connect
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { WebSocketMessage, LogEntry, RemoteCommand, RemoteResponse } from './types';

export interface BridgeClientConfig {
    url: string;
    apiKey: string;
    reconnect?: boolean;
    reconnectInterval?: number;
}

export class BridgeClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private config: BridgeClientConfig;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private messageId = 0;
    private pendingRequests = new Map<string, {
        resolve: (value: any) => void;
        reject: (error: any) => void;
    }>();

    constructor(config: BridgeClientConfig) {
        super();
        this.config = {
            reconnect: true,
            reconnectInterval: 5000,
            ...config
        };
    }

    /**
     * Connect to bridge server
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const wsUrl = `${this.config.url}?apiKey=${this.config.apiKey}`;

            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                console.log('✅ Connected to bridge server');
                this.emit('connected');
                resolve();
            });

            this.ws.on('message', (data: Buffer) => {
                try {
                    const message: WebSocketMessage = JSON.parse(data.toString());
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Failed to parse message:', error);
                }
            });

            this.ws.on('close', () => {
                console.log('🔌 Disconnected from bridge server');
                this.emit('disconnected');

                if (this.config.reconnect) {
                    this.scheduleReconnect();
                }
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.emit('error', error);
                reject(error);
            });
        });
    }

    /**
     * Handle incoming message
     */
    private handleMessage(message: WebSocketMessage) {
        switch (message.type) {
            case 'log':
                this.emit('log', message.data as LogEntry);
                break;

            case 'metrics':
                this.emit('metrics', message.data);
                break;

            case 'response':
                if (message.id) {
                    const pending = this.pendingRequests.get(message.id);
                    if (pending) {
                        pending.resolve(message.data);
                        this.pendingRequests.delete(message.id);
                    }
                }
                this.emit('response', message.data);
                break;

            case 'heartbeat':
                // Echo heartbeat
                this.send({ type: 'heartbeat', data: {} });
                break;
        }
    }

    /**
     * Send message to server
     */
    private send(message: WebSocketMessage) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            throw new Error('WebSocket not connected');
        }
    }

    /**
     * Send command and wait for response
     */
    async sendCommand(command: RemoteCommand): Promise<RemoteResponse> {
        return new Promise((resolve, reject) => {
            const id = `cmd_${this.messageId++}`;

            this.pendingRequests.set(id, { resolve, reject });

            // Set timeout
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Command timeout'));
                }
            }, 30000); // 30 second timeout

            this.send({
                type: 'command',
                data: command,
                id
            });
        });
    }

    /**
     * Restart bot
     */
    async restart(): Promise<RemoteResponse> {
        return this.sendCommand({ type: 'restart' });
    }

    /**
     * Stop bot
     */
    async stop(): Promise<RemoteResponse> {
        return this.sendCommand({ type: 'stop' });
    }

    /**
     * Update configuration
     */
    async updateConfig(config: any): Promise<RemoteResponse> {
        return this.sendCommand({ type: 'updateConfig', data: config });
    }

    /**
     * Execute code remotely
     */
    async executeCode(code: string): Promise<RemoteResponse> {
        return this.sendCommand({ type: 'executeCode', code });
    }

    /**
     * Get bot status
     */
    async getStatus(): Promise<RemoteResponse> {
        return this.sendCommand({ type: 'getStatus' });
    }

    /**
     * Emergency exit
     */
    async emergencyExit(): Promise<RemoteResponse> {
        return this.sendCommand({ type: 'emergencyExit' });
    }

    /**
     * Schedule reconnection
     */
    private scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectTimer = setTimeout(() => {
            console.log('🔄 Attempting to reconnect...');
            this.connect().catch(err => {
                console.error('Reconnection failed:', err);
            });
        }, this.config.reconnectInterval);
    }

    /**
     * Disconnect
     */
    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
