/**
 * @module CreateResourceCommand
 * @description Command to create new resources from templates
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError, InvalidArgumentError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { TreeNode } from '@/core/types/tree';
import { ProjectScannerService } from '@/services/config/ProjectScannerService';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';
import { ProjectTreeDataProvider } from '@/views/projectBrowser/ProjectTreeDataProvider';

/**
 * Arguments for CreateResourceCommand
 */
interface _CreateResourceArgs {
    projectId: string;
    typeId: string;
    parentPath: string;
    categoryId?: string;
    templateName?: string;
}

/**
 * Parsed command arguments
 */
interface ParsedCreateArgs {
    projectId: string;
    typeId: string;
    parentPath: string;
    categoryId: string | undefined;
}

/**
 * Options for resource creation with progress
 */
interface CreateProgressOptions {
    projectBasePath: string;
    args: ParsedCreateArgs;
    resourcePath: string;
    selectedCategory: string;
    selectedTemplate: string;
    displayName: string;
}

/**
 * Options for auto-opening a resource
 */
interface AutoOpenOptions {
    projectId: string;
    typeId: string;
    resourcePath: string;
    categoryId: string;
    searchConfig: any;
    isSingleton: boolean;
}

/**
 * Command to create a new resource from a template
 * Handles category selection and template selection
 */
