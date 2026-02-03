/**
 * @module ConflictMergeWebview
 * @description Custom 3-panel merge editor for resolving encoded script conflicts
 * Provides Monaco-based editors for Current, Incoming, and Result panels
 */

import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ScriptConflict } from '@/core/types/conflict';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ConflictDetectionService } from '@/services/conflict/ConflictDetectionService';
import { encodeScript } from '@/utils/decode';

/**
 * Data sent to the webview when loading a conflict
 */
interface ConflictLoadPayload {
    readonly currentScript: string;
    readonly incomingScript: string;
    readonly currentBranch: string;
    readonly incomingBranch: string;
    readonly conflictId: string;
    readonly jsonKey: string;
    readonly functionDefinition: string;
    readonly filePath: string;
}

/**
 * Messages from extension to webview
 */
type ExtensionToWebviewMessage =
    | { command: 'loadConflict'; payload: ConflictLoadPayload }
    | { command: 'setTheme'; theme: 'vs-dark' | 'vs' | 'hc-black' };

/**
 * Messages from webview to extension
 */
type WebviewToExtensionMessage =
    | { command: 'ready' }
    | { command: 'acceptResult'; conflictId: string; content: string }
    | { command: 'cancel' };

/**
 * State for a pending conflict resolution
 */
interface PendingConflict {
    readonly documentUri: vscode.Uri;
    readonly conflict: ScriptConflict;
    readonly functionDefinition: string;
    readonly hasTrailingComma: boolean;
}

/**
 * Custom merge editor webview for resolving encoded script conflicts
 * Provides 3 Monaco editor panels: Current, Incoming, and Result
 */
export class ConflictMergeWebview implements IServiceLifecycle {
    private static readonly viewType = 'flint.conflictMerge';
    private panel: vscode.WebviewPanel | null = null;
    private isInitialized = false;
    private pendingConflict: PendingConflict | null = null;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {}

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
     * Opens the merge editor for a specific script conflict
     */
    async openConflictMerge(documentUri: vscode.Uri, conflict: ScriptConflict): Promise<void> {
        // Get function definition wrapper for context
        const functionDefinition = this.getFunctionDefinition(conflict.jsonKey);

        // Detect if the script field has a trailing comma
        const hasTrailingComma = this.detectTrailingComma(conflict);

        // Store pending conflict for resolution
        this.pendingConflict = {
            documentUri,
            conflict,
            functionDefinition,
            hasTrailingComma
        };

        // If panel already exists, bring to front and load new conflict
        if (this.panel) {
            this.panel.reveal();
            await this.loadConflictIntoPanel(conflict, functionDefinition);
            return;
        }

        // Create new webview panel
        this.panel = vscode.window.createWebviewPanel(
            ConflictMergeWebview.viewType,
            `Merge: ${conflict.jsonKey}`,
            vscode.ViewColumn.One,
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
            this.pendingConflict = null;
        });

