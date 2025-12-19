// src/views/gitOperationsProvider.ts

/**
 * Git Operations Webview Provider
 * Manage Git operations remotely
 */

import * as vscode from 'vscode';
import { BridgeClientManager } from '../bridgeClientManager';

export class GitOperationsProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;

    constructor(
        private context: vscode.ExtensionContext,
        private bridgeClient: BridgeClientManager
    ) { }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'pull':
                    await this.gitPull();
                    break;
                case 'commit':
                    await this.gitCommit(message.message);
                    break;
                case 'push':
                    await this.gitPush();
                    break;
                case 'status':
                    await this.gitStatus();
                    break;
                case 'log':
                    await this.gitLog();
                    break;
            }
        });
    }

    private async gitPull() {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/git/pull`, {
                method: 'POST',
                headers: { 'x-api-key': apiKey || '' }
            });

            if (response.ok) {
                const data: any = await response.json();
                vscode.window.showInformationMessage(`✅ Pulled ${data.changes?.length || 0} changes`);
                this.sendMessage({ type: 'pullComplete', data });
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Git pull failed: ${error.message}`);
        }
    }

    private async gitCommit(message: string) {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/git/commit`, {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey || '',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message })
            });

            if (response.ok) {
                vscode.window.showInformationMessage('✅ Changes committed');
                await this.gitStatus();
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Git commit failed: ${error.message}`);
        }
    }

    private async gitPush() {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/git/push`, {
                method: 'POST',
                headers: { 'x-api-key': apiKey || '' }
            });

            if (response.ok) {
                vscode.window.showInformationMessage('✅ Changes pushed');
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Git push failed: ${error.message}`);
        }
    }

    private async gitStatus() {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/git/status`, {
                headers: { 'x-api-key': apiKey || '' }
            });

            if (response.ok) {
                const data: any = await response.json();
                this.sendMessage({ type: 'statusLoaded', data: data.status });
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Git status failed: ${error.message}`);
        }
    }

    private async gitLog() {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/git/log?count=10`, {
                headers: { 'x-api-key': apiKey || '' }
            });

            if (response.ok) {
                const data: any = await response.json();
                this.sendMessage({ type: 'logLoaded', data: data.log });
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Git log failed: ${error.message}`);
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
    <title>Git Operations</title>
    <link href="${styleUri}" rel="stylesheet">
    <style>
        .git-status {
            padding: 10px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            margin-bottom: 10px;
            font-family: monospace;
            font-size: 12px;
        }
        .commit-input {
            width: 100%;
            padding: 8px;
            margin-bottom: 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
        }
        .log-entry {
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .log-hash {
            color: var(--vscode-gitDecoration-modifiedResourceForeground);
            font-family: monospace;
        }
    </style>
</head>
<body>
    <div id="app">
        <h3>Git Operations</h3>
        
        <div class="panel">
            <h4>Status</h4>
            <div id="status" class="git-status">Loading...</div>
            <button class="btn" onclick="refreshStatus()">🔄 Refresh</button>
        </div>

        <div class="panel" style="margin-top: 15px;">
            <h4>Commit</h4>
            <input type="text" 
                   id="commitMessage" 
                   class="commit-input" 
                   placeholder="Commit message..."
                   onkeypress="if(event.key==='Enter') commit()" />
            <button class="btn btn-primary" onclick="commit()">💾 Commit</button>
        </div>

        <div class="panel" style="margin-top: 15px;">
            <h4>Sync</h4>
            <div class="button-group">
                <button class="btn btn-primary" onclick="pull()">📥 Pull</button>
                <button class="btn btn-primary" onclick="push()">📤 Push</button>
            </div>
        </div>

        <div class="panel" style="margin-top: 15px;">
            <h4>Recent Commits</h4>
            <div id="log"></div>
            <button class="btn" onclick="loadLog()">📜 Load Log</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'statusLoaded':
                    showStatus(message.data);
                    break;
                case 'logLoaded':
                    showLog(message.data);
                    break;
                case 'pullComplete':
                    refreshStatus();
                    break;
            }
        });

        function showStatus(status) {
            const container = document.getElementById('status');
            
            let html = '';
            if (status.files && status.files.length > 0) {
                html += '<div><strong>Modified files:</strong></div>';
                status.files.forEach(file => {
                    html += \`<div>\${file.path} (\${file.working_dir})</div>\`;
                });
            } else {
                html = '<div>Working tree clean</div>';
            }
            
            container.innerHTML = html;
        }

        function showLog(log) {
            const container = document.getElementById('log');
            
            if (log.all && log.all.length > 0) {
                container.innerHTML = log.all.map(commit => \`
                    <div class="log-entry">
                        <div class="log-hash">\${commit.hash.substring(0, 7)}</div>
                        <div>\${commit.message}</div>
                        <div style="font-size: 11px; color: var(--vscode-descriptionForeground);">
                            \${commit.author_name} - \${new Date(commit.date).toLocaleString()}
                        </div>
                    </div>
                \`).join('');
            } else {
                container.innerHTML = '<div>No commits</div>';
            }
        }

        function pull() {
            vscode.postMessage({ command: 'pull' });
        }

        function commit() {
            const message = document.getElementById('commitMessage').value;
            if (message) {
                vscode.postMessage({ command: 'commit', message });
                document.getElementById('commitMessage').value = '';
            }
        }

        function push() {
            vscode.postMessage({ command: 'push' });
        }

        function refreshStatus() {
            vscode.postMessage({ command: 'status' });
        }

        function loadLog() {
            vscode.postMessage({ command: 'log' });
        }

        // Load status on startup
        refreshStatus();
    </script>
</body>
</html>`;
    }
}
