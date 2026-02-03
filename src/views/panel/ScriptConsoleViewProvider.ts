/**
 * @module ScriptConsoleViewProvider
 * @description WebviewView provider for the Script Console panel
 * Split view: Multiline Buffer (left) + Interactive Interpreter (right)
 * Displays in the bottom panel area alongside Terminal, Output, and Debug Console
 */

import * as path from 'path';

import * as vscode from 'vscode';

import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import {
    CompletionScope,
    PythonCompletionService,
    type PerspectiveCompletionContext as ServicePerspectiveContext
} from '@/services/completion';
import { ProjectScannerService } from '@/services/config/ProjectScannerService';
import { ConnectionState, DesignerBridgeService } from '@/services/designer';
import { LspClientService, LspCompletionItem } from '@/services/designer/LspClientService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';
import { ScriptModuleIndexService } from '@/services/python/ScriptModuleIndexService';

/**
 * Execution scope for scripts
 */
export enum ExecutionScope {
    DESIGNER = 'designer',
    GATEWAY = 'gateway',
    PERSPECTIVE = 'perspective'
}

/**
 * Context for debug session
 */
export interface DebugContext {
    scope: ExecutionScope;
    perspectiveSessionId?: string;
    perspectivePageId?: string;
    perspectiveViewInstanceId?: string;
    perspectiveComponentPath?: string;
}

/**
 * Interface for the Script Console Debug Service
 * Will be implemented in Phase 2
 */
export interface IScriptConsoleDebugService {
    debugConsoleCode(
        code: string,
        breakpoints: number[],
        consoleProvider: ScriptConsoleViewProvider,
        context?: DebugContext
    ): Promise<void>;
    stopDebugSession(): Promise<void>;
}

/**
 * Perspective context for script execution
 */
interface PerspectiveContext {
    sessionId: string;
    pageId?: string;
    viewInstanceId?: string;
    componentPath?: string;
}

/**
 * Simplified session info for UI display
 */
interface PerspectiveSessionOption {
    sessionId: string;
    label: string;
    description: string;
}

/**
 * Simplified page info for UI display
 */
interface PerspectivePageOption {
    pageId: string;
    label: string;
    description: string;
}

/**
 * Simplified view info for UI display
 */
interface PerspectiveViewOption {
    viewInstanceId: string;
    label: string;
    description: string;
}

/**
 * Simplified component info for UI display
 */
interface PerspectiveComponentOption {
    path: string;
    label: string;
    description: string;
}

/**
 * Source of execution
 */
type ExecutionSource = 'buffer' | 'interpreter' | 'file';

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
          source?: ExecutionSource;
          code?: string;
          fromFile?: boolean;
          fileName?: string;
      }
    | { command: 'executionStarted' }
    | { command: 'setTheme'; theme: 'vs-dark' | 'vs' | 'hc-black' }
    | { command: 'sessionReset' }
    | { command: 'clearAndExecute'; code: string }
    | { command: 'setBufferContent'; content: string }
    // Perspective discovery responses
    | { command: 'perspectiveAvailability'; available: boolean }
    | { command: 'perspectiveSessions'; sessions: PerspectiveSessionOption[] }
    | { command: 'perspectivePages'; pages: PerspectivePageOption[] }
    | { command: 'perspectiveViews'; views: PerspectiveViewOption[] }
    | { command: 'perspectiveComponents'; components: PerspectiveComponentOption[] }
    // Completion responses
    | { command: 'completionResponse'; requestId: number; items: LspCompletionItem[]; isIncomplete: boolean }
    // Debug messages (extension to webview)
    | { command: 'debugStarted' }
    | { command: 'debugStopped'; line: number; reason: string }
    | { command: 'debugContinued' }
    | { command: 'debugEnded' }
    | { command: 'debugOutput'; category: string; output: string }
    | { command: 'setBreakpointsFromExtension'; breakpoints: number[] };

/**
 * Messages from webview to extension
 */
type WebviewToExtensionMessage =
    | { command: 'ready' }
    | {
          command: 'executeCode';
          code: string;
          scope: ExecutionScope;
          source: ExecutionSource;
          perspectiveContext?: PerspectiveContext;
      }
    | { command: 'resetSession' }
    | { command: 'clearOutput' }
    | { command: 'connect' }
    // Perspective discovery requests
    | { command: 'checkPerspectiveAvailability' }
    | { command: 'fetchPerspectiveSessions' }
    | { command: 'fetchPerspectivePages'; sessionId: string }
    | { command: 'fetchPerspectiveViews'; sessionId: string; pageId: string }
    | { command: 'fetchPerspectiveComponents'; sessionId: string; pageId: string; viewInstanceId: string }
    // Completion requests
    | {
          command: 'requestCompletion';
          requestId: number;
          prefix: string;
          partialWord?: string;
          scope: string;
          lineContent: string;
          perspectiveContext: PerspectiveContext | null;
      }
    // Debug commands (webview to extension)
    | { command: 'debugModeChanged'; enabled: boolean; breakpoints: number[] }
    | { command: 'breakpointsChanged'; breakpoints: number[] }
    | {
          command: 'debugBuffer';
          code: string;
          scope: ExecutionScope;
          breakpoints: number[];
          perspectiveContext?: PerspectiveContext;
      }
    | { command: 'stopDebugging' };

