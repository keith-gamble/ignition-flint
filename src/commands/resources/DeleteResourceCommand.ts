/**
 * @module DeleteResourceCommand
 * @description Command to delete resources after user confirmation
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

/**
 * Command to delete a resource after user confirmation
 * Provides safety checks and confirmation dialog
 */
export class DeleteResourceCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.DELETE_RESOURCE, context);
    }

    protected validateArguments(
        nodeOrProjectId?: TreeNode | string,
        typeId?: string,
        resourcePath?: string,
        _categoryId?: string
    ): CommandValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // If first argument is a TreeNode, we can extract the required information
        if (nodeOrProjectId && typeof nodeOrProjectId === 'object' && 'type' in nodeOrProjectId) {
            const node = nodeOrProjectId;

            if (!node.projectId) {
                errors.push('Project ID missing from tree node');
            }

            const nodeTypeId = node.resourceType ?? (node as any).typeId;
            if (!nodeTypeId) {
                errors.push('Resource type ID missing from tree node');
            }

            if (!node.resourcePath) {
                errors.push('Resource path missing from tree node');
            }
        } else {
            // String parameters
            if (!nodeOrProjectId) {
                errors.push('Project ID is required');
            }

            if (!typeId) {
                errors.push('Resource type ID is required');
            }

            if (!resourcePath) {
                errors.push('Resource path is required');
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
        resourcePath?: string,
        categoryId?: string
    ): Promise<void> {
        // Extract parameters from TreeNode if provided, otherwise use string parameters
        let actualProjectId: string;
        let actualTypeId: string;
        let actualResourcePath: string;
        let actualCategoryId: string | undefined;

        if (nodeOrProjectId && typeof nodeOrProjectId === 'object' && 'type' in nodeOrProjectId) {
            // Called from tree context menu with TreeNode
            const node = nodeOrProjectId;
            actualProjectId = node.projectId!;
            actualTypeId = node.resourceType ?? (node as any).typeId;
            actualResourcePath = node.resourcePath!;
            actualCategoryId = node.categoryId ?? (node as any).categoryId;

            console.log(
                `DeleteResource called from tree node: project=${actualProjectId}, type=${actualTypeId}, path=${actualResourcePath}, category=${actualCategoryId}`
            );
        } else {
            // Called with string parameters
            actualProjectId = nodeOrProjectId as string;
            actualTypeId = typeId!;
            actualResourcePath = resourcePath!;
            actualCategoryId = categoryId;
        }

        if (!actualProjectId || !actualTypeId || !actualResourcePath) {
            throw new InvalidArgumentError('arguments', 'projectId, typeId, and resourcePath', [
                actualProjectId,
                actualTypeId,
                actualResourcePath
            ]);
        }

        try {
            const resourceRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
            const projectScanner = this.getService<ProjectScannerService>('ProjectScannerService');

            // Get resource type definition
            const resourceType = resourceRegistry.getProvider(actualTypeId);
            if (!resourceType) {
                throw new FlintError(`Unknown resource type: ${actualTypeId}`, 'UNKNOWN_RESOURCE_TYPE');
            }

            // Get resource name for display
            const resourceName = this.getResourceDisplayName(actualResourcePath);

            // Show confirmation dialog (determine if it's a folder or file)
            const isFolder = await this.isResourceFolder(
                actualProjectId,
                actualTypeId,
                actualResourcePath,
                actualCategoryId
            );
            const confirmed = await this.confirmDeletion(resourceName, resourceType.displayName, isFolder);
            if (!confirmed) {
                return;
            }

            // Delete the resource
            await this.executeWithProgress(
                async progress => {
                    progress?.(25, 'Validating resource...');

                    // Validate resource exists and can be deleted
                    await this.validateResourceForDeletion(
                        actualProjectId,
                        actualTypeId,
                        actualResourcePath,
                        actualCategoryId
                    );

                    progress?.(50, 'Deleting resource files...');

                    // Delete the resource files
                    await this.deleteResourceFiles(actualProjectId, actualTypeId, actualResourcePath, actualCategoryId);

                    progress?.(75, 'Updating project metadata...');

                    // Refresh project scanner with cache invalidation (same as CreateFolderCommand)
                    const configService = this.getService<any>('WorkspaceConfigService');
                    if (configService) {
                        const projectPaths = await configService.getProjectPaths();

                        // Find the specific project directory path
                        let targetProjectPath: string | undefined;
                        for (const basePath of projectPaths) {
                            const candidatePath = path.join(basePath, actualProjectId);
                            try {
                                await fs.access(candidatePath);
                                targetProjectPath = candidatePath;
                                break;
                            } catch {
                                // Try next path
                            }
                        }

                        if (targetProjectPath) {
                            // Invalidate cache for this specific project
                            projectScanner.invalidateCache(targetProjectPath);
                            projectScanner.clearCache();

                            // Rescan the specific project directory - add timeout to prevent hanging
                            try {
                                await Promise.race([
                                    projectScanner.scanProject(targetProjectPath, false),
                                    new Promise<void>((_, reject) => {
                                        setTimeout(() => reject(new Error('Project scan timeout')), 5000);
                                    })
                                ]);
                            } catch (error) {
                                console.warn('Project scan failed or timed out during resource deletion:', error);
                                // Continue with deletion even if scan fails
                            }
                        }
                    }

                    progress?.(100, 'Resource deleted successfully');
                },
                { showProgress: true, progressTitle: `Deleting ${resourceType.displayName}...`, timeoutMs: 10000 }
            );

            // Refresh the tree view to show the deletion (same as CreateFolderCommand)
            const treeProvider = this.getService<any>('ProjectTreeDataProvider');
            if (treeProvider) {
                console.log('Forcing tree refresh with cache clear after resource deletion');
                treeProvider.refresh(undefined, {
                    clearCache: true,
                    preserveState: false,
                    force: true
                });
            }

            // Show success message in status bar (auto-dismiss after 5 seconds)
            vscode.window.setStatusBarMessage(`Deleted ${resourceType.displayName}: ${resourceName}`, 5000);
        } catch (error) {
            throw new FlintError(
                'Failed to delete resource',
                'RESOURCE_DELETION_FAILED',
                'Unable to delete the requested resource',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Gets display name from resource path
     */
    private getResourceDisplayName(resourcePath: string): string {
        const pathParts = resourcePath.split('/');
        return pathParts[pathParts.length - 1];
    }

    /**
     * Determines if the resource being deleted is a folder or a file
     */
    private async isResourceFolder(
        projectId: string,
        typeId: string,
        resourcePath: string,
        _categoryId?: string
    ): Promise<boolean> {
        try {
            const configService = this.getService<any>('WorkspaceConfigService');
            const resourceRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (!configService || !resourceRegistry) {
                return false;
            }

            // Get the resource provider to understand the directory structure
            const provider = resourceRegistry.getProvider(typeId);
            if (!provider) {
                return false;
            }

            const searchConfig = provider.getSearchConfig();
            const resourceDirectoryPath = searchConfig.directoryPaths[0];

            if (!resourceDirectoryPath) {
                return false;
            }

            // Find the project base path
            const projectPaths = await configService.getProjectPaths();
            let targetPath: string | undefined;

            for (const basePath of projectPaths) {
                const candidatePath = path.join(basePath, projectId);
                try {
                    await fs.access(candidatePath);
                    // Build full path to the resource
                    targetPath = path.join(candidatePath, resourceDirectoryPath, resourcePath);
                    break;
                } catch {
                    // Try next path
                }
            }

            if (!targetPath) {
                return false;
            }

            // Check if it's a directory
            try {
                const stats = await fs.stat(targetPath);
                return stats.isDirectory();
            } catch {
                // If we can't stat it, assume it's not a folder
                return false;
            }
        } catch (error) {
            console.warn('Error determining if resource is folder:', error);
            return false;
        }
    }

    /**
     * Shows confirmation dialog for resource deletion
     */
    private async confirmDeletion(resourceName: string, resourceTypeName: string, isFolder: boolean): Promise<boolean> {
        // Use appropriate terminology for folders vs files
        const itemType = isFolder ? 'folder' : resourceTypeName.toLowerCase();
        const itemTypeCapitalized = isFolder ? 'Folder' : resourceTypeName;
        const _contentDescription = isFolder
            ? 'folder and all its contents'
            : `${resourceTypeName.toLowerCase()} and all its files`;

        const choice = await vscode.window.showWarningMessage(
            `Delete ${itemTypeCapitalized} "${resourceName}"?`,
            {
                modal: true,
                detail: `This will permanently delete the ${itemType} "${resourceName}" and all its ${isFolder ? 'contents' : 'files'}. This action cannot be undone.`
            },
            'Delete'
        );

        return choice === 'Delete';
    }

    /**
     * Validates that the resource exists and can be deleted
     */
    private async validateResourceForDeletion(
        projectId: string,
        typeId: string,
        resourcePath: string,
        _categoryId?: string
    ): Promise<void> {
        const configService = this.getService<any>('WorkspaceConfigService');
        const resourceRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

        try {
            // Get the resource provider to understand the directory structure
            const provider = resourceRegistry.getProvider(typeId);
            if (!provider) {
                throw new FlintError(`Unknown resource type: ${typeId}`, 'UNKNOWN_RESOURCE_TYPE');
            }

            const searchConfig = provider.getSearchConfig();
            const resourceDirectoryPath = searchConfig.directoryPaths[0];

            if (!resourceDirectoryPath) {
                throw new FlintError(
                    `No directory path defined for resource type '${typeId}'`,
                    'RESOURCE_DIR_NOT_FOUND'
                );
            }

            // Get project paths and find the correct project directory
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

            // Check if resource exists - build correct path with resource directory
            const resourceFullPath = path.join(projectBasePath, resourceDirectoryPath, resourcePath);
            console.log(`Validating resource exists at: ${resourceFullPath}`);
            try {
                await fs.access(resourceFullPath);
            } catch {
                throw new FlintError(`Resource '${resourcePath}' not found`, 'RESOURCE_NOT_FOUND');
            }

            // Check if resource.json exists and has readonly flag
            const resourceJsonPath = path.join(resourceFullPath, 'resource.json');
            try {
                const resourceJsonContent = await fs.readFile(resourceJsonPath, 'utf8');
                const resourceMetadata = JSON.parse(resourceJsonContent);

                // Check for readonly flag
                if (resourceMetadata.restricted === true) {
                    throw new FlintError(
                        `Resource '${resourcePath}' is restricted and cannot be deleted`,
                        'RESOURCE_RESTRICTED'
                    );
                }

                // Check for inheritance (scope 'I')
                if (resourceMetadata.scope === 'I') {
                    throw new FlintError(
                        `Resource '${resourcePath}' is inherited and cannot be deleted`,
                        'RESOURCE_INHERITED'
                    );
                }
            } catch (error) {
                // If we can't read resource.json, assume it's deletable
                // (resource.json might not exist for some resources)
                console.warn('Could not validate resource.json:', error);
            }
        } catch (error) {
            if (error instanceof FlintError) {
                throw error;
            }
            throw new FlintError(
                'Failed to validate resource for deletion',
                'VALIDATION_FAILED',
                'Error checking resource status',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Deletes the actual resource files using modern services
     */
    private async deleteResourceFiles(
        projectId: string,
        typeId: string,
        resourcePath: string,
        _categoryId?: string
    ): Promise<void> {
        // Get modern services from service container
        const configService = this.getService<any>('WorkspaceConfigService');
        const resourceTypeService = this.getService<any>('ResourceTypeProviderRegistry');

        try {
            // Verify resource type exists and get directory path
            const resourceType = await resourceTypeService.getProvider(typeId);
            if (!resourceType) {
                throw new FlintError(
                    `Resource type '${typeId}' not found`,
                    'RESOURCE_TYPE_NOT_FOUND',
                    'Use the resource type registry to see available types'
                );
            }

            const searchConfig = resourceType.getSearchConfig();
            const resourceDirectoryPath = searchConfig.directoryPaths[0];

            if (!resourceDirectoryPath) {
                throw new FlintError(
                    `No directory path defined for resource type '${typeId}'`,
                    'RESOURCE_DIR_NOT_FOUND'
                );
            }

            // Implement actual file deletion logic

            // Get project paths and find the correct project directory
            const resolvedProjectPaths = await configService.getProjectPaths();
            let projectBasePath: string | undefined;

            for (const basePath of resolvedProjectPaths) {
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

            // Build full path with correct resource directory
            const resourceFullPath = path.join(projectBasePath, resourceDirectoryPath, resourcePath);
            console.log(`Deleting resource at: ${resourceFullPath}`);

            // Delete the resource directory and all its contents
            await this.deleteDirectory(resourceFullPath);

            console.log(`Deleted resource at: ${resourceFullPath}`);
        } catch (error) {
            throw new FlintError(
                `Failed to delete resource '${resourcePath}'`,
                'RESOURCE_DELETION_FAILED',
                'Resource deletion using modern services',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Recursively deletes a directory and all its contents
     */
    private async deleteDirectory(dirPath: string): Promise<void> {
        try {
            const items = await fs.readdir(dirPath);

            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stat = await fs.stat(itemPath);

                if (stat.isDirectory()) {
                    // Recursively delete subdirectory
                    await this.deleteDirectory(itemPath);
                } else {
                    // Delete file
                    await fs.unlink(itemPath);
                }
            }

            // Delete the now-empty directory
            await fs.rmdir(dirPath);
        } catch (error) {
            throw new FlintError(
                `Failed to delete directory '${dirPath}'`,
                'DIRECTORY_DELETE_FAILED',
                'Error removing directory and its contents',
                error instanceof Error ? error : undefined
            );
        }
    }
}
