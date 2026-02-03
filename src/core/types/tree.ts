/**
 * @module TreeTypes
 * @description Tree node types and related interfaces for VS Code tree views
 * Extracted and enhanced from resources/types.ts
 */

import type { ResourceOrigin } from '@/core/types/models';

/**
 * Tree node type enumeration
 */
export enum TreeNodeType {
    /** Root node representing a gateway */
    GATEWAY = 'gateway',
    /** Node representing an Ignition project */
    PROJECT = 'project',
    /** Node representing a resource type category */
    RESOURCE_TYPE = 'resourceType',
    /** Node representing a resource category within a type */
    RESOURCE_CATEGORY = 'resourceCategory',
    /** Node representing a folder within resources */
    RESOURCE_FOLDER = 'resourceFolder',
    /** Node representing an individual resource */
    RESOURCE_ITEM = 'resourceItem',
    /** Node representing a singleton resource (only one instance per project) */
    SINGLETON_RESOURCE = 'singletonResource',
    /** Node representing a search result */
    SEARCH_RESULT = 'searchResult',
    /** Node representing an error state */
    ERROR_NODE = 'errorNode',
    /** Node representing loading state */
    LOADING_NODE = 'loadingNode',
    /** Node representing empty state */
    EMPTY_NODE = 'emptyNode',
    /** Node representing a Python symbol (function, class, constant) */
    PYTHON_SYMBOL = 'pythonSymbol',

    // Perspective session tree node types
    /** Root container for active Perspective sessions */
    PERSPECTIVE_SESSIONS = 'perspectiveSessions',
    /** Individual Perspective session */
    PERSPECTIVE_SESSION = 'perspectiveSession',
    /** Page within a Perspective session */
    PERSPECTIVE_PAGE = 'perspectivePage',
    /** View instance on a Perspective page */
    PERSPECTIVE_VIEW = 'perspectiveView',
    /** Component within a Perspective view */
    PERSPECTIVE_COMPONENT = 'perspectiveComponent'
}

/**
 * Tree node interface for VS Code tree data provider
 */
export interface TreeNode {
    /** Unique identifier for the node */
    readonly id: string;
    /** Display label for the node */
    readonly label: string;
    /** Type of tree node */
    readonly type: TreeNodeType;
    /** Icon identifier or path for the node */
    readonly icon?: string;
    /** Description shown alongside the label */
    readonly description?: string;
    /** Tooltip text for the node */
    readonly tooltip?: string;
    /** Context value for when clause contexts */
    readonly contextValue?: string;
    /** Resource path relative to provider's directory if applicable */
    readonly resourcePath?: string;
    /** Project identifier if applicable */
    readonly projectId?: string;
    /** Gateway identifier if applicable */
    readonly gatewayId?: string;
    /** Resource type identifier if applicable */
    readonly resourceType?: string;
    /** Resource type identifier (preferred over resourceType) */
    readonly typeId?: string;
    /** Category identifier if applicable */
    readonly categoryId?: string;
    /** Resource origin if applicable */
    readonly origin?: ResourceOrigin;
    /** Collapsible state for the node */
    readonly collapsibleState?: TreeItemCollapsibleState;
    /** Child nodes (for caching) */
    readonly children?: readonly TreeNode[];
    /** Additional metadata */
    readonly metadata?: Readonly<Record<string, unknown>>;
    /** Sort order hint */
    readonly sortOrder?: number;
    /** Whether node represents an error state */
    readonly isError?: boolean;
    /** Whether node is currently loading */
    readonly isLoading?: boolean;
}

/**
 * Tree item collapsible state (mirrors VS Code enum)
 */
export enum TreeItemCollapsibleState {
    /** Tree item is not collapsible */
    None = 0,
    /** Tree item is collapsed */
    Collapsed = 1,
    /** Tree item is expanded */
    Expanded = 2
}

/**
 * Tree node builder context
 */
export interface TreeNodeBuildContext {
    /** Current project being processed */
    readonly currentProject?: string;
    /** Current gateway being processed */
    readonly currentGateway?: string;
    /** Whether to show inherited resources */
    readonly showInherited: boolean;
    /** Search query for filtering */
    readonly searchQuery?: string;
    /** Resource type filter */
    readonly resourceTypeFilter?: readonly string[];
    /** Maximum depth to build */
    readonly maxDepth?: number;
    /** Current depth in tree */
    readonly currentDepth: number;
}

