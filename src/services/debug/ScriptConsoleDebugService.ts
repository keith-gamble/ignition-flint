/**
 * @module ScriptConsoleDebugService
 * @description Service for coordinating debugging from the Script Console
 * Uses VS Code's debug API with virtual documents for full DAP support
 */

import * as vscode from 'vscode';

import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ConsoleCodeDocumentProvider } from '@/providers/console/ConsoleCodeDocumentProvider';
import { ConnectionState, DesignerBridgeService } from '@/services/designer';
import {
    DebugContext,
    ExecutionScope,
    IScriptConsoleDebugService,
    ScriptConsoleViewProvider
} from '@/views/panel/ScriptConsoleViewProvider';

/**
 * Virtual document URI scheme for console code
 */
export const CONSOLE_DOCUMENT_SCHEME = 'flint-console';
export const CONSOLE_DOCUMENT_PATH = '/script-console/buffer.py';
export const CONSOLE_DEBUG_FILENAME = '<script-console>';

/**
 * Service for coordinating Script Console debugging with full VS Code DAP support
 */
export class ScriptConsoleDebugService implements IScriptConsoleDebugService, IServiceLifecycle {
    private isInitialized = false;
    private consoleProvider: ScriptConsoleViewProvider | null = null;
    private bridgeService: DesignerBridgeService | null = null;
    private documentProvider: ConsoleCodeDocumentProvider | null = null;

    // VS Code debug session tracking
    private activeDebugSession: vscode.DebugSession | null = null;
    private debugSessionStartDisposable: vscode.Disposable | null = null;
    private debugSessionEndDisposable: vscode.Disposable | null = null;
    private debugStoppedDisposable: vscode.Disposable | null = null;

    // Current console debug state
    private currentCode: string | null = null;
    private currentBreakpoints: number[] = [];
    private isConsoleDebugSession = false;

    // Track original editor state to restore after debugging
    private originalActiveEditor: vscode.TextEditor | undefined;
    private bufferDocument: vscode.TextDocument | null = null;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    // ============================================================================
    // SERVICE LIFECYCLE
    // ============================================================================

