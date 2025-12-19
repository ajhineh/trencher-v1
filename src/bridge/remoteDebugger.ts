// src/bridge/remoteDebugger.ts

/**
 * Remote Debugger - Debug bot from remote
 */

import { EventEmitter } from 'events';

export interface DebugSnapshot {
    timestamp: number;
    variables: Record<string, any>;
    stack: string[];
    memory: {
        heapUsed: number;
        heapTotal: number;
        external: number;
    };
}

export class RemoteDebugger extends EventEmitter {
    private snapshots: DebugSnapshot[] = [];
    private maxSnapshots = 100;
    private breakpoints: Map<string, Set<number>> = new Map();

    /**
     * Take snapshot of current state
     */
    takeSnapshot(context?: any): DebugSnapshot {
        const snapshot: DebugSnapshot = {
            timestamp: Date.now(),
            variables: this.captureVariables(context),
            stack: this.captureStack(),
            memory: this.captureMemory()
        };

        this.snapshots.push(snapshot);
        if (this.snapshots.length > this.maxSnapshots) {
            this.snapshots.shift();
        }

        this.emit('snapshot', snapshot);
        return snapshot;
    }

    /**
     * Capture variables from context
     */
    private captureVariables(context?: any): Record<string, any> {
        if (!context) {
            return {};
        }

        const vars: Record<string, any> = {};
        
        try {
            for (const key in context) {
                const value = context[key];
                
                // Serialize value
                if (typeof value === 'function') {
                    vars[key] = '[Function]';
                } else if (value === null) {
                    vars[key] = null;
                } else if (typeof value === 'object') {
                    try {
                        vars[key] = JSON.parse(JSON.stringify(value));
                    } catch {
                        vars[key] = '[Object]';
                    }
                } else {
                    vars[key] = value;
                }
            }
        } catch (error) {
            console.error('Failed to capture variables:', error);
        }

        return vars;
    }

    /**
     * Capture stack trace
     */
    private captureStack(): string[] {
        const stack = new Error().stack || '';
        return stack.split('\n').slice(2); // Remove first 2 lines
    }

    /**
     * Capture memory usage
     */
    private captureMemory() {
        const mem = process.memoryUsage();
        return {
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            external: mem.external
        };
    }

    /**
     * Get recent snapshots
     */
    getSnapshots(count: number = 10): DebugSnapshot[] {
        return this.snapshots.slice(-count);
    }

    /**
     * Clear snapshots
     */
    clearSnapshots() {
        this.snapshots = [];
    }

    /**
     * Set breakpoint
     */
    setBreakpoint(file: string, line: number) {
        if (!this.breakpoints.has(file)) {
            this.breakpoints.set(file, new Set());
        }
        this.breakpoints.get(file)!.add(line);
        
        console.log(`🔴 Breakpoint set: ${file}:${line}`);
        this.emit('breakpointSet', { file, line });
    }

    /**
     * Remove breakpoint
     */
    removeBreakpoint(file: string, line: number) {
        const fileBreakpoints = this.breakpoints.get(file);
        if (fileBreakpoints) {
            fileBreakpoints.delete(line);
            if (fileBreakpoints.size === 0) {
                this.breakpoints.delete(file);
            }
        }
        
        console.log(`⚪ Breakpoint removed: ${file}:${line}`);
        this.emit('breakpointRemoved', { file, line });
    }

    /**
     * Check if breakpoint exists
     */
    hasBreakpoint(file: string, line: number): boolean {
        return this.breakpoints.get(file)?.has(line) || false;
    }

    /**
     * Get all breakpoints
     */
    getBreakpoints(): Array<{ file: string; line: number }> {
        const result: Array<{ file: string; line: number }> = [];
        
        this.breakpoints.forEach((lines, file) => {
            lines.forEach(line => {
                result.push({ file, line });
            });
        });

        return result;
    }

    /**
     * Evaluate expression in context
     */
    evaluate(expression: string, context?: any): any {
        try {
            // Create function with context
            const func = new Function(...Object.keys(context || {}), `return ${expression}`);
            return func(...Object.values(context || {}));
        } catch (error: any) {
            return { error: error.message };
        }
    }
}
