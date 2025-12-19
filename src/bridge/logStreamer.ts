// src/bridge/logStreamer.ts

/**
 * Log Streamer - Captures and streams logs in real-time
 */

import { EventEmitter } from 'events';
import { LogEntry } from './types';

export class LogStreamer extends EventEmitter {
    private logBuffer: LogEntry[] = [];
    private maxBufferSize: number = 1000;
    private originalConsole: {
        log: typeof console.log;
        info: typeof console.info;
        warn: typeof console.warn;
        error: typeof console.error;
    };

    constructor() {
        super();
        this.originalConsole = {
            log: console.log,
            info: console.info,
            warn: console.warn,
            error: console.error
        };
        this.setupLogCapture();
    }

    private setupLogCapture() {
        // Intercept console.log
        console.log = (...args: any[]) => {
            this.originalConsole.log(...args);
            this.captureLog('info', args);
        };

        // Intercept console.info
        console.info = (...args: any[]) => {
            this.originalConsole.info(...args);
            this.captureLog('info', args);
        };

        // Intercept console.warn
        console.warn = (...args: any[]) => {
            this.originalConsole.warn(...args);
            this.captureLog('warn', args);
        };

        // Intercept console.error
        console.error = (...args: any[]) => {
            this.originalConsole.error(...args);
            this.captureLog('error', args);
        };
    }

    private captureLog(level: LogEntry['level'], args: any[]) {
        const entry: LogEntry = {
            level,
            message: args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' '),
            timestamp: Date.now(),
            source: 'bot'
        };

        // Add to buffer
        this.logBuffer.push(entry);
        if (this.logBuffer.length > this.maxBufferSize) {
            this.logBuffer.shift();
        }

        // Emit to listeners
        this.emit('log', entry);
    }

    getRecentLogs(count: number = 100): LogEntry[] {
        return this.logBuffer.slice(-count);
    }

    clearBuffer() {
        this.logBuffer = [];
    }

    restore() {
        console.log = this.originalConsole.log;
        console.info = this.originalConsole.info;
        console.warn = this.originalConsole.warn;
        console.error = this.originalConsole.error;
    }
}
