/**
 * @module TreeNodeBuilder
 * @description Builds tree nodes for the project browser tree view
 */

import * as fs from 'fs';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IgnitionProject, ProjectResource, ResourceOrigin, ResourceFile } from '@/core/types/models';
import { ResourceTypeDefinition } from '@/core/types/resources';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { TreeNode, TreeNodeType } from '@/core/types/tree';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';

/**
 * Tree node builder configuration
 */
interface TreeNodeBuilderConfig {
    readonly showInheritanceIndicator: boolean;
    readonly showResourceCounts: boolean;
    readonly showMissingResourceJson: boolean;
    readonly useCompactFolders: boolean;
    readonly showInheritedResources: boolean;
    readonly showEmptyCategories: boolean;
}

/**
 * Node creation context
 */
interface NodeCreationContext {
    readonly projectId: string;
    readonly typeId?: string;
    readonly categoryId?: string;
    readonly parentPath?: string;
}

/**
 * Resource statistics for categories/types
 */
interface ResourceStats {
    readonly total: number;
    readonly missingResourceJson: number;
    readonly inherited: number;
    readonly folders: number;
}

/**
 * Builds and manages tree node construction for the project browser
 */
export class TreeNodeBuilder implements IServiceLifecycle {
    private resourceJsonTypes = new Set<string>();