/**
 * Tree state management interface
 */
export interface ITreeStateManager {
    /**
     * Gets cached children for node
     * @param nodeId - Node identifier
     */
    getCachedChildren(nodeId: string): readonly TreeNode[] | undefined;

    /**
     * Sets cached children for node
     * @param nodeId - Node identifier
     * @param children - Child nodes
     */
    setCachedChildren(nodeId: string, children: readonly TreeNode[]): void;

    /**
     * Clears cache for node
     * @param nodeId - Node identifier
     */
    clearCache(nodeId: string): void;

    /**
     * Clears entire cache
     */
    clearAllCache(): void;

    /**
     * Gets expansion state for node
     * @param nodeId - Node identifier
     */
    getExpansionState(nodeId: string): boolean;

    /**
     * Sets expansion state for node
     * @param nodeId - Node identifier
     * @param expanded - Whether node is expanded
     */
    setExpansionState(nodeId: string, expanded: boolean): void;

    /**
     * Gets selected nodes
     */
    getSelectedNodes(): readonly string[];

    /**
     * Sets selected nodes
     * @param nodeIds - Selected node identifiers
     */
    setSelectedNodes(nodeIds: readonly string[]): void;
}

/**
 * Tree node builder interface
 */
export interface ITreeNodeBuilder {
    /**
     * Builds root nodes
     * @param context - Build context
     */
    buildRootNodes(context: TreeNodeBuildContext): Promise<readonly TreeNode[]>;

    /**
     * Builds children for a node
     * @param parent - Parent node
     * @param context - Build context
     */
    buildChildren(parent: TreeNode, context: TreeNodeBuildContext): Promise<readonly TreeNode[]>;

    /**
     * Builds tree item for VS Code
     * @param node - Tree node
     * @param stateManager - State manager
     */
    buildTreeItem(node: TreeNode, stateManager: ITreeStateManager): TreeItem;

    /**
     * Builds gateway nodes
     * @param context - Build context
     */
    buildGatewayNodes(context: TreeNodeBuildContext): Promise<readonly TreeNode[]>;

    /**
     * Builds project nodes
     * @param gatewayId - Gateway identifier
     * @param context - Build context
     */
    buildProjectNodes(gatewayId: string, context: TreeNodeBuildContext): Promise<readonly TreeNode[]>;

    /**
     * Builds resource type nodes
     * @param projectId - Project identifier
     * @param context - Build context
     */
    buildResourceTypeNodes(projectId: string, context: TreeNodeBuildContext): Promise<readonly TreeNode[]>;

    /**
     * Builds resource category nodes
     * @param projectId - Project identifier
     * @param resourceType - Resource type
     * @param context - Build context
     */
    buildResourceCategoryNodes(
        projectId: string,
        resourceType: string,
        context: TreeNodeBuildContext
    ): Promise<readonly TreeNode[]>;

    /**
     * Builds resource folder nodes
     * @param projectId - Project identifier
     * @param resourceType - Resource type
     * @param categoryId - Category identifier
     * @param parentPath - Parent folder path
     * @param context - Build context
     */
    buildResourceFolderNodes(
        projectId: string,
        resourceType: string,
        categoryId: string | undefined,
        parentPath: string,
        context: TreeNodeBuildContext
    ): Promise<readonly TreeNode[]>;

    /**
     * Builds resource item nodes
     * @param projectId - Project identifier
     * @param resourceType - Resource type
     * @param categoryId - Category identifier
     * @param folderPath - Folder path
     * @param context - Build context
     */
    buildResourceItemNodes(
        projectId: string,
        resourceType: string,
        categoryId: string | undefined,
        folderPath: string,
        context: TreeNodeBuildContext
    ): Promise<readonly TreeNode[]>;
}

/**
 * Tree decoration provider interface
 */
export interface ITreeDecorationProvider {
    /**
     * Applies decorations to tree item
     * @param item - Tree item to decorate
     * @param node - Source tree node
     */
    applyDecorations(item: TreeItem, node: TreeNode): void;

    /**
     * Gets icon for node
     * @param node - Tree node
     */
    getIcon(node: TreeNode): string | TreeItemIcon | undefined;

    /**
     * Gets context value for node
     * @param node - Tree node
     */
    getContextValue(node: TreeNode): string | undefined;

    /**
     * Gets tooltip for node
     * @param node - Tree node
     */
    getTooltip(node: TreeNode): string | undefined;

