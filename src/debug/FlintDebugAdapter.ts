/**
 * @module FlintDebugAdapter
 * @description VS Code Debug Adapter for Flint/Ignition Python debugging
 */

import * as vscode from 'vscode';

import { SourcePathMapper } from './SourcePathMapper';

import { ServiceContainer } from '@/core/ServiceContainer';
import { CONSOLE_DOCUMENT_SCHEME, CONSOLE_DEBUG_FILENAME } from '@/services/debug';
import { ConnectionState, DebugEventData, DesignerBridgeService, DesignerConnectionManager } from '@/services/designer';

// Debug Protocol Types (subset needed for our adapter)

interface DebugProtocolMessage {
    seq: number;
    type: string;
}

interface DebugProtocolRequest extends DebugProtocolMessage {
    type: 'request';
    command: string;
    arguments?: unknown;
}

interface DebugProtocolResponse extends DebugProtocolMessage {
    type: 'response';
    request_seq: number;
    success: boolean;
    command: string;
    message?: string;
    body?: unknown;
}

interface DebugProtocolEvent extends DebugProtocolMessage {
    type: 'event';
    event: string;
    body?: unknown;
}

interface InitializeRequestArguments {
    clientID?: string;
    clientName?: string;
    adapterID: string;
    locale?: string;
    linesStartAt1?: boolean;
    columnsStartAt1?: boolean;
    pathFormat?: string;
}

interface Capabilities {
    supportsConfigurationDoneRequest?: boolean;
    supportsFunctionBreakpoints?: boolean;
    supportsConditionalBreakpoints?: boolean;
    supportsHitConditionalBreakpoints?: boolean;
    supportsEvaluateForHovers?: boolean;
    supportsStepBack?: boolean;
    supportsSetVariable?: boolean;
    supportsRestartFrame?: boolean;
    supportsGotoTargetsRequest?: boolean;
    supportsStepInTargetsRequest?: boolean;
    supportsCompletionsRequest?: boolean;
    supportsModulesRequest?: boolean;
    supportsExceptionOptions?: boolean;
    supportsValueFormattingOptions?: boolean;
    supportsExceptionInfoRequest?: boolean;
    supportTerminateDebuggee?: boolean;
    supportsDelayedStackTraceLoading?: boolean;
    supportsLoadedSourcesRequest?: boolean;
    supportsLogPoints?: boolean;
    supportsTerminateThreadsRequest?: boolean;
    supportsSetExpression?: boolean;
    supportsTerminateRequest?: boolean;
    supportsDataBreakpoints?: boolean;
    supportsReadMemoryRequest?: boolean;
    supportsDisassembleRequest?: boolean;
    supportsCancelRequest?: boolean;
    supportsBreakpointLocationsRequest?: boolean;
}

interface SourceBreakpoint {
    line: number;
    column?: number;
    condition?: string;
    hitCondition?: string;
    logMessage?: string;
}

interface SetBreakpointsArguments {
    source: {
        name?: string;
        path?: string;
    };
    breakpoints?: SourceBreakpoint[];
    lines?: number[];
    sourceModified?: boolean;
}

interface StackTraceArguments {
    threadId: number;
    startFrame?: number;
    levels?: number;
}

interface ScopesArguments {
    frameId: number;
}

interface VariablesArguments {
    variablesReference: number;
    filter?: 'indexed' | 'named';
    start?: number;
    count?: number;
}

interface ContinueArguments {
    threadId: number;
}

interface SourceArguments {
    source?: {
        name?: string;
        path?: string;
        sourceReference?: number;
    };
    sourceReference: number;
}

interface StepArguments {
    threadId: number;
}

interface PauseArguments {
    threadId: number;
}

interface EvaluateArguments {
    expression: string;
    frameId?: number;
    context?: string;
}

interface DAP_StackFrame {
    id: number;
    name: string;
    source?: {
        name?: string;
        path?: string;
    };
    line: number;
    column: number;
}

interface DAP_Scope {
    name: string;
    variablesReference: number;
    expensive?: boolean;
}

interface DAP_Variable {
    name: string;
    value: string;
    type?: string;
    variablesReference: number;
    namedVariables?: number;
    indexedVariables?: number;
}

/**
 * Launch configuration for Flint debugging
 */
