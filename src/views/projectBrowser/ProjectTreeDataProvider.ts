/**
 * @module ProjectTreeDataProvider
 * @description Enhanced tree data provider for the project browser
 * Provides tree view functionality with service-based architecture
 */

import * as path from 'path';

import * as vscode from 'vscode';

import { TreeCommandHandler } from './TreeCommandHandler';
import { TreeDecorationProvider } from './TreeDecorationProvider';
import { TreeNodeBuilder } from './TreeNodeBuilder';
import { TreeStateManager } from './TreeStateManager';

import { ConfigurationNotFoundError, FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { TreeNode, TreeNodeType } from '@/core/types/tree';

// Import our new components

/**
 * Tree provider configuration
 */
interface TreeProviderConfig {
    readonly enableSmartRefresh: boolean;
    readonly enableLazyLoading: boolean;
    readonly cacheExpirationMs: number;
    readonly autoRefreshOnConfigChange: boolean;
    readonly showEmptyCategories: boolean;
}

/**
 * Tree refresh options
 */
interface TreeRefreshOptions {
    readonly preserveState: boolean;
    readonly clearCache: boolean;
    readonly refreshTarget?: TreeNode;
    readonly force: boolean;
}

/**
 * Enhanced project tree data provider with modern architecture
 * Delegates responsibilities to specialized components
 */
export class ProjectTreeDataProvider implements vscode.TreeDataProvider<TreeNode>, IServiceLifecycle {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private config: TreeProviderConfig = {
        enableSmartRefresh: true,
        enableLazyLoading: true,
        cacheExpirationMs: 300000, // 5 minutes
        autoRefreshOnConfigChange: true,
        showEmptyCategories: false
    };

    private isInitialized = false;
    private isDisposed = false;
    private treeView?: vscode.TreeView<TreeNode>;

    // Component dependencies
    private nodeBuilder!: TreeNodeBuilder;
    private stateManager!: TreeStateManager;
    private decorationProvider!: TreeDecorationProvider;
    private commandHandler!: TreeCommandHandler;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {}

    async initialize(): Promise<void> {
        try {
            // Initialize components in dependency order
            await this.initializeComponents();

            // Load configuration
            this.loadConfiguration();

            // Setup event handlers
            this.setupEventHandlers();

            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize project tree data provider',
                'TREE_PROVIDER_INIT_FAILED',
                'Project tree data provider could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        // Start all components
        void this.nodeBuilder.start();
        await this.stateManager.start();
        void this.decorationProvider.start();
        void this.commandHandler.start();
    }

    async stop(): Promise<void> {
        if (this.nodeBuilder) await this.nodeBuilder.stop();
        if (this.stateManager) await this.stateManager.stop();
        if (this.decorationProvider) await this.decorationProvider.stop();
        if (this.commandHandler) void this.commandHandler.stop();
    }

    async dispose(): Promise<void> {
        if (this.isDisposed) return;

        await this.stop();

        // Dispose components
        if (this.nodeBuilder) await this.nodeBuilder.dispose();
        if (this.stateManager) await this.stateManager.dispose();
        if (this.decorationProvider) await this.decorationProvider.dispose();
        if (this.commandHandler) void this.commandHandler.dispose();

        // Dispose event emitter
        this._onDidChangeTreeData.dispose();

        this.isDisposed = true;
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Gets tree item representation of a node (VS Code TreeDataProvider interface)
     */
    getTreeItem(element: TreeNode): vscode.TreeItem | Promise<vscode.TreeItem> {
        try {
            // Create base VS Code tree item
            const item = new vscode.TreeItem(element.label, this.getCollapsibleState(element));

            // Set basic properties
            item.id = element.id;
            item.description = element.description;
            item.tooltip = element.tooltip;
            item.contextValue = element.contextValue;

            // Apply decorations using decoration provider
            const treeItem = {
                label: item.label as string,
                id: item.id,
                iconPath: undefined,
                description: item.description,
                tooltip: item.tooltip,
                collapsibleState: item.collapsibleState,
                contextValue: item.contextValue,
                command: undefined
            };

            this.decorationProvider.applyDecorations(treeItem, element);

            // Copy back to VS Code tree item
            if (treeItem.iconPath) {
                (item as any).iconPath = treeItem.iconPath;
            }
            item.contextValue = treeItem.contextValue;
            item.tooltip = treeItem.tooltip;

            // Add command for clickable items
            if (this.shouldAddCommand(element)) {
                item.command = {
                    command: 'flint.handleNodeClick',
                    title: 'Handle Node Click',
                    arguments: [element]
                };
            }

            return item;
        } catch (error) {
            console.error(`Error creating tree item for node ${element.id}:`, error);

            // Return error tree item
            const errorItem = new vscode.TreeItem(`Error: ${element.label}`, vscode.TreeItemCollapsibleState.None);
            errorItem.tooltip = `Failed to create tree item: ${String(error)}`;
            return errorItem;
        }
    }

    /**
     * Gets children of a node (VS Code TreeDataProvider interface)
     */
    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        try {
            // Check cache first if enabled
            if (this.config.enableLazyLoading && element) {
                const cached = this.stateManager.getCachedNodes(element.id);
                if (cached) {
                    return [...cached];
                }
            }

            // Generate children based on node type
            let children: TreeNode[];

            if (!element) {
                // Root level
                children = await this.getRootNodes();
            } else {
                children = await this.getNodeChildren(element);
            }

            // Cache results if enabled
            if (this.config.enableLazyLoading && element) {
                this.stateManager.cacheNodes(element.id, children);
            }

            return children;
        } catch (error) {
            console.error(`Error getting children for node ${element?.id ?? 'root'}:`, error);

            // Return error node
            return [
                {
                    id: `error-${Date.now()}`,
                    label: 'Error loading children',
                    type: TreeNodeType.ERROR_NODE,
                    tooltip: `Failed to load children: ${String(error)}`,
                    isError: true
                }
            ];
        }
    }

    /**
     * Gets parent of a node (optional VS Code TreeDataProvider interface)
     * Required for treeView.reveal() to work properly - it traces path from root to target
     */
    getParent?(element: TreeNode): TreeNode | undefined {
        try {
            // For resource items and folders, derive parent from path
            if (
                element.resourcePath &&
                (element.type === TreeNodeType.RESOURCE_ITEM || element.type === TreeNodeType.RESOURCE_FOLDER)
            ) {
                const pathParts = element.resourcePath.split('/');
                const typeId = element.resourceType || (element as any).typeId || 'none';
                const categoryId = (element as any).categoryId || 'none';
                const projectId = element.projectId || '';

                if (pathParts.length > 1) {
                    // Has a parent folder
                    const parentPath = pathParts.slice(0, -1).join('/');
                    const parentId = `folder::${projectId}::${typeId}::${categoryId}::${parentPath}`;

                    return {
                        id: parentId,
                        label: pathParts[pathParts.length - 2],
                        type: TreeNodeType.RESOURCE_FOLDER,
                        projectId: element.projectId,
                        resourcePath: parentPath,
                        resourceType: typeId,
                        typeId,
                        categoryId
                    } as TreeNode;
                }

                // At root of type - parent is the resource type node
                // Resource type nodes use format: root-${projectId}-${typeId} for root-level types
                // or type-${projectId}-${categoryId}-${typeId} for categorized types
                if (categoryId && categoryId !== 'none' && categoryId !== 'root') {
                    // Categorized resource type - parent is the type node within category
                    return {
                        id: `type-${projectId}-${categoryId}-${typeId}`,
                        label: typeId,
                        type: TreeNodeType.RESOURCE_TYPE,
                        projectId: element.projectId,
                        resourceType: typeId,
                        typeId,
                        categoryId
                    } as TreeNode;
                }

                // Root-level resource type
                return {
                    id: `root-${projectId}-${typeId}`,
                    label: typeId,
                    type: TreeNodeType.RESOURCE_TYPE,
                    projectId: element.projectId,
                    resourceType: typeId,
                    typeId
                } as TreeNode;
            }

            // For resource type nodes within a category, parent is the category
            if (element.type === TreeNodeType.RESOURCE_TYPE) {
                const categoryId = (element as any).categoryId;
                if (categoryId && categoryId !== 'none' && categoryId !== 'root') {
                    return {
                        id: `category-${element.projectId}-${categoryId}`,
                        label: categoryId,
                        type: TreeNodeType.RESOURCE_CATEGORY,
                        projectId: element.projectId,
                        categoryId
                    } as TreeNode;
                }
                // Root-level resource types have no parent (they're at root)
                return undefined;
            }

            // Categories and root-level nodes have no parent
            if (element.type === TreeNodeType.RESOURCE_CATEGORY) {
                return undefined;
            }
        } catch (error) {
            console.warn(`Failed to resolve parent for node ${element.id}:`, error);
        }
        return undefined;
    }

    /**
     * Refreshes the tree or specific node
     */
    refresh(element?: TreeNode, options: Partial<TreeRefreshOptions> = {}): void {
        const refreshOptions: TreeRefreshOptions = {
            preserveState: true,
            clearCache: false,
            force: false,
            ...options
        };

        try {
            // Clear cache if requested
            if (refreshOptions.clearCache) {
                if (element) {
                    this.stateManager.invalidateCache(element.id);
                } else {
                    this.stateManager.invalidateCache();
                }
            }

            // Fire change event
            this._onDidChangeTreeData.fire(refreshOptions.refreshTarget || element);
        } catch (error) {
            console.error('Error during tree refresh:', error);
        }
    }

    /**
     * Triggers smart refresh based on changes
     */
    async smartRefresh(): Promise<void> {
        if (!this.config.enableSmartRefresh) {
            this.refresh();
            return;
        }

        // Implement smart refresh logic
        try {
            // Get services to detect changes
            const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');

            if (configService && projectScannerService) {
                // Check if configuration changed
                const hasConfigChanges = await this.detectConfigurationChanges();

                if (hasConfigChanges) {
                    // Full refresh for config changes
                    this.refresh(undefined, { clearCache: true, preserveState: true });
                } else {
                    // Check for project content changes
                    const changedProjects = await this.detectProjectChanges();

                    if (changedProjects.length > 0) {
                        // Selective refresh for project changes
                        for (const projectId of changedProjects) {
                            const projectNode = { id: `project-${projectId}`, projectId } as TreeNode;
                            this.refresh(projectNode, { clearCache: true, preserveState: true });
                        }
                    } else {
                        // No changes detected, just refresh root to update timestamps
                        this.refresh(undefined, { preserveState: true });
                    }
                }
            } else {
                // Fallback to simple refresh
                this.refresh(undefined, { preserveState: true });
            }
        } catch (error) {
            console.warn('Smart refresh failed, falling back to simple refresh:', error);
            this.refresh(undefined, { preserveState: true });
        }
    }

    /**
     * Handles tree node expansion
     */
    async onDidExpandElement(element: TreeNode): Promise<void> {
        this.stateManager.setNodeExpanded(element.id, true);
        await this.commandHandler.handleNodeExpansion(element);
    }

    /**
     * Handles tree node collapse
     */
    onDidCollapseElement(element: TreeNode): void {
        this.stateManager.setNodeExpanded(element.id, false);
        this.commandHandler.handleNodeCollapse(element);
    }

    /**
     * Updates tree provider configuration
     */
    updateConfiguration(newConfig: Partial<TreeProviderConfig>): void {
        this.config = { ...this.config, ...newConfig };

        // Update component configurations
        this.stateManager.updateConfiguration({
            cacheEnabled: this.config.enableLazyLoading,
            cacheExpirationMs: this.config.cacheExpirationMs
        });
    }

    /**
     * Gets current configuration
     */
    getConfiguration(): Readonly<TreeProviderConfig> {
        return Object.freeze({ ...this.config });
    }

    /**
     * Initializes all component dependencies
     */
    private async initializeComponents(): Promise<void> {
        // Create component instances
        this.nodeBuilder = new TreeNodeBuilder(this.serviceContainer, this.context);
        this.stateManager = new TreeStateManager(this.serviceContainer, this.context);
        this.decorationProvider = new TreeDecorationProvider(this.serviceContainer, this.context);
        this.commandHandler = new TreeCommandHandler(this.serviceContainer, this.context);

        // Initialize components
        void this.nodeBuilder.initialize();
        await this.stateManager.initialize();
        void this.decorationProvider.initialize();
        void this.commandHandler.initialize();
    }

    /**
     * Sets up event handlers for external changes
     */
    private setupEventHandlers(): void {
        // Setup service-based listeners
        try {
            // Configuration service changes
            const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
            if (configService?.onConfigurationChanged) {
                configService.onConfigurationChanged(() => {
                    if (this.config.autoRefreshOnConfigChange) {
                        void this.smartRefresh();
                    }
                });
            }

            // Project scanner service changes
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
            if (projectScannerService?.onResourcesChanged) {
                projectScannerService.onResourcesChanged((projectId: string) => {
                    // Selective refresh for project changes
                    const projectNode = { id: `project-${projectId}`, projectId } as TreeNode;
                    this.refresh(projectNode, { clearCache: true });
                });
            }

            // Gateway manager service changes - refresh tree when gateway/project selection changes
            const gatewayManagerService = this.serviceContainer.get<any>('GatewayManagerService');
            if (gatewayManagerService) {
                if (gatewayManagerService.onGatewaySelected) {
                    gatewayManagerService.onGatewaySelected(() => {
                        // Refresh the entire tree since gateway selection affects root nodes
                        this.refresh();
                    });
                }

                if (gatewayManagerService.onProjectSelected) {
                    gatewayManagerService.onProjectSelected(() => {
                        // Refresh the entire tree since project selection affects root nodes and project display
                        this.refresh();
                    });
                }
            }
        } catch (error) {
            console.warn('Failed to setup service event handlers:', error);
        }

        // Configuration changes
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('flint')) {
                if (this.config.autoRefreshOnConfigChange) {
                    void this.smartRefresh();
                }
            }
        });

        // Auto-reveal opened files in the tree
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor?.document) {
                void this.revealFileInTree(editor.document);
            }
        });

        // Also listen to document open events for comprehensive auto-reveal
        vscode.workspace.onDidOpenTextDocument(document => {
            // Check if this document has a visible editor (avoid revealing background operations)
            const visibleEditor = vscode.window.visibleTextEditors.find(e => e.document === document);
            if (visibleEditor) {
                void this.revealFileInTree(document);
            }
        });

        // State manager changes
        this.stateManager.onStateChanged(event => {
            if (event.type === 'cache' && event.nodeId) {
                // Selective refresh for cache changes
                this.refresh(undefined, { refreshTarget: { id: event.nodeId } as TreeNode });
            }
        });

        // Check if there's already an active editor when the tree initializes (VS Code startup scenario)
        // We need to delay this slightly to ensure the tree is fully initialized
        setTimeout(() => {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor?.document) {
                void this.revealFileInTree(activeEditor.document);
            }
        }, 1000); // Wait 1 second for tree to initialize
    }

    /**
     * Gets root nodes using node builder
     */
    private async getRootNodes(): Promise<TreeNode[]> {
        try {
            // Get actual data from services
            const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
            const gatewayService = this.serviceContainer.get<any>('GatewayManagerService');

            // Get gateways from config
            const gateways = new Map();
            if (configService) {
                const gatewayConfigs = await configService.getGateways();
                for (const [id, config] of Object.entries(gatewayConfigs)) {
                    gateways.set(id, config);
                }
            }

            // Get active selections
            const activeGateway = gatewayService?.getActiveGatewayId();
            const activeProject = gatewayService?.getActiveProjectId();

            // Get scanned projects - for now, just get project paths from config
            const availableProjects: string[] = [];
            if (configService) {
                const projectPaths = await configService.getProjectPaths();
                // Extract project names from paths for display
                availableProjects.push(...projectPaths.map((p: string) => path.basename(p)));
            }

            return await this.nodeBuilder.createRootNodes(gateways, activeGateway, activeProject, availableProjects);
        } catch (error) {
            // If no configuration exists, return empty array to trigger welcome view
            if (error instanceof ConfigurationNotFoundError) {
                return [];
            }

            console.error('Error creating root nodes:', error);
            return [
                {
                    id: 'error-root',
                    label: 'Error loading project tree',
                    type: TreeNodeType.ERROR_NODE,
                    tooltip: `Failed to load root nodes: ${String(error)}`,
                    isError: true
                }
            ];
        }
    }

    /**
     * Gets children for a specific node using node builder
     */
    private async getNodeChildren(element: TreeNode): Promise<TreeNode[]> {
        try {
            // First check if element has direct children (for hierarchical nodes like gateway selector)
            if (element.children && element.children.length > 0) {
                return [...element.children];
            }

            switch (element.type) {
                case TreeNodeType.RESOURCE_TYPE:
                    return this.getResourceTypeChildren(element);

                case TreeNodeType.RESOURCE_CATEGORY:
                    return this.getResourceCategoryChildren(element);

                case TreeNodeType.RESOURCE_FOLDER:
                    return this.getResourceFolderChildren(element);

                case TreeNodeType.RESOURCE_ITEM:
                    // Check if this is a Python script file - if so, return symbols as children
                    return await this.getResourceItemChildren(element);

                case TreeNodeType.PYTHON_SYMBOL:
                    // Check if this is a class symbol - if so, return methods as children
                    return this.getPythonSymbolChildren(element);

                case TreeNodeType.GATEWAY:
                case TreeNodeType.PROJECT:
                    // Gateway and project nodes may have children
                    return element.children ? [...element.children] : [];

                // Perspective session tree node types
                case TreeNodeType.PERSPECTIVE_SESSIONS:
                    return await this.getPerspectiveSessionsChildren();

                case TreeNodeType.PERSPECTIVE_SESSION:
                    return await this.getPerspectiveSessionChildren(element);

                case TreeNodeType.PERSPECTIVE_PAGE:
                    return await this.getPerspectivePageChildren(element);

                case TreeNodeType.PERSPECTIVE_VIEW:
                    return await this.getPerspectiveViewChildren(element);

                case TreeNodeType.PERSPECTIVE_COMPONENT:
                    // Components have pre-built children
                    return element.children ? [...element.children] : [];

                default:
                    return [];
            }
        } catch (error) {
            console.error(`Error getting children for ${element.type} node:`, error);
            return [
                {
                    id: `error-${element.id}-children`,
                    label: 'Error loading children',
                    type: TreeNodeType.ERROR_NODE,
                    tooltip: `Failed to load children: ${String(error)}`,
                    isError: true
                }
            ];
        }
    }

    /**
     * Gets children for resource type nodes
     */
    private getResourceTypeChildren(element: TreeNode): TreeNode[] {
        try {
            // Get resources from project scanner service
            // const _projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
            const resourceTypeRegistry = this.serviceContainer.get<any>('ResourceTypeProviderRegistry');

            const resources = (element as any).resources || new Map();
            const typeId = (element as any).typeId;
            const projectId = element.projectId!;

            // Get type definition from resource type registry
            let typeDef: any = { id: typeId, categories: undefined };
            if (resourceTypeRegistry?.getResourceType) {
                const registryTypeDef = resourceTypeRegistry.getResourceType(typeId);
                if (registryTypeDef) {
                    typeDef = registryTypeDef;
                }
            }

            // If type has categories, create category nodes
            if (typeDef.categories) {
                return this.nodeBuilder.createCategoryNodes(typeId, typeDef, resources, projectId);
            }
            // Create resource tree directly
            return this.nodeBuilder.createResourceTree(resources, {
                projectId,
                typeId
            });
        } catch (error) {
            console.warn(`Failed to get resource type children for ${element.id}:`, error);
            return [];
        }
    }

    /**
     * Gets children for resource category nodes
     */
    private getResourceCategoryChildren(element: TreeNode): TreeNode[] {
        const typesMap = (element as any).typesMap || new Map();
        const typeDisplayNames = (element as any).typeDisplayNames || {};
        const categoryId = (element as any).categoryId;
        const projectId = element.projectId!;
        const singletonNodes = (element as any).singletonNodes || [];

        const nodes: TreeNode[] = [];

        // Add singleton nodes first (direct clickable items)
        nodes.push(...singletonNodes);

        // Create expandable nodes for non-singleton resource types in this category
        for (const [typeId, resourcesMap] of typesMap) {
            const typeDisplayName = typeDisplayNames[typeId] || typeId;
            const resourceCount = resourcesMap.size;

            const typeNode: TreeNode = {
                id: `type-${projectId}-${categoryId}-${typeId}`,
                label: `${typeDisplayName} (${resourceCount})`,
                type: TreeNodeType.RESOURCE_TYPE,
                icon: this.nodeBuilder.getResourceTypeIcon(typeId),
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                contextValue: 'resourceType',
                projectId,
                resourcePath: '', // Root path for resource type
                resourceType: typeId, // Set directly on TreeNode object
                typeId // Resource type identifier
            };

            // Store data for child expansion
            (typeNode as any).typeId = typeId;
            (typeNode as any).categoryId = categoryId;
            (typeNode as any).resources = resourcesMap;

            nodes.push(typeNode);
        }

        return nodes.sort((a: TreeNode, b: TreeNode) => a.label.localeCompare(b.label));
    }

    /**
     * Normalizes a resource path to a module path
     */
    private normalizeResourcePath(resourcePath: string): string {
        let normalized = resourcePath;

        // Remove the 'script-python:' prefix if present
        if (normalized.includes(':')) {
            normalized = normalized.split(':', 2)[1];
        }

        // Remove '/code' suffix if present
        if (normalized.endsWith('/code')) {
            normalized = normalized.slice(0, -5);
        }

        // Remove 'ignition/script-python/' prefix if present
        if (normalized.startsWith('ignition/script-python/')) {
            normalized = normalized.substring('ignition/script-python/'.length);
        } else if (normalized.startsWith('script-python/')) {
            normalized = normalized.substring('script-python/'.length);
        }

        // Convert resource path to module path
        return normalized.replace(/\//g, '.');
    }

    /**
     * Finds the project path for a given project ID
     */
    private findProjectPath(projectId: string): string | null {
        const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
        if (!projectScannerService) {
            return null;
        }

        let project = projectScannerService.getProject(projectId);

        if (!project) {
            const allProjects = projectScannerService.getAllCachedResults();
            project = allProjects.find(
                (p: { projectName?: string; projectPath?: string }) =>
                    p.projectName === projectId || p.projectPath?.endsWith(`/${projectId}`)
            );
        }

        const projectPath = project?.projectPath;
        return typeof projectPath === 'string' ? projectPath : null;
    }

    /**
     * Creates a tree node for a Python symbol
     */
    private createSymbolNode(symbol: any, element: TreeNode): TreeNode {
        const iconMap: Record<string, string> = {
            function: 'symbol-method',
            class: 'symbol-class',
            variable: 'symbol-variable',
            constant: 'symbol-constant'
        };

        const symbolPrefix: Record<string, string> = {
            function: 'ƒ',
            class: '○',
            constant: '◆',
            variable: '▪'
        };

        const prefix = symbolPrefix[symbol.type] || '';
        const label = `${prefix} ${symbol.name}`;

        return {
            id: `symbol-${element.projectId}-${symbol.qualifiedName}`,
            label,
            type: TreeNodeType.PYTHON_SYMBOL,
            icon: iconMap[symbol.type] || 'symbol-misc',
            description: symbol.signature
                ? `(${symbol.parameters?.map((p: any) => p.name as string).join(', ') || ''})`
                : undefined,
            tooltip: symbol.docstring || `${symbol.type}: ${symbol.name}`,
            contextValue: `pythonSymbol.${symbol.type}`,
            projectId: element.projectId,
            collapsibleState:
                symbol.type === 'class' && symbol.methods?.length > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None,
            metadata: {
                symbolType: symbol.type,
                qualifiedName: symbol.qualifiedName,
                filePath: symbol.filePath,
                lineNumber: symbol.lineNumber,
                signature: symbol.signature,
                parameters: symbol.parameters,
                methods: symbol.methods
            }
        };
    }

    /**
     * Gets children for resource item nodes (e.g., Python symbols)
     */
    private async getResourceItemChildren(element: TreeNode): Promise<TreeNode[]> {
        try {
            if (element.resourceType !== 'script-python' || !element.projectId) {
                return [];
            }

            const scriptModuleIndexService = this.serviceContainer.get<any>('ScriptModuleIndexService');
            if (!scriptModuleIndexService) {
                return [];
            }

            const resourcePath = (element as any).originalResourcePath || element.resourcePath;
            if (!resourcePath) {
                return [];
            }

            const modulePath = this.normalizeResourcePath(resourcePath);
            const projectPath = this.findProjectPath(element.projectId);

            if (projectPath) {
                await scriptModuleIndexService.indexProject(projectPath, element.projectId);
            }

            const index = await scriptModuleIndexService.getProjectIndex(element.projectId);
            if (!index) {
                return [];
            }

            const module = index.flatModules.get(modulePath);
            if (!module?.symbols?.length) {
                return [];
            }

            const nodes: TreeNode[] = module.symbols.map((symbol: any) => this.createSymbolNode(symbol, element));
            return nodes;
        } catch (error) {
            console.error(`Failed to get Python symbols for ${element.id}:`, error);
            return [];
        }
    }

    /**
     * Gets children for Python symbol nodes (e.g., methods of a class)
     */
    private getPythonSymbolChildren(element: TreeNode): TreeNode[] {
        try {
            // Only classes can have children (methods)
            if (!element.metadata || (element.metadata as any).symbolType !== 'class') {
                return [];
            }

            const methods = (element.metadata as any).methods;
            if (!methods || methods.length === 0) {
                return [];
            }

            // Create tree nodes for each method
            const methodNodes: TreeNode[] = [];
            for (const method of methods) {
                const methodNode: TreeNode = {
                    id: `method-${element.projectId}-${(element.metadata as any).qualifiedName}-${method.name}`,
                    label: `ƒ ${method.name}`,
                    type: TreeNodeType.PYTHON_SYMBOL,
                    icon: 'symbol-method',
                    description: method.signature
                        ? `(${method.parameters?.map((p: any) => p.name as string).join(', ') || ''})`
                        : undefined,
                    tooltip: method.docstring || `method: ${method.name}`,
                    contextValue: 'pythonSymbol.method',
                    projectId: element.projectId,
                    metadata: {
                        symbolType: 'method',
                        qualifiedName: `${(element.metadata as any).qualifiedName}.${method.name}`,
                        filePath: method.filePath || (element.metadata as any).filePath,
                        lineNumber: method.lineNumber,
                        signature: method.signature,
                        parameters: method.parameters
                    }
                };
                methodNodes.push(methodNode);
            }

            return methodNodes;
        } catch (error) {
            console.error(`Failed to get methods for class ${element.id}:`, error);
            return [];
        }
    }

    /**
     * Gets children for resource folder nodes
     */
    private getResourceFolderChildren(element: TreeNode): TreeNode[] {
        // Return cached children if available
        const children = element.children ? [...element.children] : [];

        // Update folder inheritance display when folder is expanded
        if (children.length > 0) {
            try {
                if (this.nodeBuilder && typeof this.nodeBuilder.updateFolderInheritanceDisplay === 'function') {
                    this.nodeBuilder.updateFolderInheritanceDisplay(element);
                }
            } catch (error) {
                console.warn(`Failed to update folder inheritance display for ${element.id}:`, error);
            }
        }

        return children;
    }

    /**
     * Determines VS Code collapsible state for a node
     */
    private getCollapsibleState(element: TreeNode): vscode.TreeItemCollapsibleState {
        if (element.type === TreeNodeType.RESOURCE_ITEM) {
            // Python script files can expand to show symbols
            if (element.resourceType === 'script-python') {
                const isExpanded = this.stateManager.isNodeExpanded(element.id);
                return isExpanded
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed;
            }
            // Other files can't expand
            return vscode.TreeItemCollapsibleState.None;
        }

        if (element.type === TreeNodeType.GATEWAY || element.type === TreeNodeType.PROJECT) {
            // Gateway and project selectors should never be expandable
            return vscode.TreeItemCollapsibleState.None;
        }

        // Check if node is expanded
        const isExpanded = this.stateManager.isNodeExpanded(element.id);

        if (isExpanded) {
            return vscode.TreeItemCollapsibleState.Expanded;
        } else if (this.hasChildren(element)) {
            return vscode.TreeItemCollapsibleState.Collapsed;
        }
        return vscode.TreeItemCollapsibleState.None;
    }

    /**
     * Checks if a node should have children
     */
    private hasChildren(element: TreeNode): boolean {
        switch (element.type) {
            case TreeNodeType.RESOURCE_TYPE:
            case TreeNodeType.RESOURCE_CATEGORY:
            case TreeNodeType.RESOURCE_FOLDER:
                return true;

            case TreeNodeType.RESOURCE_ITEM:
                // Python script files have symbols as children
                return element.resourceType === 'script-python';

            case TreeNodeType.GATEWAY:
            case TreeNodeType.PROJECT:
                // Gateway and project selectors should never be expandable
                return false;

            // Perspective nodes are always expandable (except leaf components)
            case TreeNodeType.PERSPECTIVE_SESSIONS:
            case TreeNodeType.PERSPECTIVE_SESSION:
            case TreeNodeType.PERSPECTIVE_PAGE:
            case TreeNodeType.PERSPECTIVE_VIEW:
                return true;

            case TreeNodeType.PERSPECTIVE_COMPONENT:
                // Components are expandable if they have children
                return element.children !== undefined && element.children.length > 0;

            default:
                return element.children !== undefined && element.children.length > 0;
        }
    }

    /**
     * Determines if a node should have a click command
     */
    private shouldAddCommand(element: TreeNode): boolean {
        return (
            element.type === TreeNodeType.RESOURCE_ITEM ||
            element.type === TreeNodeType.SINGLETON_RESOURCE ||
            element.type === TreeNodeType.PYTHON_SYMBOL ||
            element.id === 'gateway-selector' ||
            element.id === 'project-selector'
        );
    }

    /**
     * Detects configuration changes that would require refresh
     */
    private async detectConfigurationChanges(): Promise<boolean> {
        try {
            const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
            if (configService?.hasConfigurationChanged) {
                return (await configService.hasConfigurationChanged()) as boolean;
            }
        } catch (error) {
            console.warn('Failed to detect configuration changes:', error);
        }
        return false;
    }

    /**
     * Detects project content changes that would require refresh
     */
    private async detectProjectChanges(): Promise<string[]> {
        try {
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
            if (projectScannerService?.getChangedProjects) {
                return (await projectScannerService.getChangedProjects()) as string[];
            }
        } catch (error) {
            console.warn('Failed to detect project changes:', error);
        }
        return [];
    }

    /**
     * Sets the tree view reference for auto-reveal functionality
     */
    setTreeView(treeView: vscode.TreeView<TreeNode>): void {
        this.treeView = treeView;
    }

    /**
     * Public method to reveal a resource in the tree
     * Can be called from commands or other services
     */
    async revealResource(uri: vscode.Uri): Promise<void> {
        const document = await vscode.workspace.openTextDocument(uri);
        await this.revealFileInTree(document);
    }

    /**
     * Reveals a file in the tree view if it's part of the current project or inherited projects
     * Only reveals if the tree view is already visible - doesn't open it if closed
     */
    private async revealFileInTree(document: vscode.TextDocument): Promise<void> {
        if (!this.treeView) {
            return;
        }

        // Only reveal if the tree view is already visible - don't open it if closed
        if (!this.treeView.visible) {
            return;
        }

        try {
            const filePath = document.uri.fsPath;

            // Check if this is a script-python file
            if (!filePath.includes('script-python')) {
                return;
            }

            // Get the active project
            const gatewayService = this.serviceContainer.get<any>('GatewayManagerService');
            const activeProject = gatewayService?.getActiveProjectId();
            if (!activeProject) {
                return;
            }

            // Build the path to reveal
            const scriptPythonIndex = filePath.indexOf('script-python');
            if (scriptPythonIndex === -1) {
                return;
            }

            // Extract the module path
            const relativePath = filePath.substring(scriptPythonIndex + 'script-python'.length + 1);
            const moduleParts = relativePath.replace(/[/\\]code\.py$/, '').split(/[/\\]/);

            // Check if the file belongs to the active project or an inherited project
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
            let owningProject = activeProject;

            if (projectScannerService) {
                // Check if the file path contains the active project
                if (!filePath.includes(activeProject)) {
                    // File might be from an inherited project
                    const project = projectScannerService.getProject(activeProject);
                    if (project?.inheritanceChain) {
                        // Check each parent project in the inheritance chain
                        for (const parentProject of project.inheritanceChain) {
                            if (filePath.includes(parentProject)) {
                                // File is from this parent project
                                owningProject = activeProject; // Still use active project ID for tree node
                                break;
                            }
                        }
                    }

                    // If still no match, return - file is not related to active project
                    if (!filePath.includes(owningProject) && owningProject === activeProject) {
                        // One more check - see if any cached project matches
                        const allProjects = projectScannerService.getAllCachedResults();
                        const matchingProject = allProjects.find((p: any) => filePath.includes(p.projectName));
                        if (!matchingProject) {
                            return;
                        }
                    }
                }
            }

            // Build the tree node ID to find - always use the active project ID
            const nodeId = `resource::${activeProject}::script-python::none::${moduleParts.join('/')}`;

            // Try to find and reveal the node
            const node = this.findNodeById(nodeId);
            if (node) {
                await this.treeView.reveal(node, { select: true, focus: false, expand: true });
            }
        } catch {
            // Silently ignore reveal failures - this is a best-effort feature
            // The file still opens successfully, reveal just highlights it in the tree
        }
    }

    /**
     * Finds a tree node by its ID
     * Creates a node structure that getParent() can use to traverse the tree hierarchy
     */
    private findNodeById(nodeId: string): TreeNode | undefined {
        try {
            // Parse node ID format: nodeType::projectId::typeId::categoryId::resourcePath
            const parts = nodeId.split('::');
            if (parts.length >= 5) {
                const nodeType = parts[0];
                const projectId = parts[1];
                const typeId = parts[2];
                const categoryId = parts[3];
                const resourcePath = parts[4];

                // Determine tree node type based on prefix
                const treeNodeType = nodeType === 'folder' ? TreeNodeType.RESOURCE_FOLDER : TreeNodeType.RESOURCE_ITEM;

                // Return a node with all properties needed for getParent() to work
                return {
                    id: nodeId,
                    label: resourcePath.split('/').pop() || resourcePath,
                    type: treeNodeType,
                    projectId,
                    resourcePath,
                    resourceType: typeId,
                    typeId,
                    categoryId
                } as TreeNode;
            }
        } catch (error) {
            console.warn('Error finding node by ID:', error);
        }
        return undefined;
    }

    // ==================== Perspective Session Tree Methods ====================

    /**
     * Gets children for the Perspective Sessions root node
     */
    private async getPerspectiveSessionsChildren(): Promise<TreeNode[]> {
        try {
            const perspectiveService = this.serviceContainer.get<{
                getPerspectiveAvailable(): boolean;
                createSessionNodes(): Promise<TreeNode[]>;
            }>('PerspectiveSessionService');
            if (!perspectiveService) {
                return [
                    {
                        id: 'perspective-unavailable',
                        label: 'Perspective service not available',
                        type: TreeNodeType.EMPTY_NODE,
                        tooltip: 'The Perspective session service is not initialized'
                    }
                ];
            }

            const isAvailable = perspectiveService.getPerspectiveAvailable();
            if (!isAvailable) {
                return [
                    {
                        id: 'perspective-not-available',
                        label: 'Perspective not available on Gateway',
                        type: TreeNodeType.EMPTY_NODE,
                        tooltip: 'Perspective module is not installed or not running'
                    }
                ];
            }

            const sessionNodes = await perspectiveService.createSessionNodes();
            if (sessionNodes.length === 0) {
                return [
                    {
                        id: 'no-perspective-sessions',
                        label: 'No active sessions',
                        type: TreeNodeType.EMPTY_NODE,
                        tooltip: 'No Perspective sessions are currently active'
                    }
                ];
            }

            return sessionNodes;
        } catch (error) {
            console.error('Error getting Perspective sessions:', error);
            return [
                {
                    id: 'perspective-error',
                    label: 'Error loading sessions',
                    type: TreeNodeType.ERROR_NODE,
                    tooltip: `Failed to load sessions: ${String(error)}`,
                    isError: true
                }
            ];
        }
    }

    /**
     * Gets children for a Perspective session node (pages)
     */
    private async getPerspectiveSessionChildren(element: TreeNode): Promise<TreeNode[]> {
        try {
            const perspectiveService = this.serviceContainer.get<{
                createPageNodes(sessionId: string): Promise<TreeNode[]>;
            }>('PerspectiveSessionService');
            if (!perspectiveService) {
                return [];
            }

            const metadata = element.metadata as { sessionId?: string } | undefined;
            const sessionId = metadata?.sessionId;
            if (!sessionId) {
                return [];
            }

            const pageNodes = await perspectiveService.createPageNodes(sessionId);
            if (pageNodes.length === 0) {
                return [
                    {
                        id: `no-pages-${sessionId}`,
                        label: 'No pages',
                        type: TreeNodeType.EMPTY_NODE,
                        tooltip: 'This session has no open pages'
                    }
                ];
            }

            return pageNodes;
        } catch (error) {
            console.error('Error getting session pages:', error);
            return [];
        }
    }

    /**
     * Gets children for a Perspective page node (views)
     */
    private async getPerspectivePageChildren(element: TreeNode): Promise<TreeNode[]> {
        try {
            const perspectiveService = this.serviceContainer.get<{
                createViewNodes(sessionId: string, pageId: string): Promise<TreeNode[]>;
            }>('PerspectiveSessionService');
            if (!perspectiveService) {
                return [];
            }

            const metadata = element.metadata as { sessionId?: string; pageId?: string } | undefined;
            const sessionId = metadata?.sessionId;
            const pageId = metadata?.pageId;
            if (!sessionId || !pageId) {
                return [];
            }

            const viewNodes = await perspectiveService.createViewNodes(sessionId, pageId);
            if (viewNodes.length === 0) {
                return [
                    {
                        id: `no-views-${sessionId}-${pageId}`,
                        label: 'No views',
                        type: TreeNodeType.EMPTY_NODE,
                        tooltip: 'This page has no views'
                    }
                ];
            }

            return viewNodes;
        } catch (error) {
            console.error('Error getting page views:', error);
            return [];
        }
    }

    /**
     * Gets children for a Perspective view node (components)
     */
    private async getPerspectiveViewChildren(element: TreeNode): Promise<TreeNode[]> {
        try {
            const perspectiveService = this.serviceContainer.get<{
                createComponentNodes(sessionId: string, pageId: string, viewInstanceId: string): Promise<TreeNode[]>;
            }>('PerspectiveSessionService');
            if (!perspectiveService) {
                return [];
            }

            const metadata = element.metadata as
                | {
                      sessionId?: string;
                      pageId?: string;
                      viewInstanceId?: string;
                  }
                | undefined;
            const sessionId = metadata?.sessionId;
            const pageId = metadata?.pageId;
            const viewInstanceId = metadata?.viewInstanceId;
            if (!sessionId || !pageId || !viewInstanceId) {
                return [];
            }

            const componentNodes = await perspectiveService.createComponentNodes(sessionId, pageId, viewInstanceId);
            if (componentNodes.length === 0) {
                return [
                    {
                        id: `no-components-${viewInstanceId}`,
                        label: 'No components',
                        type: TreeNodeType.EMPTY_NODE,
                        tooltip: 'This view has no components'
                    }
                ];
            }

            return componentNodes;
        } catch (error) {
            console.error('Error getting view components:', error);
            return [];
        }
    }

    /**
     * Loads configuration from VS Code settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.ui.treeView');

        this.config = {
            enableSmartRefresh: config.get<boolean>('enableSmartRefresh') ?? true,
            enableLazyLoading: config.get<boolean>('enableLazyLoading') ?? true,
            cacheExpirationMs: config.get<number>('cacheExpirationMs') ?? 300000,
            autoRefreshOnConfigChange: config.get<boolean>('autoRefreshOnConfigChange') ?? true,
            showEmptyCategories: config.get<boolean>('showEmptyCategories') ?? false
        };
    }
}