    /**
     * Applies warning decoration if needed
     * @param item - Tree item
     * @param node - Tree node
     */
    applyWarningDecoration(item: TreeItem, node: TreeNode): void;

    /**
     * Applies error decoration if needed
     * @param item - Tree item
     * @param node - Tree node
     */
    applyErrorDecoration(item: TreeItem, node: TreeNode): void;
}

/**
 * Tree item interface (mirrors VS Code TreeItem)
 */
export interface TreeItem {
    /** Item label */
    label: string;
    /** Item identifier */
    id?: string;
    /** Icon path or identifier */
    iconPath?: string | TreeItemIcon;
    /** Item description */
    description?: string;
    /** Item tooltip */
    tooltip?: string;
    /** Collapsible state */
    collapsibleState?: TreeItemCollapsibleState;
    /** Context value for when clauses */
    contextValue?: string;
    /** Command to execute when item is selected */
    command?: TreeItemCommand;
    /** Resource URI */
    resourceUri?: any; // vscode.Uri
}

/**
 * Tree item icon interface
 */
export interface TreeItemIcon {
    /** Light theme icon */
    light: string; // vscode.Uri
    /** Dark theme icon */
    dark: string; // vscode.Uri
}

/**
 * Tree item command interface
 */
export interface TreeItemCommand {
    /** Command identifier */
    command: string;
    /** Command title */
    title: string;
    /** Command arguments */
    arguments?: readonly unknown[];
}

/**
 * Tree refresh event data
 */
export interface TreeRefreshEvent {
    /** Node to refresh (undefined for full refresh) */
    readonly node?: TreeNode;
    /** Whether refresh is due to configuration change */
    readonly configurationChanged?: boolean;
    /** Whether refresh is due to project scan */
    readonly projectScanCompleted?: boolean;
    /** Whether refresh is due to gateway selection change */
    readonly gatewaySelectionChanged?: boolean;
    /** Refresh timestamp */
    readonly timestamp: Date;
}

/**
 * Tree command handler interface
 */
export interface ITreeCommandHandler {
    /**
     * Handles node selection
     * @param node - Selected node
     */
    handleNodeSelection(node: TreeNode): Promise<void>;

    /**
     * Handles node double-click
     * @param node - Double-clicked node
     */
    handleNodeDoubleClick(node: TreeNode): Promise<void>;

    /**
     * Handles node context menu action
     * @param node - Node for context menu
     * @param action - Action identifier
     */
    handleContextMenuAction(node: TreeNode, action: string): Promise<void>;

    /**
     * Handles node expansion
     * @param node - Expanded node
     */
    handleNodeExpansion(node: TreeNode): Promise<void>;

    /**
     * Handles node collapse
     * @param node - Collapsed node
     */
    handleNodeCollapse(node: TreeNode): Promise<void>;
}

/**
 * Tree data provider interface (simplified VS Code interface)
 */
export interface ITreeDataProvider {
    /**
     * Gets tree item representation of node
     * @param element - Tree node
     */
    getTreeItem(element: TreeNode): TreeItem | Promise<TreeItem>;

    /**
     * Gets children of node
     * @param element - Parent node (undefined for root)
     */
    getChildren(element?: TreeNode): readonly TreeNode[] | Promise<readonly TreeNode[]>;

    /**
     * Gets parent of node
     * @param element - Child node
     */
    getParent?(element: TreeNode): TreeNode | undefined | Promise<TreeNode | undefined>;

    /**
     * Refreshes tree or specific node
     * @param element - Node to refresh (undefined for full refresh)
     */
    refresh(element?: TreeNode): void;
}

/**
 * Search tree node for search results
 */
export interface SearchTreeNode extends TreeNode {
    /** Search query that produced this result */
    readonly searchQuery: string;
    /** Search score/relevance */
    readonly score?: number;
    /** Matching text preview */
    readonly matchPreview?: string;
    /** File path where match was found */
    readonly matchFilePath?: string;
    /** Line number of match */
    readonly matchLine?: number;
}

/**
 * Error tree node for displaying errors
 */
export interface ErrorTreeNode extends TreeNode {
    /** Error message */
    readonly errorMessage: string;
    /** Error code if available */
    readonly errorCode?: string;
    /** Whether error is recoverable */
    readonly isRecoverable: boolean;
    /** Retry action if available */
    readonly retryAction?: () => Promise<void>;
}
