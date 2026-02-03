/**
 * @module ScriptConsoleWebview
 * @description Interactive Script Console for executing Python scripts in connected Ignition Designer
 * Provides a REPL-like interface with scope selection and session persistence
 */

import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ConnectionState, DesignerBridgeService } from '@/services/designer';

/**
 * Execution scope for scripts
 */
export enum ExecutionScope {
    DESIGNER = 'designer',
    GATEWAY = 'gateway',
    PERSPECTIVE = 'perspective'
}

/**
 * Messages from extension to webview
 */
type ExtensionToWebviewMessage =
    | { command: 'updateConnectionStatus'; connected: boolean; projectName: string | null; gatewayHost: string | null }
    | {
          command: 'executionResult';
          success: boolean;
          stdout: string;
          stderr: string;
          error?: string;
          executionTimeMs: number;
      }
    | { command: 'executionStarted' }
    | { command: 'setTheme'; theme: 'vs-dark' | 'vs' | 'hc-black' }
    | { command: 'sessionReset' };

/**
 * Messages from webview to extension
 */
type WebviewToExtensionMessage =
    | { command: 'ready' }
    | { command: 'executeCode'; code: string; scope: ExecutionScope }
    | { command: 'resetSession' }
    | { command: 'clearOutput' }
    | { command: 'connect' };

/**
 * Output entry for the console history
 */
interface OutputEntry {
    readonly type: 'input' | 'output' | 'error' | 'info';
    readonly content: string;
    readonly timestamp: Date;
}

/**
 * Interactive Script Console webview for executing Python scripts in Designer
 */
export class ScriptConsoleWebview implements IServiceLifecycle {
    private static readonly viewType = 'flint.scriptConsole';
    private panel: vscode.WebviewPanel | null = null;
    private isInitialized = false;
    private sessionId: string;
    private outputHistory: OutputEntry[] = [];
    private bridgeService: DesignerBridgeService | null = null;
    private connectionStateDisposable: vscode.Disposable | null = null;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {
        // Generate a unique session ID for this console instance
        this.sessionId = this.generateSessionId();
    }

    // ============================================================================
    // SERVICE LIFECYCLE
    // ============================================================================

