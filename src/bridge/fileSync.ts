// src/bridge/fileSync.ts

/**
 * File Sync - Sync files between local and remote
 * Supports hot reload for live updates
 */

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

export interface FileSyncConfig {
    backupDir: string;
    maxBackups: number;
}

export class FileSync extends EventEmitter {
    private config: FileSyncConfig;
    private watchedModules: Map<string, any> = new Map();

    constructor(config: FileSyncConfig) {
        super();
        this.config = config;
        this.ensureBackupDir();
    }

    /**
     * Ensure backup directory exists
     */
    private async ensureBackupDir() {
        try {
            await fs.mkdir(this.config.backupDir, { recursive: true });
        } catch (error) {
            // Directory already exists
        }
    }

    /**
     * Update file content
     */
    async updateFile(filePath: string, content: string): Promise<void> {
        // Backup current version
        await this.backup(filePath);

        // Write new content
        await fs.writeFile(filePath, content, 'utf8');

        this.emit('fileUpdated', filePath);

        // Try hot reload
        if (this.canHotReload(filePath)) {
            await this.hotReload(filePath);
        } else {
            this.emit('restartRequired', filePath);
        }
    }

    /**
     * Backup file
     */
    private async backup(filePath: string): Promise<void> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const timestamp = Date.now();
            const backupName = `${path.basename(filePath)}.${timestamp}.bak`;
            const backupPath = path.join(this.config.backupDir, backupName);

            await fs.writeFile(backupPath, content, 'utf8');

            // Clean old backups
            await this.cleanOldBackups(filePath);
        } catch (error) {
            console.error('Backup failed:', error);
        }
    }

    /**
     * Clean old backups
     */
    private async cleanOldBackups(filePath: string): Promise<void> {
        try {
            const baseName = path.basename(filePath);
            const files = await fs.readdir(this.config.backupDir);

            const backups = files
                .filter(f => f.startsWith(baseName) && f.endsWith('.bak'))
                .map(f => ({
                    name: f,
                    path: path.join(this.config.backupDir, f),
                    timestamp: parseInt(f.split('.')[1])
                }))
                .sort((a, b) => b.timestamp - a.timestamp);

            // Keep only maxBackups
            for (let i = this.config.maxBackups; i < backups.length; i++) {
                await fs.unlink(backups[i].path);
            }
        } catch (error) {
            console.error('Clean backups failed:', error);
        }
    }

    /**
     * Check if file can be hot reloaded
     */
    private canHotReload(filePath: string): boolean {
        // TypeScript/JavaScript files can be hot reloaded
        const ext = path.extname(filePath);
        return ['.ts', '.js'].includes(ext);
    }

    /**
     * Hot reload module
     */
    async hotReload(filePath: string): Promise<void> {
        try {
            const absolutePath = path.resolve(filePath);

            // Clear require cache
            delete require.cache[absolutePath];

            // Reload module
            const newModule = require(absolutePath);

            // Store for later use
            this.watchedModules.set(absolutePath, newModule);

            this.emit('hotReloaded', filePath);
            console.log(`✅ Hot reloaded: ${filePath}`);
        } catch (error: any) {
            console.error(`❌ Hot reload failed: ${error.message}`);
            this.emit('hotReloadFailed', { filePath, error });
        }
    }

    /**
     * Rollback to previous version
     */
    async rollback(filePath: string, version?: number): Promise<void> {
        try {
            const baseName = path.basename(filePath);
            const files = await fs.readdir(this.config.backupDir);

            const backups = files
                .filter(f => f.startsWith(baseName) && f.endsWith('.bak'))
                .map(f => ({
                    name: f,
                    path: path.join(this.config.backupDir, f),
                    timestamp: parseInt(f.split('.')[1])
                }))
                .sort((a, b) => b.timestamp - a.timestamp);

            if (backups.length === 0) {
                throw new Error('No backups found');
            }

            // Get backup (default to latest)
            const backup = version !== undefined && version < backups.length
                ? backups[version]
                : backups[0];

            // Restore
            const content = await fs.readFile(backup.path, 'utf8');
            await fs.writeFile(filePath, content, 'utf8');

            // Hot reload
            if (this.canHotReload(filePath)) {
                await this.hotReload(filePath);
            }

            this.emit('rolledBack', { filePath, backup: backup.name });
            console.log(`✅ Rolled back: ${filePath} to ${backup.name}`);
        } catch (error: any) {
            console.error(`❌ Rollback failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get file content
     */
    async getFile(filePath: string): Promise<string> {
        return await fs.readFile(filePath, 'utf8');
    }

    /**
     * List backups
     */
    async listBackups(filePath: string): Promise<Array<{ name: string; timestamp: number }>> {
        const baseName = path.basename(filePath);
        const files = await fs.readdir(this.config.backupDir);

        return files
            .filter(f => f.startsWith(baseName) && f.endsWith('.bak'))
            .map(f => ({
                name: f,
                timestamp: parseInt(f.split('.')[1])
            }))
            .sort((a, b) => b.timestamp - a.timestamp);
    }
}
