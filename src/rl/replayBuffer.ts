// src/rl/replayBuffer.ts

/**
 * Experience Replay Buffer for DQN
 */

export interface Experience {
    state: number[];
    action: number; // 0=IGNORE, 1=BUY, 2=SELL
    reward: number;
    nextState: number[];
    done: boolean;
}

export class ReplayBuffer {
    private buffer: Experience[] = [];
    private maxSize: number;

    constructor(maxSize: number = 10000) {
        this.maxSize = maxSize;
    }

    /**
     * Add experience to buffer
     */
    add(experience: Experience): void {
        this.buffer.push(experience);

        // Remove oldest if buffer is full
        if (this.buffer.length > this.maxSize) {
            this.buffer.shift();
        }
    }

    /**
     * Sample random batch from buffer
     */
    sample(batchSize: number): Experience[] {
        if (this.buffer.length < batchSize) {
            return this.buffer.slice(); // Return all if not enough
        }

        const sampled: Experience[] = [];
        const indices = new Set<number>();

        while (indices.size < batchSize) {
            const idx = Math.floor(Math.random() * this.buffer.length);
            if (!indices.has(idx)) {
                indices.add(idx);
                sampled.push(this.buffer[idx]);
            }
        }

        return sampled;
    }

    /**
     * Get buffer size
     */
    size(): number {
        return this.buffer.length;
    }

    /**
     * Clear buffer
     */
    clear(): void {
        this.buffer = [];
    }

    /**
     * Check if buffer has enough samples
     */
    canSample(batchSize: number): boolean {
        return this.buffer.length >= batchSize;
    }

    /**
     * Get all experiences
     */
    getAll(): Experience[] {
        return this.buffer.slice();
    }
}
