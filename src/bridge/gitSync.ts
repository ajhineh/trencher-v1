// src/bridge/gitSync.ts

/**
 * Git Sync - Sync code with Git repository
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { EventEmitter } from 'events';
import { FileSync } from './fileSync';

export interface GitSyncConfig {
    repoPath: string;
    branch: string;
    autoCommit?: boolean;
    autoPush?: boolean;
}

export class GitSync extends EventEmitter {
    private git: SimpleGit;
    private config: GitSyncConfig;
    private fileSync: FileSync;

    constructor(config: GitSyncConfig, fileSync: FileSync) {
        super();
        this.config = {
            autoCommit: false,
            autoPush: false,
            ...config
        };
        this.git = simpleGit(config.repoPath);
        this.fileSync = fileSync;
    }

    /**
     * Pull latest changes from remote
     */
    async pullLatest(): Promise<{ success: boolean; changes: string[] }> {
        try {
            console.log('📥 Pulling latest changes from Git...');

            // Get current commit
            const beforePull = await this.git.revparse(['HEAD']);

            // Pull
            await this.git.pull('origin', this.config.branch);

            // Get new commit
            const afterPull = await this.git.revparse(['HEAD']);

            // Get changed files
            const diff = await this.git.diff([
                '--name-only',
                `${beforePull}..${afterPull}`
            ]);

            const changedFiles = diff.split('\n').filter(f => f.trim());

            if (changedFiles.length > 0) {
                console.log(`✅ Pulled ${changedFiles.length} changed files`);

                // Hot reload changed files
                for (const file of changedFiles) {
                    if (this.shouldHotReload(file)) {
                        await this.fileSync.hotReload(file);
                    }
                }

                this.emit('pulled', { changes: changedFiles });
            } else {
                console.log('✅ Already up to date');
            }

            return { success: true, changes: changedFiles };
        } catch (error: any) {
            console.error('❌ Git pull failed:', error.message);
            this.emit('error', error);
            return { success: false, changes: [] };
        }
    }

    /**
     * Commit changes
     */
    async commit(message: string, files?: string[]): Promise<boolean> {
        try {
            console.log('💾 Committing changes...');

            // Add files
            if (files && files.length > 0) {
                await this.git.add(files);
            } else {
                await this.git.add('.');
            }

            // Commit
            await this.git.commit(message);

            console.log('✅ Changes committed');
            this.emit('committed', { message, files });

            // Auto push if enabled
            if (this.config.autoPush) {
                await this.push();
            }

            return true;
        } catch (error: any) {
            console.error('❌ Git commit failed:', error.message);
            this.emit('error', error);
            return false;
        }
    }

    /**
     * Push changes to remote
     */
    async push(): Promise<boolean> {
        try {
            console.log('📤 Pushing changes to remote...');

            await this.git.push('origin', this.config.branch);

            console.log('✅ Changes pushed');
            this.emit('pushed');

            return true;
        } catch (error: any) {
            console.error('❌ Git push failed:', error.message);
            this.emit('error', error);
            return false;
        }
    }

    /**
     * Get status
     */
    async getStatus(): Promise<any> {
        return await this.git.status();
    }

    /**
     * Get commit history
     */
    async getLog(count: number = 10): Promise<any> {
        return await this.git.log({ maxCount: count });
    }

    /**
     * Checkout branch
     */
    async checkoutBranch(branch: string): Promise<boolean> {
        try {
            await this.git.checkout(branch);
            this.config.branch = branch;
            console.log(`✅ Switched to branch: ${branch}`);
            return true;
        } catch (error: any) {
            console.error('❌ Checkout failed:', error.message);
            return false;
        }
    }

    /**
     * Create new branch
     */
    async createBranch(name: string): Promise<boolean> {
        try {
            await this.git.checkoutLocalBranch(name);
            console.log(`✅ Created branch: ${name}`);
            return true;
        } catch (error: any) {
            console.error('❌ Create branch failed:', error.message);
            return false;
        }
    }

    /**
     * Check if file should be hot reloaded
     */
    private shouldHotReload(file: string): boolean {
        // Only reload TypeScript/JavaScript files
        return file.endsWith('.ts') || file.endsWith('.js');
    }

    /**
     * Auto-sync (pull, commit, push)
     */
    async autoSync(commitMessage?: string): Promise<boolean> {
        try {
            // Pull latest
            await this.pullLatest();

            // Check if there are changes to commit
            const status = await this.getStatus();

            if (status.files.length > 0) {
                // Commit
                const message = commitMessage || `Auto-sync: ${new Date().toISOString()}`;
                await this.commit(message);

                // Push
                await this.push();
            }

            return true;
        } catch (error: any) {
            console.error('❌ Auto-sync failed:', error.message);
            return false;
        }
    }
}
