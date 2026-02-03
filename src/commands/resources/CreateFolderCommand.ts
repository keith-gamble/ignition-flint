/**
 * @module CreateFolderCommand
 * @description Command to create new folders for organizing resources
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { TreeNode } from '@/core/types/tree';
import { ProjectScannerService } from '@/services/config/ProjectScannerService';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';
import { ProjectTreeDataProvider } from '@/views/projectBrowser/ProjectTreeDataProvider';

/**
 * Command to create a new folder within a resource type
 * Allows organizing resources into hierarchical structures
 */
export class CreateFolderCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.CREATE_FOLDER, context);
    }

    // eslint-disable-next-line complexity
    protected validateArguments(
        nodeOrProjectId?: TreeNode | string,
        typeId?: string,
        parentPath?: string,
        _categoryId?: string
    ): CommandValidationResult {
        const warnings: string[] = [];

        // If first argument is a TreeNode, we can infer context
        if (
            nodeOrProjectId !== undefined &&
            nodeOrProjectId !== null &&
            typeof nodeOrProjectId === 'object' &&
            'type' in nodeOrProjectId
        ) {
            const node = nodeOrProjectId;
            const nodeTypeId = node.resourceType ?? (node as { typeId?: string }).typeId;
            if (
                node.projectId !== undefined &&
                node.projectId !== null &&
                node.projectId !== '' &&
                nodeTypeId !== undefined &&
                nodeTypeId !== null &&
                nodeTypeId !== ''
            ) {
                // Context can be inferred from tree node - no warnings needed
            } else {
                warnings.push('Incomplete context from tree node, will prompt for missing information');
            }
        } else {
            // String parameters or no parameters
            if (nodeOrProjectId !== undefined && nodeOrProjectId !== null && nodeOrProjectId !== '') {
                warnings.push('Project ID will be prompted from user or inferred from context');
            }
            if (typeId !== undefined && typeId !== null && typeId !== '') {
                warnings.push('Resource type ID will be prompted from user or inferred from context');
            }
            if (parentPath !== undefined && parentPath !== null && parentPath !== '') {
                warnings.push('Parent path will be prompted from user or inferred from context');
            }
        }

        return {
            isValid: true, // Allow execution even without all parameters
            errors: [],
            warnings
        };
    }

    // eslint-disable-next-line complexity
    protected async executeImpl(
        nodeOrProjectId?: TreeNode | string,
        typeId?: string,
        parentPath?: string,
        categoryId?: string
    ): Promise<void> {
        try {
            const resourceRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
            const _projectScanner = this.getService<ProjectScannerService>('ProjectScannerService');
            const gatewayManager = this.getService<{ getActiveProjectId(): string | undefined }>(
                'GatewayManagerService'
            );

            // Extract context from TreeNode if provided, otherwise use string parameters
            let selectedProjectId: string | undefined;
            let selectedTypeId: string | undefined;
            let selectedParentPath: string | undefined;
            let selectedCategoryId: string | undefined;

            if (
                nodeOrProjectId !== undefined &&
                nodeOrProjectId !== null &&
                typeof nodeOrProjectId === 'object' &&
                'type' in nodeOrProjectId
            ) {
                // Called from tree context menu with TreeNode
                const node = nodeOrProjectId;

                // TreeNode context successfully extracted

                selectedProjectId = node.projectId;
                selectedTypeId = node.resourceType ?? (node as { typeId?: string }).typeId;
                selectedCategoryId = node.categoryId ?? (node as { categoryId?: string }).categoryId;

                // For parent path, use the node's resource path if it's a folder/category
                // Otherwise use empty string for root level
                selectedParentPath = node.resourcePath ?? '';

                console.log(
                    `CreateFolder called from tree node: project=${selectedProjectId}, type=${selectedTypeId}, path=${selectedParentPath}, category=${selectedCategoryId}`
                );
            } else {
                // Called with string parameters
                selectedProjectId = nodeOrProjectId as string;
                selectedTypeId = typeId;
                selectedParentPath = parentPath;
                selectedCategoryId = categoryId;
            }

            // Fill in missing information
            if (selectedProjectId === undefined || selectedProjectId === '') {
                selectedProjectId = gatewayManager?.getActiveProjectId();
                if (selectedProjectId === undefined || selectedProjectId === '') {
                    selectedProjectId = await this.promptForProjectId();
                    if (selectedProjectId === undefined || selectedProjectId === '') return;
                }
            }

            if (selectedTypeId === undefined || selectedTypeId === '') {
                selectedTypeId = await this.promptForResourceType(resourceRegistry);
                if (selectedTypeId === undefined || selectedTypeId === '') return;
            }

            // Get resource type provider
            const resourceType = resourceRegistry.getProvider(selectedTypeId);
            if (resourceType === undefined) {
                throw new FlintError(`Unknown resource type: ${selectedTypeId}`, 'UNKNOWN_RESOURCE_TYPE');
            }

            // Check if this is a singleton resource type - singletons don't support folder creation
            const searchConfig = resourceType.getSearchConfig();
            if (searchConfig.isSingleton) {
                throw new FlintError(
                    `Cannot create folders for singleton resource type '${resourceType.displayName}'`,
                    'SINGLETON_NO_FOLDERS',
                    `Singleton resources like '${resourceType.displayName}' represent a single configuration file and do not support folder organization`
                );
            }

            if (selectedParentPath === undefined) {
                selectedParentPath = await this.promptForParentPath(resourceType);
                if (selectedParentPath === undefined) return; // Allow empty string
            }

            // Use the category from context or the resource type ID as category
            if (selectedCategoryId === undefined || selectedCategoryId === null || selectedCategoryId === '') {
                selectedCategoryId = resourceType.resourceTypeId;
            }

            // Get folder name from user
            const folderName = await this.promptForFolderName(resourceType.displayName);
            if (folderName === undefined || folderName === null || folderName === '') return;

            // Build folder path
            const folderPath =
                selectedParentPath !== undefined && selectedParentPath !== null && selectedParentPath !== ''
                    ? `${selectedParentPath}/${folderName}`
                    : folderName;

            // Create the folder
            await this.executeWithProgress(
                async progress => {
                    progress?.(25, 'Validating folder path...');

                    // Validate the folder doesn't already exist
                    await this.validateFolderPath(selectedProjectId, selectedTypeId, folderPath, selectedCategoryId);

                    progress?.(50, 'Creating folder...');

                    // Create the folder
                    await this.createFolderStructure(selectedProjectId, selectedTypeId, folderPath, selectedCategoryId);

                    progress?.(75, 'Updating project metadata...');

                    // Refresh the project scanner and tree to detect the new folder
                    try {
                        const configService = this.getService<{ getProjectPaths(): Promise<string[]> }>(
                            'WorkspaceConfigService'
                        );
                        const projectScannerService = this.getService<{
                            invalidateCache(path: string): void;
                            clearCache(): void;
                            scanProject(path: string, useCache: boolean): Promise<unknown>;
                        }>('ProjectScannerService');

                        if (
                            configService !== undefined &&
                            configService !== null &&
                            projectScannerService !== undefined &&
                            projectScannerService !== null
                        ) {
                            // Get the specific project directory path
                            const projectPaths = await configService.getProjectPaths();

                            // Find the specific project directory for this project
                            let targetProjectPath: string | undefined;
                            for (const basePath of projectPaths) {
                                const candidatePath = path.join(basePath, selectedProjectId);
                                try {
                                    await fs.access(candidatePath);
                                    targetProjectPath = candidatePath;
                                    break;
                                } catch {
                                    // Try next path
                                }
                            }

                            if (
                                targetProjectPath !== undefined &&
                                targetProjectPath !== null &&
                                targetProjectPath !== ''
                            ) {
                                // Invalidate cache for this specific project
                                projectScannerService.invalidateCache(targetProjectPath);

                                // Also clear the project scanner's global cache to be sure
                                projectScannerService.clearCache();

                                // Rescan the specific project directory with explicit no cache
                                await projectScannerService.scanProject(targetProjectPath, false);

                                // Force immediate tree refresh to bypass file watcher debounce
                                const treeProvider =
                                    this.getService<ProjectTreeDataProvider>('ProjectTreeDataProvider');
                                if (treeProvider) {
                                    treeProvider.refresh(undefined, { clearCache: true, preserveState: true });
                                }
                            } else {
                                console.warn(`Could not find project directory for: ${selectedProjectId}`);
                            }
                        }

                        // Refresh the tree view to show the new folder with cache clear
                        const treeProvider = this.getService<{
                            refresh(
                                node: unknown,
                                options: {
                                    clearCache: boolean;
                                    preserveState: boolean;
                                    force: boolean;
                                }
                            ): void;
                        }>('ProjectTreeDataProvider');
                        if (treeProvider !== undefined && treeProvider !== null) {
                            console.log('Forcing tree refresh with cache clear after folder creation');
                            // Force a complete refresh with cache clear
                            treeProvider.refresh(undefined, {
                                clearCache: true,
                                preserveState: false,
                                force: true
                            });
                        }
                    } catch (refreshError) {
                        console.warn('Failed to refresh project scanner after folder creation:', refreshError);
                        // Don't fail the whole operation if refresh fails
                    }

                    progress?.(100, 'Folder created successfully');
                },
                { showProgress: true, progressTitle: `Creating ${resourceType.displayName} folder...` }
            );

            // Show success message in status bar (auto-dismiss after 5 seconds)
            vscode.window.setStatusBarMessage(`Created ${resourceType.displayName} folder: ${folderName}`, 5000);
        } catch (error) {
            throw new FlintError(
                'Failed to create folder',
                'FOLDER_CREATION_FAILED',
                'Unable to create the requested folder',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Prompts user for folder name
     */
    private async promptForFolderName(resourceTypeName: string): Promise<string | undefined> {
        const folderName = await vscode.window.showInputBox({
            placeHolder: `Enter ${resourceTypeName} folder name`,
            prompt: 'Folder Name',
            validateInput: value => {
                if (value === undefined || value === null || value.trim().length === 0) {
                    return 'Folder name cannot be empty';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
                    return 'Folder name can only contain letters, numbers, underscores, and hyphens';
                }
                return null;
            }
        });

        return folderName?.trim();
    }

    /**
     * Prompts user to select a project ID
     */
    private async promptForProjectId(): Promise<string | undefined> {
        const configService = this.getService<{ getProjectPaths(): Promise<string[]> }>('WorkspaceConfigService');

        try {
            const projectPaths = await configService.getProjectPaths();
            const projectNames = projectPaths.map((p: string) => path.basename(p));

            if (projectNames.length === 0) {
                await vscode.window.showWarningMessage('No projects configured');
                return undefined;
            }

            if (projectNames.length === 1) {
                return projectNames[0];
            }

            return await vscode.window.showQuickPick(projectNames, {
                placeHolder: 'Select a project for the folder',
                title: 'Choose Project'
            });
        } catch (error) {
            console.warn('Failed to get project list:', error);
            return undefined;
        }
    }

    /**
     * Prompts user to select a resource type
     */
    private async promptForResourceType(registry: ResourceTypeProviderRegistry): Promise<string | undefined> {
        const resourceProviders = registry.getAllProviders();

        if (resourceProviders.length === 0) {
            await vscode.window.showWarningMessage('No resource types available');
            return undefined;
        }

        const quickPickItems = resourceProviders.map(provider => ({
            label: provider.displayName,
            description: `Resource type: ${provider.resourceTypeId}`,
            detail: `Extensions: ${provider.getSearchConfig().searchableExtensions?.join(', ') ?? 'No extensions'}`,
            typeId: provider.resourceTypeId
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select resource type for the folder',
            title: 'Choose Resource Type',
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected?.typeId;
    }

    /**
     * Prompts user for parent path
     */
    private async promptForParentPath(resourceType: { displayName: string }): Promise<string | undefined> {
        const parentPath = await vscode.window.showInputBox({
            placeHolder: `Enter parent path for ${resourceType.displayName} folder (leave empty for root)`,
            prompt: 'Parent Path (optional)',
            value: '', // Default to empty (root level)
            validateInput: value => {
                // Allow empty string for root level
                if (value !== undefined && value !== null && value !== '' && !/^[a-zA-Z0-9_/-]+$/.test(value.trim())) {
                    return 'Parent path can only contain letters, numbers, underscores, hyphens, and forward slashes';
                }
                return null;
            }
        });

        return parentPath?.trim(); // Return empty string for root level
    }

    /**
     * Validates that the folder path doesn't already exist
     */
    private async validateFolderPath(
        projectId: string,
        typeId: string,
        folderPath: string,
        _categoryId?: string
    ): Promise<void> {
        const configService = this.getService<{ getProjectPaths(): Promise<string[]> }>('WorkspaceConfigService');
        // Using imported fs and path modules

        try {
            // Get project paths and find the correct project directory
            const projectPaths = await configService.getProjectPaths();
            let projectBasePath: string | undefined;

            for (const basePath of projectPaths) {
                // Ensure basePath is a string (handle potential object structure)
                const basePathStr = typeof basePath === 'string' ? basePath : String(basePath);
                const candidatePath = path.join(basePathStr, projectId);
                try {
                    await fs.access(candidatePath);
                    projectBasePath = candidatePath;
                    break;
                } catch {
                    // Try next path
                }
            }

            if (projectBasePath === undefined || projectBasePath === null) {
                throw new FlintError(`Project directory not found for '${projectId}'`, 'PROJECT_DIR_NOT_FOUND');
            }

            // Check if folder already exists
            const targetFolderPath = path.join(projectBasePath, folderPath);
            try {
                await fs.access(targetFolderPath);
                throw new FlintError(`Folder '${folderPath}' already exists`, 'FOLDER_EXISTS');
            } catch (error) {
                if (error instanceof FlintError) {
                    throw error;
                }
                // Directory doesn't exist, which is what we want
            }
        } catch (error) {
            if (error instanceof FlintError) {
                throw error;
            }
            throw new FlintError(
                'Failed to validate folder path',
                'VALIDATION_FAILED',
                'Error checking for existing folders',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Creates the actual folder structure
     */
    private async createFolderStructure(
        projectId: string,
        typeId: string,
        folderPath: string,
        _categoryId?: string
    ): Promise<void> {
        // Get modern services from service container
        const resourceTypeService = this.getService<{
            getProvider(typeId: string): { displayName: string } | undefined;
        }>('ResourceTypeProviderRegistry');

        // Verify resource type exists
        const resourceType = resourceTypeService.getProvider(typeId);
        if (resourceType === undefined || resourceType === null) {
            throw new FlintError(`Resource type '${typeId}' not found`, 'RESOURCE_TYPE_NOT_FOUND');
        }

        // Use WorkspaceConfigService to get project paths and locate the correct project
        const configService = this.getService<{ getProjectPaths(): Promise<string[]> }>('WorkspaceConfigService');
        // Using imported fs and path modules

        try {
            // Get the directory path from resource registry
            const resourceRegistry = this.getService<{
                getProvider(typeId: string): { getSearchConfig(): { directoryPaths: string[] } } | undefined;
            }>('ResourceTypeProviderRegistry');
            const provider = resourceRegistry.getProvider(typeId);
            if (provider === undefined || provider === null) {
                throw new FlintError(`No resource provider found for type '${typeId}'`, 'RESOURCE_PROVIDER_NOT_FOUND');
            }

            const searchConfig = provider.getSearchConfig();
            const resourceDirectoryPath = searchConfig.directoryPaths[0]; // Use first directory path
            if (resourceDirectoryPath === undefined || resourceDirectoryPath === null || resourceDirectoryPath === '') {
                throw new FlintError(
                    `No directory path defined for resource type '${typeId}'`,
                    'RESOURCE_DIR_NOT_FOUND'
                );
            }

            // Get project paths and find the correct project directory
            const projectPaths = await configService.getProjectPaths();
            let projectBasePath: string | undefined;

            for (const basePath of projectPaths) {
                // Ensure basePath is a string (handle potential object structure)
                const basePathStr = typeof basePath === 'string' ? basePath : String(basePath);
                const candidatePath = path.join(basePathStr, projectId);
                try {
                    await fs.access(candidatePath);
                    projectBasePath = candidatePath;
                    break;
                } catch {
                    // Try next path
                }
            }

            if (projectBasePath === undefined || projectBasePath === null) {
                throw new FlintError(`Project directory not found for '${projectId}'`, 'PROJECT_DIR_NOT_FOUND');
            }

            // Build the full path: projectPath + resourceDir + folderPath
            const resourceBasePath = path.join(projectBasePath, resourceDirectoryPath);
            const fullFolderPath = path.join(resourceBasePath, folderPath);

            // Create the folder structure (including resource base directory if it doesn't exist)
            await fs.mkdir(fullFolderPath, { recursive: true });

            console.log(`Created folder at: ${fullFolderPath} (in ${resourceDirectoryPath} for ${typeId})`);
        } catch (error) {
            throw new FlintError(
                `Failed to create folder '${folderPath}'`,
                'FOLDER_CREATION_FAILED',
                'Error creating folder structure',
                error instanceof Error ? error : undefined
            );
        }
    }
}
