/**
 * @module TreeCommandHandler
 * @description Handles tree item commands, interactions, and context menu actions
 */

import * as vscode from 'vscode';

import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { TreeNode, TreeNodeType, TreeItemCollapsibleState } from '@/core/types/tree';

/**
 * Command handling configuration
 */
interface CommandHandlerConfig {
    readonly enableDoubleClickToOpen: boolean;
    readonly enableContextMenus: boolean;
    readonly showInheritedResources: boolean;
    readonly confirmDestructiveActions: boolean;
}

/**
 * Tree interaction event
 */
interface TreeInteractionEvent {
    readonly node: TreeNode;
    readonly action: string;
    readonly timestamp: Date;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Command execution context
 */
interface CommandExecutionContext {
    readonly node: TreeNode;
    readonly command: string;
    readonly args?: readonly unknown[];
    readonly source: 'click' | 'doubleClick' | 'contextMenu' | 'keyboard';
}

/**
 * Handles tree item commands, user interactions, and context menu actions
 */
export class TreeCommandHandler implements IServiceLifecycle {
    private config: CommandHandlerConfig = {
        enableDoubleClickToOpen: true,
        enableContextMenus: true,
        showInheritedResources: true,
        confirmDestructiveActions: true
    };

    private readonly interactionHistory: TreeInteractionEvent[] = [];
    private isInitialized = false;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {}