/**
 * WebviewViewProvider for the Script Console panel
 * Appears in the bottom panel area alongside Terminal, Output, Debug Console
 */
export class ScriptConsoleViewProvider implements vscode.WebviewViewProvider, IServiceLifecycle {
    public static readonly viewType = 'flint.scriptConsolePanel';

    private view: vscode.WebviewView | null = null;
    private isInitialized = false;
    private sessionId: string;
    private bridgeService: DesignerBridgeService | null = null;
    private lspClientService: LspClientService | null = null;
    private completionService: PythonCompletionService | null = null;
    private gatewayManagerService: GatewayManagerService | null = null;
    private projectScannerService: ProjectScannerService | null = null;
    private scriptModuleIndexService: ScriptModuleIndexService | null = null;
    private pendingFileExecution: { code: string; fileName: string } | null = null;

    // Debug state
    private debugModeEnabled = false;
    private consoleBreakpoints: number[] = [];
    private debugSessionActive = false;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {
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
        this.view = null;
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
     * Run a file in the Script Console
     * Clears the output and executes the provided code
     */
    async runFile(code: string, fileName: string): Promise<void> {
        // Store the pending execution
        this.pendingFileExecution = { code, fileName };

        // Reveal the panel
        if (this.view) {
            this.view.show(true);
            // Execute immediately if view is ready
            await this.executePendingFile();
        } else {
            // Panel not yet created - it will execute when resolveWebviewView is called
            await vscode.commands.executeCommand('flint.scriptConsolePanel.focus');
        }
    }

    // ============================================================================
    // WEBVIEW VIEW PROVIDER
    // ============================================================================

    /**
     * Called when the view is first shown
     */
    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        // Get the bridge service
        this.bridgeService = this.serviceContainer.get<DesignerBridgeService>('DesignerBridgeService');

        // Get the completion service from container
        this.completionService = this.serviceContainer.get<PythonCompletionService>('PythonCompletionService');

        // Get the gateway manager service for project ID lookups (needed for deep completions)
        this.gatewayManagerService = this.serviceContainer.get<GatewayManagerService>('GatewayManagerService');

        // Get project scanner and script module index services for deep completions
        this.projectScannerService = this.serviceContainer.get<ProjectScannerService>('ProjectScannerService');
        this.scriptModuleIndexService = this.serviceContainer.get<ScriptModuleIndexService>('ScriptModuleIndexService');

        // Initialize LSP client service if Designer Bridge is available
        if (this.bridgeService) {
            this.lspClientService = new LspClientService(this.serviceContainer);
            void this.lspClientService.initialize().then(() => {
                void this.lspClientService!.start();
                const connectionManager = this.bridgeService!.getConnectionManager();
                if (connectionManager) {
                    this.lspClientService!.setConnectionManager(connectionManager);
                    // Also set connection manager on completion service for Perspective completions
                    if (this.completionService) {
                        this.completionService.setConnectionManager(connectionManager);
                    }
                }
            });
        }

        // Configure webview options
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))]
        };

        // Generate HTML content
        webviewView.webview.html = this.generateWebviewHtml(webviewView.webview);

        // Setup message handling
        webviewView.webview.onDidReceiveMessage(
            (message: WebviewToExtensionMessage) => this.handleWebviewMessage(message),
            undefined,
            this.context.subscriptions
        );

        // Listen for connection state changes
        if (this.bridgeService) {
            this.bridgeService.onConnectionStateChanged((state, designer) => {
                void this.updateConnectionStatus(state, designer);
            });
        }

        // Handle view becoming visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible && this.bridgeService) {
                const state = this.bridgeService.getConnectionState();
                const designer = this.bridgeService.getConnectedDesigner();
                void this.updateConnectionStatus(state, designer);
            }
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
     * Execute pending file if any
     */
    private async executePendingFile(): Promise<void> {
        if (!this.pendingFileExecution || !this.view || !this.bridgeService) {
            return;
        }

        const { code, fileName } = this.pendingFileExecution;
        this.pendingFileExecution = null;

        // Check connection
        if (this.bridgeService.getConnectionState() !== ConnectionState.CONNECTED) {
            const errorMessage: ExtensionToWebviewMessage = {
                command: 'executionResult',
                success: false,
                stdout: '',
                stderr: '',
                error: 'Not connected to Designer. Click "Connect" to connect to a running Designer.',
                executionTimeMs: 0,
                fromFile: true,
                fileName
            };
            await this.view.webview.postMessage(errorMessage);
            return;
        }

        // Notify webview to clear and show we're executing
        await this.view.webview.postMessage({ command: 'executionStarted' });

        try {
            // Execute with session persistence
            const result = await this.bridgeService.executeScript({
                code,
                sessionId: this.sessionId
            });

            const message: ExtensionToWebviewMessage = {
                command: 'executionResult',
                success: result.success,
                stdout: result.stdout,
                stderr: result.stderr,
                error: result.error,
                executionTimeMs: result.executionTimeMs,
                source: 'file',
                fromFile: true,
                fileName
            };
            await this.view.webview.postMessage(message);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const message: ExtensionToWebviewMessage = {
                command: 'executionResult',
                success: false,
                stdout: '',
                stderr: '',
                error: errorMessage,
                executionTimeMs: 0,
                source: 'file',
                fromFile: true,
                fileName
            };
            await this.view.webview.postMessage(message);
        }
    }

    /**
     * Updates the connection status in the webview
     */
    private async updateConnectionStatus(
        state: ConnectionState,
        designer: { project: { name: string }; gateway: { host: string } } | null
    ): Promise<void> {
        if (!this.view) {
            return;
        }

        const connected = state === ConnectionState.CONNECTED;

        const message: ExtensionToWebviewMessage = {
            command: 'updateConnectionStatus',
            connected,
            projectName: designer?.project.name ?? null,
            gatewayHost: designer?.gateway.host ?? null
        };

        await this.view.webview.postMessage(message);
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
                await this.handleExecuteCode(message.code, message.scope, message.source, message.perspectiveContext);
                break;

            case 'resetSession':
                await this.handleResetSession();
                break;

            case 'clearOutput':
                // No server-side action needed
                break;

            case 'connect':
                await this.handleConnect();
                break;

            // Perspective discovery commands
            case 'checkPerspectiveAvailability':
                await this.handleCheckPerspectiveAvailability();
                break;

            case 'fetchPerspectiveSessions':
                await this.handleFetchPerspectiveSessions();
                break;

            case 'fetchPerspectivePages':
                await this.handleFetchPerspectivePages(message.sessionId);
                break;

            case 'fetchPerspectiveViews':
                await this.handleFetchPerspectiveViews(message.sessionId, message.pageId);
                break;

            case 'fetchPerspectiveComponents':
                await this.handleFetchPerspectiveComponents(message.sessionId, message.pageId, message.viewInstanceId);
                break;

            case 'requestCompletion':
                await this.handleRequestCompletion(
                    message.requestId,
                    message.prefix,
                    message.partialWord || '',
                    message.scope,
                    message.perspectiveContext
                );
                break;

            // Debug commands
            case 'debugModeChanged':
                this.handleDebugModeChanged(message.enabled, message.breakpoints);
                break;

            case 'breakpointsChanged':
                this.handleBreakpointsChanged(message.breakpoints);
                break;

            case 'debugBuffer':
                await this.handleDebugBuffer(
                    message.code,
                    message.scope,
                    message.breakpoints,
                    message.perspectiveContext
                );
                break;

            case 'stopDebugging':
                await this.handleStopDebugging();
                break;

            default:
                console.warn('Unknown webview message:', message);
        }
    }

    /**
     * Handles the ready message from the webview
     */
    private async handleReady(): Promise<void> {
        if (!this.view || !this.bridgeService) {
            return;
        }

        // Send current theme
        const theme = this.getVSCodeTheme();
        await this.view.webview.postMessage({ command: 'setTheme', theme });

        // Send current connection status
        const state = this.bridgeService.getConnectionState();
        const designer = this.bridgeService.getConnectedDesigner();
        await this.updateConnectionStatus(state, designer);

        // Execute pending file if any
        if (this.pendingFileExecution) {
            await this.executePendingFile();
        }
    }

    /**
     * Handles code execution request
     */
    private async handleExecuteCode(
        code: string,
        scope: ExecutionScope,
        source: ExecutionSource,
        perspectiveContext?: PerspectiveContext
    ): Promise<void> {
        if (!this.view || !this.bridgeService) {
            return;
        }

        // Notify webview that execution started
        await this.view.webview.postMessage({ command: 'executionStarted' });

        // Check connection
        if (this.bridgeService.getConnectionState() !== ConnectionState.CONNECTED) {
            const errorMessage: ExtensionToWebviewMessage = {
                command: 'executionResult',
                success: false,
                stdout: '',
                stderr: '',
                error: 'Not connected to Designer. Click "Connect" to connect to a running Designer.',
                executionTimeMs: 0,
                source,
                code
            };
            await this.view.webview.postMessage(errorMessage);
            return;
        }

        // Validate Perspective context if scope is Perspective
        if (scope === ExecutionScope.PERSPECTIVE) {
            if (!perspectiveContext?.sessionId) {
                const errorMessage: ExtensionToWebviewMessage = {
                    command: 'executionResult',
                    success: false,
                    stdout: '',
                    stderr: '',
                    error: 'Please select a Perspective session before executing.',
                    executionTimeMs: 0,
                    source,
                    code
                };
                await this.view.webview.postMessage(errorMessage);
                return;
            }
        }

        // Map scope enum to string for API
        const scopeString: 'designer' | 'gateway' | 'perspective' =
            scope === ExecutionScope.GATEWAY
                ? 'gateway'
                : scope === ExecutionScope.PERSPECTIVE
                  ? 'perspective'
                  : 'designer';

        try {
            // Execute with session persistence and scope
            const result = await this.bridgeService.executeScript({
                code,
                sessionId: this.sessionId,
                scope: scopeString,
                // Include Perspective context if provided
                perspectiveSessionId: perspectiveContext?.sessionId,
                perspectivePageId: perspectiveContext?.pageId,
                perspectiveViewInstanceId: perspectiveContext?.viewInstanceId,
                perspectiveComponentPath: perspectiveContext?.componentPath
            });

            const message: ExtensionToWebviewMessage = {
                command: 'executionResult',
                success: result.success,
                stdout: result.stdout,
                stderr: result.stderr,
                error: result.error,
                executionTimeMs: result.executionTimeMs,
                source,
                code
            };
            await this.view.webview.postMessage(message);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const message: ExtensionToWebviewMessage = {
                command: 'executionResult',
                success: false,
                stdout: '',
                stderr: '',
                error: errorMessage,
                executionTimeMs: 0,
                source,
                code
            };
            await this.view.webview.postMessage(message);
        }
    }

    /**
     * Handles session reset request
     */
    private async handleResetSession(): Promise<void> {
        this.sessionId = this.generateSessionId();

        if (this.view) {
            await this.view.webview.postMessage({ command: 'sessionReset' });
        }
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

    // ============================================================================
    // PERSPECTIVE DISCOVERY HANDLERS
    // ============================================================================

    /**
     * Checks if Perspective is available on the Gateway
     */
    private async handleCheckPerspectiveAvailability(): Promise<void> {
        if (!this.view || !this.bridgeService) {
            return;
        }

        try {
            const connectionManager = this.bridgeService.getConnectionManager();
            if (!connectionManager) {
                await this.view.webview.postMessage({ command: 'perspectiveAvailability', available: false });
                return;
            }

            const available = await connectionManager.isPerspectiveAvailable();
            await this.view.webview.postMessage({ command: 'perspectiveAvailability', available });
        } catch {
            await this.view.webview.postMessage({ command: 'perspectiveAvailability', available: false });
        }
    }

    /**
     * Fetches active Perspective sessions
     */
    private async handleFetchPerspectiveSessions(): Promise<void> {
        if (!this.view || !this.bridgeService) {
            return;
        }

        try {
            const connectionManager = this.bridgeService.getConnectionManager();
            if (!connectionManager) {
                await this.view.webview.postMessage({ command: 'perspectiveSessions', sessions: [] });
                return;
            }

            const result = await connectionManager.perspectiveListSessions();
            interface SessionData {
                sessionId: string;
                userName: string;
                projectName: string;
                displayName?: string;
                sessionType?: string;
            }
            const sessions: PerspectiveSessionOption[] = (result.sessions || []).map((s: SessionData) => ({
                sessionId: s.sessionId,
                // Use displayName if available, fallback to userName@projectName
                label: s.displayName || `${s.userName}@${s.projectName}`,
                // Don't add description since displayName already contains all info
                description: ''
            }));

            await this.view.webview.postMessage({ command: 'perspectiveSessions', sessions });
        } catch {
            await this.view.webview.postMessage({ command: 'perspectiveSessions', sessions: [] });
        }
    }

    /**
     * Fetches pages for a Perspective session
     */
    private async handleFetchPerspectivePages(sessionId: string): Promise<void> {
        if (!this.view || !this.bridgeService) {
            return;
        }

        try {
            const connectionManager = this.bridgeService.getConnectionManager();
            if (!connectionManager) {
                await this.view.webview.postMessage({ command: 'perspectivePages', pages: [] });
                return;
            }

            const result = await connectionManager.perspectiveGetSessionPages(sessionId);
            interface PageData {
                pageId: string;
                primaryViewPath: string;
                viewCount: number;
            }
            const pages: PerspectivePageOption[] = (result.pages || []).map((p: PageData) => {
                // Use primaryViewPath as the main label if available
                const viewPath = p.primaryViewPath || 'Unknown View';

                // Determine if we should show the pageId
                // - Don't show if pageId matches viewPath (Designer case)
                // - Show shortened UUID for browser sessions
                let description = '';
                if (p.pageId !== viewPath && p.pageId !== p.primaryViewPath) {
                    // It's likely a UUID from browser, show shortened version
                    const shortPageId = p.pageId.length > 8 ? p.pageId.substring(0, 8) : p.pageId;
                    description = shortPageId;
                }

                return {
                    pageId: p.pageId,
                    label: viewPath,
                    description
                };
            });

            await this.view.webview.postMessage({ command: 'perspectivePages', pages });
        } catch {
            await this.view.webview.postMessage({ command: 'perspectivePages', pages: [] });
        }
    }

    /**
     * Fetches views for a Perspective page
     */
    private async handleFetchPerspectiveViews(sessionId: string, pageId: string): Promise<void> {
        if (!this.view || !this.bridgeService) {
            return;
        }

        try {
            const connectionManager = this.bridgeService.getConnectionManager();
            if (!connectionManager) {
                await this.view.webview.postMessage({ command: 'perspectiveViews', views: [] });
                return;
            }

            const result = await connectionManager.perspectiveGetPageViews(sessionId, pageId);
            interface ViewData {
                viewInstanceId: string;
                viewPath: string;
                componentCount: number;
            }

            // Count occurrences of each view path to detect duplicates
            const viewPathCounts: Record<string, number> = {};
            const viewPathIndices: Record<string, number> = {};
            for (const v of (result.views || []) as ViewData[]) {
                viewPathCounts[v.viewPath] = (viewPathCounts[v.viewPath] || 0) + 1;
            }

            const views: PerspectiveViewOption[] = (result.views || []).map((v: ViewData) => {
                // Track index for this view path
                viewPathIndices[v.viewPath] = (viewPathIndices[v.viewPath] || 0) + 1;
                const index = viewPathIndices[v.viewPath];
                const count = viewPathCounts[v.viewPath];

                // Add index suffix if there are duplicates
                const label = count > 1 ? `${v.viewPath} [${index}/${count}]` : v.viewPath;

                return {
                    viewInstanceId: v.viewInstanceId,
                    label,
                    description: `${v.componentCount} components`
                };
            });

            await this.view.webview.postMessage({ command: 'perspectiveViews', views });
        } catch {
            await this.view.webview.postMessage({ command: 'perspectiveViews', views: [] });
        }
    }

    /**
     * Fetches components for a Perspective view
     */
    private async handleFetchPerspectiveComponents(
        sessionId: string,
        pageId: string,
        viewInstanceId: string
    ): Promise<void> {
        if (!this.view || !this.bridgeService) {
            return;
        }

        try {
            const connectionManager = this.bridgeService.getConnectionManager();
            if (!connectionManager) {
                await this.view.webview.postMessage({ command: 'perspectiveComponents', components: [] });
                return;
            }

            const result = await connectionManager.perspectiveGetViewComponents(sessionId, pageId, viewInstanceId);

            // Send the raw tree data - the webview will render it as a tree
            await this.view.webview.postMessage({
                command: 'perspectiveComponents',
                components: result.components || []
            });
        } catch {
            await this.view.webview.postMessage({ command: 'perspectiveComponents', components: [] });
        }
    }

    // ============================================================================
    // COMPLETION HANDLERS
    // ============================================================================

    /**
     * Handles completion requests from the webview.
     * Uses local LSP client for system/project completions (for best reliability),
     * and delegates to PythonCompletionService for context variables and Perspective completions.
     */
    private async handleRequestCompletion(
        requestId: number,
        prefix: string,
        partialWord: string,
        scope: string,
        perspectiveContext: PerspectiveContext | null
    ): Promise<void> {
        if (!this.view) {
            return;
        }

        const items: LspCompletionItem[] = [];
        let isIncomplete = false;

        const completionScope = this.mapScopeToEnum(scope);
        const servicePerspectiveContext: ServicePerspectiveContext | null = perspectiveContext
            ? {
                  sessionId: perspectiveContext.sessionId,
                  pageId: perspectiveContext.pageId,
                  viewInstanceId: perspectiveContext.viewInstanceId,
                  componentPath: perspectiveContext.componentPath
              }
            : null;

        // Get project ID for completions
        const projectId = await this.resolveProjectIdForCompletions();

        // 1. Handle Perspective self.* completions (component-specific, not from unified service)
        if (prefix.startsWith('self')) {
            const perspectiveItems = await this.getPerspectiveSelfCompletions(prefix, scope, perspectiveContext);
            items.push(...perspectiveItems);
        } else {
            // 2. Use unified PythonCompletionService for all other completions
            const completionResult = await this.fetchCompletionsFromService(
                prefix,
                partialWord,
                completionScope,
                projectId,
                servicePerspectiveContext
            );
            items.push(...completionResult.items);
            isIncomplete = completionResult.isIncomplete;
        }

        // Send response back to webview
        const response: ExtensionToWebviewMessage = {
            command: 'completionResponse',
            requestId,
            items,
            isIncomplete
        };
        await this.view.webview.postMessage(response);
    }

    /**
     * Resolves the project ID for completions from various sources
     */
    private async resolveProjectIdForCompletions(): Promise<string | null> {
        // Try connected designer first
        if (this.bridgeService) {
            const designer = this.bridgeService.getConnectedDesigner();
            if (designer?.project?.name) {
                return designer.project.name;
            }
        }

        // Try active gateway selection
        if (this.gatewayManagerService) {
            const projectId = this.gatewayManagerService.getActiveProjectId();
            if (projectId) {
                return projectId;
            }
        }

        // Fallback: try to find any Ignition project in the workspace
        if (this.projectScannerService) {
            return this.findProjectInWorkspace();
        }

        return null;
    }

    /**
     * Fetches completions from the PythonCompletionService
     */
    private async fetchCompletionsFromService(
        prefix: string,
        partialWord: string,
        completionScope: CompletionScope,
        projectId: string | null,
        servicePerspectiveContext: ServicePerspectiveContext | null
    ): Promise<{ items: LspCompletionItem[]; isIncomplete: boolean }> {
        if (!this.completionService) {
            return { items: [], isIncomplete: false };
        }

        try {
            // Determine if we're completing a partial name at root level
            // e.g., user typed "calc" and we want to find "Test.calculateArea"
            const isPartialAtRoot = prefix === '' && partialWord !== '';
            const effectivePrefix = isPartialAtRoot ? '' : prefix;

            const response = await this.completionService.getCompletions({
                prefix: effectivePrefix,
                scope: completionScope,
                projectId: projectId ?? undefined,
                perspectiveContext: servicePerspectiveContext,
                includeDesignerLsp: true,
                includeLocalScripts: true
            });

            const items = [...response.items];
            const isIncomplete = response.isIncomplete;

            // For partial word at root level, also do deep search
            if (isPartialAtRoot && projectId) {
                const existingLabels = new Set(items.map(item => item.label.toLowerCase()));
                const deepItems = await this.completionService.getDeepCompletions(projectId, partialWord);
                // Filter and add deep items that aren't duplicates
                for (const item of deepItems) {
                    if (!existingLabels.has(item.label.toLowerCase())) {
                        items.push(item);
                        existingLabels.add(item.label.toLowerCase());
                    }
                }
            }

            return { items, isIncomplete };
        } catch (error) {
            console.error('[ScriptConsole] Error getting completions:', error);
            return { items: [], isIncomplete: false };
        }
    }

    /**
     * Maps scope string to CompletionScope enum
     */
    private mapScopeToEnum(scope: string): CompletionScope {
        switch (scope) {
            case 'designer':
                return CompletionScope.DESIGNER;
            case 'gateway':
                return CompletionScope.GATEWAY;
            case 'perspective':
                return CompletionScope.PERSPECTIVE;
            default:
                return CompletionScope.DESIGNER;
        }
    }

    /**
     * Gets Perspective self.* completions when in Perspective scope with a component selected
     */
    private async getPerspectiveSelfCompletions(
        prefix: string,
        scope: string,
        perspectiveContext: PerspectiveContext | null
    ): Promise<LspCompletionItem[]> {
        if (scope !== 'perspective' || !perspectiveContext?.componentPath) {
            return [];
        }

        if (prefix !== 'self' && !prefix.startsWith('self.')) {
            return [];
        }

        if (!this.completionService) {
            return [];
        }

        try {
            const servicePerspectiveContext: ServicePerspectiveContext = {
                sessionId: perspectiveContext.sessionId,
                pageId: perspectiveContext.pageId,
                viewInstanceId: perspectiveContext.viewInstanceId,
                componentPath: perspectiveContext.componentPath
            };

            const response = await this.completionService.getCompletions({
                prefix,
                scope: CompletionScope.PERSPECTIVE,
                perspectiveContext: servicePerspectiveContext,
                includeDesignerLsp: false,
                includeLocalScripts: false
            });
            return response.items;
        } catch (error) {
            console.error('[ScriptConsole] Error getting Perspective completions:', error);
            return [];
        }
    }

    // ============================================================================
    // DEBUG HANDLERS
    // ============================================================================

    /**
     * Handles debug mode toggle from webview
     */
    private handleDebugModeChanged(enabled: boolean, breakpoints: number[]): void {
        this.debugModeEnabled = enabled;
        this.consoleBreakpoints = breakpoints;
    }

    /**
     * Handles breakpoint changes from webview
     */
    private handleBreakpointsChanged(breakpoints: number[]): void {
        this.consoleBreakpoints = breakpoints;
    }

    /**
     * Handles debug buffer request from webview
     * This will coordinate with the ScriptConsoleDebugService to start a debug session
     * Supports Designer, Gateway, and Perspective scopes
     */
    private async handleDebugBuffer(
        code: string,
        scope: ExecutionScope,
        breakpoints: number[],
        perspectiveContext?: PerspectiveContext
    ): Promise<void> {
        if (!this.view || !this.bridgeService) {
            return;
        }

        // Check connection
        if (this.bridgeService.getConnectionState() !== ConnectionState.CONNECTED) {
            await this.view.webview.postMessage({
                command: 'debugOutput',
                category: 'stderr',
                output: 'Not connected to Designer. Click "Connect" to connect to a running Designer.\n'
            });
            await this.view.webview.postMessage({ command: 'debugEnded' });
            return;
        }

        this.consoleBreakpoints = breakpoints;
        this.debugSessionActive = true;

        // Build debug context with scope information
        const debugContext: DebugContext = {
            scope,
            perspectiveSessionId: perspectiveContext?.sessionId,
            perspectivePageId: perspectiveContext?.pageId,
            perspectiveViewInstanceId: perspectiveContext?.viewInstanceId,
            perspectiveComponentPath: perspectiveContext?.componentPath
        };

        // Get the debug service and start a debug session
        const debugService = this.serviceContainer.getOptional<IScriptConsoleDebugService>('ScriptConsoleDebugService');
        if (debugService) {
            await debugService.debugConsoleCode(code, breakpoints, this, debugContext);
        } else {
            // Fallback: notify that debug service is not available yet
            await this.view.webview.postMessage({
                command: 'debugOutput',
                category: 'stderr',
                output: 'Debug service is not available. Debug functionality will be added in a future update.\n'
            });
            await this.view.webview.postMessage({ command: 'debugEnded' });
            this.debugSessionActive = false;
        }
    }

    /**
     * Handles stop debugging request from webview
     */
    private async handleStopDebugging(): Promise<void> {
        const debugService = this.serviceContainer.getOptional<IScriptConsoleDebugService>('ScriptConsoleDebugService');
        if (debugService) {
            await debugService.stopDebugSession();
        }
        this.debugSessionActive = false;
        if (this.view) {
            await this.view.webview.postMessage({ command: 'debugEnded' });
        }
    }

    /**
     * Sends a debug message to the webview
     * Called by ScriptConsoleDebugService to update the UI
     */
    async sendDebugMessage(message: ExtensionToWebviewMessage): Promise<void> {
        if (this.view) {
            await this.view.webview.postMessage(message);
        }
    }

    /**
     * Gets the current console breakpoints
     */
    getConsoleBreakpoints(): number[] {
        return [...this.consoleBreakpoints];
    }

    /**
     * Checks if debug session is active
     */
    isDebugSessionActive(): boolean {
        return this.debugSessionActive;
    }

    /**
     * Sets debug session active state
     */
    setDebugSessionActive(active: boolean): void {
        this.debugSessionActive = active;
    }

    /**
     * Finds an Ignition project in the workspace for completions.
     * First checks cached results, then scans workspace folders if needed.
     */
    private async findProjectInWorkspace(): Promise<string | null> {
        if (!this.projectScannerService) {
            return null;
        }

        // 1. First check cached projects
        const allProjects = this.projectScannerService.getAllCachedResults();
        if (allProjects.length > 0) {
            return allProjects[0].projectName;
        }

        // 2. If no cached projects, scan workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return null;
        }

        // Scan each workspace folder for Ignition projects
        for (const folder of workspaceFolders) {
            const projectPath = await this.searchFolderForProject(folder.uri.fsPath);
            if (projectPath) {
                // Found a project - scan and index it with progress notification
                const projectName = path.basename(projectPath);
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Indexing project "${projectName}" for completions...`,
                        cancellable: false
                    },
                    async progress => {
                        progress.report({ message: 'Scanning project structure...' });
                        await this.projectScannerService!.scanProject(projectPath);

                        if (this.scriptModuleIndexService) {
                            progress.report({ message: 'Indexing Python modules...' });
                            await this.scriptModuleIndexService.indexProject(projectPath, projectName);
                        }
                    }
                );
                return projectName;
            }
        }

        return null;
    }

    /**
     * Recursively searches a folder for an Ignition project (looks for project.json)
     */
    private async searchFolderForProject(folderPath: string): Promise<string | null> {
        if (!this.projectScannerService) {
            return null;
        }

        // Check if this folder is an Ignition project
        if (await this.projectScannerService.isIgnitionProject(folderPath)) {
            return folderPath;
        }

        // Check immediate subdirectories (don't go too deep)
        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(folderPath));
            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory && !name.startsWith('.')) {
                    const subPath = path.join(folderPath, name);
                    if (await this.projectScannerService.isIgnitionProject(subPath)) {
                        return subPath;
                    }
                }
            }
        } catch {
            // Ignore errors reading directories
        }

        return null;
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

        // Monaco CDN URL
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
    <title>Script Console</title>
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
                        <option value="gateway">Gateway</option>
                        <option value="perspective">Perspective</option>
                    </select>
                </div>
                <!-- Perspective context selectors (hidden by default) -->
                <div id="perspectiveContext" class="perspective-context" style="display: none;">
                    <select id="perspectiveSessionSelect" title="Select Perspective Session">
                        <option value="">Select Session...</option>
                    </select>
                    <select id="perspectivePageSelect" title="Select Page" disabled>
                        <option value="">Select Page...</option>
                    </select>
                    <select id="perspectiveViewSelect" title="Select View" disabled>
                        <option value="">Select View...</option>
                    </select>
                    <div class="component-picker">
                        <button id="componentPickerBtn" disabled title="Select Component (optional, binds as 'self')">
                            <span id="componentPickerLabel">No component</span>
                            <svg class="picker-arrow" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M4.5 5.5L8 9l3.5-3.5L13 7l-5 5-5-5 1.5-1.5z"/>
                            </svg>
                        </button>
                    </div>
                    <button id="refreshPerspectiveBtn" class="btn btn-secondary btn-sm" title="Refresh sessions">⟳</button>
                </div>
            </div>
            <div class="header-right">
                <span id="executionStatus" class="execution-status"></span>
                <div id="connectionStatus" class="connection-status disconnected">
                    <span class="status-indicator"></span>
                    <span class="status-text">Disconnected</span>
                </div>
                <button id="connectBtn" class="btn btn-secondary btn-sm">Connect</button>
            </div>
        </div>

        <!-- Main split view -->
        <div class="main-content">
            <div class="split-pane">
                <!-- Left: Multiline Buffer -->
                <div class="buffer-pane">
                    <div class="buffer-header">
                        <span class="pane-title">Multiline Buffer</span>
                        <button id="toggleWrapBtn" class="btn btn-icon" title="Word wrap is OFF - click to enable (Alt+Z)">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M2 3h12v1H2V3zm0 4h9v1H2V7zm0 4h5v1H2v-1z"/>
                                <path d="M13 7.5v.5h-1v-.5a1.5 1.5 0 0 0-3 0v2a.5.5 0 0 0 .5.5H12v1H9.5a1.5 1.5 0 0 1-1.5-1.5v-2a2.5 2.5 0 0 1 5 0z"/>
                            </svg>
                        </button>
                    </div>
                    <div id="bufferEditor" class="buffer-editor"></div>
                    <div class="buffer-footer">
                        <button id="executeBufferBtn" class="btn btn-primary btn-sm">Execute (Ctrl+Enter)</button>
                    </div>
                </div>

                <!-- Resize handle -->
                <div class="resize-handle"></div>

                <!-- Right: Interactive Interpreter -->
                <div class="interpreter-pane">
                    <div class="interpreter-header">
                        <span class="pane-title">Interactive Interpreter</span>
                        <div>
                            <button id="clearBtn" class="btn btn-secondary btn-sm" title="Clear output">Clear</button>
                            <button id="resetBtn" class="btn btn-secondary btn-sm" title="Reset session (clear variables)">Reset</button>
                        </div>
                    </div>
                    <div id="interpreterOutput" class="interpreter-output"></div>
                    <div class="interpreter-input-area">
                        <span class="interpreter-prompt">&gt;&gt;&gt;</span>
                        <textarea id="interpreterInput" class="interpreter-input" rows="1" placeholder="Enter command..."></textarea>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Loading overlay -->
    <div id="loadingOverlay" class="loading-overlay">
        <div class="loading-spinner"></div>
        <span>Loading...</span>
    </div>

    <!-- Component Tree Modal -->
    <div id="componentTreeModal" class="modal hidden">
        <div class="modal-content component-tree-modal">
            <div class="modal-header">
                <span class="modal-title">Select Component</span>
                <button id="componentTreeCloseBtn" class="btn-close" title="Close">×</button>
            </div>
            <div class="modal-body">
                <div class="component-tree-info">Select a component to bind as 'self' in your script</div>
                <div id="componentTree" class="component-tree"></div>
            </div>
            <div class="modal-footer">
                <button id="componentClearBtn" class="btn btn-secondary btn-sm">Clear Selection</button>
            </div>
        </div>
    </div>

    <!-- Monaco loader -->
    <script nonce="${nonce}" src="${monacoBase}/vs/loader.js"></script>
    <script nonce="${nonce}">
        require.config({ paths: { 'vs': '${monacoBase}/vs' } });
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
