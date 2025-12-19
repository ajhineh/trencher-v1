// src/views/dashboardProvider.ts

/**
 * Dashboard Webview Provider
 * Displays bot metrics, logs, and controls
 */

import * as vscode from 'vscode';
import { BridgeClientManager } from '../bridgeClientManager';

export class DashboardProvider implements vscode.WebviewViewProvider {
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

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'restart':
                    await this.bridgeClient.restart();
                    break;
                case 'stop':
                    await this.bridgeClient.stop();
                    break;
                case 'emergency':
                    await this.bridgeClient.emergencyExit();
                    break;
                case 'updateConfig':
                    await this.bridgeClient.updateConfig(message.data);
                    break;
            }
        });
    }

    private setupEventHandlers() {
        this.bridgeClient.on('connected', () => {
            this.sendMessage({ type: 'connected' });
        });

        this.bridgeClient.on('disconnected', () => {
            this.sendMessage({ type: 'disconnected' });
        });

        this.bridgeClient.on('metrics', (metrics) => {
            this.sendMessage({ type: 'metrics', data: metrics });
        });

        this.bridgeClient.on('log', (log) => {
            this.sendMessage({ type: 'log', data: log });
        });
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bot Dashboard</title>
    <link href="${styleUri}" rel="stylesheet">
</head>
<body>
    <div id="app">
        <div id="connection-status" class="status disconnected">
            <span class="status-indicator"></span>
            <span class="status-text">Disconnected</span>
        </div>

        <div id="metrics-panel" class="panel" style="display: none;">
            <h3>System Metrics</h3>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-label">CPU</div>
                    <div class="metric-value" id="cpu">-</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Memory</div>
                    <div class="metric-value" id="memory">-</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Uptime</div>
                    <div class="metric-value" id="uptime">-</div>
                </div>
            </div>

            <h3>Bot Metrics</h3>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-label">Active Trades</div>
                    <div class="metric-value" id="activeTrades">-</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Total Trades</div>
                    <div class="metric-value" id="totalTrades">-</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Win Rate</div>
                    <div class="metric-value" id="winRate">-</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">P&L</div>
                    <div class="metric-value" id="profitLoss">-</div>
                </div>
            </div>
        </div>

        <div id="controls-panel" class="panel" style="display: none;">
            <h3>Controls</h3>
            <div class="button-group">
                <button class="btn btn-primary" onclick="sendCommand('restart')">
                    🔄 Restart
                </button>
                <button class="btn btn-warning" onclick="sendCommand('stop')">
                    🛑 Stop
                </button>
                <button class="btn btn-danger" onclick="sendCommand('emergency')">
                    🚨 Emergency Exit
                </button>
            </div>
        </div>

        <div id="logs-panel" class="panel">
            <h3>Recent Logs</h3>
            <div id="logs-container" class="logs-container"></div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const logs = [];
        const maxLogs = 100;

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'connected':
                    updateConnectionStatus(true);
                    break;
                case 'disconnected':
                    updateConnectionStatus(false);
                    break;
                case 'metrics':
                    updateMetrics(message.data);
                    break;
                case 'log':
                    addLog(message.data);
                    break;
            }
        });

        function updateConnectionStatus(connected) {
            const status = document.getElementById('connection-status');
            const text = status.querySelector('.status-text');
            
            if (connected) {
                status.className = 'status connected';
                text.textContent = 'Connected';
                document.getElementById('metrics-panel').style.display = 'block';
                document.getElementById('controls-panel').style.display = 'block';
            } else {
                status.className = 'status disconnected';
                text.textContent = 'Disconnected';
                document.getElementById('metrics-panel').style.display = 'none';
                document.getElementById('controls-panel').style.display = 'none';
            }
        }

        function updateMetrics(metrics) {
            // System metrics
            document.getElementById('cpu').textContent = 
                metrics.system.cpu.toFixed(1) + '%';
            document.getElementById('memory').textContent = 
                metrics.system.memory.percentage.toFixed(1) + '%';
            document.getElementById('uptime').textContent = 
                formatUptime(metrics.system.uptime);

            // Bot metrics
            document.getElementById('activeTrades').textContent = 
                metrics.bot.activeTrades;
            document.getElementById('totalTrades').textContent = 
                metrics.bot.totalTrades;
            document.getElementById('winRate').textContent = 
                metrics.bot.winRate.toFixed(1) + '%';
            
            const pl = metrics.bot.profitLoss;
            const plEl = document.getElementById('profitLoss');
            plEl.textContent = (pl >= 0 ? '+' : '') + pl.toFixed(4) + ' SOL';
            plEl.className = 'metric-value ' + (pl >= 0 ? 'positive' : 'negative');
        }

        function addLog(log) {
            logs.push(log);
            if (logs.length > maxLogs) {
                logs.shift();
            }

            const container = document.getElementById('logs-container');
            const logEl = document.createElement('div');
            logEl.className = 'log-entry log-' + log.level;
            
            const time = new Date(log.timestamp).toLocaleTimeString();
            logEl.innerHTML = 
                '<span class="log-time">' + time + '</span>' +
                '<span class="log-level">' + log.level.toUpperCase() + '</span>' +
                '<span class="log-message">' + escapeHtml(log.message) + '</span>';
            
            container.appendChild(logEl);
            container.scrollTop = container.scrollHeight;

            // Keep only last 100 in DOM
            while (container.children.length > maxLogs) {
                container.removeChild(container.firstChild);
            }
        }

        function sendCommand(command) {
            vscode.postMessage({ command });
        }

        function formatUptime(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return hours + 'h ' + minutes + 'm';
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
    }
}
