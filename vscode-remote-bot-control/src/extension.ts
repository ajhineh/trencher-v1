// src/extension.ts

/**
 * VS Code Extension Entry Point
 * Remote Bot Control Extension
 */

import * as vscode from 'vscode';
import { BridgeClientManager } from './bridgeClientManager';
import { DashboardProvider } from './views/dashboardProvider';
import { LogsProvider } from './views/logsProvider';

let bridgeClient: BridgeClientManager;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Remote Bot Control extension is now active!');

    // Initialize bridge client
    bridgeClient = new BridgeClientManager();

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(circle-slash) Bot Disconnected';
    statusBarItem.command = 'remoteBotControl.connect';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Update status bar on connection changes
    bridgeClient.on('connected', () => {
        statusBarItem.text = '$(check) Bot Connected';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        vscode.window.showInformationMessage('✅ Connected to bot');
    });

    bridgeClient.on('disconnected', () => {
        statusBarItem.text = '$(circle-slash) Bot Disconnected';
        statusBarItem.backgroundColor = undefined;
    });

    bridgeClient.on('error', (error) => {
        vscode.window.showErrorMessage(`Bot connection error: ${error.message}`);
    });

    // Register dashboard provider
    const dashboardProvider = new DashboardProvider(context, bridgeClient);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'remoteBotControl.dashboard',
            dashboardProvider
        )
    );

    // Register logs provider
    const logsProvider = new LogsProvider(bridgeClient);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
            'remoteBotControl.logs',
            logsProvider
        )
    );

    // Register config editor provider
    const { ConfigEditorProvider } = require('./views/configEditorProvider');
    const configEditorProvider = new ConfigEditorProvider(context, bridgeClient);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'remoteBotControl.configEditor',
            configEditorProvider
        )
    );

    // Register file sync provider
    const { FileSyncProvider } = require('./views/fileSyncProvider');
    const fileSyncProvider = new FileSyncProvider(context, bridgeClient);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'remoteBotControl.fileSync',
            fileSyncProvider
        )
    );

    // Register Git operations provider
    const { GitOperationsProvider } = require('./views/gitOperationsProvider');
    const gitOpsProvider = new GitOperationsProvider(context, bridgeClient);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'remoteBotControl.gitOps',
            gitOpsProvider
        )
    );

    // Register debug panel provider
    const { DebugPanelProvider } = require('./views/debugPanelProvider');
    const debugPanelProvider = new DebugPanelProvider(context, bridgeClient);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'remoteBotControl.debugPanel',
            debugPanelProvider
        )
    );

    // Register commands
    registerCommands(context);

    // Auto-connect if enabled
    const config = vscode.workspace.getConfiguration('remoteBotControl');
    if (config.get<boolean>('autoConnect')) {
        vscode.commands.executeCommand('remoteBotControl.connect');
    }
}

function registerCommands(context: vscode.ExtensionContext) {
    // Connect command
    context.subscriptions.push(
        vscode.commands.registerCommand('remoteBotControl.connect', async () => {
            const config = vscode.workspace.getConfiguration('remoteBotControl');
            let url = config.get<string>('serverUrl');
            let apiKey = config.get<string>('apiKey');

            // Prompt for URL if not set
            if (!url) {
                url = await vscode.window.showInputBox({
                    prompt: 'Enter bridge server URL',
                    placeHolder: 'ws://your-vps-ip:3001',
                    value: 'ws://localhost:3001'
                });
                if (!url) { return; }
                await config.update('serverUrl', url, vscode.ConfigurationTarget.Global);
            }

            // Prompt for API key if not set
            if (!apiKey) {
                apiKey = await vscode.window.showInputBox({
                    prompt: 'Enter API key',
                    password: true
                });
                if (!apiKey) { return; }
                await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
            }

            try {
                await bridgeClient.connect(
                    url,
                    apiKey,
                    true,
                    config.get<number>('reconnectInterval') || 5000
                );
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to connect: ${error.message}`);
            }
        })
    );

    // Disconnect command
    context.subscriptions.push(
        vscode.commands.registerCommand('remoteBotControl.disconnect', () => {
            bridgeClient.disconnect();
            vscode.window.showInformationMessage('Disconnected from bot');
        })
    );

    // Restart command
    context.subscriptions.push(
        vscode.commands.registerCommand('remoteBotControl.restart', async () => {
            if (!bridgeClient.isConnected()) {
                vscode.window.showWarningMessage('Not connected to bot');
                return;
            }

            try {
                const result = await bridgeClient.restart();
                vscode.window.showInformationMessage(
                    result.success ? '✅ Bot restarted' : '❌ Restart failed'
                );
            } catch (error: any) {
                vscode.window.showErrorMessage(`Restart failed: ${error.message}`);
            }
        })
    );

    // Stop command
    context.subscriptions.push(
        vscode.commands.registerCommand('remoteBotControl.stop', async () => {
            if (!bridgeClient.isConnected()) {
                vscode.window.showWarningMessage('Not connected to bot');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                'Stop the bot?',
                'Yes', 'No'
            );

            if (confirm === 'Yes') {
                try {
                    const result = await bridgeClient.stop();
                    vscode.window.showInformationMessage(
                        result.success ? '✅ Bot stopped' : '❌ Stop failed'
                    );
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Stop failed: ${error.message}`);
                }
            }
        })
    );

    // Emergency exit command
    context.subscriptions.push(
        vscode.commands.registerCommand('remoteBotControl.emergency', async () => {
            if (!bridgeClient.isConnected()) {
                vscode.window.showWarningMessage('Not connected to bot');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                '🚨 Emergency exit will close all positions immediately. Continue?',
                { modal: true },
                'Yes', 'No'
            );

            if (confirm === 'Yes') {
                try {
                    const result = await bridgeClient.emergencyExit();
                    vscode.window.showInformationMessage(
                        result.success ? '✅ Emergency exit executed' : '❌ Emergency exit failed'
                    );
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Emergency exit failed: ${error.message}`);
                }
            }
        })
    );

    // Refresh logs command
    context.subscriptions.push(
        vscode.commands.registerCommand('remoteBotControl.refreshLogs', () => {
            vscode.commands.executeCommand('remoteBotControl.logs.refresh');
        })
    );

    // Clear logs command
    context.subscriptions.push(
        vscode.commands.registerCommand('remoteBotControl.clearLogs', () => {
            vscode.commands.executeCommand('remoteBotControl.logs.clear');
        })
    );
}

export function deactivate() {
    if (bridgeClient) {
        bridgeClient.disconnect();
    }
}
