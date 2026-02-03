/**
 * @module SearchByTypeCommand
 * @description Command to search for resources by resource type
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { ResourceSearchResult } from '@/core/types/resources';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';
import { SearchProviderService } from '@/services/search/SearchProviderService';

/**
 * Command to search and filter resources by their type
 */
export class SearchByTypeCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.SEARCH_BY_TYPE, context);
    }

    protected validateArguments(typeId?: string, _projectId?: string): CommandValidationResult {
        return {
            isValid: true,
            errors: [],
            warnings: typeId ? [] : ['Resource type will be prompted from user']
        };
    }

    protected async executeImpl(typeId?: string, projectId?: string): Promise<void> {
        try {
            const resourceRegistry = this.getService<any>('ResourceTypeProviderRegistry');
            const _searchProvider = this.getService<SearchProviderService>('SearchProviderService');
            const gatewayManager = this.getService<GatewayManagerService>('GatewayManagerService');

            // Get resource type from user if not provided
            let selectedTypeId = typeId;
            if (!selectedTypeId) {
                selectedTypeId = await this.promptForResourceType(resourceRegistry);
                if (!selectedTypeId) return;
            }

            // Get resource type definition
            const resourceType = resourceRegistry.getResourceType(selectedTypeId);
            if (!resourceType) {
                throw new FlintError(`Unknown resource type: ${selectedTypeId}`, 'UNKNOWN_RESOURCE_TYPE');
            }

            // Determine project scope
            const targetProjectId = projectId ?? gatewayManager.getSelectedProject() ?? undefined;

            // Search for resources of this type
            const searchResults = await this.executeWithProgress(
                async progress => {
                    progress?.(25, `Searching for ${resourceType.displayName} resources...`);

                    // Execute type-specific search using modern services
                    const results = await this.searchByResourceType(selectedTypeId, targetProjectId);

                    progress?.(100, 'Type search completed');

                    return results;
                },
                {
                    showProgress: true,
                    progressTitle: `Searching ${resourceType.displayName}...`
                }
            );

            // Display results grouped by category if applicable
            await this.displayTypeSearchResults(resourceType, searchResults, targetProjectId);
        } catch (error) {
            throw new FlintError(
                'Type search failed',
                'TYPE_SEARCH_FAILED',
                'Unable to search resources by type',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Prompts user to select a resource type
     */
    private async promptForResourceType(registry: any): Promise<string | undefined> {
        // Get all available resource providers
        const resourceProviders = registry.getAllProviders();

        if (resourceProviders.length === 0) {
            await vscode.window.showWarningMessage('No resource types available');
            return undefined;
        }

        // Group by resource type for better organization
        const typeGroups = new Map<string, any[]>();
        resourceProviders.forEach((provider: any) => {
            const category = provider.displayName ?? 'Other';
            if (!typeGroups.has(category)) {
                typeGroups.set(category, []);
            }
            typeGroups.get(category)!.push(provider);
        });

        // Create quick pick items
        const quickPickItems: (vscode.QuickPickItem & { typeId?: string })[] = [];

        typeGroups.forEach((providers: any[], group) => {
            // Add group separator
            if (quickPickItems.length > 0) {
                quickPickItems.push({ kind: vscode.QuickPickItemKind.Separator, label: group });
            }

            // Add providers in this group
            providers.forEach((provider: any) => {
                const searchConfig = provider.getSearchConfig();
                quickPickItems.push({
                    label: provider.displayName,
                    description: `Resource type: ${provider.resourceTypeId}`,
                    detail: `Extensions: ${searchConfig.searchableExtensions?.join(', ') ?? 'No extensions'}`,
                    typeId: provider.resourceTypeId
                });
            });
        });

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select a resource type to search for',
            title: 'Search by Resource Type',
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected?.typeId;
    }

    /**
     * Searches for resources of a specific type
     */
    private async searchByResourceType(typeId: string, projectId?: string): Promise<ResourceSearchResult[]> {
        const configService = this.getService<any>('WorkspaceConfigService');
        const resourceTypeService = this.getService<any>('ResourceTypeProviderRegistry');
        const results: ResourceSearchResult[] = [];

        try {
            // Get resource type provider
            const resourceType = resourceTypeService.getProvider(typeId);
            if (!resourceType) {
                return [];
            }

            // Get project paths
            const projectPaths = await configService.getProjectPaths();

            // If specific project is requested, filter paths
            const targetPaths = projectId
                ? projectPaths.filter((p: string) => p.includes(projectId) ?? path.basename(p) === projectId)
                : projectPaths;

            // Search each project path
            for (const projectPath of targetPaths) {
                try {
                    const projectName = path.basename(projectPath);
                    const projectResources = await this.scanProjectForType(projectPath, projectName, resourceType);
                    results.push(...projectResources);
                } catch (error) {
                    console.warn(`Failed to scan project at ${projectPath}:`, error);
                }
            }

            return results;
        } catch (error) {
            throw new FlintError(
                'Failed to execute type search',
                'TYPE_SEARCH_EXECUTION_FAILED',
                'Unable to search for resources of specified type',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Displays search results for a specific resource type
     */
    private async displayTypeSearchResults(resourceProvider: any, results: any[], projectId?: string): Promise<void> {
        if (results.length === 0) {
            const projectText = projectId ? ` in project '${projectId}'` : '';
            const choice = await vscode.window.showInformationMessage(
                `No ${resourceProvider.displayName} resources found${projectText}`,
                'Search All Projects',
                'Create New'
            );

            switch (choice) {
                case 'Search All Projects':
                    await vscode.commands.executeCommand(COMMANDS.SEARCH_BY_TYPE, resourceProvider.resourceTypeId);
                    break;
                case 'Create New':
                    // Trigger resource creation workflow
                    await vscode.commands.executeCommand(
                        COMMANDS.CREATE_RESOURCE,
                        projectId ?? '',
                        resourceProvider.resourceTypeId,
                        '' // parent path - will be prompted
                    );
                    break;
                default:
                    // User cancelled or chose unknown option
                    break;
            }
            return;
        }

        // Group results by project if searching across multiple projects
        const resultsByProject = new Map<string, any[]>();
        results.forEach(result => {
            const project = result.projectId ?? 'Unknown Project';
            if (!resultsByProject.has(project)) {
                resultsByProject.set(project, []);
            }
            resultsByProject.get(project)!.push(result);
        });

        // Create quick pick items
        const quickPickItems: any[] = [];

        resultsByProject.forEach((projectResults, project) => {
            if (resultsByProject.size > 1) {
                // Add project separator for multi-project results
                quickPickItems.push({
                    kind: vscode.QuickPickItemKind.Separator,
                    label: `${project} (${projectResults.length})`
                });
            }

            projectResults.forEach(result => {
                quickPickItems.push({
                    label: result.name ?? result.path ?? 'Unnamed Resource',
                    description: result.category ? `${result.category}` : '',
                    detail: result.path ?? result.description,
                    resource: result
                });
            });
        });

        const projectText = projectId ? ` in ${projectId}` : ` across ${resultsByProject.size} project(s)`;
        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: `${results.length} ${resourceProvider.displayName} resource${results.length > 1 ? 's' : ''} found${projectText}`,
            title: `${resourceProvider.displayName} Resources`,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected?.resource) {
            // Open selected resource
            await this.openSelectedResource(selected.resource);
        }
    }

    /**
     * Opens a selected resource
     */
    private async openSelectedResource(resource: any): Promise<void> {
        try {
            // Open resource using the established command
            await vscode.commands.executeCommand(
                COMMANDS.OPEN_RESOURCE,
                resource.projectId,
                resource.type,
                resource.path,
                resource.category
            );
        } catch (error) {
            console.warn('Failed to open selected resource:', error);
            await vscode.window.showWarningMessage(`Failed to open resource: ${resource.name ?? resource.path}`);
        }
    }

    /**
     * Scans a project directory for resources of a specific type
     */
    private async scanProjectForType(projectPath: string, projectName: string, resourceType: any): Promise<any[]> {
        const resources: any[] = [];

        try {
            // Get expected paths for this resource type from provider
            const searchConfig = resourceType.getSearchConfig();
            const resourceTypePaths = searchConfig.directoryPaths ?? [];

            for (const resourceTypePath of resourceTypePaths) {
                const fullPath = path.join(projectPath, resourceTypePath);

                try {
                    const stat = await fs.stat(fullPath);
                    if (stat.isDirectory()) {
                        // Scan resources in this directory
                        const resourceDirs = await fs.readdir(fullPath);
                        for (const resourceDir of resourceDirs) {
                            const resourcePath = path.join(fullPath, resourceDir);
                            const resourceStat = await fs.stat(resourcePath);

                            if (resourceStat.isDirectory()) {
                                const relativeResourcePath = path.relative(projectPath, resourcePath);
                                resources.push({
                                    name: resourceDir,
                                    path: relativeResourcePath,
                                    projectId: projectName,
                                    type: resourceType.resourceTypeId,
                                    // Use resourceTypeId as category for providers
                                    category: resourceType.resourceTypeId,
                                    description: `${resourceType.displayName} in ${projectName}`
                                });
                            }
                        }
                    }
                } catch {
                    // Resource type directory doesn't exist, which is okay
                    console.log(`Resource type directory '${resourceTypePath}' not found in ${projectName}`);
                }
            }
        } catch (error) {
            console.warn(`Failed to scan project '${projectName}' for type '${resourceType.resourceTypeId}':`, error);
        }

        return resources;
    }
}