    async initialize(): Promise<void> {
        await Promise.resolve();
        this.isInitialized = true;
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async stop(): Promise<void> {
        await Promise.resolve();
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
        if (this.connectionStateDisposable) {
            this.connectionStateDisposable.dispose();
            this.connectionStateDisposable = null;
        }
    }

    async dispose(): Promise<void> {
        await this.stop();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    // ============================================================================
    // PUBLIC API
    // ============================================================================

    /**
     * Opens the Script Console panel
     */
    async openConsole(): Promise<void> {
        await Promise.resolve();

        // Get the bridge service
        this.bridgeService = this.serviceContainer.get<DesignerBridgeService>('DesignerBridgeService');
        if (!this.bridgeService) {
            throw new FlintError(
                'Designer Bridge Service not available',
                'SERVICE_NOT_FOUND',
                'The Designer Bridge Service is required for the Script Console'
            );
        }

        // If panel already exists, bring to front
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        // Create new webview panel
        this.panel = vscode.window.createWebviewPanel(
            ScriptConsoleWebview.viewType,
            'Ignition Script Console',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))]
            }
        );

        // Generate HTML content
        this.panel.webview.html = this.generateWebviewHtml(this.panel.webview);

        // Setup message handling
        this.panel.webview.onDidReceiveMessage(
            (message: WebviewToExtensionMessage) => this.handleWebviewMessage(message),
            undefined,
            this.context.subscriptions
        );

        // Handle panel disposal
        this.panel.onDidDispose(() => {
            this.panel = null;
            if (this.connectionStateDisposable) {
                this.connectionStateDisposable.dispose();
                this.connectionStateDisposable = null;
            }
        });

        // Listen for connection state changes
        this.bridgeService.onConnectionStateChanged((state, designer) => {
            void this.updateConnectionStatus(state, designer);
        });
    }

    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================

    /**
     * Generates a unique session ID
     */
    private generateSessionId(): string {
        return `flint-console-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Updates the connection status in the webview
     */
    private async updateConnectionStatus(
        state: ConnectionState,
        designer: { project: { name: string }; gateway: { host: string } } | null
    ): Promise<void> {
        if (!this.panel) {
            return;
        }

        const connected = state === ConnectionState.CONNECTED;
        const message: ExtensionToWebviewMessage = {
            command: 'updateConnectionStatus',
            connected,
            projectName: designer?.project.name ?? null,
            gatewayHost: designer?.gateway.host ?? null
        };

        await this.panel.webview.postMessage(message);
    }

    /**
     * Handles messages from the webview
     */
    private async handleWebviewMessage(message: WebviewToExtensionMessage): Promise<void> {
        switch (message.command) {
            case 'ready':
                await this.handleReady();
                break;

            case 'executeCode':
                await this.handleExecuteCode(message.code, message.scope);
                break;

            case 'resetSession':
                await this.handleResetSession();
                break;

            case 'clearOutput':
                this.outputHistory = [];
                break;

            case 'connect':
                await this.handleConnect();
                break;

            default:
                console.warn('Unknown webview message:', message);
        }
    }

    /**
     * Handles the ready message from the webview
     */
    private async handleReady(): Promise<void> {
        if (!this.panel || !this.bridgeService) {
            return;
        }

        // Send current theme
        const theme = this.getVSCodeTheme();
        await this.panel.webview.postMessage({ command: 'setTheme', theme });

        // Send current connection status
        const state = this.bridgeService.getConnectionState();
        const designer = this.bridgeService.getConnectedDesigner();
        await this.updateConnectionStatus(state, designer);
    }

    /**
     * Handles code execution request
     */
    private async handleExecuteCode(code: string, _scope: ExecutionScope): Promise<void> {
        if (!this.panel || !this.bridgeService) {
            return;
        }

        // Add input to history
        this.outputHistory.push({
            type: 'input',
            content: code,
            timestamp: new Date()
        });

        // Notify webview that execution started
        await this.panel.webview.postMessage({ command: 'executionStarted' });

        // Check connection
        if (this.bridgeService.getConnectionState() !== ConnectionState.CONNECTED) {
            const errorMessage: ExtensionToWebviewMessage = {
                command: 'executionResult',
                success: false,
                stdout: '',
                stderr: '',
                error: 'Not connected to Designer. Click "Connect" to connect to a running Designer.',
                executionTimeMs: 0
            };
            await this.panel.webview.postMessage(errorMessage);
            return;
        }

        try {
            // Execute the script
            // TODO: In Phase 2, pass sessionId to enable variable persistence
            const result = await this.bridgeService.executeScript({ code });

            // Add output to history
            if (result.stdout) {
                this.outputHistory.push({
                    type: 'output',
                    content: result.stdout,
                    timestamp: new Date()
                });
            }

            if (result.stderr) {
                this.outputHistory.push({
                    type: 'error',
                    content: result.stderr,
                    timestamp: new Date()
                });
            }

            if (result.error) {
                this.outputHistory.push({
                    type: 'error',
                    content: result.error,
                    timestamp: new Date()
                });
            }

            // Send result to webview
            const message: ExtensionToWebviewMessage = {
                command: 'executionResult',
                success: result.success,
                stdout: result.stdout,
                stderr: result.stderr,
                error: result.error,
                executionTimeMs: result.executionTimeMs
            };
            await this.panel.webview.postMessage(message);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputHistory.push({
                type: 'error',
                content: errorMessage,
                timestamp: new Date()
            });

            const message: ExtensionToWebviewMessage = {
                command: 'executionResult',
                success: false,
                stdout: '',
                stderr: '',
                error: errorMessage,
                executionTimeMs: 0
            };
            await this.panel.webview.postMessage(message);
        }
    }

    /**
     * Handles session reset request
     */
    private async handleResetSession(): Promise<void> {
        // Generate new session ID
        this.sessionId = this.generateSessionId();
        this.outputHistory = [];

        if (this.panel) {
            await this.panel.webview.postMessage({ command: 'sessionReset' });
        }

        // TODO: In Phase 2, send resetSession RPC call to Designer
    }

    /**
     * Handles connect request
     */
    private async handleConnect(): Promise<void> {
        if (!this.bridgeService) {
            return;
        }

        await this.bridgeService.selectAndConnect();
    }

    /**
     * Determines the current VS Code theme type
     */
    private getVSCodeTheme(): 'vs-dark' | 'vs' | 'hc-black' {
        const colorTheme = vscode.window.activeColorTheme;
        switch (colorTheme.kind) {
            case vscode.ColorThemeKind.Dark:
                return 'vs-dark';
            case vscode.ColorThemeKind.HighContrast:
            case vscode.ColorThemeKind.HighContrastLight:
                return 'hc-black';
            default:
                return 'vs';
        }
    }

    /**
     * Generates the HTML content for the webview
     */
    private generateWebviewHtml(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'script-console.css'))
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'script-console.js'))
        );

        const nonce = this.getNonce();

        // Monaco CDN URL - using a specific version for stability
        const monacoBase = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;
                   style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net;
                   font-src ${webview.cspSource} https://cdn.jsdelivr.net;
                   connect-src https://cdn.jsdelivr.net;">
    <link href="${styleUri.toString()}" rel="stylesheet">
    <title>Ignition Script Console</title>
</head>
<body>
    <div class="console-container">
        <!-- Header -->
        <div class="console-header">
            <div class="header-left">
                <h1>Script Console</h1>
                <div class="scope-selector">
                    <label for="scopeSelect">Scope:</label>
                    <select id="scopeSelect">
                        <option value="designer" selected>Designer</option>
                        <option value="gateway" disabled>Gateway (coming soon)</option>
                        <option value="perspective" disabled>Perspective (coming soon)</option>
                    </select>
                </div>
            </div>
            <div class="header-right">
                <div id="connectionStatus" class="connection-status disconnected">
                    <span class="status-indicator"></span>
                    <span class="status-text">Disconnected</span>
                </div>
                <button id="connectBtn" class="btn btn-secondary btn-sm">Connect</button>
            </div>
        </div>

        <!-- Output Area -->
        <div class="output-area" id="outputArea">
            <div class="output-placeholder">
                <p>Welcome to the Ignition Script Console</p>
                <p class="hint">Execute Python scripts in your connected Designer. Variables persist between executions.</p>
            </div>
        </div>

        <!-- Input Area -->
        <div class="input-area">
            <div class="input-header">
                <span class="prompt">&gt;&gt;&gt;</span>
                <span class="input-hint">Python</span>
            </div>
            <div id="inputEditor" class="input-editor"></div>
        </div>

        <!-- Footer with action buttons -->
        <div class="console-footer">
            <div class="footer-left">
                <button id="clearOutputBtn" class="btn btn-secondary btn-sm" title="Clear Output">
                    Clear Output
                </button>
                <button id="resetSessionBtn" class="btn btn-secondary btn-sm" title="Reset Session (clear variables)">
                    Reset Session
                </button>
            </div>
            <div class="footer-right">
                <span id="executionStatus" class="execution-status"></span>
                <button id="executeBtn" class="btn btn-primary" title="Execute (Ctrl+Enter)">
                    Execute
                </button>
            </div>
        </div>
    </div>

    <!-- Loading overlay -->
    <div id="loadingOverlay" class="loading-overlay">
        <div class="loading-spinner"></div>
        <span>Loading Monaco Editor...</span>
    </div>

    <!-- Monaco loader -->
    <script nonce="${nonce}" src="${monacoBase}/vs/loader.js"></script>
    <script nonce="${nonce}">
        // Configure Monaco AMD loader
        require.config({
            paths: { 'vs': '${monacoBase}/vs' }
        });

        // Store the nonce and script URI for the main script
        window.flintNonce = '${nonce}';
        window.flintScriptUri = '${scriptUri.toString()}';
    </script>
    <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
    }

    /**
     * Generates a random nonce for CSP
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
