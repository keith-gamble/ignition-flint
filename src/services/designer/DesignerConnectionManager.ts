/**
 * @module DesignerConnectionManager
 * @description Manages WebSocket connections to Designer instances
 */

import type WebSocket from 'ws';

import type { DesignerInstance } from './DesignerDiscoveryService';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

// WebSocket class type for dynamic import
type WebSocketConstructor = new (url: string) => WebSocket;

/**
 * JSON-RPC request structure
 */
interface JsonRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
    id: number | string;
}

/**
 * JSON-RPC response structure
 */
interface JsonRpcResponse {
    jsonrpc: '2.0';
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
    id: number | string | null;
}

/**
 * JSON-RPC notification structure (no id field)
 */
interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
}

/**
 * Debug event data
 */
export interface DebugEventData {
    event: string;
    body?: unknown;
}

/**
 * LSP cache invalidation event data
 */
export interface LspCacheInvalidationData {
    reason: string;
    count: number;
}

/**
 * Connection state
 */
export enum ConnectionState {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    AUTHENTICATING = 'authenticating',
    CONNECTED = 'connected',
    ERROR = 'error'
}

/**
 * Pending request tracking
 */
interface PendingRequest {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

/**
 * Options for executing a script
 */
export interface ExecuteScriptOptions {
    /** The Python code to execute */
    code: string;
    /** Optional timeout in milliseconds */
    timeoutMs?: number;
    /** Optional session ID for variable persistence */
    sessionId?: string;
    /** If true, clears the session before execution */
    resetSession?: boolean;
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
}

/**
 * Options for project scan
 */
export interface ProjectScanOptions {
    /** Whether to scan on the Gateway (default: true) */
    scanGateway?: boolean;
    /** Whether to refresh the Designer view (default: true) */
    refreshDesigner?: boolean;
}

/**
 * Result of a project scan operation
 */
export interface ProjectScanResult {
    /** Overall success status */
    success: boolean;
    /** Whether the Gateway scan succeeded */
    gatewayScanSuccess: boolean;
    /** Whether the Designer refresh succeeded */
    designerRefreshSuccess: boolean;
    /** Timestamp of the scan */
    timestamp: number;
}

/**
 * Manages a WebSocket connection to a Designer instance
 */
export class DesignerConnectionManager implements IServiceLifecycle {
    private static readonly REQUEST_TIMEOUT_MS = 30000;
    private static readonly RECONNECT_DELAY_MS = 3000;

    private status: ServiceStatus = ServiceStatus.NOT_INITIALIZED;
    private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
    private ws: WebSocket | null = null;
    private connectedDesigner: DesignerInstance | null = null;
    private requestIdCounter = 0;
    private pendingRequests: Map<number | string, PendingRequest> = new Map();
    private reconnectTimeout?: NodeJS.Timeout;
    private WebSocketClass: WebSocketConstructor | null = null;

    private onConnectionStateChangedCallbacks: Array<
        (state: ConnectionState, designer: DesignerInstance | null) => void
    > = [];

    private onDebugEventCallbacks: Array<(event: DebugEventData) => void> = [];

    private onLspCacheInvalidationCallbacks: Array<(data: LspCacheInvalidationData) => void> = [];

    constructor(private readonly _serviceContainer: ServiceContainer) {}

    /**
     * Registers a callback for debug events from the Designer
     */
    onDebugEvent(callback: (event: DebugEventData) => void): void {
        this.onDebugEventCallbacks.push(callback);
    }

    /**
     * Removes a debug event callback
     */
    offDebugEvent(callback: (event: DebugEventData) => void): void {
        const index = this.onDebugEventCallbacks.indexOf(callback);
        if (index >= 0) {
            this.onDebugEventCallbacks.splice(index, 1);
        }
    }

    /**
     * Registers a callback for LSP cache invalidation events from the Designer
     */
    onLspCacheInvalidation(callback: (data: LspCacheInvalidationData) => void): void {
        this.onLspCacheInvalidationCallbacks.push(callback);
    }

    /**
     * Removes an LSP cache invalidation callback
     */
    offLspCacheInvalidation(callback: (data: LspCacheInvalidationData) => void): void {
        const index = this.onLspCacheInvalidationCallbacks.indexOf(callback);
        if (index >= 0) {
            this.onLspCacheInvalidationCallbacks.splice(index, 1);
        }
    }

