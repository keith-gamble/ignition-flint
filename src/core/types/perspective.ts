/**
 * @module PerspectiveTypes
 * @description Type definitions for Perspective session and component data
 */

/**
 * Information about an active Perspective session
 */
export interface PerspectiveSessionInfo {
    /** Unique session identifier */
    readonly sessionId: string;
    /** Username of the session owner */
    readonly userName: string;
    /** Project name the session is running */
    readonly projectName: string;
    /** Number of open pages in the session */
    readonly pageCount: number;
    /** Total number of views across all pages */
    readonly viewCount: number;
    /** Session creation timestamp */
    readonly startTime: number;
    /** Browser user agent string */
    readonly userAgent: string;
}

/**
 * Information about a page within a Perspective session
 */
export interface PerspectivePageInfo {
    /** Unique page identifier */
    readonly pageId: string;
    /** Path of the primary view on the page */
    readonly primaryViewPath: string;
    /** Number of views on the page */
    readonly viewCount: number;
}

/**
 * Information about a view instance on a Perspective page
 */
export interface PerspectiveViewInfo {
    /** Unique view instance identifier */
    readonly viewInstanceId: string;
    /** Path to the view resource */
    readonly viewPath: string;
    /** Total number of components in the view */
    readonly componentCount: number;
    /** Type of the root component */
    readonly rootComponentType: string;
}

/**
 * Information about a component within a Perspective view
 */
export interface PerspectiveComponentInfo {
    /** Component path within the view hierarchy */
    readonly path: string;
    /** Component type (e.g., 'ia.input.button') */
    readonly type: string;
    /** Component name */
    readonly name: string;
    /** Whether the component has scripts configured */
    readonly hasScripts: boolean;
    /** Child components */
    readonly children: readonly PerspectiveComponentInfo[];
}

/**
 * Result from listing Perspective sessions
 */
export interface PerspectiveListSessionsResult {
    readonly sessions: readonly PerspectiveSessionInfo[];
}

/**
 * Result from listing Perspective pages
 */
export interface PerspectiveListPagesResult {
    readonly pages: readonly PerspectivePageInfo[];
}

/**
 * Result from listing Perspective views
 */
export interface PerspectiveListViewsResult {
    readonly views: readonly PerspectiveViewInfo[];
}

/**
 * Result from listing Perspective components
 */
export interface PerspectiveListComponentsResult {
    readonly components: readonly PerspectiveComponentInfo[];
}

/**
 * Context for Perspective script execution
 */
export interface PerspectiveScriptContext {
    /** The Perspective session ID */
    readonly sessionId: string;
    /** Optional page ID for narrower context */
    readonly pageId?: string;
    /** Optional view instance ID */
    readonly viewInstanceId?: string;
    /** Optional component path to bind as 'self' */
    readonly componentPath?: string;
}

/**
 * Tree node metadata for Perspective nodes
 */
export interface PerspectiveNodeMetadata {
    /** Index signature for Record<string, unknown> compatibility */
    readonly [key: string]: unknown;
    /** Session ID for session/page/view/component nodes */
    readonly sessionId?: string;
    /** Page ID for page/view/component nodes */
    readonly pageId?: string;
    /** View instance ID for view/component nodes */
    readonly viewInstanceId?: string;
    /** Component path for component nodes */
    readonly componentPath?: string;
    /** Component type for component nodes */
    readonly componentType?: string;
    /** Whether the component has scripts */
    readonly hasScripts?: boolean;
    /** Session user name */
    readonly userName?: string;
    /** Session project name */
    readonly projectName?: string;
    /** View path */
    readonly viewPath?: string;
}
