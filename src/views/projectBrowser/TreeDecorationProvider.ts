/**
 * @module TreeDecorationProvider
 * @description Handles tree item decorations, icons, and visual indicators
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ResourceOrigin } from '@/core/types/models';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { TreeNode, TreeNodeType, TreeItem } from '@/core/types/tree';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';

/**
 * Decoration configuration
 */
interface DecorationConfig {
    readonly showWarningIcons: boolean;
    readonly showInheritanceIndicator: boolean;
    readonly showResourceCounts: boolean;
    readonly useColoredIcons: boolean;
    readonly propagateWarningsToFolders: boolean;
}

/**
 * Icon theme configuration
 */
interface IconTheme {
    readonly gateway: string;
    readonly project: string;
    readonly resourceType: string;
    readonly resourceFolder: string;
    readonly resourceFile: string;
    readonly warning: string;
    readonly error: string;
    readonly inherited: string;
    readonly missing: string;
}

/**
 * Warning types for resources
 */
enum WarningType {
    MISSING_RESOURCE_JSON = 'missing-resource-json',
    INVALID_RESOURCE_JSON = 'invalid-resource-json',
    MISSING_PARENT_PROJECT = 'missing-parent-project',
    CIRCULAR_INHERITANCE = 'circular-inheritance',
    DEPRECATED_TYPE = 'deprecated-type'
}

/**
 * Provides decorations for tree items including icons, warnings, and tooltips
 */
export class TreeDecorationProvider implements IServiceLifecycle {
    private resourceJsonTypes = new Set<string>();

    private config: DecorationConfig = {
        showWarningIcons: true,
        showInheritanceIndicator: true,
        showResourceCounts: false,
        useColoredIcons: true,
        propagateWarningsToFolders: true
    };

    private iconTheme: IconTheme = {
        gateway: 'server',
        project: 'folder',
        resourceType: 'symbol-class',
        resourceFolder: 'folder',
        resourceFile: 'file',
        warning: 'warning',
        error: 'error',
        inherited: 'arrow-down',
        missing: 'question'
    };

    private isInitialized = false;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {}