    async initialize(): Promise<void> {
        this.status = ServiceStatus.INITIALIZING;
        try {
            // Dynamically import ws module
            const wsModule = await import('ws');
            this.WebSocketClass = wsModule.default;
            this.status = ServiceStatus.INITIALIZED;
        } catch (error) {
            this.status = ServiceStatus.FAILED;
            throw new FlintError(
                'Failed to initialize designer connection manager',
                'DESIGNER_CONNECTION_INIT_FAILED',
                'WebSocket module not available',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (this.status !== ServiceStatus.INITIALIZED && this.status !== ServiceStatus.STOPPED) {
            await this.initialize();
        }
        this.status = ServiceStatus.RUNNING;
    }

    async stop(): Promise<void> {
        this.status = ServiceStatus.STOPPING;
        await this.disconnect();
        this.status = ServiceStatus.STOPPED;
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.pendingRequests.clear();
        this.onConnectionStateChangedCallbacks = [];
        this.onDebugEventCallbacks = [];
        this.onLspCacheInvalidationCallbacks = [];
    }

    getStatus(): ServiceStatus {
        return this.status;
    }

    /**
     * Gets the current connection state
     */
    getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    /**
     * Gets the currently connected Designer instance
     */
    getConnectedDesigner(): DesignerInstance | null {
        return this.connectedDesigner;
    }

    /**
     * Registers a callback for connection state changes
     */
    onConnectionStateChanged(callback: (state: ConnectionState, designer: DesignerInstance | null) => void): void {
        this.onConnectionStateChangedCallbacks.push(callback);
    }

    /**
     * Connects to a Designer instance
     */
    async connect(designer: DesignerInstance): Promise<void> {
        if (!this.WebSocketClass) {
            throw new FlintError(
                'WebSocket not initialized',
                'WEBSOCKET_NOT_INITIALIZED',
                'Call initialize() before connect()'
            );
        }

        // Disconnect from current designer if connected
        if (this.ws) {
            await this.disconnect();
        }

        this.setConnectionState(ConnectionState.CONNECTING, designer);

        const WS = this.WebSocketClass;

        return new Promise((resolve, reject) => {
            try {
                const url = `ws://127.0.0.1:${designer.port}`;
                this.ws = new WS(url);

                this.ws.on('open', () => {
                    this.connectedDesigner = designer;
                    this.setConnectionState(ConnectionState.AUTHENTICATING, designer);

                    // Authenticate
                    void this.authenticate(designer.secret)
                        .then(() => {
                            this.setConnectionState(ConnectionState.CONNECTED, designer);
                            resolve();
                        })
                        .catch((error: unknown) => {
                            this.setConnectionState(ConnectionState.ERROR, designer);
                            reject(error instanceof Error ? error : new Error(String(error)));
                        });
                });

                this.ws.on('message', (data: Buffer | string) => {
                    this.handleMessage(data.toString());
                });

                this.ws.on('close', () => {
                    this.handleClose();
                });

                this.ws.on('error', (error: Error) => {
                    this.setConnectionState(ConnectionState.ERROR, designer);
                    reject(
                        new FlintError(
                            'WebSocket connection failed',
                            'WEBSOCKET_CONNECTION_FAILED',
                            error.message,
                            error
                        )
                    );
                });
            } catch (error: unknown) {
                this.setConnectionState(ConnectionState.ERROR, designer);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    /**
     * Disconnects from the current Designer
     */
    disconnect(): Promise<void> {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = undefined;
        }

        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Connection closed'));
            this.pendingRequests.delete(id);
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.connectedDesigner = null;
        this.setConnectionState(ConnectionState.DISCONNECTED, null);

        return Promise.resolve();
    }

    /**
     * Sends a JSON-RPC request and waits for a response
     */
    async sendRequest<T>(method: string, params?: unknown): Promise<T> {
        if (this.connectionState !== ConnectionState.CONNECTED && method !== 'authenticate') {
            throw new FlintError('Not connected to Designer', 'NOT_CONNECTED', 'Connect to a Designer first');
        }

        if (!this.ws) {
            throw new FlintError('WebSocket not available', 'WEBSOCKET_NOT_AVAILABLE', 'Connection lost');
        }

        const id = ++this.requestIdCounter;
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            method,
            params,
            id
        };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new FlintError('Request timed out', 'REQUEST_TIMEOUT', `Method: ${method}`));
            }, DesignerConnectionManager.REQUEST_TIMEOUT_MS);

            this.pendingRequests.set(id, {
                resolve: resolve as (result: unknown) => void,
                reject,
                timeout
            });

            this.ws!.send(JSON.stringify(request));
        });
    }

