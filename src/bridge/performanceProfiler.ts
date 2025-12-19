// src/bridge/performanceProfiler.ts

/**
 * Performance Profiler - Profile bot performance
 */

import { EventEmitter } from 'events';

export interface PerformanceMetric {
    name: string;
    duration: number;
    timestamp: number;
    metadata?: any;
}

export interface ProfileReport {
    totalDuration: number;
    averageDuration: number;
    minDuration: number;
    maxDuration: number;
    count: number;
    metrics: PerformanceMetric[];
}

export class PerformanceProfiler extends EventEmitter {
    private metrics: Map<string, PerformanceMetric[]> = new Map();
    private timers: Map<string, number> = new Map();
    private maxMetricsPerName = 1000;

    /**
     * Start timing
     */
    start(name: string) {
        this.timers.set(name, Date.now());
    }

    /**
     * End timing and record
     */
    end(name: string, metadata?: any) {
        const startTime = this.timers.get(name);
        if (!startTime) {
            console.warn(`No timer found for: ${name}`);
            return;
        }

        const duration = Date.now() - startTime;
        this.timers.delete(name);

        const metric: PerformanceMetric = {
            name,
            duration,
            timestamp: Date.now(),
            metadata
        };

        // Store metric
        if (!this.metrics.has(name)) {
            this.metrics.set(name, []);
        }

        const nameMetrics = this.metrics.get(name)!;
        nameMetrics.push(metric);

        // Limit size
        if (nameMetrics.length > this.maxMetricsPerName) {
            nameMetrics.shift();
        }

        this.emit('metric', metric);
    }

    /**
     * Measure async function
     */
    async measure<T>(name: string, fn: () => Promise<T>, metadata?: any): Promise<T> {
        this.start(name);
        try {
            const result = await fn();
            this.end(name, metadata);
            return result;
        } catch (error) {
            this.end(name, { ...metadata, error: true });
            throw error;
        }
    }

    /**
     * Get report for a metric
     */
    getReport(name: string): ProfileReport | null {
        const metrics = this.metrics.get(name);
        if (!metrics || metrics.length === 0) {
            return null;
        }

        const durations = metrics.map(m => m.duration);
        const total = durations.reduce((a, b) => a + b, 0);

        return {
            totalDuration: total,
            averageDuration: total / durations.length,
            minDuration: Math.min(...durations),
            maxDuration: Math.max(...durations),
            count: metrics.length,
            metrics: metrics.slice(-100) // Last 100
        };
    }

    /**
     * Get all reports
     */
    getAllReports(): Map<string, ProfileReport> {
        const reports = new Map<string, ProfileReport>();

        this.metrics.forEach((_, name) => {
            const report = this.getReport(name);
            if (report) {
                reports.set(name, report);
            }
        });

        return reports;
    }

    /**
     * Find slow operations
     */
    findSlowOperations(thresholdMs: number = 1000): PerformanceMetric[] {
        const slow: PerformanceMetric[] = [];

        this.metrics.forEach(metrics => {
            metrics.forEach(metric => {
                if (metric.duration > thresholdMs) {
                    slow.push(metric);
                }
            });
        });

        return slow.sort((a, b) => b.duration - a.duration);
    }

    /**
     * Get recommendations
     */
    getRecommendations(): string[] {
        const recommendations: string[] = [];
        const reports = this.getAllReports();

        reports.forEach((report, name) => {
            // Slow average
            if (report.averageDuration > 1000) {
                recommendations.push(
                    `⚠️ "${name}" is slow (avg: ${report.averageDuration.toFixed(0)}ms). Consider optimization.`
                );
            }

            // High variance
            const variance = report.maxDuration - report.minDuration;
            if (variance > 5000) {
                recommendations.push(
                    `⚠️ "${name}" has high variance (${variance.toFixed(0)}ms). Check for inconsistent performance.`
                );
            }

            // Frequent calls
            if (report.count > 1000) {
                recommendations.push(
                    `💡 "${name}" called ${report.count} times. Consider caching or batching.`
                );
            }
        });

        return recommendations;
    }

    /**
     * Clear metrics
     */
    clear(name?: string) {
        if (name) {
            this.metrics.delete(name);
        } else {
            this.metrics.clear();
        }
    }

    /**
     * Export metrics
     */
    export(): any {
        const data: any = {};

        this.metrics.forEach((metrics, name) => {
            data[name] = metrics;
        });

        return data;
    }
}