        // Wait for webview to be ready, then load the conflict
        // The 'ready' message handler will call loadConflictIntoPanel
    }

    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================

    /**
     * Get a function definition wrapper based on the JSON key
     */
    private getFunctionDefinition(jsonKey: string): string {
        switch (jsonKey) {
            case 'script':
                return 'def runAction(self, event):\n';
            case 'code':
                return 'def transform(self, value, quality, timestamp):\n';
            default:
                return `def ${jsonKey}(self):\n`;
        }
    }

    /**
     * Detect if the script field has a trailing comma in the original content
     * We check the current content since both sides should have the same structure
     */
    private detectTrailingComma(conflict: ScriptConflict): boolean {
        // Look at the current content to find the script line
        const content = conflict.currentContent;
        const jsonKey = conflict.jsonKey;

        // Find the line with the script field and check if it ends with a comma
        // The pattern matches: "jsonKey": "..." followed by optional comma
        const regex = new RegExp(`"${jsonKey}":\\s*"(?:[^"\\\\]|\\\\.)*"(,?)`, 's');
        const match = content.match(regex);

        return match !== null && match[1] === ',';
    }

    /**
     * Loads a conflict into the webview panel
     */
    private async loadConflictIntoPanel(conflict: ScriptConflict, functionDefinition: string): Promise<void> {
        if (!this.panel || !this.pendingConflict) {
            return;
        }

        // Add function wrapper to scripts for context
        const currentScript = functionDefinition + conflict.currentScript;
        const incomingScript = functionDefinition + conflict.incomingScript;

        // Get relative file path for display
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        let filePath = this.pendingConflict.documentUri.fsPath;
        if (workspaceFolder) {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
            if (!relativePath.startsWith('..')) {
                filePath = relativePath;
            }
        }

        const payload: ConflictLoadPayload = {
            currentScript,
            incomingScript,
            currentBranch: conflict.currentBranch,
            incomingBranch: conflict.incomingBranch,
            conflictId: conflict.id,
            jsonKey: conflict.jsonKey,
            functionDefinition,
            filePath
        };

        const message: ExtensionToWebviewMessage = {
            command: 'loadConflict',
            payload
        };

        await this.panel.webview.postMessage(message);

        // Also send theme
        const theme = this.getVSCodeTheme();
        await this.panel.webview.postMessage({ command: 'setTheme', theme });
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
     * Handles messages from the webview
     */
    private async handleWebviewMessage(message: WebviewToExtensionMessage): Promise<void> {
        switch (message.command) {
            case 'ready':
                // Webview is ready, load the conflict
                if (this.pendingConflict) {
                    await this.loadConflictIntoPanel(
                        this.pendingConflict.conflict,
                        this.pendingConflict.functionDefinition
                    );
                }
                break;

            case 'acceptResult':
                await this.handleAcceptResult(message.conflictId, message.content);
                break;

            case 'cancel':
                this.panel?.dispose();
                break;

            default:
                console.warn('Unknown webview message:', message);
        }
    }

    /**
     * Handles accepting the result and resolving the conflict
     */
    private async handleAcceptResult(conflictId: string, content: string): Promise<void> {
        if (!this.pendingConflict) {
            void vscode.window.showErrorMessage('No pending conflict to resolve');
            return;
        }

        if (this.pendingConflict.conflict.id !== conflictId) {
            void vscode.window.showErrorMessage('Conflict ID mismatch');
            return;
        }

        try {
            const functionDefinition = this.pendingConflict.functionDefinition;

            // Validate that the function definition hasn't been modified
            if (!content.startsWith(functionDefinition)) {
                throw new FlintError(
                    'Function definition has been modified',
                    'FUNCTION_DEFINITION_MODIFIED',
                    'The function definition line must not be changed. Please restore it to its original form.'
                );
            }

            // Strip function wrapper
            const scriptToEncode = content.slice(functionDefinition.length);

            // Encode the script
            const encodedScript = encodeScript(scriptToEncode);

            // Open the original document
            const originalUri = this.pendingConflict.documentUri;
            const document = await vscode.workspace.openTextDocument(originalUri);

            // Re-parse conflicts to get current line numbers
            const conflictService = this.serviceContainer.get<ConflictDetectionService>('ConflictDetectionService');
            if (!conflictService) {
                throw new FlintError('ConflictDetectionService not available', 'SERVICE_NOT_FOUND');
            }

            const result = conflictService.parseConflicts(document);
            const conflict = result.scriptConflicts.find(c => c.id === conflictId);

            if (!conflict) {
                throw new FlintError(
                    'Conflict no longer exists',
                    'CONFLICT_NOT_FOUND',
                    'The conflict may have been resolved or the file may have changed'
                );
            }

            // Build the replacement text with trailing comma if needed
            const scriptLineIndent = this.detectScriptIndent(document, conflict);
            const trailingComma = this.pendingConflict.hasTrailingComma ? ',' : '';
            const replacement = `${scriptLineIndent}"${this.pendingConflict.conflict.jsonKey}": "${encodedScript}"${trailingComma}`;

            // Calculate the range to replace
            const startPos = new vscode.Position(conflict.startLine, 0);
            const endPos = new vscode.Position(conflict.endLine, document.lineAt(conflict.endLine).text.length);
            const range = new vscode.Range(startPos, endPos);

            // Apply the edit
            const edit = new vscode.WorkspaceEdit();
            edit.replace(originalUri, range, replacement);
            const success = await vscode.workspace.applyEdit(edit);

            if (!success) {
                throw new FlintError('Failed to resolve conflict', 'EDIT_FAILED');
            }

            // Invalidate conflict cache
            conflictService.invalidateCache(originalUri);

            // Show success message
            void vscode.window.showInformationMessage('Conflict resolved successfully');

            // Close the panel
            this.panel?.dispose();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Failed to resolve conflict: ${errorMessage}`);
        }
    }

    /**
     * Detect the indentation of the script line within a conflict
     */
    private detectScriptIndent(document: vscode.TextDocument, conflict: ScriptConflict): string {
        const currentContent = conflict.currentContent;
        const lines = currentContent.split(/\r?\n/);

        for (const line of lines) {
            if (line.includes(`"${conflict.jsonKey}":`)) {
                const match = line.match(/^(\s*)/);
                return match ? match[1] : '';
            }
        }

        // Fallback: try to get indentation from the start line
        const startLineText = document.lineAt(conflict.startLine).text;
        const match = startLineText.match(/^(\s*)/);
        return match ? match[1] : '';
    }

    /**
     * Generates the HTML content for the webview
     */
    private generateWebviewHtml(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'conflict-merge.css'))
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'conflict-merge.js'))
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
    <title>Merge Script Conflict</title>
</head>
<body>
    <div class="merge-container">
        <!-- Header -->
        <div class="merge-header">
            <h1>Merge Script: <span id="filePathLabel" class="file-path"></span></h1>
            <span class="json-key-badge" id="jsonKeyLabel">script</span>
        </div>

        <!-- Top panels: Current and Incoming -->
        <div class="top-panels">
            <div class="panel current-panel">
                <div class="panel-header">
                    <span class="panel-title">Current (<span id="currentBranchLabel">HEAD</span>)</span>
                </div>
                <div id="currentEditor" class="editor-container"></div>
                <div class="panel-actions">
                    <button id="useCurrentBtn" class="btn btn-secondary">
                        Use This Version ↓
                    </button>
                </div>
            </div>

            <div class="panel incoming-panel">
                <div class="panel-header">
                    <span class="panel-title">Incoming (<span id="incomingBranchLabel">branch</span>)</span>
                </div>
                <div id="incomingEditor" class="editor-container"></div>
                <div class="panel-actions">
                    <button id="useIncomingBtn" class="btn btn-secondary">
                        Use This Version ↓
                    </button>
                </div>
            </div>
        </div>

        <!-- Bottom panel: Result -->
        <div class="result-panel">
            <div class="panel-header">
                <span class="panel-title">Result</span>
                <span class="panel-hint">Edit below or use buttons above to copy a version</span>
            </div>
            <div id="resultEditor" class="editor-container result-editor"></div>
        </div>

        <!-- Footer with action buttons -->
        <div class="merge-footer">
            <button id="toggleWrapBtn" class="btn btn-icon" title="Word wrap is OFF - click to enable (Alt+Z)">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2 3h12v1H2V3zm0 4h9v1H2V7zm0 4h5v1H2v-1z"/>
                    <path d="M13 7.5v.5h-1v-.5a1.5 1.5 0 0 0-3 0v2a.5.5 0 0 0 .5.5H12v1H9.5a1.5 1.5 0 0 1-1.5-1.5v-2a2.5 2.5 0 0 1 5 0z"/>
                    <path d="M12 11l1.5-1.5L12 8v3z"/>
                </svg>
            </button>
            <div class="footer-spacer"></div>
            <button id="cancelBtn" class="btn btn-secondary">Cancel</button>
            <button id="acceptBtn" class="btn btn-primary">Accept Result</button>
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