    /**
     * Executes a Python script in the Designer, Gateway, or Perspective scope
     * @param options Execution options including code, timeout, session, scope, etc.
     */
    async executeScript(options: ExecuteScriptOptions): Promise<{
        success: boolean;
        stdout: string;
        stderr: string;
        error?: string;
        executionTimeMs: number;
    }> {
        return this.sendRequest('executeScript', {
            code: options.code,
            timeoutMs: options.timeoutMs,
            sessionId: options.sessionId,
            resetSession: options.resetSession,
            scope: options.scope,
            perspectiveSessionId: options.perspectiveSessionId,
            perspectivePageId: options.perspectivePageId,
            perspectiveViewInstanceId: options.perspectiveViewInstanceId,
            perspectiveComponentPath: options.perspectiveComponentPath
        });
    }

    // ==================== Perspective Session Discovery Methods ====================

    /**
     * Lists all active Perspective sessions on the Gateway
     */
    async perspectiveListSessions(): Promise<{
        sessions: Array<{
            sessionId: string;
            userName: string;
            projectName: string;
            pageCount: number;
            viewCount: number;
            startTime: number;
            userAgent: string;
            sessionType?: string;
            displayName?: string;
        }>;
    }> {
        return this.sendRequest('perspective.listSessions');
    }

    /**
     * Gets the pages within a specific Perspective session
     */
    async perspectiveGetSessionPages(sessionId: string): Promise<{
        pages: Array<{
            pageId: string;
            primaryViewPath: string;
            viewCount: number;
        }>;
    }> {
        return this.sendRequest('perspective.getSessionPages', { sessionId });
    }

    /**
     * Gets the views on a specific page within a Perspective session
     */
    async perspectiveGetPageViews(
        sessionId: string,
        pageId: string
    ): Promise<{
        views: Array<{
            viewInstanceId: string;
            viewPath: string;
            componentCount: number;
            rootComponentType: string;
        }>;
    }> {
        return this.sendRequest('perspective.getPageViews', { sessionId, pageId });
    }

    /**
     * Gets the component tree for a specific view within a Perspective session
     */
    async perspectiveGetViewComponents(
        sessionId: string,
        pageId: string,
        viewInstanceId: string
    ): Promise<{
        components: Array<{
            path: string;
            type: string;
            name: string;
            hasScripts: boolean;
            children: unknown[];
        }>;
    }> {
        return this.sendRequest('perspective.getViewComponents', { sessionId, pageId, viewInstanceId });
    }

    /**
     * Checks if Perspective is available on the Gateway
     */
    async isPerspectiveAvailable(): Promise<boolean> {
        try {
            const result = await this.sendRequest<{ available: boolean }>('perspective.isAvailable');
            return result.available;
        } catch {
            return false;
        }
    }

    /**
     * Gets completion items for a Perspective component's properties
     */
    async perspectiveGetComponentCompletions(
        sessionId: string,
        pageId: string,
        viewInstanceId: string,
        componentPath: string,
        prefix: string
    ): Promise<{
        items: Array<{
            label: string;
            kind: number;
            detail?: string;
            documentation?: string;
            insertText?: string;
            insertTextFormat?: number;
            sortText?: string;
            filterText?: string;
            path?: string;
        }>;
        isIncomplete: boolean;
    }> {
        return this.sendRequest('perspective.getComponentCompletions', {
            sessionId,
            pageId,
            viewInstanceId,
            componentPath,
            prefix
        });
    }

    /**
     * Pings the Designer to check connection
     */
    async ping(): Promise<{
        status: string;
        timestamp: number;
        projectName: string;
        authenticated: boolean;
    }> {
        return this.sendRequest('ping');
    }