    private config: TreeNodeBuilderConfig = {
        showInheritanceIndicator: true,
        showResourceCounts: true,
        showMissingResourceJson: true,
        useCompactFolders: false,
        showInheritedResources: true,
        showEmptyCategories: true
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
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize tree node builder',
                'TREE_NODE_BUILDER_INIT_FAILED',
                'Tree node builder could not start properly',
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
        try {
            // Get resource types from ResourceTypeProviderRegistry
            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (providerRegistry) {
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
            } else {
                // No fallback - empty set if provider registry is unavailable
                this.resourceJsonTypes = new Set();
            }
        } catch (error) {
            console.error('TreeNodeBuilder: Failed to initialize resource types from provider registry:', error);
            this.resourceJsonTypes = new Set();
        }
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Creates root nodes for the tree (gateways, projects, etc.)
     */
    async createRootNodes(
        gateways: Map<string, any>,
        activeGateway?: string,
        activeProject?: string,
        availableProjects?: string[]
    ): Promise<TreeNode[]> {
        const nodes: TreeNode[] = [];

        // Gateway selector - always at root level (shows "Add Gateway" button when empty)
        nodes.push(this.createGatewaySelectorNode(gateways, activeGateway));

        // Pre-scan the active project if we have one, so inheritance info is available for project selector
        const projectScanResult = await this.preScanActiveProject(activeGateway, activeProject);

        // Project selector - now created after project is scanned so inheritance info is available
        nodes.push(this.createProjectSelectorNode(availableProjects || [], gateways.size > 0, activeProject));

        // Separator
        nodes.push(this.createSeparatorNode());

        // If we have both gateway and project selected and scan succeeded, add the project content
        if (activeGateway && activeProject && projectScanResult) {
            const contentNodes = this.createProjectContentNodes(activeProject, projectScanResult);
            nodes.push(...contentNodes);
        }

        return nodes;
    }

    /**
     * Pre-scans the active project to prepare for tree building
     */
    private async preScanActiveProject(activeGateway?: string, activeProject?: string): Promise<any> {
        if (!activeGateway || !activeProject) {
            return null;
        }

        try {
            // Get config service to find project path
            const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');

            if (!configService || !projectScannerService) {
                return null;
            }

            // Get project paths from config
            const projectPaths = await configService.getProjectPaths();

            // Find the actual project directory within the configured paths
            const projectPath = this.findProjectPath(projectPaths, activeProject);

            if (projectPath) {
                // Scan the project to get resources and cache it
                return await projectScannerService.scanProject(projectPath);
            }
        } catch (error) {
            console.warn(`Failed to pre-scan project ${activeProject}:`, error);
        }

        return null;
    }

    /**
     * Finds the project path within configured paths
     */
    private findProjectPath(projectPaths: string[], activeProject: string): string | undefined {
        for (const basePath of projectPaths) {
            const candidatePath = `${basePath}/${activeProject}`;

            // Check if this project directory exists
            try {
                if (fs.existsSync(candidatePath)) {
                    // Verify it's actually an Ignition project by checking for project.json
                    const projectJsonPath = `${candidatePath}/project.json`;
                    if (fs.existsSync(projectJsonPath)) {
                        return candidatePath;
                    }
                }
            } catch {
                // Try next path
            }
        }
        return undefined;
    }

    /**
     * Creates project content nodes from scan results
     */
    private createProjectContentNodes(activeProject: string, projectScanResult: any): TreeNode[] {
        try {
            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (!providerRegistry) {
                return [];
            }

            const scanResult = projectScanResult;
            const localResourceCount = scanResult?.resources?.length || 0;
            const inheritedResourceCount = scanResult?.inheritedResources?.length || 0;
            const allResourcesFound = localResourceCount + inheritedResourceCount;

            if (allResourcesFound === 0) {
                return [];
            }

            // Process resources into organized collections
            const { rootLevelResources, categorizedResources, allResources } = this.organizeResources(
                scanResult,
                activeProject
            );

            // Create nodes
            const nodes: TreeNode[] = [];

            // Create root-level resource nodes
            const rootNodes = this.createRootLevelResourceNodes(rootLevelResources, activeProject, allResources);
            nodes.push(...rootNodes);

            // Create category nodes with sub-types
            const categoryNodes = this.createCategoryTreeNodes(categorizedResources, activeProject, allResources);
            nodes.push(...categoryNodes);

            return nodes;
        } catch (error) {
            console.warn(`Failed to load project content for ${activeProject}:`, error);
            // Add error node to show what went wrong
            return [
                {
                    id: 'project-content-error',
                    label: 'Error loading project content',
                    type: TreeNodeType.ERROR_NODE,
                    tooltip: `Failed to load resources for project ${activeProject}: ${String(error)}`,
                    isError: true,
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                }
            ];
        }
    }

    /**
     * Organizes scan results into root-level and categorized resources
     */
    private organizeResources(
        scanResult: any,
        activeProject: string
    ): {
        rootLevelResources: Map<string, Map<string, ProjectResource>>;
        categorizedResources: Map<string, Map<string, Map<string, ProjectResource>>>;
        allResources: ProjectResource[];
    } {
        const rootLevelResources = new Map<string, Map<string, ProjectResource>>();
        const categorizedResources = new Map<string, Map<string, Map<string, ProjectResource>>>();

        // Process local resources
        const localResources = scanResult.resources || [];
        for (const resource of localResources) {
            this.processResource(
                resource,
                ResourceOrigin.LOCAL,
                activeProject,
                rootLevelResources,
                categorizedResources
            );
        }

        // Process inherited resources if showing inherited resources is enabled
        if (this.config.showInheritedResources && scanResult.inheritedResources) {
            for (const resource of scanResult.inheritedResources) {
                // Inherited resources already have the correct origin and sourceProject
                this.processResource(
                    resource,
                    resource.origin || ResourceOrigin.INHERITED,
                    resource.sourceProject || activeProject,
                    rootLevelResources,
                    categorizedResources
                );
            }
        }

        // Combine all resources for node creation
        const allResources = [...localResources, ...(scanResult.inheritedResources || [])];

        return { rootLevelResources, categorizedResources, allResources };
    }

    /**
     * Creates resource type nodes
     */
    createResourceTypeNodes(
        project: IgnitionProject,
        resourceTypes: ResourceTypeDefinition[],
        resourcesByType: Map<string, Map<string, ProjectResource>>
    ): TreeNode[] {
        const nodes: TreeNode[] = [];

        for (const typeDef of resourceTypes) {
            // Service interface doesn't have internal property, skip internal check

            const resources = resourcesByType.get(typeDef.id);

            // Skip empty resource types only if showEmptyCategories is false
            if (!this.config.showEmptyCategories && (!resources || resources.size === 0)) {
                continue;
            }

            const stats = this.calculateResourceStats(resources || new Map(), typeDef.id);
            const node = this.createResourceTypeNode(typeDef, stats, project.id);

            // Store resources for later use (empty Map if no resources)
            (node as any).resources = resources || new Map();
            nodes.push(node);
        }

        return nodes.sort((a, b) => {
            const aOrder = (a as any).sortOrder || 999;
            const bOrder = (b as any).sortOrder || 999;
            return aOrder - bOrder;
        });
    }

    /**
     * Creates root-level resource nodes (no parent category)
     */
    createRootLevelResourceNodes(
        rootLevelResources: Map<string, Map<string, ProjectResource>>,
        projectId: string,
        _allResources: any[]
    ): TreeNode[] {
        const nodes: TreeNode[] = [];

        // Resource type display names for root-level resources
        // Get display names from ResourceTypeProviderRegistry
        const typeDisplayNames = this.getTypeDisplayNames();

        // Get all available resource types from registry
        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
        if (!providerRegistry) {
            return nodes;
        }

        const allProviders = providerRegistry.getAllProviders();

        // Iterate through ALL resource types, not just ones with resources
        for (const provider of allProviders) {
            const typeId = provider.resourceTypeId;
            const searchConfig = provider.getSearchConfig();

            // Skip categorized resource types (they'll be handled in createCategoryTreeNodes)
            if (searchConfig.category) {
                continue;
            }

            // Get resources for this type (may be empty)
            const resourcesMap = rootLevelResources.get(typeId) || new Map();
            const displayName = provider.displayName || typeDisplayNames[typeId] || typeId;
            const resourceCount = resourcesMap.size;

            // Skip empty resource types only if showEmptyCategories is false
            if (!this.config.showEmptyCategories && resourceCount === 0) {
                continue;
            }

            // Check if this is a singleton type
            if (this.isSingletonType(typeId) && resourceCount === 1) {
                // For singletons, create a directly clickable item (no expansion, no count)
                const singletonResource = Array.from(resourcesMap.values())[0];

                const singletonNode: TreeNode = {
                    id: `singleton-${projectId}-${typeId}`,
                    label: displayName, // No count for singletons
                    type: TreeNodeType.SINGLETON_RESOURCE, // Dedicated singleton type
                    icon: this.getResourceIcon(singletonResource), // Use resource-specific icon
                    collapsibleState: vscode.TreeItemCollapsibleState.None,
                    contextValue: 'singletonResource',
                    projectId,
                    // Use actual resource path for file operations
                    resourcePath: this.extractResourcePath(singletonResource.path),
                    resourceType: typeId, // Set directly on TreeNode object
                    typeId, // Resource type identifier
                    categoryId: undefined, // Set directly on TreeNode object
                    origin: singletonResource.origin,
                    tooltip: this.createResourceTooltip(singletonResource)
                };
                (singletonNode as any).originalResourcePath = singletonResource.path;

                nodes.push(singletonNode);
            } else {
                // For regular root-level resources, create expandable nodes with counts
                const rootNode: TreeNode = {
                    id: `root-${projectId}-${typeId}`,
                    label: `${displayName} (${resourceCount})`,
                    type: TreeNodeType.RESOURCE_TYPE,
                    icon: this.getResourceTypeIcon(typeId),
                    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                    contextValue: 'resourceType',
                    projectId,
                    resourcePath: '', // Root path for resource type
                    resourceType: typeId, // Set directly on TreeNode object
                    typeId, // Resource type identifier
                    categoryId: 'root' // Set directly on TreeNode object
                };
                (rootNode as any).resources = resourcesMap;

                nodes.push(rootNode);
            }
        }

        return nodes.sort((a, b) => a.label.localeCompare(b.label));
    }

    /**
     * Gets resource type display names from ResourceTypeProviderRegistry
     */
    private getTypeDisplayNames(): Record<string, string> {
        try {
            // Get display names from ResourceTypeProviderRegistry
            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (providerRegistry) {
                const allProviders = providerRegistry.getAllProviders();
                const displayNames: Record<string, string> = {};

                allProviders.forEach(provider => {
                    displayNames[provider.resourceTypeId] = provider.displayName;
                });

                return displayNames;
            }
        } catch (error) {
            console.error('TreeNodeBuilder: Failed to get display names from provider registry:', error);
        }

        // No fallback - return empty object if provider registry is unavailable
        return {};
    }

    /**
     * Gets category display names from ResourceTypeProviderRegistry
     */
    private getCategoryDisplayNames(): Record<string, string> {
        try {
            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (providerRegistry) {
                const allProviders = providerRegistry.getAllProviders();
                const categoryDisplayNames: Record<string, string> = {};

                // Collect unique categories from providers - category IS the display name
                allProviders.forEach(provider => {
                    const searchConfig = provider.getSearchConfig();
                    if (searchConfig.category) {
                        // Category field is the display name itself
                        categoryDisplayNames[searchConfig.category] = searchConfig.category;
                    }
                });

                return categoryDisplayNames;
            }
        } catch (error) {
            console.error('TreeNodeBuilder: Failed to get category display names from provider registry:', error);
        }

        // Return empty object if provider registry is unavailable
        return {};
    }

    /**
     * Creates a singleton tree node for an existing resource
     */
    private createExistingSingletonNode(
        singletonResource: ProjectResource,
        displayName: string,
        projectId: string,
        categoryId: string,
        typeId: string
    ): TreeNode {
        const node: TreeNode = {
            id: `singleton-${projectId}-${categoryId}-${typeId}`,
            label: displayName,
            type: TreeNodeType.SINGLETON_RESOURCE,
            icon: this.getResourceIcon(singletonResource),
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            contextValue: 'singletonResource',
            projectId,
            resourcePath: this.extractResourcePath(singletonResource.path),
            resourceType: typeId,
            typeId,
            categoryId,
            origin: singletonResource.origin,
            tooltip: this.createResourceTooltip(singletonResource)
        };
        (node as any).originalResourcePath = singletonResource.path;
        return node;
    }

    /**
     * Creates an empty singleton tree node for a resource that can be created
     */
    private createEmptySingletonNode(
        displayName: string,
        projectId: string,
        categoryId: string,
        typeId: string,
        icon: string
    ): TreeNode {
        return {
            id: `empty-singleton-${projectId}-${categoryId}-${typeId}`,
            label: displayName,
            type: TreeNodeType.SINGLETON_RESOURCE,
            icon,
            description: '(not created)',
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            contextValue: 'emptySingletonResource',
            projectId,
            resourcePath: '',
            resourceType: typeId,
            typeId,
            categoryId,
            tooltip: `${displayName} (click to create)`
        };
    }

    /**
     * Processes providers for a category, separating singletons from non-singletons
     */
    private processCategoryProviders(
        categoryProviders: any[],
        typesMap: Map<string, Map<string, ProjectResource>>,
        typeDisplayNames: Record<string, string>,
        projectId: string,
        categoryId: string
    ): { singletonNodes: TreeNode[]; nonSingletonTypes: Map<string, Map<string, ProjectResource>>; count: number } {
        const singletonNodes: TreeNode[] = [];
        const nonSingletonTypes: Map<string, Map<string, ProjectResource>> = new Map();
        let count = 0;

        for (const provider of categoryProviders) {
            const typeId = provider.resourceTypeId;
            const resourcesMap = typesMap.get(typeId) || new Map();

            if (!this.config.showEmptyCategories && resourcesMap.size === 0) {
                continue;
            }

            if (this.isSingletonType(typeId)) {
                const displayName = provider.displayName || typeDisplayNames[typeId] || typeId;
                if (resourcesMap.size === 1) {
                    const resource = Array.from(resourcesMap.values())[0] as ProjectResource;
                    singletonNodes.push(
                        this.createExistingSingletonNode(resource, displayName, projectId, categoryId, typeId)
                    );
                } else if (resourcesMap.size === 0) {
                    const searchConfig = provider.getSearchConfig();
                    const icon = searchConfig.categoryIcon || this.getResourceTypeIcon(typeId);
                    singletonNodes.push(
                        this.createEmptySingletonNode(displayName, projectId, categoryId, typeId, icon)
                    );
                }
            } else {
                nonSingletonTypes.set(typeId, resourcesMap);
                count += resourcesMap.size;
            }
        }

        return { singletonNodes, nonSingletonTypes, count };
    }

    /**
     * Creates category tree nodes with proper hierarchy
     */
    createCategoryTreeNodes(
        resourcesByCategory: Map<string, Map<string, Map<string, ProjectResource>>>,
        projectId: string,
        _allResources: any[]
    ): TreeNode[] {
        const nodes: TreeNode[] = [];
        const categoryDisplayNames = this.getCategoryDisplayNames();
        const typeDisplayNames = this.getTypeDisplayNames();

        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
        if (!providerRegistry) {
            return nodes;
        }

        const allProviders = providerRegistry.getAllProviders();
        const allCategories = new Set<string>();

        for (const provider of allProviders) {
            const searchConfig = provider.getSearchConfig();
            if (searchConfig.category) {
                allCategories.add(searchConfig.category);
            }
        }

        for (const categoryId of allCategories) {
            const typesMap = resourcesByCategory.get(categoryId) || new Map();
            const categoryDisplayName = categoryDisplayNames[categoryId] || categoryId;
            const categoryProviders = allProviders.filter(p => p.getSearchConfig().category === categoryId);

            const { singletonNodes, nonSingletonTypes, count } = this.processCategoryProviders(
                categoryProviders,
                typesMap,
                typeDisplayNames,
                projectId,
                categoryId
            );

            const totalItems = singletonNodes.length + nonSingletonTypes.size;
            if (totalItems > 0 || this.config.showEmptyCategories) {
                const categoryNode: TreeNode = {
                    id: `category-${projectId}-${categoryId}`,
                    label: count > 0 ? `${categoryDisplayName} (${count})` : categoryDisplayName,
                    type: TreeNodeType.RESOURCE_CATEGORY,
                    icon: this.getCategoryIcon(categoryId),
                    collapsibleState:
                        nonSingletonTypes.size > 0 || singletonNodes.length > 0
                            ? vscode.TreeItemCollapsibleState.Collapsed
                            : vscode.TreeItemCollapsibleState.None,
                    contextValue: 'resourceCategory',
                    projectId
                };

                (categoryNode as any).categoryId = categoryId;
                (categoryNode as any).typesMap = nonSingletonTypes;
                (categoryNode as any).typeDisplayNames = typeDisplayNames;
                (categoryNode as any).singletonNodes = singletonNodes;

                nodes.push(categoryNode);
            }
        }

        return nodes.sort((a, b) => a.label.localeCompare(b.label));
    }

    /**
     * Creates category nodes for resource types with categories
     */
    createCategoryNodes(
        typeId: string,
        typeDef: ResourceTypeDefinition,
        resources: Map<string, ProjectResource>,
        projectId: string
    ): TreeNode[] {
        // Provider interface uses categories object, not single category
        if (!typeDef.categories) {
            return this.createResourceTree(resources, { projectId, typeId });
        }

        const nodes: TreeNode[] = [];
        // Get first category for now - in future could support multiple
        const categoryKeys = Object.keys(typeDef.categories);
        if (categoryKeys.length === 0) {
            return this.createResourceTree(resources, { projectId, typeId });
        }
        const categoryId = categoryKeys[0];
        const category = typeDef.categories[categoryId];

        const categoryResources = this.filterResourcesByCategory(resources, categoryId, category);

        if (categoryResources.size > 0) {
            const stats = this.calculateResourceStats(categoryResources, typeId);
            const node = this.createResourceCategoryNode(categoryId, category, stats, projectId, typeId);

            // Store resources for later use
            (node as any).resources = categoryResources;
            nodes.push(node);
        }

        return nodes;
    }

    /**
     * Creates a hierarchical resource tree from flat resource map
     */
    createResourceTree(resources: Map<string, ProjectResource>, context: NodeCreationContext): TreeNode[] {
        const tree = new Map<string, TreeNode>();
        const rootNodes: TreeNode[] = [];

        // Sort resources for consistent ordering
        const sortedResources = Array.from(resources.entries()).sort(([a], [b]) => a.localeCompare(b));

        for (const [resourceKey, resource] of sortedResources) {
            const resourcePath = this.extractResourcePath(resourceKey);
            const effectivePath = this.transformResourcePath(resourcePath, resource.type, context.categoryId);

            if (resource.metadata?.isFolder) {
                this.processFolder(effectivePath, resource, context, tree, rootNodes);
            } else {
                this.processFile(effectivePath, resource, context, tree, rootNodes);
            }
        }

        // Sort and structure the tree
        return this.sortAndStructureTree(rootNodes);
    }

    /**
     * Creates a folder node
     */
    createFolderNode(folderPath: string, label: string, context: NodeCreationContext): TreeNode {
        const node: TreeNode = {
            id: this.buildNodeId('folder', context, folderPath),
            label,
            type: TreeNodeType.RESOURCE_FOLDER,
            icon: 'folder',
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            contextValue: 'resourceFolder',
            projectId: context.projectId,
            resourcePath: folderPath,
            resourceType: context.typeId, // Set directly on TreeNode object
            typeId: context.typeId, // Resource type identifier
            categoryId: context.categoryId, // Set directly on TreeNode object
            children: []
        };

        return node;
    }

    /**
     * Analyzes a folder's inheritance based on its children
     */
    private analyzeFolderInheritance(folderNode: TreeNode): { allInherited: boolean; closestSource?: string } {
        if (!folderNode.children || folderNode.children.length === 0) {
            return { allInherited: false };
        }

        let inheritedCount = 0;
        const sourceProjects = new Set<string>();

        // Recursively check all descendants
        const checkNode = (node: TreeNode): void => {
            if (node.origin === ResourceOrigin.INHERITED && (node as any).sourceProject) {
                inheritedCount++;
                sourceProjects.add((node as any).sourceProject);
            } else if (node.origin === ResourceOrigin.LOCAL) {
                // If any local resource found, folder is not exclusively inherited
            }

            // Check children recursively
            if (node.children) {
                for (const child of node.children) {
                    checkNode(child);
                }
            }
        };

        let totalResourceCount = 0;
        const countResources = (node: TreeNode): void => {
            if (node.type === TreeNodeType.RESOURCE_ITEM) {
                totalResourceCount++;
                checkNode(node);
            } else if (node.children) {
                for (const child of node.children) {
                    countResources(child);
                }
            }
        };

        for (const child of folderNode.children) {
            countResources(child);
        }

        const allInherited = totalResourceCount > 0 && inheritedCount === totalResourceCount;

        // Find closest source (first in inheritance chain if multiple sources)
        let closestSource: string | undefined;
        if (allInherited && sourceProjects.size > 0) {
            // Get the inheritance chain from project scanner to determine closest parent
            try {
                const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
                if (projectScannerService?.getProject) {
                    const project = projectScannerService.getProject(folderNode.projectId);
                    if (project?.inheritanceChain && project.inheritanceChain.length > 0) {
                        // Find the first source project that appears in the inheritance chain
                        for (const chainProject of project.inheritanceChain) {
                            if (sourceProjects.has(chainProject)) {
                                closestSource = chainProject;
                                break;
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn('Failed to determine closest inheritance source:', error);
            }

            // Fallback: if we can't determine from chain, use any source
            if (!closestSource && sourceProjects.size > 0) {
                closestSource = Array.from(sourceProjects)[0];
            }
        }

        return { allInherited, closestSource };
    }

    /**
     * Updates folder inheritance display after children are populated
     */
    updateFolderInheritanceDisplay(folderNode: TreeNode): void {
        if (!this.config.showInheritanceIndicator) return;

        const { allInherited, closestSource } = this.analyzeFolderInheritance(folderNode);

        if (allInherited && closestSource) {
            (folderNode as any).description = `(inherited from ${closestSource})`;
            (folderNode as any).origin = ResourceOrigin.INHERITED;
            (folderNode as any).sourceProject = closestSource;
        }
    }

    /**
     * Creates a resource file node
     */
    createResourceNode(
        resourcePath: string,
        label: string,
        resource: ProjectResource,
        context: NodeCreationContext
    ): TreeNode {
        // Check if this is a Python script file - they should be expandable to show symbols
        const isPythonScript = resource.type === 'script-python' || context.typeId === 'script-python';

        const node: TreeNode = {
            id: this.buildNodeId('resource', context, resourcePath),
            label,
            type: TreeNodeType.RESOURCE_ITEM,
            icon: this.getResourceIcon(resource),
            collapsibleState: isPythonScript
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
            contextValue: isPythonScript ? 'pythonScript' : 'resource',
            projectId: context.projectId,
            resourcePath,
            resourceType: resource.type || context.typeId, // Set directly on TreeNode object
            typeId: context.typeId, // Resource type identifier
            categoryId: context.categoryId, // Set directly on TreeNode object
            origin: resource.origin,
            tooltip: this.createResourceTooltip(resource)
        };

        // Store original untransformed path for file operations
        (node as any).originalResourcePath = resource.path;

        // Add inheritance indicator
        if (resource.origin === ResourceOrigin.INHERITED && this.config.showInheritanceIndicator) {
            (node as any).description = `(inherited from ${resource.sourceProject})`;
            (node as any).sourceProject = resource.sourceProject;
        }

        return node;
    }

    /**
     * Updates tree node builder configuration
     */
    updateConfiguration(newConfig?: Partial<TreeNodeBuilderConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Gets current configuration
     */
    getConfiguration(): Readonly<TreeNodeBuilderConfig> {
        return Object.freeze({ ...this.config });
    }

    /**
     * Loads configuration from VS Code settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.ui.treeView');

        this.config = {
            showInheritanceIndicator: config.get<boolean>('showInheritanceIndicator') ?? true,
            showResourceCounts: config.get<boolean>('showResourceCounts') ?? true,
            showMissingResourceJson: config.get<boolean>('showMissingResourceJson') ?? true,
            useCompactFolders: config.get<boolean>('useCompactFolders') ?? false,
            showInheritedResources:
                vscode.workspace.getConfiguration('flint').get<boolean>('showInheritedResources') ?? true,
            showEmptyCategories: config.get<boolean>('showEmptyCategories') ?? true
        };
    }

    /**
     * Creates gateway selector node
     */
    private createGatewaySelectorNode(gateways: Map<string, any>, activeGateway?: string): TreeNode {
        const description = gateways.size === 0 ? 'No gateways configured' : activeGateway || 'No gateway selected';

        return {
            id: 'gateway-selector',
            label: 'Gateway',
            type: TreeNodeType.GATEWAY,
            icon: 'server',
            description,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            contextValue: gateways.size === 0 ? 'gatewaySelector.empty' : 'gatewaySelector'
        };
    }

    /**
     * Creates project selector node
     */
    private createProjectSelectorNode(
        availableProjects: string[],
        hasGateways: boolean,
        activeProject?: string
    ): TreeNode {
        let description: string;
        let contextValue: string;

        if (!hasGateways) {
            description = 'Select a gateway first';
            contextValue = 'projectSelector.noGateways';
        } else if (availableProjects.length === 0) {
            description = 'No projects configured';
            contextValue = 'projectSelector.empty';
        } else if (activeProject) {
            // Show project name with inheritance information in description
            try {
                const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
                if (projectScannerService?.getProject) {
                    const project = projectScannerService.getProject(activeProject);
                    if (project?.metadata?.parent) {
                        // Show only the direct parent (1 level up)
                        description = `${activeProject} (inherits from ${project.metadata.parent})`;
                    } else {
                        description = activeProject;
                    }
                } else {
                    description = activeProject;
                }
            } catch (error) {
                console.warn(`TreeNodeBuilder: Failed to get project inheritance info for ${activeProject}:`, error);
                description = activeProject;
            }
            contextValue = 'projectSelector';
        } else {
            description = 'No project selected';
            contextValue = 'projectSelector';
        }

        return {
            id: 'project-selector',
            label: 'Project',
            type: TreeNodeType.PROJECT,
            icon: 'folder',
            description,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            contextValue
        };
    }

    /**
     * Creates separator node
     */
    private createSeparatorNode(): TreeNode {
        return {
            id: 'separator',
            label: '',
            type: TreeNodeType.EMPTY_NODE,
            collapsibleState: vscode.TreeItemCollapsibleState.None
        };
    }

    /**
     * Creates resource type node
     */
    private createResourceTypeNode(typeDef: ResourceTypeDefinition, stats: ResourceStats, projectId: string): TreeNode {
        let label = `${typeDef.name}`;

        if (this.config.showResourceCounts) {
            label += ` (${stats.total})`;
        }

        if (this.config.showMissingResourceJson && stats.missingResourceJson > 0) {
            label += ` ⚠️ ${stats.missingResourceJson} missing resource.json`;
        }

        const node: TreeNode = {
            id: `resource-type-${typeDef.id}`,
            label,
            type: TreeNodeType.RESOURCE_TYPE,
            icon: this.getResourceTypeIcon(typeDef.id),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            contextValue: 'resourceType',
            projectId,
            resourcePath: '', // Root path for resource type
            resourceType: typeDef.id, // Set directly on TreeNode object
            typeId: typeDef.id // Resource type identifier
        };
        (node as any).sortOrder = 999; // Service interface doesn't have sortOrder

        return node;
    }

    /**
     * Creates resource category node
     */
    private createResourceCategoryNode(
        categoryId: string,
        category: any,
        stats: ResourceStats,
        projectId: string,
        typeId: string
    ): TreeNode {
        let label = category.name;

        if (this.config.showResourceCounts) {
            label += ` (${stats.total})`;
        }

        if (this.config.showMissingResourceJson && stats.missingResourceJson > 0) {
            label += ` ⚠️ ${stats.missingResourceJson}`;
        }

        const node: TreeNode = {
            id: `resource-category-${projectId}-${typeId}-${categoryId}`,
            label,
            type: TreeNodeType.RESOURCE_CATEGORY,
            icon: category.icon,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            contextValue: 'resourceCategory',
            projectId,
            resourceType: typeId, // Set directly on TreeNode object
            categoryId // Set directly on TreeNode object
        };

        return node;
    }

    /**
     * Calculates statistics for resource collection
     */
    private calculateResourceStats(resources: Map<string, ProjectResource>, typeId: string): ResourceStats {
        let total = 0;
        let missingResourceJson = 0;
        let inherited = 0;
        let folders = 0;

        const needsResourceJson = this.resourceJsonTypes.has(typeId);

        for (const [, resource] of resources) {
            total++;

            if (resource.metadata?.isFolder) {
                folders++;
            } else if (needsResourceJson) {
                const hasResourceJson = resource.files.some((file: ResourceFile) => file.name === 'resource.json');
                if (!hasResourceJson) {
                    missingResourceJson++;
                }
            }

            if (resource.origin === ResourceOrigin.INHERITED) {
                inherited++;
            }
        }

        return { total, missingResourceJson, inherited, folders };
    }

    /**
     * Filters resources by category patterns
     */
    private filterResourcesByCategory(
        resources: Map<string, ProjectResource>,
        categoryId: string,
        category: any
    ): Map<string, ProjectResource> {
        const filtered = new Map<string, ProjectResource>();

        for (const [path, resource] of resources) {
            let shouldInclude = false;

            if (resource.metadata?.isFolder) {
                shouldInclude = path.startsWith(`${categoryId}/`);
            } else if (resource.files.length > 0 && category.patterns) {
                for (const pattern of category.patterns) {
                    const hasMatchingFile = resource.files.some(
                        (file: ResourceFile) => file.name === pattern.primaryFile
                    );
                    if (hasMatchingFile) {
                        shouldInclude = true;
                        break;
                    }
                }
            }

            if (shouldInclude) {
                filtered.set(path, resource);
            }
        }

        return filtered;
    }

    /**
     * Processes a folder resource into the tree structure
     */
    private processFolder(
        folderPath: string,
        resource: ProjectResource,
        context: NodeCreationContext,
        tree: Map<string, TreeNode>,
        rootNodes: TreeNode[]
    ): void {
        const pathParts = folderPath.split('/');

        // Create intermediate folders
        this.createIntermediateFolders(pathParts.slice(0, -1), context, tree, rootNodes);

        // Create the actual folder
        const folderId = this.buildNodeId('folder', context, folderPath);
        if (!tree.has(folderId)) {
            const folderNode = this.createFolderNode(folderPath, pathParts[pathParts.length - 1], context);
            tree.set(folderId, folderNode);
            this.addToParentOrRoot(pathParts.slice(0, -1), folderNode, context, tree, rootNodes);
        }
    }

    /**
     * Processes a file resource into the tree structure
     */
    private processFile(
        resourcePath: string,
        resource: ProjectResource,
        context: NodeCreationContext,
        tree: Map<string, TreeNode>,
        rootNodes: TreeNode[]
    ): void {
        const pathParts = resourcePath.split('/');

        // Create intermediate folders
        this.createIntermediateFolders(pathParts.slice(0, -1), context, tree, rootNodes);

        // Create the file node
        const fileNode = this.createResourceNode(resourcePath, pathParts[pathParts.length - 1], resource, {
            ...context,
            typeId: resource.type
        });

        // Add to parent or root
        this.addToParentOrRoot(pathParts.slice(0, -1), fileNode, context, tree, rootNodes);
    }

    /**
     * Creates intermediate folder nodes as needed
     */
    private createIntermediateFolders(
        parentParts: string[],
        context: NodeCreationContext,
        tree: Map<string, TreeNode>,
        rootNodes: TreeNode[]
    ): void {
        for (let i = 1; i <= parentParts.length; i++) {
            const partialPath = parentParts.slice(0, i).join('/');
            const folderId = this.buildNodeId('folder', context, partialPath);

            if (!tree.has(folderId)) {
                const folderNode = this.createFolderNode(partialPath, parentParts[i - 1], context);
                tree.set(folderId, folderNode);

                if (i === 1) {
                    // Top-level folder
                    if (!rootNodes.some(node => node.id === folderId)) {
                        rootNodes.push(folderNode);
                    }
                } else {
                    // Nested folder
                    const parentPath = parentParts.slice(0, i - 1).join('/');
                    const parentId = this.buildNodeId('folder', context, parentPath);
                    const parent = tree.get(parentId);
                    if (parent && !parent.children?.some(child => child.id === folderId)) {
                        if (!parent.children) (parent as any).children = [];
                        (parent.children as TreeNode[]).push(folderNode);
                    }
                }
            }
        }
    }

    /**
     * Adds a node to its parent folder or root collection
     */
    private addToParentOrRoot(
        parentParts: string[],
        node: TreeNode,
        context: NodeCreationContext,
        tree: Map<string, TreeNode>,
        rootNodes: TreeNode[]
    ): void {
        if (parentParts.length === 0) {
            // Add to root
            if (!rootNodes.some(n => n.id === node.id)) {
                rootNodes.push(node);
            }
        } else {
            // Add to parent folder
            const parentPath = parentParts.join('/');
            const parentId = this.buildNodeId('folder', context, parentPath);
            const parent = tree.get(parentId);
            if (parent && !parent.children?.some(child => child.id === node.id)) {
                if (!parent.children) (parent as any).children = [];
                (parent.children as TreeNode[]).push(node);
            }
        }
    }

    /**
     * Sorts and structures the tree recursively
     */
    private sortAndStructureTree(nodes: TreeNode[]): TreeNode[] {
        // Sort: folders first, then files, both alphabetically
        nodes.sort(this.nodeComparator.bind(this));

        // Sort children recursively and update folder inheritance
        for (const node of nodes) {
            if (node.children) {
                (node as any).children = this.sortAndStructureTree([...node.children]);

                // Update folder inheritance display after children are populated
                if (node.type === TreeNodeType.RESOURCE_FOLDER) {
                    this.updateFolderInheritanceDisplay(node);
                }
            }
        }

        return nodes;
    }

    /**
     * Node comparison function for sorting
     */
    private nodeComparator(a: TreeNode, b: TreeNode): number {
        const aIsFolder = a.type === TreeNodeType.RESOURCE_FOLDER;
        const bIsFolder = b.type === TreeNodeType.RESOURCE_FOLDER;

        // Folders first
        if (aIsFolder && !bIsFolder) return -1;
        if (!aIsFolder && bIsFolder) return 1;

        // Then alphabetical
        return a.label.localeCompare(b.label, undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    }

    /**
     * Gets display name from resource data
     */
    private getDisplayNameFromResources(allResources: any[], typeId: string): string | undefined {
        const resource = allResources.find(r => r.type === typeId);
        return resource?.displayName as string | undefined;
    }

    /**
     * Gets appropriate icon for resource category from providers
     */
    private getCategoryIcon(categoryId: string): string {
        try {
            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (providerRegistry) {
                const allProviders = providerRegistry.getAllProviders();

                // Find a provider that defines this category and has an icon
                for (const provider of allProviders) {
                    const searchConfig = provider.getSearchConfig();
                    if (searchConfig.category === categoryId && searchConfig.categoryIcon) {
                        return searchConfig.categoryIcon;
                    }
                }
            }
        } catch (error) {
            console.error('TreeNodeBuilder: Failed to get category icon from provider registry:', error);
        }

        // Default fallback icon
        return 'folder';
    }

    /**
     * Gets appropriate icon for resource type using ResourceTypeProviderRegistry - NO INFERENCE
     */
    getResourceTypeIcon(typeId: string): string {
        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

        if (!providerRegistry) {
            console.warn(`TreeNodeBuilder: ResourceTypeProviderRegistry unavailable, using generic icon for ${typeId}`);
            return 'file';
        }

        const provider = providerRegistry.getProvider(typeId);
        if (!provider) {
            console.warn(`TreeNodeBuilder: No provider found for resource type ${typeId}, using generic icon`);
            return 'file';
        }

        // Get explicit icon from provider's search configuration
        const searchConfig = provider.getSearchConfig();

        // Check if provider defines a specific icon for its category
        if (searchConfig.categoryIcon) {
            return searchConfig.categoryIcon;
        }

        console.warn(
            `TreeNodeBuilder: No explicit icon defined for resource type: ${typeId} - provider should define categoryIcon in search configuration`
        );
        return 'file';
    }

    /**
     * Gets appropriate icon for resource
     */
    private getResourceIcon(resource: ProjectResource): string {
        // Return folder icon for folders
        if (resource.metadata?.isFolder) {
            return 'folder';
        }

        // Use the resource type icon method which uses provider registry
        return this.getResourceTypeIcon(resource.type);
    }

    /**
     * Creates tooltip for resource
     */
    private createResourceTooltip(resource: ProjectResource): string {
        let tooltip = `Type: ${resource.type}\n`;
        tooltip += `Path: ${resource.path}\n`;

        if (resource.origin === ResourceOrigin.INHERITED) {
            tooltip += `Inherited from: ${resource.sourceProject}\n`;
        }

        if (resource.files.length > 0) {
            tooltip += `Files: ${resource.files.map((f: ResourceFile) => f.name).join(', ')}`;
        } else if (resource.metadata?.isFolder) {
            tooltip += 'Type: Folder';
        }

        return tooltip;
    }

    /**
     * Extracts resource path from resource key
     */
    private extractResourcePath(resourceKey: string): string {
        return resourceKey.includes(':') ? resourceKey.split(':', 2)[1] : resourceKey;
    }

    /**
     * Transforms resource path by removing wrapper directories using ResourceTypeProviderRegistry
     */
    private transformResourcePath(resourcePath: string, resourceType: string, categoryId?: string): string {
        let effectivePath = resourcePath;

        // Remove category prefix if present
        if (categoryId && effectivePath.startsWith(`${categoryId}/`)) {
            effectivePath = effectivePath.substring(categoryId.length + 1);
        }

        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

        if (!providerRegistry) {
            console.warn(
                `TreeNodeBuilder: ResourceTypeProviderRegistry unavailable, using path as-is for ${resourceType}`
            );
            return effectivePath;
        }

        const provider = providerRegistry.getProvider(resourceType);
        if (!provider) {
            console.warn(`TreeNodeBuilder: No provider found for resource type ${resourceType}, using path as-is`);
            return effectivePath;
        }

        // For singleton types, use display name
        if (this.isSingletonType(resourceType)) {
            return provider.displayName;
        }

        // Get directory paths from provider and remove them from the effective path
        const searchConfig = provider.getSearchConfig();
        if (searchConfig.directoryPaths && searchConfig.directoryPaths.length > 0) {
            for (const dirPath of searchConfig.directoryPaths) {
                const pathPrefix = `${dirPath}/`;
                if (effectivePath.startsWith(pathPrefix)) {
                    return effectivePath.substring(pathPrefix.length);
                }
            }
        }

        // Return path as-is if no transformation found
        return effectivePath;
    }

    /**
     * Determines if a resource type is a singleton
     */
    private isSingletonType(typeId: string): boolean {
        try {
            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
            if (providerRegistry) {
                const provider = providerRegistry.getProvider(typeId);
                if (provider) {
                    // Check if provider has singleton configuration
                    const searchConfig = provider.getSearchConfig();
                    return searchConfig.isSingleton || false;
                }
            }
        } catch (error) {
            console.error(`Failed to check singleton status from provider registry for type ${typeId}:`, error);
        }

        // Default to false if provider registry is unavailable
        return false;
    }

    /**
     * Gets display name for project from ProjectScannerService with inheritance information
     */
    private getProjectDisplayName(projectId: string): string {
        try {
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');

            if (projectScannerService?.getProject) {
                const project = projectScannerService.getProject(projectId);
                if (project) {
                    // Start with project ID (directory name) as requested
                    let displayName = projectId;

                    // Add inheritance information showing full inheritance chain
                    if (project.inheritanceChain && project.inheritanceChain.length > 0) {
                        const chainDisplay = project.inheritanceChain.join(' → ');
                        displayName += ` (inherits from ${chainDisplay})`;
                    }

                    return displayName;
                }
            }
        } catch (error) {
            console.warn(`TreeNodeBuilder: Failed to get project metadata for ${projectId}:`, error);
        }

        // Fallback to project ID if metadata is unavailable
        return projectId;
    }

    /**
     * Builds unique node ID
     */
    private buildNodeId(nodeType: string, context: NodeCreationContext, path?: string): string {
        const parts = [nodeType, context.projectId, context.typeId || 'none', context.categoryId || 'none', path || ''];
        return parts.join('::');
    }

    /**
     * Processes a resource and adds it to the appropriate collections
     */
    private processResource(
        resource: ProjectResource,
        origin: ResourceOrigin,
        sourceProject: string,
        rootLevelResources: Map<string, Map<string, ProjectResource>>,
        categorizedResources: Map<string, Map<string, Map<string, ProjectResource>>>
    ): void {
        // Extract category from metadata or use resource type to determine category
        const category =
            (resource.metadata?.category as string) ||
            this.getCategoryForResourceType(resource.type) ||
            'uncategorized';
        const type = resource.type || 'unknown';
        const key = (resource.metadata?.key as string) || `${type}:${resource.path}`;

        // Use the existing ProjectResource, but update origin and sourceProject if needed
        const projectResource: ProjectResource = {
            ...resource,
            origin,
            sourceProject
        };

        // Check if this is a root-level resource (only null/root categories, not all singletons)
        if (category === 'root' || category === null || category === 'uncategorized') {
            if (!rootLevelResources.has(type)) {
                rootLevelResources.set(type, new Map());
            }
            rootLevelResources.get(type)!.set(key, projectResource);
        } else {
            // Group by category first
            if (!categorizedResources.has(category)) {
                categorizedResources.set(category, new Map());
            }

            // Then by type within category
            const categoryMap = categorizedResources.get(category)!;
            if (!categoryMap.has(type)) {
                categoryMap.set(type, new Map());
            }

            categoryMap.get(type)!.set(key, projectResource);
        }
    }

    /**
     * Gets the category for a resource type from the ResourceTypeProviderRegistry
     */
    private getCategoryForResourceType(resourceType: string): string | null {
        try {
            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
            if (providerRegistry) {
                const provider = providerRegistry.getProvider(resourceType);
                if (provider) {
                    const searchConfig = provider.getSearchConfig();
                    return searchConfig.category || null;
                }
            }
        } catch (error) {
            console.warn(`Failed to get category for resource type ${resourceType}:`, error);
        }
        return null;
    }
}