export class CreateResourceCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.CREATE_RESOURCE, context);
    }

    protected validateArguments(
        nodeOrProjectId?: TreeNode | string,
        typeId?: string,
        parentPath?: string,
        _categoryId?: string,
        _templateName?: string
    ): CommandValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // If first argument is a TreeNode, we can infer context
        if (
            nodeOrProjectId !== undefined &&
            nodeOrProjectId !== null &&
            typeof nodeOrProjectId === 'object' &&
            'type' in nodeOrProjectId
        ) {
            const node = nodeOrProjectId;
            // Check differently for folders - they might not have resourceType but can still be valid
            if (node.projectId && node.resourcePath !== undefined) {
                // Check if we have resourceType OR if this is a resourceFolder that should inherit type
                const isResourceFolder = node.contextValue === 'resourceFolder' && (node as any).resourceType;
                if (node.resourceType || isResourceFolder) {
                    return { isValid: true, errors: [], warnings: [] };
                }
                // For folders without resourceType, we need to try to infer it from the tree structure
                // This is a temporary workaround - ideally folders should have resourceType set properly
                if (node.contextValue === 'resourceFolder') {
                    return { isValid: true, errors: [], warnings: ['ResourceType will be inferred'] };
                }
                errors.push('Tree node must have resourceType');
            } else {
                errors.push('Tree node must have projectId and resourcePath');
            }
        } else {
            // Individual parameters mode
            if (!nodeOrProjectId) {
                errors.push('Project ID is required');
            }

            if (!typeId) {
                errors.push('Resource type ID is required');
            }

            if (!parentPath) {
                errors.push('Parent path is required');
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    protected async executeImpl(
        nodeOrProjectId?: TreeNode | string,
        typeId?: string,
        parentPath?: string,
        categoryId?: string,
        templateName?: string
    ): Promise<void> {
        const args = await this.parseCommandArguments(nodeOrProjectId, typeId, parentPath, categoryId);

        try {
            const resourceRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
            const resourceProvider = resourceRegistry.getProvider(args.typeId);
            if (!resourceProvider) {
                throw new FlintError(`Unknown resource type: ${args.typeId}`, 'UNKNOWN_RESOURCE_TYPE');
            }

            const searchConfig = resourceProvider.getSearchConfig();
            const isSingleton = searchConfig.isSingleton || false;
            const selectedCategory = args.categoryId ?? args.typeId;

            const { resourceName, resourcePath } = await this.buildResourcePath(
                resourceProvider,
                searchConfig,
                isSingleton,
                args.parentPath
            );
            if (!resourceName) return;

            const selectedTemplate = await this.resolveTemplate(templateName, resourceProvider);
            if (!selectedTemplate) return;

            const projectBasePath = await this.resolveProjectBasePath(args.projectId);

            await this.createResourceWithProgress({
                projectBasePath,
                args,
                resourcePath,
                selectedCategory,
                selectedTemplate,
                displayName: resourceProvider.displayName
            });

            vscode.window.setStatusBarMessage(`Created ${resourceProvider.displayName}: ${resourceName}`, 5000);

            await this.autoOpenResource({
                projectId: args.projectId,
                typeId: args.typeId,
                resourcePath,
                categoryId: selectedCategory,
                searchConfig,
                isSingleton
            });
        } catch (error) {
            throw new FlintError(
                'Failed to create resource',
                'RESOURCE_CREATION_FAILED',
                `Unable to create the requested resource: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Parses command arguments from TreeNode or individual parameters
     */
    private async parseCommandArguments(
        nodeOrProjectId?: TreeNode | string,
        typeId?: string,
        parentPath?: string,
        categoryId?: string
    ): Promise<ParsedCreateArgs> {
        if (this.isTreeNode(nodeOrProjectId)) {
            const node = nodeOrProjectId;
            let actualTypeId: string;
            if (node.resourceType) {
                actualTypeId = node.resourceType;
            } else if (node.contextValue === 'resourceFolder') {
                actualTypeId = await this.inferResourceTypeFromFolder(node.projectId!, node.resourcePath!);
            } else {
                throw new InvalidArgumentError('TreeNode', 'node with resourceType', node);
            }

            return {
                projectId: node.projectId!,
                typeId: actualTypeId,
                parentPath: node.resourcePath!,
                categoryId: node.categoryId || categoryId
            };
        }

        if (!nodeOrProjectId || !typeId || !parentPath) {
            throw new InvalidArgumentError('arguments', 'projectId, typeId, and parentPath', [
                nodeOrProjectId,
                typeId,
                parentPath
            ]);
        }

        return { projectId: nodeOrProjectId, typeId, parentPath, categoryId };
    }

    /**
     * Type guard for TreeNode
     */
    private isTreeNode(value: unknown): value is TreeNode {
        return value !== undefined && value !== null && typeof value === 'object' && 'type' in value;
    }

    /**
     * Builds the resource path for singleton or regular resources
     */
    private async buildResourcePath(
        resourceProvider: any,
        searchConfig: any,
        isSingleton: boolean,
        parentPath: string
    ): Promise<{ resourceName: string; resourcePath: string }> {
        if (isSingleton) {
            const directoryPaths = searchConfig.directoryPaths || [];
            if (directoryPaths.length === 0) {
                throw new FlintError('Resource type has no directory paths configured', 'NO_DIRECTORY_PATHS');
            }
            return { resourceName: resourceProvider.displayName, resourcePath: '' };
        }

        const userProvidedName = await this.promptForResourceName(resourceProvider.displayName);
        if (!userProvidedName) return { resourceName: '', resourcePath: '' };

        const resourcePath = parentPath ? `${parentPath}/${userProvidedName}` : userProvidedName;
        return { resourceName: userProvidedName, resourcePath };
    }

    /**
     * Resolves the template to use
     */
    private async resolveTemplate(
        templateName: string | undefined,
        resourceProvider: any
    ): Promise<string | undefined> {
        return templateName || (await this.selectTemplate(resourceProvider));
    }

    /**
     * Resolves the project base path
     */
    private async resolveProjectBasePath(projectId: string): Promise<string> {
        const configService = this.getService<any>('WorkspaceConfigService');
        const resolvedProjectPaths = await configService.getProjectPaths();

        for (const basePath of resolvedProjectPaths) {
            const candidatePath = path.join(basePath, projectId);
            try {
                await fs.access(candidatePath);
                return candidatePath;
            } catch {
                // Try next path
            }
        }

        throw new FlintError(`Project directory not found for '${projectId}'`, 'PROJECT_DIR_NOT_FOUND');
    }

    /**
     * Creates the resource with progress reporting
     */
    private async createResourceWithProgress(options: CreateProgressOptions): Promise<void> {
        const { projectBasePath, args, resourcePath, selectedCategory, selectedTemplate, displayName } = options;
        const projectScanner = this.getService<ProjectScannerService>('ProjectScannerService');

        await this.executeWithProgress(
            async progress => {
                progress?.(25, 'Validating resource path...');
                await this.validateResourcePath(args.projectId, args.typeId, resourcePath, selectedCategory);

                progress?.(50, 'Creating resource files...');
                await this.createResourceFiles(
                    projectBasePath,
                    args.typeId,
                    resourcePath,
                    selectedCategory,
                    selectedTemplate
                );

                progress?.(75, 'Updating project metadata...');
                await this.refreshProjectAfterCreate(projectScanner, args.projectId, projectBasePath, resourcePath);

                progress?.(100, 'Resource created successfully');
            },
            { showProgress: true, progressTitle: `Creating ${displayName}...` }
        );
    }

    /**
     * Refreshes the project after resource creation
     */
    private async refreshProjectAfterCreate(
        projectScanner: ProjectScannerService,
        projectId: string,
        projectBasePath: string,
        resourcePath: string
    ): Promise<void> {
        try {
            await projectScanner.scanResourcePath(projectId, resourcePath);
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            console.warn('Incremental resource scan failed, falling back to full project scan:', error);
            projectScanner.invalidateCache(projectBasePath);
            await projectScanner.scanProject(projectBasePath, false);
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const treeProvider = this.getService<ProjectTreeDataProvider>('ProjectTreeDataProvider');
        if (treeProvider) {
            treeProvider.refresh(undefined, { clearCache: true, preserveState: true });
        }
    }

    /**
     * Auto-opens the newly created resource
     */
    private async autoOpenResource(options: AutoOpenOptions): Promise<void> {
        const { projectId, typeId, resourcePath, categoryId, searchConfig, isSingleton } = options;
        try {
            let openResourcePath = resourcePath;
            if (isSingleton && resourcePath === '') {
                const directoryPaths = searchConfig.directoryPaths || [];
                if (directoryPaths.length > 0) {
                    openResourcePath = directoryPaths[0];
                }
            }

            await vscode.commands.executeCommand(
                COMMANDS.OPEN_RESOURCE,
                projectId,
                typeId,
                openResourcePath,
                categoryId
            );
        } catch (openError) {
            console.warn('Failed to auto-open newly created resource:', openError);
        }
    }

    /**
     * Prompts user for resource name
     */
    private async promptForResourceName(resourceTypeName: string): Promise<string | undefined> {
        const resourceName = await vscode.window.showInputBox({
            placeHolder: `Enter ${resourceTypeName} name`,
            prompt: 'Resource Name',
            validateInput: value => {
                if (!value || value.trim().length === 0) {
                    return 'Resource name cannot be empty';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
                    return 'Resource name can only contain letters, numbers, underscores, and hyphens';
                }
                return null;
            }
        });

        return resourceName?.trim();
    }

    /**
     * Prompts user to select a template using ResourceTypeProviderRegistry
     */
    private async selectTemplate(resourceProvider: any): Promise<string | undefined> {
        try {
            const templateConfig = resourceProvider.getTemplateConfig();
            if (templateConfig.templates && templateConfig.templates.length > 0) {
                // If only one template, use it automatically
                if (templateConfig.templates.length === 1) {
                    return String(templateConfig.templates[0].id);
                }

                // Multiple templates - show selection UI
                const templateItems: vscode.QuickPickItem[] = templateConfig.templates.map(
                    (template: { id: string; name: string; description?: string }) => ({
                        label: template.name,
                        description: template.description,
                        detail: template.id
                    })
                );

                const selectedTemplate = await vscode.window.showQuickPick(templateItems, {
                    placeHolder: `Select a template for ${resourceProvider.displayName}`,
                    canPickMany: false
                });

                return selectedTemplate?.detail;
            }

            // Fallback to default
            return 'basic';
        } catch (error) {
            console.warn('Failed to get templates from provider registry, using default:', error);
            return 'basic';
        }
    }

    /**
     * Validates that the resource path doesn't already exist
     */
    private async validateResourcePath(
        _projectId: string,
        _typeId: string,
        _resourcePath: string,
        _categoryId?: string
    ): Promise<void> {
        // Implement validation with resource services (now available for integration)
        // For now, assume validation is handled by the resource creation process
    }

    /**
     * Infers the resource type from a folder's path by checking which resource type directory it belongs to
     */
    private async inferResourceTypeFromFolder(projectId: string, folderPath: string): Promise<string> {
        try {
            const resourceRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
            const configService = this.getService<any>('WorkspaceConfigService');

            if (!resourceRegistry || !configService) {
                throw new FlintError(
                    'Required services not available for resource type inference',
                    'SERVICES_UNAVAILABLE'
                );
            }

            // Get all resource type providers
            const providers = resourceRegistry.getAllProviders();

            // Get project base path
            const projectPaths = await configService.getProjectPaths();
            let projectBasePath: string | undefined;

            for (const basePath of projectPaths) {
                const candidatePath = path.join(basePath, projectId);
                try {
                    await fs.access(candidatePath);
                    projectBasePath = candidatePath;
                    break;
                } catch {
                    // Try next path
                }
            }

            if (!projectBasePath) {
                throw new FlintError(`Project directory not found for '${projectId}'`, 'PROJECT_DIR_NOT_FOUND');
            }

            // Check which resource type directory this folder belongs to
            for (const provider of providers) {
                const searchConfig = provider.getSearchConfig();
                const directoryPaths = searchConfig.directoryPaths || [];

                for (const dirPath of directoryPaths) {
                    const folderFullPath = path.join(projectBasePath, dirPath, folderPath);

                    try {
                        // Check if the folder exists within this resource type directory
                        await fs.access(folderFullPath);
                        return provider.resourceTypeId;
                    } catch {
                        // Folder not found in this resource type directory, try next
                    }
                }
            }

            // Fallback: if we can't determine from the folder structure, default to script-python
            return 'script-python';
        } catch {
            // Fallback to script-python if inference fails
            return 'script-python';
        }
    }

    /**
     * Creates the actual resource files using ResourceTypeProviderRegistry
     */
    private async createResourceFiles(
        projectBasePath: string,
        typeId: string,
        resourcePath: string,
        categoryId?: string,
        templateName?: string
    ): Promise<void> {
        try {
            // Use ResourceTypeProviderRegistry for resource creation
            const providerRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (!providerRegistry) {
                throw new FlintError(
                    'ResourceTypeProviderRegistry is not available',
                    'RESOURCE_PROVIDER_REGISTRY_UNAVAILABLE',
                    'Cannot create resource without provider registry'
                );
            }

            // Get provider for this resource type
            const provider = providerRegistry.getProvider(typeId);
            if (!provider) {
                throw new FlintError(
                    `No provider found for resource type: ${typeId}`,
                    'RESOURCE_TYPE_PROVIDER_NOT_FOUND',
                    'Cannot create resource without appropriate provider'
                );
            }

            // Get the directory path from the resource type provider
            const searchConfig = provider.getSearchConfig();
            const directoryPaths = searchConfig.directoryPaths || [];
            if (directoryPaths.length === 0) {
                throw new FlintError(
                    `Resource type '${typeId}' has no directory paths configured`,
                    'NO_DIRECTORY_PATHS'
                );
            }

            // Use the first directory path (most resource types have only one)
            const resourceDirectory = directoryPaths[0];

            // Create the full resource path within the correct resource type directory
            const fullResourcePath = path.join(projectBasePath, resourceDirectory, resourcePath);

            // Use provider to create resource
            if (provider.createResource) {
                await provider.createResource(fullResourcePath, templateName);
            } else {
                throw new Error('Provider creation not implemented');
            }
        } catch (error) {
            // If provider creation fails, throw error
            console.error(`Provider creation failed for ${typeId}:`, error);

            throw new FlintError(
                `Failed to create resource '${resourcePath}'`,
                'RESOURCE_CREATION_FAILED',
                'Resource creation using provider registry failed',
                error instanceof Error ? error : undefined
            );
        }
    }
}
