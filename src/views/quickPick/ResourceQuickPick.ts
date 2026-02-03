/**
 * @module ResourceQuickPick
 * @description Quick pick interface for resource selection and operations
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ProjectResource, ResourceOrigin } from '@/core/types/models';
import { ResourceTypeDefinition } from '@/core/types/resources';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Resource quick pick item
 */
interface ResourceQuickPickItem extends vscode.QuickPickItem {
    readonly resource: ProjectResource;
    readonly projectId: string;
    readonly resourceType: ResourceTypeDefinition;
    readonly resourcePath: string;
    readonly isFolder: boolean;
}

/**
 * Resource quick pick options
 */
interface ResourceQuickPickOptions {
    readonly title?: string;
    readonly placeholder?: string;
    readonly canPickMany?: boolean;
    readonly ignoreFocusOut?: boolean;
    readonly showInheritedResources?: boolean;
    readonly resourceTypeFilter?: readonly string[];
    readonly projectFilter?: readonly string[];
    readonly includeResourceJson?: boolean;
    readonly sortBy?: 'name' | 'type' | 'project' | 'lastModified';
    readonly sortOrder?: 'asc' | 'desc';
}

/**
 * Resource selection result
 */
interface ResourceSelectionResult {
    readonly selectedResources: readonly ResourceQuickPickItem[];
    readonly cancelled: boolean;
    readonly searchQuery?: string;
}

/**
 * Resource group for organizing results
 */
interface ResourceGroup {
    readonly label: string;
    readonly resources: readonly ResourceQuickPickItem[];
    readonly collapsed?: boolean;
}

/**
 * Quick pick provider for resource selection with advanced filtering and search
 */
export class ResourceQuickPick implements IServiceLifecycle {
    private quickPick?: vscode.QuickPick<ResourceQuickPickItem>;
    private allResources: ResourceQuickPickItem[] = [];
    private isInitialized = false;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {}

