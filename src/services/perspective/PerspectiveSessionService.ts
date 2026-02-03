/**
 * @module PerspectiveSessionService
 * @description Service for managing Perspective session data and tree nodes
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import type {
    PerspectiveSessionInfo,
    PerspectivePageInfo,
    PerspectiveViewInfo,
    PerspectiveComponentInfo,
    PerspectiveScriptContext,
    PerspectiveNodeMetadata
} from '@/core/types/perspective';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { TreeNode, TreeNodeType, TreeItemCollapsibleState } from '@/core/types/tree';

/**
 * Service for fetching and managing Perspective session data
 */
export class PerspectiveSessionService implements IServiceLifecycle {
    private status: ServiceStatus = ServiceStatus.NOT_INITIALIZED;
    private isPerspectiveAvailable = false;

    // Cache for session data
    private sessionCache: Map<string, PerspectiveSessionInfo> = new Map();
    private pageCache: Map<string, PerspectivePageInfo[]> = new Map();
    private viewCache: Map<string, PerspectiveViewInfo[]> = new Map();
    private componentCache: Map<string, PerspectiveComponentInfo[]> = new Map();

    // Event emitters
    private readonly sessionChangedEmitter = new vscode.EventEmitter<void>();
    public readonly onSessionsChanged = this.sessionChangedEmitter.event;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    async initialize(): Promise<void> {
        this.status = ServiceStatus.INITIALIZING;
        try {
            // Check if Perspective is available
            await this.checkPerspectiveAvailability();
            this.status = ServiceStatus.INITIALIZED;
        } catch (error) {
            this.status = ServiceStatus.FAILED;
            throw new FlintError(
                'Failed to initialize Perspective session service',
                'PERSPECTIVE_SERVICE_INIT_FAILED',
                'Could not check Perspective availability',
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

    stop(): Promise<void> {
        this.status = ServiceStatus.STOPPING;
        this.clearCache();
        this.status = ServiceStatus.STOPPED;
        return Promise.resolve();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.sessionChangedEmitter.dispose();
    }

    getStatus(): ServiceStatus {
        return this.status;
    }

    /**
     * Checks if Perspective is available on the connected Gateway
     */
    async checkPerspectiveAvailability(): Promise<boolean> {
        try {
            const bridgeService = this.serviceContainer.get<any>('DesignerBridgeService');
            if (!bridgeService) {
                this.isPerspectiveAvailable = false;
                return false;
            }

            const connectionManager = bridgeService.getConnectionManager();
            if (!connectionManager) {
                this.isPerspectiveAvailable = false;
                return false;
            }

            this.isPerspectiveAvailable = await connectionManager.isPerspectiveAvailable();
            return this.isPerspectiveAvailable;
        } catch {
            this.isPerspectiveAvailable = false;
            return false;
        }
    }

    /**
     * Returns whether Perspective is available
     */
    getPerspectiveAvailable(): boolean {
        return this.isPerspectiveAvailable;
    }

    /**
     * Lists all active Perspective sessions
     */
    async listSessions(): Promise<PerspectiveSessionInfo[]> {
        try {
            // Using a more specific type pattern
            const bridgeService = this.serviceContainer.get<{
                getConnectionManager(): {
                    perspectiveListSessions(): Promise<{ sessions: PerspectiveSessionInfo[] }>;
                } | null;
            }>('DesignerBridgeService');
            if (!bridgeService) {
                return [];
            }

            const connectionManager = bridgeService.getConnectionManager();
            if (!connectionManager) {
                return [];
            }

            const result = await connectionManager.perspectiveListSessions();
            const sessions = result.sessions || [];

            // Update cache
            this.sessionCache.clear();
            for (const session of sessions) {
                this.sessionCache.set(session.sessionId, session);
            }

            return sessions;
        } catch (error) {
            console.error('Failed to list Perspective sessions:', error);
            return [];
        }
    }

    /**
     * Gets pages for a specific session
     */
    async getSessionPages(sessionId: string): Promise<PerspectivePageInfo[]> {
        // Check cache first
        const cached = this.pageCache.get(sessionId);
        if (cached) {
            return cached;
        }

        try {
            const bridgeService = this.serviceContainer.get<{
                getConnectionManager(): {
                    perspectiveGetSessionPages(sessionId: string): Promise<{ pages: PerspectivePageInfo[] }>;
                } | null;
            }>('DesignerBridgeService');
            if (!bridgeService) {
                return [];
            }

            const connectionManager = bridgeService.getConnectionManager();
            if (!connectionManager) {
                return [];
            }

            const result = await connectionManager.perspectiveGetSessionPages(sessionId);
            const pages = result.pages || [];

            // Update cache
            this.pageCache.set(sessionId, pages);

            return pages;
        } catch (error) {
            console.error('Failed to get session pages:', error);
            return [];
        }
    }

    /**
     * Gets views for a specific page
     */
    async getPageViews(sessionId: string, pageId: string): Promise<PerspectiveViewInfo[]> {
        const cacheKey = `${sessionId}::${pageId}`;

        // Check cache first
        const cached = this.viewCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const bridgeService = this.serviceContainer.get<{
                getConnectionManager(): {
                    perspectiveGetPageViews(
                        sessionId: string,
                        pageId: string
                    ): Promise<{ views: PerspectiveViewInfo[] }>;
                } | null;
            }>('DesignerBridgeService');
            if (!bridgeService) {
                return [];
            }

            const connectionManager = bridgeService.getConnectionManager();
            if (!connectionManager) {
                return [];
            }

            const result = await connectionManager.perspectiveGetPageViews(sessionId, pageId);
            const views = result.views || [];

            // Update cache
            this.viewCache.set(cacheKey, views);

            return views;
        } catch (error) {
            console.error('Failed to get page views:', error);
            return [];
        }
    }

    /**
     * Gets components for a specific view
     */
    async getViewComponents(
        sessionId: string,
        pageId: string,
        viewInstanceId: string
    ): Promise<PerspectiveComponentInfo[]> {
        const cacheKey = `${sessionId}::${pageId}::${viewInstanceId}`;

        // Check cache first
        const cached = this.componentCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const bridgeService = this.serviceContainer.get<any>('DesignerBridgeService');
            if (!bridgeService) {
                return [];
            }

            const connectionManager = bridgeService.getConnectionManager();
            if (!connectionManager) {
                return [];
            }

            const result = await connectionManager.perspectiveGetViewComponents(sessionId, pageId, viewInstanceId);
            const components = (result.components || []) as PerspectiveComponentInfo[];

            // Update cache
            this.componentCache.set(cacheKey, components);

            return components;
        } catch (error) {
            console.error('Failed to get view components:', error);
            return [];
        }
    }

    /**
     * Clears all cached data
     */
    clearCache(): void {
        this.sessionCache.clear();
        this.pageCache.clear();
        this.viewCache.clear();
        this.componentCache.clear();
    }

    /**
     * Refreshes session data and notifies listeners
     */
    async refresh(): Promise<void> {
        this.clearCache();
        await this.checkPerspectiveAvailability();
        await this.listSessions();
        this.sessionChangedEmitter.fire();
    }

    // ==================== Tree Node Building Methods ====================

    /**
     * Creates the root "Active Perspective Sessions" node
     */
    createPerspectiveSessionsRootNode(): TreeNode {
        return {
            id: 'perspective-sessions',
            label: 'Active Perspective Sessions',
            type: TreeNodeType.PERSPECTIVE_SESSIONS,
            icon: 'browser',
            collapsibleState: TreeItemCollapsibleState.Collapsed,
            contextValue: 'perspectiveSessions',
            tooltip: 'Active Perspective sessions on the Gateway'
        };
    }

    /**
     * Creates tree nodes for all sessions
     */
    async createSessionNodes(): Promise<TreeNode[]> {
        const sessions = await this.listSessions();
        return sessions.map(session => this.createSessionNode(session));
    }

    /**
     * Creates a tree node for a single session
     */
    createSessionNode(session: PerspectiveSessionInfo): TreeNode {
        const metadata: PerspectiveNodeMetadata = {
            sessionId: session.sessionId,
            userName: session.userName,
            projectName: session.projectName
        };

        return {
            id: `perspective-session::${session.sessionId}`,
            label: `${session.userName}@${session.projectName}`,
            description: session.sessionId.substring(0, 8),
            type: TreeNodeType.PERSPECTIVE_SESSION,
            icon: 'account',
            collapsibleState: TreeItemCollapsibleState.Collapsed,
            contextValue: 'perspectiveSession',
            tooltip: `Session: ${session.sessionId}\nUser: ${session.userName}\nProject: ${session.projectName}\nPages: ${session.pageCount}\nViews: ${session.viewCount}`,
            metadata
        };
    }

    /**
     * Creates tree nodes for pages in a session
     */
    async createPageNodes(sessionId: string): Promise<TreeNode[]> {
        const pages = await this.getSessionPages(sessionId);
        return pages.map(page => this.createPageNode(sessionId, page));
    }

    /**
     * Creates a tree node for a single page
     */
    createPageNode(sessionId: string, page: PerspectivePageInfo): TreeNode {
        const metadata: PerspectiveNodeMetadata = {
            sessionId,
            pageId: page.pageId,
            viewPath: page.primaryViewPath
        };

        return {
            id: `perspective-page::${sessionId}::${page.pageId}`,
            label: `Page: ${page.pageId}`,
            description: page.primaryViewPath,
            type: TreeNodeType.PERSPECTIVE_PAGE,
            icon: 'file',
            collapsibleState: TreeItemCollapsibleState.Collapsed,
            contextValue: 'perspectivePage',
            tooltip: `Page: ${page.pageId}\nPrimary View: ${page.primaryViewPath}\nViews: ${page.viewCount}`,
            metadata
        };
    }

    /**
     * Creates tree nodes for views on a page
     */
    async createViewNodes(sessionId: string, pageId: string): Promise<TreeNode[]> {
        const views = await this.getPageViews(sessionId, pageId);
        return views.map(view => this.createViewNode(sessionId, pageId, view));
    }

    /**
     * Creates a tree node for a single view
     */
    createViewNode(sessionId: string, pageId: string, view: PerspectiveViewInfo): TreeNode {
        const metadata: PerspectiveNodeMetadata = {
            sessionId,
            pageId,
            viewInstanceId: view.viewInstanceId,
            viewPath: view.viewPath
        };

        return {
            id: `perspective-view::${sessionId}::${pageId}::${view.viewInstanceId}`,
            label: view.viewPath,
            description: `[${view.viewInstanceId.substring(0, 8)}]`,
            type: TreeNodeType.PERSPECTIVE_VIEW,
            icon: 'layout',
            collapsibleState: TreeItemCollapsibleState.Collapsed,
            contextValue: 'perspectiveView',
            tooltip: `View: ${view.viewPath}\nInstance: ${view.viewInstanceId}\nComponents: ${view.componentCount}\nRoot Type: ${view.rootComponentType}`,
            metadata
        };
    }

    /**
     * Creates tree nodes for components in a view
     */
    async createComponentNodes(sessionId: string, pageId: string, viewInstanceId: string): Promise<TreeNode[]> {
        const components = await this.getViewComponents(sessionId, pageId, viewInstanceId);
        return components.map(component => this.createComponentNode(sessionId, pageId, viewInstanceId, component));
    }

    /**
     * Creates a tree node for a component (recursive for children)
     */
    createComponentNode(
        sessionId: string,
        pageId: string,
        viewInstanceId: string,
        component: PerspectiveComponentInfo
    ): TreeNode {
        const metadata: PerspectiveNodeMetadata = {
            sessionId,
            pageId,
            viewInstanceId,
            componentPath: component.path,
            componentType: component.type,
            hasScripts: component.hasScripts
        };

        const hasChildren = component.children && component.children.length > 0;

        // Build child nodes
        const childNodes = hasChildren
            ? component.children.map(child => this.createComponentNode(sessionId, pageId, viewInstanceId, child))
            : undefined;

        return {
            id: `perspective-component::${sessionId}::${pageId}::${viewInstanceId}::${component.path}`,
            label: component.name,
            description: component.type,
            type: TreeNodeType.PERSPECTIVE_COMPONENT,
            icon: component.hasScripts ? 'code' : 'symbol-misc',
            collapsibleState: hasChildren ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None,
            contextValue: component.hasScripts ? 'perspectiveComponentWithScripts' : 'perspectiveComponent',
            tooltip: `Component: ${component.name}\nPath: ${component.path}\nType: ${component.type}${component.hasScripts ? '\n(Has Scripts)' : ''}`,
            metadata,
            children: childNodes
        };
    }

    /**
     * Gets the script context for a tree node
     */
    getScriptContextFromNode(node: TreeNode): PerspectiveScriptContext | null {
        const metadata = node.metadata as PerspectiveNodeMetadata | undefined;
        if (!metadata?.sessionId) {
            return null;
        }

        return {
            sessionId: metadata.sessionId,
            pageId: metadata.pageId,
            viewInstanceId: metadata.viewInstanceId,
            componentPath: metadata.componentPath
        };
    }
}
