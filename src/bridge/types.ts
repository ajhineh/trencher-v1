// src/bridge/types.ts

/**
 * Bridge System Types
 */

export interface BridgeConfig {
    port: number;
    apiKey: string;
    allowedIPs: string[];
    enableSSL: boolean;
    sslCert?: string;
    sslKey?: string;
}

export interface LogEntry {
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    timestamp: number;
    source?: string;
    metadata?: any;
}

export interface SystemMetrics {
    cpu: number;
    memory: {
        used: number;
        total: number;
        percentage: number;
    };
    disk: {
        used: number;
        total: number;
        percentage: number;
    };
    network: {
        rx: number;
        tx: number;
    };
    uptime: number;
}

export interface BotMetrics {
    activeTrades: number;
    totalTrades: number;
    winRate: number;
    profitLoss: number;
    positions: Array<{
        mint: string;
        entryPrice: number;
        currentPrice: number;
        profitPercent: number;
    }>;
}

export interface RemoteCommand {
    type: 'restart' | 'stop' | 'updateConfig' | 'executeCode' | 'getStatus' | 'emergencyExit';
    data?: any;
    code?: string;
}

export interface RemoteResponse {
    success: boolean;
    data?: any;
    error?: string;
    timestamp: number;
}

export interface WebSocketMessage {
    type: 'log' | 'metrics' | 'command' | 'response' | 'heartbeat' | 'git' | 'file' | 'debug' | 'performance';
    data: any;
    id?: string;
}
