// src/bridgeClientManager.ts

/**
 * Bridge Client Manager
 * Manages connection to remote bridge server
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';

interface BridgeClientConfig {
    url: string;
    apiKey: string;
    reconnect?: boolean;
    reconnectInterval?: number;
}

interface WebSocketMessage {
    type: string;
    data: any;
    id?: string;
}

export class BridgeClientManager extends EventEmitter {
    private ws: WebSocket | null = null;
    private config: BridgeClientConfig | null = null;
    private connected = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private messageId = 0;
    private pendingRequests = new Map<string, {
        resolve: (value: any) => void;
        reject: (error: any) => void;
    }>();

    async connect(url: string, apiKey: string, reconnect: boolean = true, reconnectInterval: number = 5000) {
        if (this.connected) {
            return;
        }

        this.config = { url, apiKey, reconnect, reconnectInterval };

        try {
            const wsUrl = `${url}?apiKey=${apiKey}`;
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                this.connected = true;
                this.emit('connected');
                console.log('✅ Connected to bridge server');
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
                this.connected = false;
                this.emit('disconnected');
                console.log('🔌 Disconnected from bridge server');

                if (this.config?.reconnect) {
                    this.scheduleReconnect();
                }
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.emit('error', error);
            });
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.connected = false;
        }
    }

    private handleMessage(message: WebSocketMessage) {
        switch (message.type) {
            case 'log':
                this.emit('log', message.data);
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
                this.send({ type: 'heartbeat', data: {} });
                break;
        }
    }

    private send(message: WebSocketMessage) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            throw new Error('WebSocket not connected');
        }
    }

    private async sendCommand(command: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = `cmd_${this.messageId++}`;

            this.pendingRequests.set(id, { resolve, reject });

            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Command timeout'));
                }
            }, 30000);

            this.send({
                type: 'command',
                data: command,
                id
            });
        });
    }

    async restart() {
        return this.sendCommand({ type: 'restart' });
    }

    async stop() {
        return this.sendCommand({ type: 'stop' });
    }

    async emergencyExit() {
        return this.sendCommand({ type: 'emergencyExit' });
    }

    async updateConfig(config: any) {
        return this.sendCommand({ type: 'updateConfig', data: config });
    }

    async getStatus() {
        return this.sendCommand({ type: 'getStatus' });
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectTimer = setTimeout(() => {
            if (this.config) {
                console.log('🔄 Attempting to reconnect...');
                this.connect(
                    this.config.url,
                    this.config.apiKey,
                    this.config.reconnect,
                    this.config.reconnectInterval
                ).catch(err => {
                    console.error('Reconnection failed:', err);
                });
            }
        }, this.config?.reconnectInterval || 5000);
    }

    isConnected(): boolean {
        return this.connected;
    }
}