    initialize(): Promise<void> {
        // Get the bridge service
        this.bridgeService = this.serviceContainer.getOptional<DesignerBridgeService>('DesignerBridgeService') ?? null;

        // Get or create the document provider
        this.documentProvider = ConsoleCodeDocumentProvider.getInstance();

        // Subscribe to debug session events
        this.debugSessionStartDisposable = vscode.debug.onDidStartDebugSession(session => {
            if (this.isConsoleDebugSession && session.configuration.isConsoleDebug) {
                this.activeDebugSession = session;
                void this.notifyDebugStarted();
            }
        });

        this.debugSessionEndDisposable = vscode.debug.onDidTerminateDebugSession(session => {
            if (this.activeDebugSession && session.id === this.activeDebugSession.id) {
                void this.onDebugSessionEnded();
            }
        });

        // Listen for debug stopped events to update the webview
        this.debugStoppedDisposable = vscode.debug.onDidChangeActiveStackItem(stackItem => {
            if (this.activeDebugSession && stackItem) {
                void this.handleStackItemChanged(stackItem);
            }
        });

        this.isInitialized = true;
        return Promise.resolve();
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async stop(): Promise<void> {
        await this.stopDebugSession();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.debugSessionStartDisposable?.dispose();
        this.debugSessionEndDisposable?.dispose();
        this.debugStoppedDisposable?.dispose();
        this.isInitialized = false;
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    // ============================================================================
    // PUBLIC API
    // ============================================================================

    /**
     * Start a debug session for console code using VS Code's debug API
     * Supports Designer, Gateway, and Perspective scopes
     */
    async debugConsoleCode(
        code: string,
        breakpoints: number[],
        consoleProvider: ScriptConsoleViewProvider,
        context?: DebugContext
    ): Promise<void> {
        this.consoleProvider = consoleProvider;
        this.currentCode = code;
        this.currentBreakpoints = breakpoints;
        this.isConsoleDebugSession = true;

        // Default to designer scope if not specified
        const scope = context?.scope ?? ExecutionScope.DESIGNER;

        // Check connection to Designer
        if (!this.bridgeService || this.bridgeService.getConnectionState() !== ConnectionState.CONNECTED) {
            await this.sendDebugMessage({
                command: 'debugOutput',
                category: 'stderr',
                output: 'Not connected to Designer. Click "Connect" to connect to a running Designer.\n'
            });
            await this.sendDebugMessage({ command: 'debugEnded' });
            this.isConsoleDebugSession = false;
            return;
        }

        try {
            // Save the original active editor to restore later
            this.originalActiveEditor = vscode.window.activeTextEditor;

            // Update the virtual document with the console code
            if (this.documentProvider) {
                this.documentProvider.updateContent(code);
            }

            // Get the virtual document URI
            const documentUri = ConsoleCodeDocumentProvider.getUri();

            // Open the virtual document in VS Code editor
            // This is essential so VS Code can show the source when hitting breakpoints
            const document = await vscode.workspace.openTextDocument(documentUri);
            this.bufferDocument = document;
            await vscode.window.showTextDocument(document, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: false,
                preview: true // Use preview so it's easier to close
            });

            // Give VS Code a moment to register the document
            await new Promise(resolve => setTimeout(resolve, 100));

            // Set breakpoints on the virtual document before starting debug
            this.setBreakpointsOnDocument(documentUri, breakpoints);

            // Create the debug configuration for console debugging
            const debugConfig: vscode.DebugConfiguration = {
                type: 'flint',
                name: `Script Console Debug (${scope})`,
                request: 'launch',
                program: documentUri.toString(),
                isConsoleDebug: true,
                consoleCode: code,
                scope,
                stopOnEntry: false,
                // Perspective context (only used when scope is 'perspective')
                perspectiveSessionId: context?.perspectiveSessionId,
                perspectivePageId: context?.perspectivePageId,
                perspectiveViewInstanceId: context?.perspectiveViewInstanceId,
                perspectiveComponentPath: context?.perspectiveComponentPath
            };

            // Start the debug session
            const started = await vscode.debug.startDebugging(undefined, debugConfig);

            if (!started) {
                await this.sendDebugMessage({
                    command: 'debugOutput',
                    category: 'stderr',
                    output: 'Failed to start debug session.\n'
                });
                await this.sendDebugMessage({ command: 'debugEnded' });
                this.isConsoleDebugSession = false;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            await this.sendDebugMessage({
                command: 'debugOutput',
                category: 'stderr',
                output: `Debug error: ${errorMessage}\n`
            });
            await this.sendDebugMessage({ command: 'debugEnded' });
            this.isConsoleDebugSession = false;
        }
    }

    /**
     * Stop the current debug session
     */
    async stopDebugSession(): Promise<void> {
        if (this.activeDebugSession) {
            await vscode.debug.stopDebugging(this.activeDebugSession);
        }
        this.isConsoleDebugSession = false;
    }

    // ============================================================================
    // BREAKPOINT MANAGEMENT
    // ============================================================================

    /**
     * Set breakpoints on the virtual document
     */
    private setBreakpointsOnDocument(documentUri: vscode.Uri, lines: number[]): void {
        // First, remove any existing breakpoints on this document
        const existingBreakpoints = vscode.debug.breakpoints.filter(
            bp => bp instanceof vscode.SourceBreakpoint && bp.location.uri.toString() === documentUri.toString()
        );

        if (existingBreakpoints.length > 0) {
            vscode.debug.removeBreakpoints(existingBreakpoints);
        }

        // Add new breakpoints
        if (lines.length > 0) {
            const newBreakpoints = lines.map(line => {
                const location = new vscode.Location(documentUri, new vscode.Position(line - 1, 0));
                return new vscode.SourceBreakpoint(location);
            });

            vscode.debug.addBreakpoints(newBreakpoints);
        }
    }

    // ============================================================================
    // DEBUG EVENT HANDLING
    // ============================================================================

    /**
     * Handle stack item changes (paused at breakpoint or step)
     * Note: vscode.DebugStackFrame has limited public properties, so we use
     * the session's customRequest to get detailed stack frame info
     */
    private async handleStackItemChanged(_stackItem: vscode.DebugStackFrame | vscode.DebugThread): Promise<void> {
        if (!this.isConsoleDebugSession || !this.consoleProvider || !this.activeDebugSession) {
            return;
        }

        try {
            // Request stack trace from the debug adapter to get current line
            const response = await this.activeDebugSession.customRequest('stackTrace', {
                threadId: 1,
                startFrame: 0,
                levels: 1
            });

            if (response?.stackFrames?.[0]) {
                const frame = response.stackFrames[0];
                const source = frame.source;
                const line = frame.line;

                // Check if the source is our console document
                if (
                    source?.path?.includes(CONSOLE_DOCUMENT_SCHEME) ||
                    source?.name === CONSOLE_DEBUG_FILENAME ||
                    source?.path === CONSOLE_DEBUG_FILENAME
                ) {
                    await this.sendDebugMessage({
                        command: 'debugStopped',
                        line,
                        reason: 'breakpoint'
                    });
                }
            }
        } catch {
            // Failed to get stack trace, ignore
        }
    }

    /**
     * Notify webview that debug session started
     */
    private async notifyDebugStarted(): Promise<void> {
        if (this.consoleProvider) {
            this.consoleProvider.setDebugSessionActive(true);
            await this.sendDebugMessage({ command: 'debugStarted' });
        }
    }

    /**
     * Called when debug session ends
     */
    private async onDebugSessionEnded(): Promise<void> {
        this.activeDebugSession = null;
        this.currentCode = null;
        this.isConsoleDebugSession = false;

        // Close the buffer document if it's still open
        await this.closeBufferDocument();

        // Focus the Script Console view
        await this.focusScriptConsole();

        if (this.consoleProvider) {
            this.consoleProvider.setDebugSessionActive(false);
            await this.sendDebugMessage({ command: 'debugEnded' });
        }
    }

    /**
     * Close the buffer document that was opened for debugging
     */
    private async closeBufferDocument(): Promise<void> {
        if (this.bufferDocument) {
            try {
                // Find all editors showing this document
                const documentUri = this.bufferDocument.uri.toString();
                for (const tabGroup of vscode.window.tabGroups.all) {
                    for (const tab of tabGroup.tabs) {
                        if (tab.input instanceof vscode.TabInputText) {
                            if (tab.input.uri.toString() === documentUri) {
                                await vscode.window.tabGroups.close(tab);
                            }
                        }
                    }
                }
            } catch {
                // Ignore errors closing the document
            }
            this.bufferDocument = null;
        }
    }

    /**
     * Focus the Script Console view after debugging ends
     */
    private async focusScriptConsole(): Promise<void> {
        try {
            // Use the VS Code command to focus the Script Console view
            await vscode.commands.executeCommand('flint.scriptConsole.focus');
        } catch {
            // View might not be visible, try to show it
            try {
                await vscode.commands.executeCommand('workbench.view.extension.flint-script-console');
            } catch {
                // Ignore if the view can't be shown
            }
        }
    }

    // ============================================================================
    // HELPER METHODS
    // ============================================================================

    /**
     * Send a debug message to the webview
     */
    private async sendDebugMessage(
        message:
            | { command: 'debugStarted' }
            | { command: 'debugStopped'; line: number; reason: string }
            | { command: 'debugContinued' }
            | { command: 'debugEnded' }
            | { command: 'debugOutput'; category: string; output: string }
    ): Promise<void> {
        if (this.consoleProvider) {
            await this.consoleProvider.sendDebugMessage(message);
        }
    }
}