    /**
     * Shows a message dialog in the Designer
     */
    async showMessage(message: string, title?: string): Promise<void> {
        return this.sendRequest('showMessage', { message, title });
    }

    /**
     * Requests a project scan on the Gateway and refreshes the Designer view
     * @param options Scan options (scanGateway, refreshDesigner)
     * @returns Result of the scan operation
     */
    async scanProject(options: ProjectScanOptions = {}): Promise<ProjectScanResult> {
        return this.sendRequest<ProjectScanResult>('project.scan', {
            scanGateway: options.scanGateway ?? true,
            refreshDesigner: options.refreshDesigner ?? true
        });
    }

    /**
     * Authenticates with the Designer
     */
    private async authenticate(secret: string): Promise<void> {
        const result = await this.sendRequest<{
            success: boolean;
            designerVersion: string;
            moduleVersion: string;
            projectName: string;
            gatewayName: string;
        }>('authenticate', {
            secret,
            clientName: 'Flint VS Code Extension',
            clientVersion: '1.0.0'
        });

        if (!result.success) {
            throw new FlintError('Authentication failed', 'AUTH_FAILED', 'Invalid secret');
        }
    }

    /**
     * Handles incoming WebSocket messages
     */
    private handleMessage(data: string): void {
        try {
            const message = JSON.parse(data);

            // Check if this is a notification (has method, no id)
            if (message.method && (message.id === undefined || message.id === null)) {
                this.handleNotification(message as JsonRpcNotification);
                return;
            }

            // Handle as response
            const response = message as JsonRpcResponse;
            if (response.id !== null && response.id !== undefined) {
                const pending = this.pendingRequests.get(response.id);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this.pendingRequests.delete(response.id);

                    if (response.error) {
                        pending.reject(
                            new FlintError(
                                response.error.message,
                                `JSONRPC_ERROR_${response.error.code}`,
                                response.error.message
                            )
                        );
                    } else {
                        pending.resolve(response.result);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
        }
    }

    /**
     * Handles JSON-RPC notifications from Designer
     */
    private handleNotification(notification: JsonRpcNotification): void {
        // Handle debug events
        if (notification.method.startsWith('debug.event.')) {
            const eventType = notification.method.substring('debug.event.'.length);
            const eventData: DebugEventData = {
                event: eventType,
                body: notification.params
            };

            // Emit to all listeners
            for (const callback of this.onDebugEventCallbacks) {
                try {
                    callback(eventData);
                } catch (error) {
                    console.error('Error in debug event callback:', error);
                }
            }
        }

        // Handle LSP cache invalidation notifications
        if (notification.method === 'lsp.cacheInvalidated') {
            const params = notification.params as LspCacheInvalidationData | undefined;
            const data: LspCacheInvalidationData = {
                reason: params?.reason ?? 'unknown',
                count: params?.count ?? 0
            };

            console.log(`[DesignerConnectionManager] LSP cache invalidation: ${data.count} ${data.reason}`);

            // Emit to all listeners
            for (const callback of this.onLspCacheInvalidationCallbacks) {
                try {
                    callback(data);
                } catch (error) {
                    console.error('Error in LSP cache invalidation callback:', error);
                }
            }
        }
    }

    /**
     * Handles WebSocket close event
     */
    private handleClose(): void {
        const wasConnected = this.connectionState === ConnectionState.CONNECTED;
        this.setConnectionState(ConnectionState.DISCONNECTED, null);

        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Connection closed'));
            this.pendingRequests.delete(id);
        }

        // Attempt reconnect if we were connected
        if (wasConnected && this.connectedDesigner) {
            const designer = this.connectedDesigner;
            this.reconnectTimeout = setTimeout(() => {
                void this.connect(designer).catch(error => {
                    console.error('Reconnect failed:', error);
                });
            }, DesignerConnectionManager.RECONNECT_DELAY_MS);
        }

        this.ws = null;
        this.connectedDesigner = null;
    }

    /**
     * Sets the connection state and notifies listeners
     */
    private setConnectionState(state: ConnectionState, designer: DesignerInstance | null): void {
        this.connectionState = state;

        for (const callback of this.onConnectionStateChangedCallbacks) {
            try {
                callback(state, designer);
            } catch (error) {
                console.error('Error in connection state callback:', error);
            }
        }
    }
}
