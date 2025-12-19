// src/views/logsProvider.ts

/**
 * Logs Tree View Provider
 * Displays logs in tree view
 */

import * as vscode from 'vscode';
import { BridgeClientManager } from '../bridgeClientManager';

interface LogEntry {
    level: string;
    message: string;
    timestamp: number;
}

export class LogsProvider implements vscode.TreeDataProvider<LogTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<LogTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private logs: LogEntry[] = [];
    private maxLogs = 100;

    constructor(private bridgeClient: BridgeClientManager) {
        this.bridgeClient.on('log', (log: LogEntry) => {
            this.addLog(log);
        });

        // Register refresh command
        vscode.commands.registerCommand('remoteBotControl.logs.refresh', () => {
            this.refresh();
        });

        // Register clear command
        vscode.commands.registerCommand('remoteBotControl.logs.clear', () => {
            this.clear();
        });
    }

    private addLog(log: LogEntry) {
        this.logs.push(log);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        this.refresh();
    }

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    clear() {
        this.logs = [];
        this.refresh();
    }

    getTreeItem(element: LogTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: LogTreeItem): Thenable<LogTreeItem[]> {
        if (!this.bridgeClient.isConnected()) {
            return Promise.resolve([]);
        }

        if (!element) {
            // Root level - show recent logs
            return Promise.resolve(
                this.logs.slice(-50).reverse().map(log => new LogTreeItem(log))
            );
        }

        return Promise.resolve([]);
    }
}

class LogTreeItem extends vscode.TreeItem {
    constructor(public log: LogEntry) {
        const time = new Date(log.timestamp).toLocaleTimeString();
        const label = `[${time}] ${log.message}`;

        super(label, vscode.TreeItemCollapsibleState.None);

        this.tooltip = log.message;
        this.description = log.level.toUpperCase();

        // Set icon based on log level
        switch (log.level) {
            case 'error':
                this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
                break;
            case 'warn':
                this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
                break;
            case 'info':
                this.iconPath = new vscode.ThemeIcon('info', new vscode.ThemeColor('editorInfo.foreground'));
                break;
            case 'debug':
                this.iconPath = new vscode.ThemeIcon('bug');
                break;
            default:
                this.iconPath = new vscode.ThemeIcon('circle-outline');
        }
    }
}