export interface FlintLaunchRequestArguments extends vscode.DebugConfiguration {
    /** The Python script file to debug */
    program: string;
    /** Stop at entry point */
    stopOnEntry?: boolean;
    /** Execution scope: 'designer', 'gateway', or 'perspective' */
    scope?: 'designer' | 'gateway' | 'perspective';
    /** Perspective session ID (required when scope is 'perspective') */
    perspectiveSessionId?: string;
    /** Perspective page ID (optional for perspective scope) */
    perspectivePageId?: string;
    /** Perspective view instance ID (optional for perspective scope) */
    perspectiveViewInstanceId?: string;
    /** Perspective component path to bind as 'self' (optional for perspective scope) */
    perspectiveComponentPath?: string;
    /** Whether this is a console debug session (code provided directly) */
    isConsoleDebug?: boolean;
    /** Code to debug when isConsoleDebug is true */
    consoleCode?: string;
}

/**
 * Represents a breakpoint in the debugger
 */
interface FlintBreakpoint {
    id: number;
    line: number;
    verified: boolean;
    condition?: string;
    hitCount?: number;
    message?: string;
}

/**
 * Stack frame from the debugger
 */
interface FlintStackFrame {
    id: number;
    name: string;
    filePath: string;
    line: number;
    column: number;
    modulePath?: string;
}

/**
 * Variable from the debugger
 */
interface FlintVariable {
    name: string;
    value: string;
    type: string;
    variablesReference: number;
    namedVariables?: number;
    indexedVariables?: number;
}

/**
 * Debug adapter for Flint/Ignition Python debugging.
 * Communicates with the Designer's debug handler via WebSocket.
 */
export class FlintDebugAdapter implements vscode.DebugAdapter {
    private static readonly THREAD_ID = 1;

    private sequence = 1;

    private sessionId: string | null = null;
    private connectionManager: DesignerConnectionManager | null = null;
    private bridgeService: DesignerBridgeService | null = null;

    // Store the original launch program path for post-debug navigation
    private launchProgramPath: string | null = null;

    // Store console code for source requests (when debugging from Script Console)
    private consoleCode: string | null = null;

    private breakpoints = new Map<string, FlintBreakpoint[]>();

    // Promise to track when launch is complete (session ID available)
    private launchCompletePromise: Promise<void> | null = null;
    private launchCompleteResolve: (() => void) | null = null;

    // Bound callback for debug events
    private debugEventCallback = this.handleDebugEvent.bind(this);

    private _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    readonly onDidSendMessage = this._onDidSendMessage.event;

    constructor(private readonly serviceContainer: ServiceContainer) {
        try {
            this.bridgeService = this.serviceContainer.get<DesignerBridgeService>('DesignerBridgeService');
            this.connectionManager = this.bridgeService.getConnectionManager();

            // Subscribe to debug events from Designer
            if (this.connectionManager) {
                this.connectionManager.onDebugEvent(this.debugEventCallback);
            }
        } catch {
            // Services may not be available yet
        }
    }

    handleMessage(message: vscode.DebugProtocolMessage): void {
        const request = message as DebugProtocolRequest;

        if (request.type === 'request') {
            this.handleRequest(request.command, request.seq, request.arguments ?? {});
        }
    }

    dispose(): void {
        // Unsubscribe from debug events
        if (this.connectionManager) {
            this.connectionManager.offDebugEvent(this.debugEventCallback);
        }
        this._onDidSendMessage.dispose();
        this.stopSession();
    }

    /**
     * Handles debug events from the Designer and converts them to DAP events
     */
    private handleDebugEvent(event: DebugEventData): void {
        const handlers: Record<string, () => void> = {
            stopped: () => this.handleStoppedEvent(event.body),
            terminated: () => this.handleTerminatedEvent(),
            exited: () => this.handleExitedEvent(event.body),
            output: () => this.handleOutputEvent(event.body),
            breakpoint: () => this.handleBreakpointEvent(event.body)
        };

        const handler = handlers[event.event];
        if (handler) {
            handler();
        }
    }

    private handleStoppedEvent(body: unknown): void {
        const stoppedBody = body as
            | {
                  reason?: string;
                  threadId?: number;
                  description?: string;
                  text?: string;
                  allThreadsStopped?: boolean;
              }
            | undefined;

        this.sendEvent('stopped', {
            reason: stoppedBody?.reason ?? 'breakpoint',
            threadId: stoppedBody?.threadId ?? FlintDebugAdapter.THREAD_ID,
            description: stoppedBody?.description,
            text: stoppedBody?.text,
            allThreadsStopped: stoppedBody?.allThreadsStopped ?? true
        });
    }

