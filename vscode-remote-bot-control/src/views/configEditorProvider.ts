// src/views/configEditorProvider.ts

/**
 * Config Editor Webview Provider
 * Edit bot configuration remotely
 */

import * as vscode from 'vscode';
import { BridgeClientManager } from '../bridgeClientManager';

export class ConfigEditorProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private currentConfig: any = {};

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

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'loadConfig':
                    await this.loadConfig();
                    break;
                case 'saveConfig':
                    await this.saveConfig(message.config);
                    break;
                case 'resetConfig':
                    await this.resetConfig();
                    break;
            }
        });

        // Load config on connect
        this.bridgeClient.on('connected', () => {
            this.loadConfig();
        });
    }

    private async loadConfig() {
        try {
            // Get current config from bot
            const response = await fetch('http://localhost:3001/api/config', {
                headers: {
                    'x-api-key': vscode.workspace.getConfiguration('remoteBotControl').get('apiKey') || ''
                }
            });

            if (response.ok) {
                this.currentConfig = await response.json();
                this.sendMessage({
                    type: 'configLoaded',
                    data: this.currentConfig
                });
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load config: ${error.message}`);
        }
    }

    private async saveConfig(config: any) {
        try {
            const result = await this.bridgeClient.updateConfig(config);

            if (result.success) {
                vscode.window.showInformationMessage('✅ Configuration updated');
                this.currentConfig = config;
            } else {
                vscode.window.showErrorMessage('❌ Failed to update configuration');
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Save failed: ${error.message}`);
        }
    }

    private async resetConfig() {
        const confirm = await vscode.window.showWarningMessage(
            'Reset configuration to defaults?',
            'Yes', 'No'
        );

        if (confirm === 'Yes') {
            await this.loadConfig();
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Config Editor</title>
    <link href="${styleUri}" rel="stylesheet">
    <style>
        .config-section {
            margin-bottom: 20px;
            padding: 15px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
        }
        .config-section h4 {
            margin: 0 0 10px 0;
            color: var(--vscode-foreground);
        }
        .config-field {
            margin-bottom: 12px;
        }
        .config-field label {
            display: block;
            margin-bottom: 4px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .config-field input, .config-field select {
            width: 100%;
            padding: 6px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-family: var(--vscode-font-family);
        }
        .config-field input:focus, .config-field select:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .button-group {
            display: flex;
            gap: 8px;
            margin-top: 15px;
        }
    </style>
</head>
<body>
    <div id="app">
        <h3>Bot Configuration</h3>
        
        <div class="config-section">
            <h4>Sniper Mode</h4>
            <div class="config-field">
                <label>Mode</label>
                <select id="sniperMode">
                    <option value="CONSERVATIVE">Conservative</option>
                    <option value="NORMAL">Normal</option>
                </select>
            </div>
            <div class="config-field">
                <label>Max Buy Amount (SOL)</label>
                <input type="number" id="maxBuyAmount" step="0.01" />
            </div>
            <div class="config-field">
                <label>Min Liquidity (SOL)</label>
                <input type="number" id="minLiquidity" step="1" />
            </div>
        </div>

        <div class="config-section">
            <h4>Exit Strategy</h4>
            <div class="config-field">
                <label>Strategy</label>
                <select id="exitStrategy">
                    <option value="TAKE_PROFIT">Take Profit</option>
                    <option value="STOP_LOSS">Stop Loss</option>
                    <option value="TRAILING_STOP">Trailing Stop</option>
                    <option value="HYBRID">Hybrid</option>
                </select>
            </div>
            <div class="config-field">
                <label>Take Profit (%)</label>
                <input type="number" id="takeProfitPercent" step="1" />
            </div>
            <div class="config-field">
                <label>Stop Loss (%)</label>
                <input type="number" id="stopLossPercent" step="1" />
            </div>
        </div>

        <div class="config-section">
            <h4>Advanced</h4>
            <div class="config-field">
                <label>AI Confidence Threshold</label>
                <input type="number" id="aiConfidence" min="0" max="100" step="1" />
            </div>
            <div class="config-field">
                <label>Enable Rug Pull Protection</label>
                <select id="rugProtection">
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                </select>
            </div>
        </div>

        <div class="button-group">
            <button class="btn btn-primary" onclick="saveConfig()">💾 Save</button>
            <button class="btn" onclick="loadConfig()">🔄 Reload</button>
            <button class="btn btn-warning" onclick="resetConfig()">↩️ Reset</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'configLoaded') {
                populateConfig(message.data);
            }
        });

        function populateConfig(config) {
            document.getElementById('sniperMode').value = config.SNIPER_MODE || 'NORMAL';
            document.getElementById('maxBuyAmount').value = config.MAX_BUY_AMOUNT || 0.1;
            document.getElementById('minLiquidity').value = config.MIN_LIQUIDITY || 10;
            document.getElementById('exitStrategy').value = config.EXIT_STRATEGY || 'HYBRID';
            document.getElementById('takeProfitPercent').value = config.TAKE_PROFIT_PERCENT || 50;
            document.getElementById('stopLossPercent').value = config.STOP_LOSS_PERCENT || 30;
            document.getElementById('aiConfidence').value = config.AI_CONFIDENCE_THRESHOLD || 70;
            document.getElementById('rugProtection').value = String(config.ENABLE_RUG_PULL_PROTECTION !== false);
        }

        function getConfig() {
            return {
                SNIPER_MODE: document.getElementById('sniperMode').value,
                MAX_BUY_AMOUNT: parseFloat(document.getElementById('maxBuyAmount').value),
                MIN_LIQUIDITY: parseFloat(document.getElementById('minLiquidity').value),
                EXIT_STRATEGY: document.getElementById('exitStrategy').value,
                TAKE_PROFIT_PERCENT: parseInt(document.getElementById('takeProfitPercent').value),
                STOP_LOSS_PERCENT: parseInt(document.getElementById('stopLossPercent').value),
                AI_CONFIDENCE_THRESHOLD: parseInt(document.getElementById('aiConfidence').value),
                ENABLE_RUG_PULL_PROTECTION: document.getElementById('rugProtection').value === 'true'
            };
        }

        function saveConfig() {
            vscode.postMessage({
                command: 'saveConfig',
                config: getConfig()
            });
        }

        function loadConfig() {
            vscode.postMessage({ command: 'loadConfig' });
        }

        function resetConfig() {
            vscode.postMessage({ command: 'resetConfig' });
        }

        // Load config on startup
        loadConfig();
    </script>
</body>
</html>`;
    }
}
