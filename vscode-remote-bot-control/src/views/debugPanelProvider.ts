// src/views/debugPanelProvider.ts

/**
 * Debug Panel Webview Provider
 * Remote debugging and performance monitoring
 */

import * as vscode from 'vscode';
import { BridgeClientManager } from '../bridgeClientManager';

export class DebugPanelProvider implements vscode.WebviewViewProvider {
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
                case 'takeSnapshot':
                    await this.takeSnapshot();
                    break;
                case 'getSnapshots':
                    await this.getSnapshots();
                    break;
                case 'getPerformance':
                    await this.getPerformance();
                    break;
                case 'getRecommendations':
                    await this.getRecommendations();
                    break;
            }
        });
    }

    private async takeSnapshot() {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/debug/snapshot`, {
                method: 'POST',
                headers: { 'x-api-key': apiKey || '' }
            });

            if (response.ok) {
                vscode.window.showInformationMessage('✅ Snapshot taken');
                await this.getSnapshots();
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Snapshot failed: ${error.message}`);
        }
    }

    private async getSnapshots() {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/debug/snapshots?count=10`, {
                headers: { 'x-api-key': apiKey || '' }
            });

            if (response.ok) {
                const data: any = await response.json();
                this.sendMessage({ type: 'snapshotsLoaded', data: data.snapshots });
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load snapshots: ${error.message}`);
        }
    }

    private async getPerformance() {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/profile/report`, {
                headers: { 'x-api-key': apiKey || '' }
            });

            if (response.ok) {
                const data: any = await response.json();
                this.sendMessage({ type: 'performanceLoaded', data: data.reports });
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load performance: ${error.message}`);
        }
    }

    private async getRecommendations() {
        try {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            const serverUrl = config.get<string>('serverUrl')?.replace('ws://', 'http://').replace('wss://', 'https://');
            const apiKey = config.get<string>('apiKey');

            const response = await fetch(`${serverUrl}/api/profile/recommendations`, {
                headers: { 'x-api-key': apiKey || '' }
            });

            if (response.ok) {
                const data: any = await response.json();
                this.sendMessage({ type: 'recommendationsLoaded', data: data.recommendations });
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load recommendations: ${error.message}`);
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
    <title>Debug & Performance</title>
    <link href="${styleUri}" rel="stylesheet">
    <style>
        .snapshot-item {
            padding: 8px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            margin-bottom: 8px;
            cursor: pointer;
        }
        .snapshot-item:hover {
            background: rgba(255,255,255,0.05);
        }
        .perf-metric {
            display: flex;
            justify-content: space-between;
            padding: 6px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .recommendation {
            padding: 8px;
            margin-bottom: 8px;
            background: rgba(255, 193, 7, 0.1);
            border-left: 3px solid #ffc107;
            border-radius: 3px;
        }
    </style>
</head>
<body>
    <div id="app">
        <h3>Debug & Performance</h3>
        
        <div class="panel">
            <h4>Snapshots</h4>
            <button class="btn btn-primary" onclick="takeSnapshot()">📸 Take Snapshot</button>
            <div id="snapshots" style="margin-top: 10px;"></div>
        </div>

        <div class="panel" style="margin-top: 15px;">
            <h4>Performance Metrics</h4>
            <button class="btn" onclick="loadPerformance()">📊 Load Metrics</button>
            <div id="performance" style="margin-top: 10px;"></div>
        </div>

        <div class="panel" style="margin-top: 15px;">
            <h4>Optimization Recommendations</h4>
            <button class="btn" onclick="loadRecommendations()">💡 Get Recommendations</button>
            <div id="recommendations" style="margin-top: 10px;"></div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'snapshotsLoaded':
                    showSnapshots(message.data);
                    break;
                case 'performanceLoaded':
                    showPerformance(message.data);
                    break;
                case 'recommendationsLoaded':
                    showRecommendations(message.data);
                    break;
            }
        });

        function showSnapshots(snapshots) {
            const container = document.getElementById('snapshots');
            
            if (snapshots && snapshots.length > 0) {
                container.innerHTML = snapshots.map(snapshot => {
                    const time = new Date(snapshot.timestamp).toLocaleTimeString();
                    const memMB = (snapshot.memory.heapUsed / 1024 / 1024).toFixed(1);
                    
                    return \`
                        <div class="snapshot-item">
                            <div><strong>\${time}</strong></div>
                            <div>Memory: \${memMB} MB</div>
                            <div>Variables: \${Object.keys(snapshot.variables || {}).length}</div>
                        </div>
                    \`;
                }).join('');
            } else {
                container.innerHTML = '<div>No snapshots</div>';
            }
        }

        function showPerformance(reports) {
            const container = document.getElementById('performance');
            
            if (reports && Object.keys(reports).length > 0) {
                container.innerHTML = Object.entries(reports).map(([name, report]) => \`
                    <div class="perf-metric">
                        <span>\${name}</span>
                        <span>\${report.averageDuration.toFixed(0)}ms avg</span>
                    </div>
                \`).join('');
            } else {
                container.innerHTML = '<div>No metrics</div>';
            }
        }

        function showRecommendations(recommendations) {
            const container = document.getElementById('recommendations');
            
            if (recommendations && recommendations.length > 0) {
                container.innerHTML = recommendations.map(rec => \`
                    <div class="recommendation">\${rec}</div>
                \`).join('');
            } else {
                container.innerHTML = '<div>No recommendations</div>';
            }
        }

        function takeSnapshot() {
            vscode.postMessage({ command: 'takeSnapshot' });
        }

        function loadPerformance() {
            vscode.postMessage({ command: 'getPerformance' });
        }

        function loadRecommendations() {
            vscode.postMessage({ command: 'getRecommendations' });
        }

        // Load snapshots on startup
        vscode.postMessage({ command: 'getSnapshots' });
    </script>
</body>
</html>`;
    }
}