    async initialize(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        try {
            this.loadConfiguration();
            this.initializeResourceTypes();
            this.setupConfigurationWatcher();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize tree decoration provider',
                'TREE_DECORATION_INIT_FAILED',
                'Tree decoration provider could not start properly',
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
        // Nothing to stop
    }

    async dispose(): Promise<void> {
        // Nothing to dispose
    }

    /**
     * Initializes resource types dynamically from ResourceTypeProviderRegistry
     */
    private initializeResourceTypes(): void {
        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

        if (!providerRegistry) {
            throw new FlintError(
                'ResourceTypeProviderRegistry is unavailable',
                'RESOURCE_PROVIDER_REGISTRY_UNAVAILABLE',
                'Cannot initialize resource types without provider registry'
            );
        }

        const allProviders = providerRegistry.getAllProviders();

        // Add all resource types that support templates (likely need resource.json)
        allProviders.forEach(provider => {
            const templateConfig = provider.getTemplateConfig();
            if (templateConfig.templates && templateConfig.templates.length > 0) {
                // Check if template includes resource.json
                const hasResourceJson = templateConfig.templates.some(
                    t => t.files && Object.keys(t.files).includes('resource.json')
                );
                if (hasResourceJson) {
                    this.resourceJsonTypes.add(provider.resourceTypeId);
                }
            }
        });
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Applies decorations to a tree item
     */
    applyDecorations(item: any, node: TreeNode): void {
        // Get base icon
        const baseIcon = this.getIcon(node);

        // Apply decorations based on node state - use VS Code ThemeIcon objects
        if (node.isError) {
            item.iconPath = new vscode.ThemeIcon(this.iconTheme.error, new vscode.ThemeColor('errorForeground'));
        } else if (this.hasWarnings(node)) {
            item.iconPath = new vscode.ThemeIcon(
                this.iconTheme.warning,
                new vscode.ThemeColor('problemsWarningIcon.foreground')
            );
        } else if (node.origin === ResourceOrigin.INHERITED && this.config.useColoredIcons) {
            item.iconPath = new vscode.ThemeIcon(
                baseIcon || this.iconTheme.resourceFile,
                new vscode.ThemeColor('descriptionForeground')
            );
        } else if (baseIcon) {
            item.iconPath = new vscode.ThemeIcon(baseIcon);
        }

        // Apply context value
        item.contextValue = this.getContextValue(node);

        // Apply tooltip
        item.tooltip = this.getTooltip(node);
    }

    /**
     * Applies VS Code specific decorations to a VS Code TreeItem
     */
    applyVSCodeDecorations(item: vscode.TreeItem, node: TreeNode): void {
        // Get base icon
        const baseIcon = this.getIcon(node);

        // Apply decorations based on node state with actual ThemeIcon objects
        if (node.isError) {
            item.iconPath = new vscode.ThemeIcon(this.iconTheme.error, new vscode.ThemeColor('errorForeground'));
        } else if (this.hasWarnings(node)) {
            item.iconPath = new vscode.ThemeIcon(
                this.iconTheme.warning,
                new vscode.ThemeColor('problemsWarningIcon.foreground')
            );
        } else if (node.origin === ResourceOrigin.INHERITED && this.config.useColoredIcons) {
            item.iconPath = new vscode.ThemeIcon(
                baseIcon || this.iconTheme.resourceFile,
                new vscode.ThemeColor('descriptionForeground')
            );
        } else if (baseIcon) {
            item.iconPath = new vscode.ThemeIcon(baseIcon);
        }

        // Apply context value and tooltip
        item.contextValue = this.getContextValue(node);
        item.tooltip = this.getTooltip(node);
    }

    /**
     * Gets appropriate icon for node
     */
    getIcon(node: TreeNode): string | undefined {
        // Handle error states first
        if (node.isError) {
            return this.iconTheme.error;
        }

        // Handle loading states
        if (node.isLoading) {
            return 'loading~spin';
        }

        // Handle specific node types
        switch (node.type) {
            case TreeNodeType.GATEWAY:
                return this.getGatewayIcon(node);

            case TreeNodeType.PROJECT:
                return this.getProjectIcon(node);

            case TreeNodeType.RESOURCE_TYPE:
                return this.getResourceTypeIcon(node);

            case TreeNodeType.RESOURCE_CATEGORY:
                return this.getResourceCategoryIcon(node);

            case TreeNodeType.RESOURCE_FOLDER:
                return this.getResourceFolderIcon(node);

            case TreeNodeType.RESOURCE_ITEM:
                return this.getResourceItemIcon(node);

            case TreeNodeType.SINGLETON_RESOURCE:
                return this.getResourceItemIcon(node); // Use same logic as resource items

            case TreeNodeType.SEARCH_RESULT:
                return 'search';

            default:
                return undefined;
        }
    }

    /**
     * Gets context value for node with decoration info
     */
    getContextValue(node: TreeNode): string | undefined {
        let contextValue = node.contextValue || '';

        // Add warning indicators
        if (this.hasWarnings(node)) {
            const warnings = this.getWarnings(node);
            for (const warning of warnings) {
                contextValue += `.${warning}`;
            }
        }

        // Add inheritance indicator
        if (node.origin === ResourceOrigin.INHERITED && this.config.showInheritanceIndicator) {
            contextValue += '.inherited';
        }

        return contextValue || undefined;
    }

    /**
     * Gets enhanced tooltip for node
     */
    getTooltip(node: TreeNode): string | undefined {
        let tooltip = node.tooltip || '';

        // Add warning information
        if (this.hasWarnings(node)) {
            const warnings = this.getWarnings(node);
            const warningTexts = warnings.map(w => this.getWarningText(w));
            tooltip += tooltip ? '\n\n' : '';
            tooltip += `⚠️ Warnings:\n${warningTexts.map(w => `• ${w}`).join('\n')}`;
        }

        // Add inheritance information
        if (node.origin === ResourceOrigin.INHERITED && this.config.showInheritanceIndicator) {
            tooltip += tooltip ? '\n\n' : '';
            tooltip += '📋 Inherited from parent project';
        }

        return tooltip || undefined;
    }

    /**
     * Applies warning decoration to tree item
     */
    applyWarningDecoration(item: TreeItem, node: TreeNode): void {
        if (!this.config.showWarningIcons) return;

        const warnings = this.getWarnings(node);
        const hasCriticalWarnings = warnings.some(w => this.isCriticalWarning(w));

        if (hasCriticalWarnings) {
            // Override icon with warning icon for critical warnings
            item.iconPath = this.iconTheme.warning;
        } else {
            // Use warning icon for existing icon
            if (typeof item.iconPath === 'string') {
                item.iconPath = this.iconTheme.warning;
            }
        }
    }

    /**
     * Applies error decoration to tree item
     */
    applyErrorDecoration(item: TreeItem, _node: TreeNode): void {
        item.iconPath = this.iconTheme.error;
    }

    /**
     * Updates decoration configuration
     */
    updateConfiguration(newConfig: Partial<DecorationConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Gets current configuration
     */
    getConfiguration(): Readonly<DecorationConfig> {
        return Object.freeze({ ...this.config });
    }

    /**
     * Gets gateway-specific icon
     */
    private getGatewayIcon(_node: TreeNode): string {
        return this.iconTheme.gateway;
    }

    /**
     * Gets project-specific icon
     */
    private getProjectIcon(_node: TreeNode): string {
        return this.iconTheme.project;
    }

    /**
     * Gets resource type icon
     */
    private getResourceTypeIcon(node: TreeNode): string {
        // Use icon from node if available, otherwise use default
        return node.icon || this.iconTheme.resourceType;
    }

    /**
     * Gets resource category icon
     */
    private getResourceCategoryIcon(node: TreeNode): string {
        return node.icon || this.iconTheme.resourceType;
    }

    /**
     * Gets resource folder icon with warning propagation
     */
    private getResourceFolderIcon(node: TreeNode): string {
        // Check for warnings in this folder if propagation is enabled
        if (this.config.propagateWarningsToFolders && this.config.showWarningIcons) {
            if (this.hasMissingResourceJsonInSubtree(node)) {
                return this.iconTheme.warning;
            }

            // Check for other folder-level warnings
            const warnings = this.getWarnings(node);
            if (warnings.length > 0) {
                const hasCriticalWarnings = warnings.some(w => this.isCriticalWarning(w));
                if (hasCriticalWarnings) {
                    return this.iconTheme.error;
                }
                return this.iconTheme.warning;
            }
        }

        return this.iconTheme.resourceFolder;
    }

    /**
     * Gets resource item icon with decoration
     */
    private getResourceItemIcon(node: TreeNode): string {
        // Check for missing resource.json
        if (this.config.showWarningIcons && this.isMissingResourceJson(node)) {
            return this.iconTheme.warning;
        }

        // Use resource type specific icon or default
        return node.icon || this.getResourceTypeIconName(node);
    }

    /**
     * Gets resource type specific icon name from provider - NO INFERENCE
     */
    private getResourceTypeIconName(node: TreeNode): string {
        const resourceType = node.resourceType;

        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

        if (!providerRegistry || !resourceType) {
            return this.iconTheme.resourceFile;
        }

        const provider = providerRegistry.getProvider(resourceType);
        if (!provider) {
            console.warn(`No provider found for resource type: ${resourceType}`);
            return this.iconTheme.resourceFile;
        }

        // Get explicit icon from provider's search configuration
        const searchConfig = provider.getSearchConfig();

        // Check if provider defines a specific icon for its category
        if (searchConfig.categoryIcon) {
            return searchConfig.categoryIcon;
        }

        console.warn(
            `No explicit icon defined for resource type: ${resourceType} - provider should define categoryIcon in search configuration`
        );
        return this.iconTheme.resourceFile;
    }

    /**
     * Checks if node has warnings
     */
    private hasWarnings(node: TreeNode): boolean {
        return this.getWarnings(node).length > 0;
    }

    /**
     * Gets all warnings for a node
     */
    private getWarnings(node: TreeNode): WarningType[] {
        const warnings: WarningType[] = [];

        // Check for missing resource.json
        if (this.isMissingResourceJson(node)) {
            warnings.push(WarningType.MISSING_RESOURCE_JSON);
        }

        // Check folder propagation
        if (
            node.type === TreeNodeType.RESOURCE_FOLDER &&
            this.config.propagateWarningsToFolders &&
            this.hasMissingResourceJsonInSubtree(node)
        ) {
            warnings.push(WarningType.MISSING_RESOURCE_JSON);
        }

        // Check for additional warning conditions
        this.checkInvalidResourceJson(node, warnings);
        this.checkMissingParentProject(node, warnings);
        this.checkCircularInheritance(node, warnings);
        this.checkDeprecatedResourceType(node, warnings);

        return warnings;
    }

    /**
     * Gets warning text for display
     */
    private getWarningText(warning: WarningType): string {
        switch (warning) {
            case WarningType.MISSING_RESOURCE_JSON:
                return 'Missing resource.json file';
            case WarningType.INVALID_RESOURCE_JSON:
                return 'Invalid resource.json format';
            case WarningType.MISSING_PARENT_PROJECT:
                return 'Parent project not found';
            case WarningType.CIRCULAR_INHERITANCE:
                return 'Circular inheritance detected';
            case WarningType.DEPRECATED_TYPE:
                return 'Deprecated resource type';
            default:
                return 'Unknown warning';
        }
    }

    /**
     * Checks if warning is critical
     */
    private isCriticalWarning(warning: WarningType): boolean {
        switch (warning) {
            case WarningType.MISSING_RESOURCE_JSON:
            case WarningType.INVALID_RESOURCE_JSON:
            case WarningType.CIRCULAR_INHERITANCE:
                return true;
            case WarningType.MISSING_PARENT_PROJECT:
            case WarningType.DEPRECATED_TYPE:
                return false;
            default:
                return false;
        }
    }

    /**
     * Checks if resource is missing resource.json
     */
    private isMissingResourceJson(node: TreeNode): boolean {
        if (node.type !== TreeNodeType.RESOURCE_ITEM) return false;
        if (!node.resourceType || !node.projectId || !node.resourcePath) return false;

        // Only check for resource types that need resource.json
        if (!this.resourceJsonTypes.has(node.resourceType)) {
            return false;
        }

        try {
            // Get resource data from project scanner service
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
            if (projectScannerService?.getResource) {
                const resource = projectScannerService.getResource(node.projectId, node.resourcePath);
                if (resource?.files) {
                    // Check if resource.json file exists
                    const hasResourceJson = resource.files.some(
                        (file: { name?: string; path?: string }) =>
                            file.name === 'resource.json' || file.path?.endsWith('/resource.json') === true
                    );
                    return !hasResourceJson;
                }
            }

            // If we can't get the resource data, assume it's not missing to avoid false positives
            return false;
        } catch (error) {
            console.warn(`Failed to check resource.json for ${node.resourcePath}:`, error);
            return false;
        }
    }

    /**
     * Checks if folder has resources missing resource.json in subtree
     */
    private hasMissingResourceJsonInSubtree(node: TreeNode): boolean {
        if (node.type !== TreeNodeType.RESOURCE_FOLDER) return false;
        if (!node.projectId || !node.resourcePath) return false;

        try {
            // Get all resources under this folder path from project scanner service
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
            if (projectScannerService?.getResourcesInPath) {
                const resources = projectScannerService.getResourcesInPath(node.projectId, node.resourcePath);

                if (resources && Array.isArray(resources)) {
                    // Check if any resources in subtree are missing resource.json
                    return resources.some(
                        (resource: { type?: string; files?: Array<{ name?: string; path?: string }> }) => {
                            // Only check resources that need resource.json
                            if (!resource.type || !this.resourceJsonTypes.has(resource.type)) {
                                return false;
                            }

                            // Check if resource.json file exists
                            if (resource.files) {
                                const hasResourceJson = resource.files.some(
                                    (file: { name?: string; path?: string }) =>
                                        file.name === 'resource.json' || file.path?.endsWith('/resource.json') === true
                                );
                                return !hasResourceJson;
                            }
                            return false;
                        }
                    );
                }
            }

            return false;
        } catch (error) {
            console.warn(`Failed to check subtree warnings for folder ${node.resourcePath}:`, error);
            return false;
        }
    }

    /**
     * Checks for invalid resource.json format
     */
    private checkInvalidResourceJson(node: TreeNode, warnings: WarningType[]): void {
        if (node.type !== TreeNodeType.RESOURCE_ITEM) return;
        if (!node.resourceType || !node.projectId || !node.resourcePath) return;

        // Only check for resource types that have resource.json
        if (!this.resourceJsonTypes.has(node.resourceType)) return;

        try {
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
            if (projectScannerService?.getResource) {
                const resource = projectScannerService.getResource(node.projectId, node.resourcePath);
                if (resource?.files) {
                    const resourceJsonFile = resource.files.find(
                        (file: { name?: string; path?: string; hasValidationErrors?: boolean }) =>
                            file.name === 'resource.json' || file.path?.endsWith('/resource.json') === true
                    );

                    if (resourceJsonFile?.hasValidationErrors) {
                        warnings.push(WarningType.INVALID_RESOURCE_JSON);
                    }
                }
            }
        } catch {
            // Silently handle validation errors to avoid spam
        }
    }

    /**
     * Checks for missing parent project issues
     */
    private checkMissingParentProject(node: TreeNode, warnings: WarningType[]): void {
        if (node.type !== TreeNodeType.RESOURCE_ITEM) return;
        if (node.origin !== ResourceOrigin.INHERITED) return;

        try {
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
            if (projectScannerService?.getProject) {
                const resource = projectScannerService.getResource(node.projectId, node.resourcePath);
                if (resource?.sourceProject) {
                    const parentProject = projectScannerService.getProject(resource.sourceProject);
                    if (!parentProject) {
                        warnings.push(WarningType.MISSING_PARENT_PROJECT);
                    }
                }
            }
        } catch {
            // Silently handle validation errors
        }
    }

    /**
     * Checks for circular inheritance issues
     */
    private checkCircularInheritance(node: TreeNode, warnings: WarningType[]): void {
        if (node.type !== TreeNodeType.PROJECT) return;

        try {
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
            if (projectScannerService?.detectCircularInheritance) {
                const hasCircularInheritance = projectScannerService.detectCircularInheritance(node.projectId);
                if (hasCircularInheritance) {
                    warnings.push(WarningType.CIRCULAR_INHERITANCE);
                }
            }
        } catch {
            // Silently handle validation errors
        }
    }

    /**
     * Checks for deprecated resource types
     */
    private checkDeprecatedResourceType(node: TreeNode, warnings: WarningType[]): void {
        if (node.type !== TreeNodeType.RESOURCE_ITEM) return;
        if (!node.resourceType) return;

        try {
            const resourceTypeRegistry = this.serviceContainer.get<any>('ResourceTypeRegistry');
            if (resourceTypeRegistry?.getTypeDefinition) {
                const typeDef = resourceTypeRegistry.getTypeDefinition(node.resourceType);
                if (typeDef?.deprecated) {
                    warnings.push(WarningType.DEPRECATED_TYPE);
                }
            }
        } catch {
            // Silently handle validation errors
        }
    }

    /**
     * Loads configuration from VS Code settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.ui.treeView');

        this.config = {
            showWarningIcons: config.get<boolean>('showWarningIcons') ?? true,
            showInheritanceIndicator: config.get<boolean>('showInheritanceIndicator') ?? true,
            showResourceCounts: config.get<boolean>('showResourceCounts') ?? false,
            useColoredIcons: config.get<boolean>('useColoredIcons') ?? true,
            propagateWarningsToFolders: config.get<boolean>('propagateWarningsToFolders') ?? true
        };

        // Load icon theme overrides if configured
        const iconConfig = config.get<Partial<IconTheme>>('iconTheme');
        if (iconConfig) {
            this.iconTheme = { ...this.iconTheme, ...iconConfig };
        }
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
                    console.warn('Failed to reload tree decoration configuration:', error);
                }
            }
        });
    }
}
