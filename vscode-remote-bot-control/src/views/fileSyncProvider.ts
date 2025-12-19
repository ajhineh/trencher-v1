// src/views/fileSyncProvider.ts

/**
 * File Sync Webview Provider
 * Manage remote file editing and hot reload
 */

import * as vscode from 'vscode';
import { BridgeClientManager } from '../bridgeClientManager';

export class FileSyncProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;

    constructor(
        private context: vscode.ExtensionContext,
        private bridgeClient: BridgeClientManager
    ) {
        this.setupEventHandlers();
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'getFile':
                    await this.getFile(message.path);
                    break;
                case 'saveFile':
                    await this.saveFile(message.path, message.content);
                    break;
                case 'rollback':
                    await this.rollback(message.path, message.version);
                    break;
                case 'listBackups':
                    await this.listBackups(message.path);
                    break;
            }
        });
    }

    private setupEventHandlers() {
        this.bridgeClient.on('response', (data) => {
            if (data.event === 'hotReloaded') {
                this.sendMessage({
                    type: 'hotReloaded',
                    data: { path: data.path }
                });
                vscode.window.showInformationMessage(`🔥 Hot reloaded: ${data.path}`);
            } else if (data.event === 'restartRequired') {
                vscode.window.showWarningMessage(`⚠️ Restart required for: ${data.path}`);
            }
        });
    }

    private async getFile(path: string) {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/file?path=${encodeURIComponent(path)}`, {
                headers: { 'x-api-key': apiKey || '' }
            });

            if (response.ok) {
                const data: any = await response.json();
                this.sendMessage({
                    type: 'fileLoaded',
                    data: { path, content: data.content }
                });
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load file: ${error.message}`);
        }
    }

    private async saveFile(path: string, content: string) {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/file`, {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey || '',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path, content })
            });

            if (response.ok) {
                vscode.window.showInformationMessage(`✅ File saved: ${path}`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to save file: ${error.message}`);
        }
    }

    private async rollback(path: string, version: number) {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/file/rollback`, {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey || '',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path, version })
            });

            if (response.ok) {
                vscode.window.showInformationMessage(`✅ Rolled back: ${path}`);
                await this.getFile(path);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Rollback failed: ${error.message}`);
        }
    }

    private async listBackups(path: string) {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/file/backups?path=${encodeURIComponent(path)}`, {
                headers: { 'x-api-key': apiKey || '' }
            });

            if (response.ok) {
                const data: any = await response.json();
                this.sendMessage({
                    type: 'backupsListed',
                    data: { path, backups: data.backups }
                });
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to list backups: ${error.message}`);
        }
    }

    private sendMessage(message: any) {
        if (this.view) {
            this.view.webview.postMessage(message);
        }
    }

    private getHtmlContent(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dashboard.css')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>File Sync</title>
    <link href="${styleUri}" rel="stylesheet">
    <style>
        .file-input {
            width: 100%;
            padding: 8px;
            margin-bottom: 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
        }
        .editor {
            width: 100%;
            min-height: 300px;
            padding: 10px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }
        .backups-list {
            max-height: 150px;
            overflow-y: auto;
            margin-top: 10px;
        }
        .backup-item {
            padding: 6px;
            cursor: pointer;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .backup-item:hover {
            background: rgba(255,255,255,0.05);
        }
    </style>
</head>
<body>
    <div id="app">
        <h3>File Sync & Hot Reload</h3>
        
        <div class="panel">
            <input type="text" 
                   class="file-input" 
                   id="filePath" 
                   placeholder="Enter file path (e.g., src/config.ts)"
                   onkeypress="if(event.key==='Enter') loadFile()" />
            
            <div class="button-group">
                <button class="btn btn-primary" onclick="loadFile()">📂 Load</button>
                <button class="btn btn-primary" onclick="saveFile()">💾 Save</button>
                <button class="btn" onclick="listBackups()">📋 Backups</button>
            </div>
        </div>

        <div class="panel" style="margin-top: 15px;">
            <textarea id="editor" class="editor" placeholder="File content will appear here..."></textarea>
        </div>

        <div id="backups" class="panel" style="margin-top: 15px; display: none;">
            <h4>Backups</h4>
            <div id="backupsList" class="backups-list"></div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentPath = '';

        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'fileLoaded':
                    currentPath = message.data.path;
                    document.getElementById('filePath').value = currentPath;
                    document.getElementById('editor').value = message.data.content;
                    break;
                case 'backupsListed':
                    showBackups(message.data.backups);
                    break;
                case 'hotReloaded':
                    showNotification('🔥 Hot reloaded!');
                    break;
            }
        });

        function loadFile() {
            const path = document.getElementById('filePath').value;
            if (path) {
                vscode.postMessage({ command: 'getFile', path });
            }
        }

        function saveFile() {
            const path = document.getElementById('filePath').value;
            const content = document.getElementById('editor').value;
            
            if (path && content) {
                vscode.postMessage({ command: 'saveFile', path, content });
            }
        }

        function listBackups() {
            const path = document.getElementById('filePath').value;
            if (path) {
                vscode.postMessage({ command: 'listBackups', path });
            }
        }

        function showBackups(backups) {
            const container = document.getElementById('backupsList');
            const panel = document.getElementById('backups');
            
            container.innerHTML = '';
            
            backups.forEach((backup, index) => {
                const item = document.createElement('div');
                item.className = 'backup-item';
                const date = new Date(backup.timestamp).toLocaleString();
                item.textContent = \`Version \${index}: \${date}\`;
                item.onclick = () => rollback(index);
                container.appendChild(item);
            });
            
            panel.style.display = 'block';
        }

        function rollback(version) {
            const path = document.getElementById('filePath').value;
            vscode.postMessage({ command: 'rollback', path, version });
        }

        function showNotification(message) {
            // Could add a toast notification here
            console.log(message);
        }
    </script>
</body>
</html>`;
    }
}