    private handleTerminatedEvent(): void {
        this.sendEvent('terminated');

        // Navigate back to the original launch file after debug session ends
        if (this.launchProgramPath) {
            const filePath = this.launchProgramPath;
            // Use setTimeout to let the terminated event propagate first
            setTimeout(() => {
                void this.navigateToLaunchFile(filePath);
            }, 100);
        }
    }

    private async navigateToLaunchFile(filePath: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: false
            });
        } catch (error) {
            console.error('[FlintDebug] Failed to navigate back to launch file:', error);
        }
    }

    private handleExitedEvent(body: unknown): void {
        const exitedBody = body as { exitCode?: number } | undefined;
        this.sendEvent('exited', { exitCode: exitedBody?.exitCode ?? 0 });
    }

    private handleOutputEvent(body: unknown): void {
        const outputBody = body as
            | {
                  category?: string;
                  output?: string;
                  source?: { path?: string };
                  line?: number;
              }
            | undefined;

        // Send to Debug Console
        this.sendEvent('output', {
            category: outputBody?.category ?? 'console',
            output: outputBody?.output ?? '',
            source: outputBody?.source,
            line: outputBody?.line
        });
    }

    private handleBreakpointEvent(body: unknown): void {
        const bpBody = body as
            | {
                  reason?: string;
                  breakpoint?: {
                      id?: number;
                      verified?: boolean;
                      line?: number;
                  };
              }
            | undefined;

        this.sendEvent('breakpoint', {
            reason: bpBody?.reason ?? 'changed',
            breakpoint: bpBody?.breakpoint
        });
    }

    private handleRequest(command: string, seq: number, args: unknown): void {
        switch (command) {
            case 'initialize':
                this.handleInitialize(seq, args as InitializeRequestArguments);
                break;
            case 'launch':
                void this.handleLaunch(seq, args as FlintLaunchRequestArguments);
                break;
            case 'disconnect':
                this.handleDisconnect(seq);
                break;
            case 'setBreakpoints':
                void this.handleSetBreakpoints(seq, args as SetBreakpointsArguments);
                break;
            case 'setExceptionBreakpoints':
                this.handleSetExceptionBreakpoints(seq);
                break;
            case 'threads':
                this.handleThreads(seq);
                break;
            case 'stackTrace':
                void this.handleStackTrace(seq, args as StackTraceArguments);
                break;
            case 'scopes':
                void this.handleScopes(seq, args as ScopesArguments);
                break;
            case 'variables':
                void this.handleVariables(seq, args as VariablesArguments);
                break;
            case 'continue':
                void this.handleContinue(seq, args as ContinueArguments);
                break;
            case 'next':
                void this.handleNext(seq, args as StepArguments);
                break;
            case 'stepIn':
                void this.handleStepIn(seq, args as StepArguments);
                break;
            case 'stepOut':
                void this.handleStepOut(seq, args as StepArguments);
                break;
            case 'pause':
                void this.handlePause(seq, args as PauseArguments);
                break;
            case 'evaluate':
                void this.handleEvaluate(seq, args as EvaluateArguments);
                break;
            case 'configurationDone':
                void this.handleConfigurationDone(seq);
                break;
            case 'terminate':
                this.handleTerminate(seq);
                break;
            case 'source':
                this.handleSource(seq, args as SourceArguments);
                break;
            default:
                this.sendErrorResponse(seq, command, `Unknown command: ${command}`);
        }
    }

    private handleInitialize(seq: number, _args: InitializeRequestArguments): void {
        // Send capabilities
        const capabilities: Capabilities = {
            supportsConfigurationDoneRequest: true,
            supportsFunctionBreakpoints: false,
            supportsConditionalBreakpoints: true,
            supportsHitConditionalBreakpoints: true,
            supportsEvaluateForHovers: true,
            supportsStepBack: false,
            supportsSetVariable: false,
            supportsRestartFrame: false,
            supportsGotoTargetsRequest: false,
            supportsStepInTargetsRequest: false,
            supportsCompletionsRequest: false,
            supportsModulesRequest: false,
            supportsExceptionOptions: false,
            supportsValueFormattingOptions: false,
            supportsExceptionInfoRequest: false,
            supportTerminateDebuggee: true,
            supportsDelayedStackTraceLoading: false,
            supportsLoadedSourcesRequest: false,
            supportsLogPoints: false,
            supportsTerminateThreadsRequest: false,
            supportsSetExpression: false,
            supportsTerminateRequest: true,
            supportsDataBreakpoints: false,
            supportsReadMemoryRequest: false,
            supportsDisassembleRequest: false,
            supportsCancelRequest: false,
            supportsBreakpointLocationsRequest: false
        };

        this.sendResponse(seq, 'initialize', capabilities);

        // Send initialized event
        this.sendEvent('initialized');
    }

    private async handleLaunch(seq: number, args: FlintLaunchRequestArguments): Promise<void> {
        // Store the launch program path for post-debug navigation (not for console debug)
        this.launchProgramPath = args.isConsoleDebug ? null : args.program;

        // Store console code for source requests
        this.consoleCode = args.isConsoleDebug && args.consoleCode ? args.consoleCode : null;

        // Create a promise that configurationDone can wait for
        this.launchCompletePromise = new Promise<void>(resolve => {
            this.launchCompleteResolve = resolve;
        });

        // Check connection
        if (!this.connectionManager || this.bridgeService?.getConnectionState() !== ConnectionState.CONNECTED) {
            this.sendErrorResponse(seq, 'launch', 'Not connected to Designer. Please connect first.');
            this.sendEvent('terminated');
            this.launchCompleteResolve?.();
            return;
        }

        try {
            // Validate Perspective scope requirements
            if (args.scope === 'perspective' && !args.perspectiveSessionId) {
                this.sendErrorResponse(seq, 'launch', 'Perspective session ID is required for perspective scope');
                this.sendEvent('terminated');
                this.launchCompleteResolve?.();
                return;
            }

            // Prepare source code and paths
            const source = await this.prepareDebugSource(args);

            // Build debug session parameters
            const debugParams = this.buildDebugParams(source, args);

            // Start debug session on Designer (or Gateway for perspective scope)
            const result = await this.connectionManager.sendRequest<{
                success: boolean;
                sessionId?: string;
                error?: string;
            }>('debug.startSession', debugParams);

            if (!result.success || !result.sessionId) {
                this.sendErrorResponse(seq, 'launch', result.error ?? 'Failed to start debug session');
                this.sendEvent('terminated');
                return;
            }

            this.sessionId = result.sessionId;

            // Signal that launch is complete - configurationDone can now proceed
            this.launchCompleteResolve?.();

            // Send launch response
            this.sendResponse(seq, 'launch');

            // If stopOnEntry, send stopped event
            if (args.stopOnEntry) {
                this.sendEvent('stopped', { reason: 'entry', threadId: FlintDebugAdapter.THREAD_ID });
            }
        } catch (error) {
            this.sendErrorResponse(
                seq,
                'launch',
                `Launch failed: ${error instanceof Error ? error.message : String(error)}`
            );
            this.sendEvent('terminated');
            this.launchCompleteResolve?.();
        }
    }

    /**
     * Prepares the debug source code and paths from launch arguments
     */
    private async prepareDebugSource(
        args: FlintLaunchRequestArguments
    ): Promise<{ code: string; filePath: string; modulePath: string }> {
        if (args.isConsoleDebug && args.consoleCode) {
            // Console debug mode - use code directly
            return {
                code: args.consoleCode,
                filePath: '<script-console>',
                modulePath: '<script-console>'
            };
        }

        // File debug mode - read from file
        const fileUri = vscode.Uri.file(args.program);
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        return {
            code: Buffer.from(fileContent).toString('utf8'),
            modulePath: SourcePathMapper.filePathToModulePath(args.program) ?? args.program,
            filePath: SourcePathMapper.getDebugFilename(args.program)
        };
    }

    /**
     * Builds debug session parameters including Perspective context if needed
     */
    private buildDebugParams(
        source: { code: string; filePath: string; modulePath: string },
        args: FlintLaunchRequestArguments
    ): Record<string, unknown> {
        const debugParams: Record<string, unknown> = {
            code: source.code,
            filePath: source.filePath,
            modulePath: source.modulePath,
            scope: args.scope ?? 'designer'
        };

        // Add Perspective context if scope is 'perspective'
        if (args.scope === 'perspective' && args.perspectiveSessionId) {
            debugParams.perspectiveSessionId = args.perspectiveSessionId;
            debugParams.perspectivePageId = args.perspectivePageId;
            debugParams.perspectiveViewInstanceId = args.perspectiveViewInstanceId;
            debugParams.perspectiveComponentPath = args.perspectiveComponentPath;
        }

        return debugParams;
    }

    private handleDisconnect(seq: number): void {
        this.stopSession();
        this.sendResponse(seq, 'disconnect');
    }

    private handleTerminate(seq: number): void {
        this.stopSession();
        this.sendResponse(seq, 'terminate');
        this.sendEvent('terminated');
    }

    private async handleSetBreakpoints(seq: number, args: SetBreakpointsArguments): Promise<void> {
        const source = args.source;
        let filePath = source.path ?? '';
        const clientBreakpoints = args.breakpoints ?? [];

        // Handle flint-console: URI scheme for Script Console debugging
        const isConsoleBreakpoint = filePath.startsWith(`${CONSOLE_DOCUMENT_SCHEME}:`);
        if (isConsoleBreakpoint) {
            filePath = CONSOLE_DEBUG_FILENAME;
        }

        if (!this.sessionId || !this.connectionManager) {
            // Not in debug session, store breakpoints for later and acknowledge
            const breakpoints = clientBreakpoints.map((bp: SourceBreakpoint, i: number) => ({
                id: i + 1,
                verified: false,
                line: bp.line,
                condition: bp.condition,
                hitCount: bp.hitCondition ? parseInt(bp.hitCondition, 10) : undefined,
                message: 'Breakpoint will be set when debug session starts'
            }));
            this.breakpoints.set(filePath, breakpoints);
            this.sendResponse(seq, 'setBreakpoints', { breakpoints });
            return;
        }

        try {
            // Send breakpoints to Designer
            const bpParams = clientBreakpoints.map((bp: SourceBreakpoint) => ({
                line: bp.line,
                condition: bp.condition,
                hitCount: bp.hitCondition ? parseInt(bp.hitCondition, 10) : undefined
            }));

            // Use console debug filename or get debug filename for regular files
            const debugFilePath = isConsoleBreakpoint
                ? CONSOLE_DEBUG_FILENAME
                : SourcePathMapper.getDebugFilename(filePath);

            const result = await this.connectionManager.sendRequest<{
                breakpoints: Array<{
                    id: number;
                    verified: boolean;
                    line: number;
                    message?: string;
                }>;
            }>('debug.setBreakpoints', {
                sessionId: this.sessionId,
                filePath: debugFilePath,
                breakpoints: bpParams
            });

            const breakpoints = result.breakpoints.map(bp => ({
                id: bp.id,
                verified: bp.verified,
                line: bp.line,
                message: bp.message
            }));

            this.breakpoints.set(filePath, breakpoints);
            this.sendResponse(seq, 'setBreakpoints', { breakpoints });
        } catch (error) {
            // On error, mark breakpoints as unverified
            const breakpoints = clientBreakpoints.map((bp: SourceBreakpoint, i: number) => ({
                id: i + 1,
                verified: false,
                line: bp.line,
                message: `Error: ${error instanceof Error ? error.message : String(error)}`
            }));
            this.sendResponse(seq, 'setBreakpoints', { breakpoints });
        }
    }

    private handleSetExceptionBreakpoints(seq: number): void {
        // Exception breakpoints not yet supported
        this.sendResponse(seq, 'setExceptionBreakpoints');
    }

    private handleThreads(seq: number): void {
        // Single-threaded Python debugging
        this.sendResponse(seq, 'threads', {
            threads: [{ id: FlintDebugAdapter.THREAD_ID, name: 'MainThread' }]
        });
    }

    private async handleStackTrace(seq: number, args: StackTraceArguments): Promise<void> {
        if (!this.sessionId || !this.connectionManager) {
            this.sendResponse(seq, 'stackTrace', { stackFrames: [], totalFrames: 0 });
            return;
        }

        try {
            const result = await this.connectionManager.sendRequest<{
                stackFrames: FlintStackFrame[];
                totalFrames: number;
            }>('debug.getStackTrace', {
                sessionId: this.sessionId,
                threadId: args.threadId,
                startFrame: args.startFrame,
                levels: args.levels
            });

            const stackFrames: DAP_StackFrame[] = result.stackFrames.map(frame => ({
                id: frame.id,
                name: frame.name,
                source: {
                    name: frame.filePath.split('/').pop() ?? frame.name,
                    path: frame.filePath
                },
                line: frame.line,
                column: frame.column
            }));

            this.sendResponse(seq, 'stackTrace', {
                stackFrames,
                totalFrames: result.totalFrames
            });
        } catch {
            this.sendResponse(seq, 'stackTrace', { stackFrames: [], totalFrames: 0 });
        }
    }

    private async handleScopes(seq: number, args: ScopesArguments): Promise<void> {
        if (!this.sessionId || !this.connectionManager) {
            this.sendResponse(seq, 'scopes', { scopes: [] });
            return;
        }

        try {
            const result = await this.connectionManager.sendRequest<{
                scopes: Array<{
                    name: string;
                    variablesReference: number;
                    expensive: boolean;
                }>;
            }>('debug.getScopes', {
                sessionId: this.sessionId,
                frameId: args.frameId
            });

            const scopes: DAP_Scope[] = result.scopes.map(scope => ({
                name: scope.name,
                variablesReference: scope.variablesReference,
                expensive: scope.expensive
            }));

            this.sendResponse(seq, 'scopes', { scopes });
        } catch {
            this.sendResponse(seq, 'scopes', { scopes: [] });
        }
    }

    private async handleVariables(seq: number, args: VariablesArguments): Promise<void> {
        if (!this.sessionId || !this.connectionManager) {
            this.sendResponse(seq, 'variables', { variables: [] });
            return;
        }

        try {
            const result = await this.connectionManager.sendRequest<{
                variables: FlintVariable[];
            }>('debug.getVariables', {
                sessionId: this.sessionId,
                variablesReference: args.variablesReference,
                start: args.start,
                count: args.count
            });

            const variables: DAP_Variable[] = result.variables.map(v => ({
                name: v.name,
                value: v.value,
                type: v.type,
                variablesReference: v.variablesReference,
                namedVariables: v.namedVariables,
                indexedVariables: v.indexedVariables
            }));

            this.sendResponse(seq, 'variables', { variables });
        } catch {
            this.sendResponse(seq, 'variables', { variables: [] });
        }
    }

    private async handleContinue(seq: number, _args: ContinueArguments): Promise<void> {
        await this.sendDebugCommand(seq, 'continue', 'debug.continue');
    }

    private async handleNext(seq: number, _args: StepArguments): Promise<void> {
        await this.sendDebugCommand(seq, 'next', 'debug.stepOver');
    }

    private async handleStepIn(seq: number, _args: StepArguments): Promise<void> {
        await this.sendDebugCommand(seq, 'stepIn', 'debug.stepInto');
    }

    private async handleStepOut(seq: number, _args: StepArguments): Promise<void> {
        await this.sendDebugCommand(seq, 'stepOut', 'debug.stepOut');
    }

    private async handlePause(seq: number, _args: PauseArguments): Promise<void> {
        await this.sendDebugCommand(seq, 'pause', 'debug.pause');
    }

    private async sendDebugCommand(seq: number, responseCommand: string, method: string): Promise<void> {
        if (!this.sessionId || !this.connectionManager) {
            this.sendErrorResponse(seq, responseCommand, 'No active debug session');
            return;
        }

        try {
            await this.connectionManager.sendRequest(method, {
                sessionId: this.sessionId,
                threadId: FlintDebugAdapter.THREAD_ID
            });
            this.sendResponse(seq, responseCommand);
        } catch (error) {
            this.sendErrorResponse(
                seq,
                responseCommand,
                `Command failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private async handleEvaluate(seq: number, args: EvaluateArguments): Promise<void> {
        if (!this.sessionId || !this.connectionManager) {
            this.sendErrorResponse(seq, 'evaluate', 'No active debug session');
            return;
        }

        try {
            const result = await this.connectionManager.sendRequest<{
                result: string;
                type: string;
                variablesReference: number;
                namedVariables?: number;
                indexedVariables?: number;
            }>('debug.evaluate', {
                sessionId: this.sessionId,
                expression: args.expression,
                frameId: args.frameId,
                context: args.context
            });

            this.sendResponse(seq, 'evaluate', {
                result: result.result,
                type: result.type,
                variablesReference: result.variablesReference,
                namedVariables: result.namedVariables,
                indexedVariables: result.indexedVariables
            });
        } catch (error) {
            this.sendErrorResponse(
                seq,
                'evaluate',
                `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Handle DAP 'source' request - returns source code for a given source reference
     * This is called by VS Code when it needs to display source that doesn't have a local file
     */
    private handleSource(seq: number, args: SourceArguments): void {
        const sourcePath = args.source?.path ?? args.source?.name;

        // Check if this is a request for console debug source
        if (sourcePath === CONSOLE_DEBUG_FILENAME || sourcePath === '<script-console>') {
            if (this.consoleCode) {
                this.sendResponse(seq, 'source', {
                    content: this.consoleCode,
                    mimeType: 'text/x-python'
                });
                return;
            }
        }

        this.sendErrorResponse(seq, 'source', `Source not available: ${sourcePath ?? 'unknown'}`);
    }

    private async handleConfigurationDone(seq: number): Promise<void> {
        // Wait for launch to complete (session ID to be available)
        if (this.launchCompletePromise) {
            await this.launchCompletePromise;
        }

        // Now that we have a session, send any stored breakpoints to the Designer
        if (this.sessionId && this.connectionManager) {
            await this.sendStoredBreakpointsToDesigner();

            try {
                await this.connectionManager.sendRequest('debug.run', {
                    sessionId: this.sessionId
                });
            } catch (error) {
                this.sendErrorResponse(
                    seq,
                    'configurationDone',
                    `Failed to start debug session: ${error instanceof Error ? error.message : String(error)}`
                );
                return;
            }
        }
        this.sendResponse(seq, 'configurationDone');
    }

    /**
     * Send all stored breakpoints to the Designer.
     * Called after session is created but before execution starts.
     */
    private async sendStoredBreakpointsToDesigner(): Promise<void> {
        if (!this.sessionId || !this.connectionManager) {
            return;
        }

        for (const [filePath, bps] of this.breakpoints) {
            if (bps.length === 0) continue;

            try {
                const bpParams = bps.map(bp => ({
                    line: bp.line,
                    condition: bp.condition
                }));

                const debugFilePath = SourcePathMapper.getDebugFilename(filePath);

                const result = await this.connectionManager.sendRequest<{
                    breakpoints: Array<{
                        id: number;
                        verified: boolean;
                        line: number;
                        message?: string;
                    }>;
                }>('debug.setBreakpoints', {
                    sessionId: this.sessionId,
                    filePath: debugFilePath,
                    breakpoints: bpParams
                });

                // Update local breakpoint state with verified info
                for (let i = 0; i < result.breakpoints.length && i < bps.length; i++) {
                    bps[i].verified = result.breakpoints[i].verified;
                    bps[i].id = result.breakpoints[i].id;
                }
            } catch {
                // Breakpoint setting failed - breakpoints will remain unverified
            }
        }
    }

    private stopSession(): void {
        if (this.sessionId && this.connectionManager) {
            void this.connectionManager.sendRequest('debug.stopSession', { sessionId: this.sessionId }).catch(() => {
                // Ignore errors when stopping
            });
        }
        this.sessionId = null;
        this.launchProgramPath = null;
        this.consoleCode = null;
        this.breakpoints.clear();
    }

    private sendResponse(seq: number, command: string, body?: unknown): void {
        const response: DebugProtocolResponse = {
            seq: this.sequence++,
            type: 'response',
            request_seq: seq,
            command,
            success: true,
            body
        };
        this._onDidSendMessage.fire(response as vscode.DebugProtocolMessage);
    }

    private sendErrorResponse(seq: number, command: string, message: string): void {
        const response: DebugProtocolResponse = {
            seq: this.sequence++,
            type: 'response',
            request_seq: seq,
            command,
            success: false,
            message
        };
        this._onDidSendMessage.fire(response as vscode.DebugProtocolMessage);
    }

    private sendEvent(event: string, body?: unknown): void {
        const eventMessage: DebugProtocolEvent = {
            seq: this.sequence++,
            type: 'event',
            event,
            body
        };
        this._onDidSendMessage.fire(eventMessage as vscode.DebugProtocolMessage);
    }
}