    async initialize(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        try {
            this.loadConfiguration();
            this.setupConfigurationWatcher();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize tree command handler',
                'TREE_COMMAND_HANDLER_INIT_FAILED',
                'Tree command handler could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async stop(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        // Clear interaction history
        this.interactionHistory.length = 0;
    }

    async dispose(): Promise<void> {
        await this.stop();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Handles node selection (single click)
     */
    async handleNodeSelection(node: TreeNode): Promise<void> {
        try {
            this.recordInteraction(node, 'selection');

            // Handle different node types
            switch (node.type) {
                case TreeNodeType.GATEWAY:
                    await this.handleGatewaySelection(node);
                    break;

                case TreeNodeType.PROJECT:
                    await this.handleProjectSelection(node);
                    break;

                case TreeNodeType.RESOURCE_ITEM:
                    this.handleResourceSelection(node);
                    break;

                case TreeNodeType.RESOURCE_FOLDER:
                    this.handleFolderSelection(node);
                    break;

                default:
                    // Default behavior - just select the node
                    break;
            }
        } catch (error) {
            throw new FlintError(
                'Failed to handle node selection',
                'NODE_SELECTION_FAILED',
                `Could not process selection for node: ${node.id}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Handles node double-click
     */
    async handleNodeDoubleClick(node: TreeNode): Promise<void> {
        if (!this.config.enableDoubleClickToOpen) return;

        try {
            this.recordInteraction(node, 'doubleClick');

            // Handle different node types
            switch (node.type) {
                case TreeNodeType.RESOURCE_ITEM:
                    await this.openResource(node);
                    break;

                case TreeNodeType.SINGLETON_RESOURCE:
                    await this.openResource(node);
                    break;

                case TreeNodeType.RESOURCE_FOLDER:
                    // Toggle expansion
                    await vscode.commands.executeCommand('workbench.actions.treeOpenEditors.toggleExpansion');
                    break;

                case TreeNodeType.GATEWAY:
                    await this.selectGateway(node);
                    break;

                case TreeNodeType.PROJECT:
                    await this.selectProject(node);
                    break;

                default:
                    // Default behavior - expand/collapse if collapsible
                    if (
                        node.collapsibleState !== undefined &&
                        node.collapsibleState !== TreeItemCollapsibleState.None
                    ) {
                        await vscode.commands.executeCommand('workbench.actions.treeOpenEditors.toggleExpansion');
                    }
                    break;
            }
        } catch (error) {
            throw new FlintError(
                'Failed to handle node double-click',
                'NODE_DOUBLE_CLICK_FAILED',
                `Could not process double-click for node: ${node.id}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Handles context menu actions
     */
    async handleContextMenuAction(node: TreeNode, action: string): Promise<void> {
        if (!this.config.enableContextMenus) return;

        try {
            this.recordInteraction(node, 'contextMenu', { action });

            const context: CommandExecutionContext = {
                node,
                command: action,
                source: 'contextMenu'
            };

            await this.executeCommand(context);
        } catch (error) {
            throw new FlintError(
                'Failed to handle context menu action',
                'CONTEXT_MENU_ACTION_FAILED',
                `Could not execute context menu action "${action}" for node: ${node.id}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Handles node expansion
     */
    async handleNodeExpansion(node: TreeNode): Promise<void> {
        try {
            this.recordInteraction(node, 'expansion');

            // Notify state manager of expansion
            try {
                const stateManager = this.serviceContainer.get<any>('TreeStateManager');
                if (stateManager) {
                    stateManager.setNodeExpanded(node.id, true);
                }
            } catch (error) {
                console.warn(`Failed to update expansion state for node ${node.id}:`, error);
            }

            // Perform any lazy loading if needed
            await this.performLazyLoading(node);
        } catch (error) {
            console.warn(`Failed to handle node expansion for ${node.id}:`, error);
        }
    }

    /**
     * Handles node collapse
     */
    handleNodeCollapse(node: TreeNode): void {
        try {
            this.recordInteraction(node, 'collapse');

            // Notify state manager of collapse
            try {
                const stateManager = this.serviceContainer.get<any>('TreeStateManager');
                if (stateManager) {
                    stateManager.setNodeExpanded(node.id, false);
                }
            } catch (error) {
                console.warn(`Failed to update expansion state for node ${node.id}:`, error);
            }
        } catch (error) {
            console.warn(`Failed to handle node collapse for ${node.id}:`, error);
        }
    }

    /**
     * Gets interaction history
     */
    getInteractionHistory(): readonly TreeInteractionEvent[] {
        return [...this.interactionHistory];
    }

    /**
     * Updates command handler configuration
     */
    updateConfiguration(newConfig: Partial<CommandHandlerConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Gets current configuration
     */
    getConfiguration(): Readonly<CommandHandlerConfig> {
        return Object.freeze({ ...this.config });
    }

    /**
     * Executes a command in context
     */
    private async executeCommand(context: CommandExecutionContext): Promise<void> {
        const { node, command } = context;

        switch (command) {
            // Resource operations
            case 'flint.openResource':
                await this.openResource(node);
                break;

            case 'flint.createResource':
                await vscode.commands.executeCommand(COMMANDS.CREATE_RESOURCE, node);
                break;

            case 'flint.createFolder':
                await vscode.commands.executeCommand(COMMANDS.CREATE_FOLDER, node);
                break;

            case 'flint.deleteResource':
                await this.deleteResource(node);
                break;

            case 'flint.renameResource':
                await vscode.commands.executeCommand(COMMANDS.RENAME_RESOURCE, node);
                break;

            case 'flint.duplicateResource':
                await vscode.commands.executeCommand(COMMANDS.DUPLICATE_RESOURCE, node);
                break;

            case 'flint.copyPath':
                await vscode.commands.executeCommand(COMMANDS.COPY_RESOURCE_PATH, node);
                break;

            // Resource JSON operations
            case 'flint.createResourceJson':
                await vscode.commands.executeCommand(COMMANDS.CREATE_RESOURCE_JSON, node);
                break;

            case 'flint.validateResourceJson':
                await vscode.commands.executeCommand(COMMANDS.VALIDATE_RESOURCE_JSON, node);
                break;

            // Gateway/Project operations
            case 'flint.selectGateway':
                await this.selectGateway(node);
                break;

            case 'flint.selectProject':
                await this.selectProject(node);
                break;

            case 'flint.refreshProject':
                await vscode.commands.executeCommand(COMMANDS.REFRESH_PROJECTS);
                break;

            // Configuration operations
            case 'flint.openConfig':
                await vscode.commands.executeCommand(COMMANDS.OPEN_CONFIG);
                break;

            case 'flint.getStarted':
                await vscode.commands.executeCommand(COMMANDS.GET_STARTED);
                break;

            default:
                console.warn(`Unknown command: ${command}`);
                break;
        }
    }

    /**
     * Records user interaction for analytics
     */
    private recordInteraction(node: TreeNode, action: string, metadata?: Record<string, unknown>): void {
        const event: TreeInteractionEvent = {
            node,
            action,
            timestamp: new Date(),
            metadata
        };

        this.interactionHistory.push(event);

        // Keep only last 100 interactions
        if (this.interactionHistory.length > 100) {
            this.interactionHistory.shift();
        }
    }

    /**
     * Handles gateway selection
     */
    private async handleGatewaySelection(node: TreeNode): Promise<void> {
        // Show gateway selection quick pick if this is the gateway selector
        if (node.id === 'gateway-selector') {
            await vscode.commands.executeCommand(COMMANDS.SELECT_GATEWAY);
        }
    }

    /**
     * Handles project selection
     */
    private async handleProjectSelection(node: TreeNode): Promise<void> {
        // Show project selection quick pick if this is the project selector
        if (node.id === 'project-selector') {
            await vscode.commands.executeCommand(COMMANDS.SELECT_PROJECT);
        }
    }

    /**
     * Handles resource selection
     */
    private handleResourceSelection(node: TreeNode): void {
        // Show resource details in status bar
        if (node.resourcePath && node.projectId) {
            const resourceType = node.resourceType ? ` (${node.resourceType})` : '';
            const origin = node.origin ? ` • ${node.origin}` : '';
            vscode.window.setStatusBarMessage(
                `🎯 ${node.resourcePath}${resourceType} in ${node.projectId}${origin}`,
                5000
            );
        }
    }

    /**
     * Handles folder selection
     */
    private handleFolderSelection(node: TreeNode): void {
        // Show folder details in status bar
        if (node.resourcePath && node.projectId) {
            const childCount = node.children ? ` (${node.children.length} items)` : '';
            vscode.window.setStatusBarMessage(`📁 ${node.resourcePath}${childCount} in ${node.projectId}`, 5000);
        }
    }

    /**
     * Opens a resource in appropriate editor
     */
    private async openResource(node: TreeNode): Promise<void> {
        if (!node.projectId || !node.resourcePath) {
            throw new FlintError(
                'Cannot open resource',
                'INVALID_RESOURCE_NODE',
                'Resource node is missing project ID or resource path'
            );
        }

        await vscode.commands.executeCommand(COMMANDS.OPEN_RESOURCE, node);
    }

    /**
     * Deletes a resource with confirmation
     */
    private async deleteResource(node: TreeNode): Promise<void> {
        if (!this.config.confirmDestructiveActions) {
            await vscode.commands.executeCommand(COMMANDS.DELETE_RESOURCE, node);
            return;
        }

        const isFolder = node.type === TreeNodeType.RESOURCE_FOLDER;
        const resourceType = isFolder ? 'folder' : 'resource';
        const resourceName = node.label;

        const choice = await vscode.window.showWarningMessage(
            `Delete ${resourceType} "${resourceName}"?`,
            {
                modal: true,
                detail: isFolder
                    ? 'This will delete the folder and all resources it contains. This action cannot be undone.'
                    : 'This will delete the resource. This action cannot be undone.'
            },
            'Delete'
        );

        if (choice === 'Delete') {
            await vscode.commands.executeCommand(COMMANDS.DELETE_RESOURCE, node);
        }
    }

    /**
     * Selects a gateway
     */
    private async selectGateway(_node: TreeNode): Promise<void> {
        await vscode.commands.executeCommand(COMMANDS.SELECT_GATEWAY);
    }

    /**
     * Selects a project
     */
    private async selectProject(_node: TreeNode): Promise<void> {
        await vscode.commands.executeCommand(COMMANDS.SELECT_PROJECT);
    }

    /**
     * Performs lazy loading for expanded nodes
     */
    private async performLazyLoading(node: TreeNode): Promise<void> {
        try {
            // Only perform lazy loading for resource folders and types
            if (
                node.type !== TreeNodeType.RESOURCE_FOLDER &&
                node.type !== TreeNodeType.RESOURCE_TYPE &&
                node.type !== TreeNodeType.RESOURCE_CATEGORY
            ) {
                return;
            }

            // Check if we need to scan for new resources
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
            if (projectScannerService && node.projectId) {
                // Trigger selective rescan for this resource path
                await projectScannerService.scanResourcePath(node.projectId, node.resourcePath);

                // Invalidate cache for this node to force refresh
                const stateManager = this.serviceContainer.get<any>('TreeStateManager');
                if (stateManager) {
                    stateManager.invalidateCache(node.id);
                }
            }
        } catch (error) {
            console.warn(`Failed to perform lazy loading for node ${node.id}:`, error);
        }
    }

    /**
     * Loads configuration from VS Code settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.ui.treeView');

        this.config = {
            enableDoubleClickToOpen: config.get<boolean>('enableDoubleClickToOpen') ?? true,
            enableContextMenus: config.get<boolean>('enableContextMenus') ?? true,
            showInheritedResources: config.get<boolean>('showInheritedResources') ?? true,
            confirmDestructiveActions: config.get<boolean>('confirmDestructiveActions') ?? true
        };
    }

    /**
     * Sets up configuration change watcher
     */
    private setupConfigurationWatcher(): void {
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('flint.ui.treeView')) {
                try {
                    this.loadConfiguration();
                } catch (error) {
                    console.warn('Failed to reload tree command handler configuration:', error);
                }
            }
        });
    }
}
