/**
 * @module RenameResourceCommand
 * @description Command to rename resources with validation and file system updates
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
 * Command to rename a resource and update all related files
 * Handles validation and maintains resource integrity
 */
export class RenameResourceCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.RENAME_RESOURCE, context);
    }

    protected validateArguments(
        nodeOrProjectId?: TreeNode | string,
        typeId?: string,
        resourcePath?: string,
        _categoryId?: string
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
            if (node.projectId && node.resourceType && node.resourcePath !== undefined) {
                // Context can be inferred from tree node - no validation errors
                return { isValid: true, errors: [], warnings: [] };
            }
            errors.push('Tree node must have projectId, resourceType, and resourcePath');
        } else {
            // Individual parameters mode
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
        let actualProjectId: string;
        let actualTypeId: string;
        let actualResourcePath: string;
        let actualCategoryId: string | undefined;

        // Handle TreeNode input
        if (
            nodeOrProjectId !== undefined &&
            nodeOrProjectId !== null &&
            typeof nodeOrProjectId === 'object' &&
            'type' in nodeOrProjectId
        ) {
            const node = nodeOrProjectId;
            actualProjectId = node.projectId!;
            actualTypeId = node.resourceType!;
            actualResourcePath = node.resourcePath!;
            actualCategoryId = node.categoryId;
        } else {
            // Handle individual parameters
            if (!nodeOrProjectId || !typeId || !resourcePath) {
                throw new InvalidArgumentError('arguments', 'projectId, typeId, and resourcePath', [
                    nodeOrProjectId,
                    typeId,
                    resourcePath
                ]);
            }
            actualProjectId = nodeOrProjectId;
            actualTypeId = typeId;
            actualResourcePath = resourcePath;
            actualCategoryId = categoryId;
        }

        try {
            const resourceRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
            const projectScanner = this.getService<ProjectScannerService>('ProjectScannerService');

            // Get resource type definition
            const resourceType = resourceRegistry.getProvider(actualTypeId);
            if (!resourceType) {
                throw new FlintError(`Unknown resource type: ${actualTypeId}`, 'UNKNOWN_RESOURCE_TYPE');
            }

            // Get current resource name for display and validation
            const currentName = this.getResourceDisplayName(actualResourcePath);

            // Prompt for new name
            const newName = await this.promptForNewName(currentName, resourceType.displayName);
            if (newName === null || newName === undefined || newName.length === 0 || newName === currentName) {
                return; // User cancelled or no change
            }

            // Build new resource path
            const pathParts = actualResourcePath.split('/');
            pathParts[pathParts.length - 1] = newName;
            const newResourcePath = pathParts.join('/');

            // Resolve project path first so we can use it later
            const configService = this.getService<any>('WorkspaceConfigService');
            const resolvedProjectPaths = await configService.getProjectPaths();
            let projectBasePath: string | undefined;

            for (const basePath of resolvedProjectPaths) {
                const candidatePath = path.join(basePath, actualProjectId);
                try {
                    await fs.access(candidatePath);
                    projectBasePath = candidatePath;
                    break;
                } catch {
                    // Try next path
                }
            }

            if (!projectBasePath) {
                throw new FlintError(`Project directory not found for '${actualProjectId}'`, 'PROJECT_DIR_NOT_FOUND');
            }

            // Rename the resource
            await this.executeWithProgress(
                async progress => {
                    progress?.(25, 'Validating new name...');

                    // Validate the new name doesn't conflict
                    await this.validateNewName(actualProjectId, actualTypeId, newResourcePath, actualCategoryId);

                    progress?.(50, 'Renaming resource files...');

                    // Rename the resource files
                    await this.renameResourceFiles(
                        actualProjectId,
                        actualTypeId,
                        actualResourcePath,
                        newResourcePath,
                        actualCategoryId
                    );

                    progress?.(75, 'Updating project metadata...');

                    // Refresh project scanner using the full project path - add timeout to prevent hanging
                    try {
                        await Promise.race([
                            projectScanner.scanProject(projectBasePath),
                            new Promise<void>((_, reject) => {
                                setTimeout(() => reject(new Error('Project scan timeout')), 5000);
                            })
                        ]);
                    } catch (error) {
                        console.warn('Project scan failed or timed out during resource rename:', error);
                        // Continue with rename even if scan fails
                    }

                    progress?.(100, 'Resource renamed successfully');
                },
                { showProgress: true, progressTitle: `Renaming ${resourceType.displayName}...`, timeoutMs: 10000 }
            );

            // Show success message in status bar (auto-dismiss after 5 seconds)
            vscode.window.setStatusBarMessage(
                `Renamed ${resourceType.displayName} from "${currentName}" to "${newName}"`,
                5000
            );

            // Auto-open the renamed resource
            try {
                await vscode.commands.executeCommand(
                    COMMANDS.OPEN_RESOURCE,
                    actualProjectId,
                    actualTypeId,
                    newResourcePath,
                    actualCategoryId
                );
            } catch (openError) {
                // If auto-open fails, log it but don't fail the entire operation
                console.warn('Failed to auto-open renamed resource:', openError);
            }
        } catch (error) {
            throw new FlintError(
                'Failed to rename resource',
                'RESOURCE_RENAME_FAILED',
                'Unable to rename the requested resource',
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
     * Prompts user for new resource name
     */
    private async promptForNewName(currentName: string, resourceTypeName: string): Promise<string | undefined> {
        const newName = await vscode.window.showInputBox({
            value: currentName,
            prompt: `Rename ${resourceTypeName}`,
            placeHolder: 'Enter new name',
            validateInput: value => {
                if (!value || value.trim().length === 0) {
                    return 'Resource name cannot be empty';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
                    return 'Resource name can only contain letters, numbers, underscores, and hyphens';
                }
                if (value.trim() === currentName) {
                    return 'New name must be different from current name';
                }
                return null;
            }
        });

        return newName?.trim();
    }

    /**
     * Validates that the new name doesn't conflict with existing resources
     */
    private async validateNewName(
        projectId: string,
        typeId: string,
        newResourcePath: string,
        _categoryId?: string
    ): Promise<void> {
        const configService = this.getService<any>('WorkspaceConfigService');

        try {
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

            if (projectBasePath === null || projectBasePath === undefined || projectBasePath.length === 0) {
                throw new FlintError(`Project directory not found for '${projectId}'`, 'PROJECT_DIR_NOT_FOUND');
            }

            // Check if target resource already exists
            const targetResourcePath = path.join(projectBasePath, newResourcePath);
            try {
                await fs.access(targetResourcePath);
                throw new FlintError(`Resource '${newResourcePath}' already exists`, 'RESOURCE_EXISTS');
            } catch (error) {
                if (error instanceof FlintError) {
                    throw error;
                }
                // File doesn't exist, which is what we want
            }
        } catch (error) {
            if (error instanceof FlintError) {
                throw error;
            }
            throw new FlintError(
                'Failed to validate new name',
                'VALIDATION_FAILED',
                'Error checking for existing resources',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Renames the actual resource files
     */
    private async renameResourceFiles(
        projectId: string,
        typeId: string,
        oldPath: string,
        newPath: string,
        _categoryId?: string
    ): Promise<void> {
        // Get modern services from service container
        const configService = this.getService<any>('WorkspaceConfigService');
        const resourceTypeService = this.getService<any>('ResourceTypeProviderRegistry');

        // Verify resource type exists
        const resourceType = await resourceTypeService.getProvider(typeId);
        if (!resourceType) {
            throw new FlintError(`Resource type '${typeId}' not found`, 'RESOURCE_TYPE_NOT_FOUND');
        }

        // Implement actual file renaming logic

        try {
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

            if (projectBasePath === null || projectBasePath === undefined || projectBasePath.length === 0) {
                throw new FlintError(`Project directory not found for '${projectId}'`, 'PROJECT_DIR_NOT_FOUND');
            }

            // Get the directory path from the resource type provider
            const searchConfig = resourceType.getSearchConfig();
            const directoryPaths = searchConfig.directoryPaths || [];
            if (directoryPaths.length === 0) {
                throw new FlintError(
                    `Resource type '${typeId}' has no directory paths configured`,
                    'NO_DIRECTORY_PATHS'
                );
            }

            // Use the first directory path (most resource types have only one)
            const resourceDirectory = directoryPaths[0];

            // Build full paths within the correct resource type directory
            const oldFullPath = path.join(projectBasePath, resourceDirectory, oldPath);
            const newFullPath = path.join(projectBasePath, resourceDirectory, newPath);

            // Check if source exists
            try {
                await fs.access(oldFullPath);
            } catch {
                throw new FlintError(`Source resource '${oldPath}' not found`, 'SOURCE_NOT_FOUND');
            }

            // Rename/move the resource directory
            await fs.rename(oldFullPath, newFullPath);

            // Update resource.json metadata if it exists
            const resourceJsonPath = path.join(newFullPath, 'resource.json');
            try {
                const resourceJsonContent = await fs.readFile(resourceJsonPath, 'utf8');
                const resourceMetadata = JSON.parse(resourceJsonContent);

                // Update timestamp
                if (resourceMetadata.attributes?.lastModification) {
                    resourceMetadata.attributes.lastModification.timestamp = Date.now();
                    resourceMetadata.attributes.lastModification.actor = 'extension';
                }

                await fs.writeFile(resourceJsonPath, JSON.stringify(resourceMetadata, null, 2), 'utf8');
            } catch (error) {
                // resource.json might not exist, that's ok
                console.warn('Could not update resource.json metadata:', error);
            }

            console.log(`Renamed resource: ${oldFullPath} → ${newFullPath}`);
        } catch (error) {
            throw new FlintError(
                `Failed to rename resource files from '${oldPath}' to '${newPath}'`,
                'RESOURCE_RENAME_FAILED',
                'Error renaming resource files',
                error instanceof Error ? error : undefined
            );
        }
    }
}
