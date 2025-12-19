
import { logger } from '../logger';

export interface LatencyStats {
    count: number;
    min: number;
    max: number;
    avg: number;
    p95: number;
    p99: number;
}

export class LatencyTracker {
    private static instance: LatencyTracker;
    private metrics: Map<string, number[]> = new Map();
    private readonly MAX_HISTORY = 1000; // Keep last 1000 samples per metric

    private constructor() { }

    static getInstance(): LatencyTracker {
        if (!LatencyTracker.instance) {
            LatencyTracker.instance = new LatencyTracker();
        }
        return LatencyTracker.instance;
    }

    /**
     * Record a duration for a specific metric
     * @param metricName Name of the operation (e.g., 'DQN_Inference')
     * @param durationMs Duration in milliseconds
     */
    record(metricName: string, durationMs: number): void {
        if (!this.metrics.has(metricName)) {
            this.metrics.set(metricName, []);
        }

        const samples = this.metrics.get(metricName)!;
        samples.push(durationMs);

        // Maintain fixed window size
        if (samples.length > this.MAX_HISTORY) {
            samples.shift(); // Remove oldest
        }
    }

    /**
     * Start a timer and return a function to stop it and record
     */
    startTimer(metricName: string): () => void {
        const start = process.hrtime();
        return () => {
            const end = process.hrtime(start);
            const durationMs = (end[0] * 1000) + (end[1] / 1e6);
            this.record(metricName, durationMs);
        };
    }

    /**
     * Get statistics for a specific metric
     */
    getStats(metricName: string): LatencyStats | null {
        const samples = this.metrics.get(metricName);
        if (!samples || samples.length === 0) return null;

        // Sort for percentiles
        const sorted = [...samples].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);

        return {
            count: samples.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            avg: sum / samples.length,
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)]
        };
    }

    /**
     * Get statistics for all metrics
     */
    getAllStats(): Record<string, LatencyStats> {
        const report: Record<string, LatencyStats> = {};
        for (const [name, _] of this.metrics) {
            const stats = this.getStats(name);
            if (stats) {
                report[name] = stats;
            }
        }
        return report;
    }

    /**
     * Reset all metrics
     */
    reset(): void {
        this.metrics.clear();
    }
}

export const latencyTracker = LatencyTracker.getInstance();
