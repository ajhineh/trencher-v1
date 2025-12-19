import { EventEmitter } from 'events';
import { logger } from '../../logger';

export enum JobPriority {
    LOW = 0,
    MEDIUM = 1,
    HIGH = 2,
    CRITICAL = 3
}

export enum JobStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED'
}

export interface AnalysisJob {
    id: string;
    tokenMint: string;
    priority: JobPriority;
    status: JobStatus;
    timestamp: number;
    data: any; // Context data for analysis
    result?: any;
    error?: string;
    attempts: number;
}

export class AnalysisQueue extends EventEmitter {
    private queue: AnalysisJob[] = [];
    private processing: Map<string, AnalysisJob> = new Map();
    private maxConcurrent: number = 3;

    constructor(maxConcurrent: number = 3) {
        super();
        this.maxConcurrent = maxConcurrent;
    }

    /**
     * Add a job to the queue
     */
    public add(job: Omit<AnalysisJob, 'status' | 'timestamp' | 'attempts'>): string {
        const newJob: AnalysisJob = {
            ...job,
            status: JobStatus.PENDING,
            timestamp: Date.now(),
            attempts: 0
        };

        this.queue.push(newJob);
        this.sortQueue();

        logger.info(`[QUEUE] Added job ${newJob.id} (Priority: ${newJob.priority})`);
        this.emit('jobAdded', newJob);
        this.processNext();

        return newJob.id;
    }

    /**
     * Get next job to process
     */
    private processNext(): void {
        if (this.processing.size >= this.maxConcurrent) {
            return;
        }

        if (this.queue.length === 0) {
            return;
        }

        const job = this.queue.shift();
        if (!job) return;

        job.status = JobStatus.PROCESSING;
        this.processing.set(job.id, job);

        this.emit('process', job);
    }

    /**
     * Mark job as completed
     */
    public complete(jobId: string, result: any): void {
        const job = this.processing.get(jobId);
        if (!job) return;

        job.status = JobStatus.COMPLETED;
        job.result = result;

        this.processing.delete(jobId);
        logger.info(`[QUEUE] Job ${jobId} completed`);

        this.emit('completed', job);
        this.processNext();
    }

    /**
     * Mark job as failed
     */
    public fail(jobId: string, error: string): void {
        const job = this.processing.get(jobId);
        if (!job) return;

        job.status = JobStatus.FAILED;
        job.error = error;

        this.processing.delete(jobId);
        logger.error(`[QUEUE] Job ${jobId} failed: ${error}`);

        this.emit('failed', job);
        this.processNext();
    }

    /**
     * Sort queue by priority (Critical first)
     */
    private sortQueue(): void {
        this.queue.sort((a, b) => b.priority - a.priority);
    }

    public getStatus(jobId: string): JobStatus | undefined {
        // Check processing
        if (this.processing.has(jobId)) {
            return this.processing.get(jobId)?.status;
        }

        // Check pending
        const pending = this.queue.find(j => j.id === jobId);
        if (pending) return pending.status;

        return undefined;
    }

    public getQueueLength(): number {
        return this.queue.length;
    }

    public getProcessingCount(): number {
        return this.processing.size;
    }
}