    async initialize(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        try {
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize resource quick pick',
                'RESOURCE_QUICK_PICK_INIT_FAILED',
                'Resource quick pick could not start properly',
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
        if (this.quickPick) {
            this.quickPick.dispose();
            this.quickPick = undefined;
        }
    }

    async dispose(): Promise<void> {
        await this.stop();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Shows resource selection quick pick
     */
    async showResourcePicker(options: ResourceQuickPickOptions = {}): Promise<ResourceSelectionResult> {
        try {
            // Load all resources
            await this.loadResources(options);

            // Create and configure quick pick
            this.quickPick = vscode.window.createQuickPick<ResourceQuickPickItem>();
            this.configureQuickPick(this.quickPick, options);

            // Set initial items
            this.updateQuickPickItems(this.allResources, options);

            // Setup event handlers
            const result = await this.handleQuickPickInteraction(this.quickPick, options);

            return result;
        } catch (error) {
            throw new FlintError(
                'Failed to show resource picker',
                'RESOURCE_PICKER_FAILED',
                'Resource picker could not be displayed',
                error instanceof Error ? error : undefined
            );
        } finally {
            if (this.quickPick) {
                this.quickPick.dispose();
                this.quickPick = undefined;
            }
        }
    }

    /**
     * Shows project resource browser
     */
    async showProjectBrowser(projectId: string): Promise<ResourceSelectionResult> {
        return this.showResourcePicker({
            title: `Resources in ${projectId}`,
            placeholder: 'Select a resource to open or search...',
            projectFilter: [projectId],
            sortBy: 'type',
            includeResourceJson: false
        });
    }

    /**
     * Shows resource type browser
     */
    async showResourceTypeBrowser(resourceType: string): Promise<ResourceSelectionResult> {
        return this.showResourcePicker({
            title: `${resourceType} Resources`,
            placeholder: 'Select a resource to open...',
            resourceTypeFilter: [resourceType],
            sortBy: 'name'
        });
    }

    /**
     * Shows quick resource opener
     */
    async showQuickOpen(): Promise<ResourceSelectionResult> {
        return this.showResourcePicker({
            title: 'Quick Open Resource',
            placeholder: 'Type to search for resources...',
            sortBy: 'lastModified',
            sortOrder: 'desc',
            showInheritedResources: false
        });
    }

    /**
     * Shows resource operations picker
     */
    async showResourceOperations(resource: ProjectResource, _projectId: string): Promise<string | undefined> {
        const operations = this.getResourceOperations(resource);

        interface OperationItem extends vscode.QuickPickItem {
            id: string;
        }

        const selected = await vscode.window.showQuickPick<OperationItem>(
            operations.map(op => ({
                label: op.label,
                description: op.description,
                id: op.id
            })),
            {
                placeHolder: 'Select an operation...'
            }
        );

        return selected?.id;
    }

    /**
     * Configures the quick pick instance
     */
    private configureQuickPick(
        quickPick: vscode.QuickPick<ResourceQuickPickItem>,
        options: ResourceQuickPickOptions
    ): void {
        quickPick.title = options.title || 'Select Resource';
        quickPick.placeholder = options.placeholder || 'Start typing to search for resources...';
        quickPick.canSelectMany = options.canPickMany || false;
        quickPick.ignoreFocusOut = options.ignoreFocusOut ?? true;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
    }

    /**
     * Loads all available resources
     */
    private async loadResources(options: ResourceQuickPickOptions): Promise<void> {
        try {
            this.allResources = [];

            // Get resources from modern services
            const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
            const resourceTypeService = this.serviceContainer.get<any>('ResourceTypeProviderRegistry');

            const _config = await configService.getConfiguration();

            if (!projectScannerService || !resourceTypeService) {
                console.warn('Required services not available');
                return;
            }

            // Get actual resources from services
            const allResources: Array<{
                resource: ProjectResource;
                projectId: string;
                resourceType: ResourceTypeDefinition;
            }> = [];

            if (projectScannerService && resourceTypeService) {
                try {
                    // Get all projects
                    const projectPaths = await configService.getProjectPaths();

                    for (const projectPath of projectPaths) {
                        // Extract project ID from path
                        const projectId = projectPath.split('/').pop() || projectPath;

                        // Get resources for this project
                        const projectResources = await projectScannerService.getResources(projectId);
                        if (projectResources && projectResources.size > 0) {
                            for (const [_resourceKey, resource] of projectResources) {
                                // Get resource type definition
                                const resourceTypeDef = resourceTypeService.getTypeDefinition(resource.type);
                                if (resourceTypeDef) {
                                    allResources.push({
                                        resource,
                                        projectId,
                                        resourceType: resourceTypeDef
                                    });
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.warn('Failed to load resources from services:', error);
                }
            }

            // Log if no resources loaded
            if (allResources.length === 0) {
                console.log('No resources found in any project');
            }

            // Filter resources based on options
            const filteredResources = this.filterResources(allResources, options);

            // Convert to quick pick items
            this.allResources = filteredResources.map(item => this.createQuickPickItem(item));

            // Sort resources
            this.sortResources(this.allResources, options);
        } catch (error) {
            console.error('Failed to load resources:', error);
            this.allResources = [];
        }
    }

    /**
     * Creates a quick pick item from resource data
     */
    private createQuickPickItem(resource: {
        resource: ProjectResource;
        projectId: string;
        resourceType: ResourceTypeDefinition;
    }): ResourceQuickPickItem {
        const { resource: res, projectId, resourceType } = resource;

        // Build label and description
        const label = this.getResourceDisplayName(res);
        let description = `$(${resourceType.icon || 'file'}) ${resourceType.name}`;

        if (res.origin === ResourceOrigin.INHERITED) {
            description += ' (inherited)';
        }

        // Build detail with project and path info
        let detail = `Project: ${projectId}`;
        if (res.path !== label) {
            detail += ` • Path: ${res.path}`;
        }

        // Add file count if applicable
        if (res.files.length > 1) {
            detail += ` • ${res.files.length} files`;
        }

        return {
            label,
            description,
            detail,
            resource: res,
            projectId,
            resourceType,
            resourcePath: res.path,
            isFolder: res.metadata?.isFolder === true
        };
    }

    /**
     * Filters resources based on options
     */
    private filterResources(
        resources: Array<{
            resource: ProjectResource;
            projectId: string;
            resourceType: ResourceTypeDefinition;
        }>,
        options: ResourceQuickPickOptions
    ): Array<{
        resource: ProjectResource;
        projectId: string;
        resourceType: ResourceTypeDefinition;
    }> {
        let filtered = resources;

        // Filter by resource type
        if (options.resourceTypeFilter && options.resourceTypeFilter.length > 0) {
            filtered = filtered.filter(item => options.resourceTypeFilter!.includes(item.resource.type));
        }

        // Filter by project
        if (options.projectFilter && options.projectFilter.length > 0) {
            filtered = filtered.filter(item => options.projectFilter!.includes(item.projectId));
        }

        // Filter inherited resources
        if (options.showInheritedResources === false) {
            filtered = filtered.filter(item => item.resource.origin !== ResourceOrigin.INHERITED);
        }

        // Filter resource.json files
        if (options.includeResourceJson === false) {
            filtered = filtered.filter(item => !item.resource.files.some(file => file.name === 'resource.json'));
        }

        return filtered;
    }

    /**
     * Sorts resources based on options
     */
    private sortResources(resources: ResourceQuickPickItem[], options: ResourceQuickPickOptions): void {
        const sortBy = options.sortBy || 'name';
        const sortOrder = options.sortOrder || 'asc';
        const multiplier = sortOrder === 'asc' ? 1 : -1;

        resources.sort((a, b) => {
            let comparison = 0;

            switch (sortBy) {
                case 'name':
                    comparison = a.label.localeCompare(b.label);
                    break;
                case 'type':
                    comparison = a.resourceType.name.localeCompare(b.resourceType.name);
                    break;
                case 'project':
                    comparison = a.projectId.localeCompare(b.projectId);
                    break;
                case 'lastModified': {
                    // Compare last modified times from metadata, fallback to name comparison
                    const aTime = a.resource.metadata?.lastModified as number | undefined;
                    const bTime = b.resource.metadata?.lastModified as number | undefined;

                    if (aTime && bTime) {
                        comparison = aTime - bTime;
                    } else if (aTime) {
                        comparison = -1; // a has timestamp, b doesn't - a comes first
                    } else if (bTime) {
                        comparison = 1; // b has timestamp, a doesn't - b comes first
                    } else {
                        comparison = a.label.localeCompare(b.label); // fallback to name
                    }
                    break;
                }
                default:
                    comparison = a.label.localeCompare(b.label);
                    break;
            }

            return comparison * multiplier;
        });
    }

    /**
     * Updates quick pick items with search filtering
     */
    private updateQuickPickItems(resources: ResourceQuickPickItem[], _options: ResourceQuickPickOptions): void {
        if (!this.quickPick) return;

        // Group resources if needed
        if (this.shouldGroupResources(resources)) {
            const groups = this.groupResources(resources);
            const items = this.flattenGroups(groups);
            this.quickPick.items = items;
        } else {
            this.quickPick.items = resources;
        }
    }

    /**
     * Handles quick pick user interaction
     */
    private async handleQuickPickInteraction(
        quickPick: vscode.QuickPick<ResourceQuickPickItem>,
        options: ResourceQuickPickOptions
    ): Promise<ResourceSelectionResult> {
        return new Promise<ResourceSelectionResult>(resolve => {
            // Handle value changes for search
            quickPick.onDidChangeValue(value => {
                // Implement advanced search filtering
                if (value.trim()) {
                    const filtered = this.allResources.filter(item => {
                        const searchText = value.toLowerCase();
                        return (
                            item.label.toLowerCase().includes(searchText) ||
                            (item.description?.toLowerCase().includes(searchText) ?? false) ||
                            (item.detail?.toLowerCase().includes(searchText) ?? false) ||
                            item.resourcePath.toLowerCase().includes(searchText) ||
                            item.resourceType.name.toLowerCase().includes(searchText) ||
                            item.projectId.toLowerCase().includes(searchText)
                        );
                    });
                    this.updateQuickPickItems(filtered, options);
                } else {
                    this.updateQuickPickItems(this.allResources, options);
                }
            });

            // Handle selection
            quickPick.onDidAccept(() => {
                const selected = quickPick.selectedItems;
                resolve({
                    selectedResources: [...selected],
                    cancelled: false,
                    searchQuery: quickPick.value
                });
                quickPick.hide();
            });

            // Handle cancellation
            quickPick.onDidHide(() => {
                if (quickPick.selectedItems.length === 0) {
                    resolve({
                        selectedResources: [],
                        cancelled: true
                    });
                }
            });

            // Show the quick pick
            quickPick.show();
        });
    }

    /**
     * Gets resource display name
     */
    private getResourceDisplayName(resource: ProjectResource): string {
        const pathParts = resource.path.split('/');
        return pathParts[pathParts.length - 1] || resource.path;
    }

    /**
     * Checks if resources should be grouped
     */
    private shouldGroupResources(resources: ResourceQuickPickItem[]): boolean {
        // Group if we have resources from multiple projects or types
        const projects = new Set(resources.map(r => r.projectId));
        const types = new Set(resources.map(r => r.resourceType.id));

        return projects.size > 1 || types.size > 3;
    }

    /**
     * Groups resources by project and type
     */
    private groupResources(resources: ResourceQuickPickItem[]): ResourceGroup[] {
        const groups = new Map<string, ResourceQuickPickItem[]>();

        for (const resource of resources) {
            const groupKey = `${resource.projectId} - ${resource.resourceType.name}`;
            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(resource);
        }

        return Array.from(groups.entries()).map(([label, resources]) => ({
            label,
            resources
        }));
    }

    /**
     * Flattens resource groups into quick pick items
     */
    private flattenGroups(groups: ResourceGroup[]): ResourceQuickPickItem[] {
        const items: ResourceQuickPickItem[] = [];

        for (const group of groups) {
            // Add group separator
            items.push({
                label: group.label,
                kind: vscode.QuickPickItemKind.Separator,
                resource: {} as ProjectResource,
                projectId: '',
                resourceType: {} as ResourceTypeDefinition,
                resourcePath: '',
                isFolder: false
            });

            // Add group items
            items.push(...group.resources);
        }

        return items;
    }

    /**
     * Gets available operations for a resource
     */
    private getResourceOperations(resource: ProjectResource): Array<{
        id: string;
        label: string;
        description?: string;
    }> {
        const operations = [
            { id: 'open', label: '$(file) Open', description: 'Open resource in editor' },
            { id: 'reveal', label: '$(eye) Reveal in Tree', description: 'Show resource in project browser' },
            { id: 'copy-path', label: '$(copy) Copy Path', description: 'Copy resource path to clipboard' }
        ];

        // Add type-specific operations
        if (resource.files.some(f => f.name === 'resource.json')) {
            operations.push({
                id: 'validate-json',
                label: '$(check) Validate resource.json',
                description: 'Validate resource.json format'
            });
        }

        if (resource.origin !== ResourceOrigin.INHERITED) {
            operations.push(
                { id: 'rename', label: '$(edit) Rename', description: 'Rename this resource' },
                { id: 'duplicate', label: '$(files) Duplicate', description: 'Create a copy of this resource' },
                { id: 'delete', label: '$(trash) Delete', description: 'Delete this resource' }
            );
        }

        return operations;
    }
}
