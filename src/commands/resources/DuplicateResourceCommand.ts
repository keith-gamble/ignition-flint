/**
 * @module DuplicateResourceCommand
 * @description Command to duplicate/copy resources with new names
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
 * Command to duplicate a resource with a new name
 * Copies all resource files and maintains structure
 */
export class DuplicateResourceCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.DUPLICATE_RESOURCE, context);
    }

    protected validateArguments(
        nodeOrProjectId?: TreeNode | string,
        typeId?: string,
        resourcePath?: string,
        _categoryId?: string
    ): CommandValidationResult {
        const errors: string[] = [];

        // If first argument is a TreeNode, we can infer context
        if (
            nodeOrProjectId !== undefined &&
            nodeOrProjectId !== null &&
            typeof nodeOrProjectId === 'object' &&
            'type' in nodeOrProjectId
        ) {
            const node = nodeOrProjectId;
            if (node.projectId && node.resourceType && node.resourcePath !== undefined) {
                // Context can be inferred from tree node
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
            warnings: []
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

            // Get current resource name and suggest a new name
            const currentName = this.getResourceDisplayName(actualResourcePath);
            const suggestedName = this.generateDuplicateName(currentName);

            // Prompt for duplicate name
            const newName = await this.promptForDuplicateName(suggestedName, resourceType.displayName);
            if (!newName) {
                return; // User cancelled
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

            // Duplicate the resource
            await this.executeWithProgress(
                async progress => {
                    progress?.(25, 'Validating duplicate name...');

                    // Validate the new name doesn't conflict
                    await this.validateDuplicateName(actualProjectId, actualTypeId, newResourcePath, actualCategoryId);

                    progress?.(50, 'Copying resource files...');

                    // Duplicate the resource files
                    await this.duplicateResourceFiles(
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
                        console.warn('Project scan failed or timed out during resource duplication:', error);
                        // Continue with duplication even if scan fails
                    }

                    progress?.(100, 'Resource duplicated successfully');
                },
                { showProgress: true, progressTitle: `Duplicating ${resourceType.displayName}...`, timeoutMs: 10000 }
            );

            // Show success message in status bar (auto-dismiss after 5 seconds)
            vscode.window.setStatusBarMessage(`Duplicated ${resourceType.displayName}: ${newName}`, 5000);

            // Auto-open the duplicated resource
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
                console.warn('Failed to auto-open duplicated resource:', openError);
            }
        } catch (error) {
            throw new FlintError(
                'Failed to duplicate resource',
                'RESOURCE_DUPLICATE_FAILED',
                'Unable to duplicate the requested resource',
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
     * Generates a suggested name for the duplicate
     */
    private generateDuplicateName(originalName: string): string {
        // Check if name already ends with a copy pattern
        const copyPattern = /^(.+?)(?:\s*-\s*Copy(?:\s*\((\d+)\))?)?$/;
        const match = originalName.match(copyPattern);

        if (match) {
            const baseName = match[1];
            const copyNumber = match[2] ? parseInt(match[2]) + 1 : 2;
            return copyNumber === 2 ? `${baseName} - Copy` : `${baseName} - Copy (${copyNumber})`;
        }

        return `${originalName} - Copy`;
    }

    /**
     * Prompts user for duplicate name
     */
    private async promptForDuplicateName(suggestedName: string, resourceTypeName: string): Promise<string | undefined> {
        const newName = await vscode.window.showInputBox({
            value: suggestedName,
            prompt: `Duplicate ${resourceTypeName}`,
            placeHolder: 'Enter name for duplicate',
            validateInput: value => {
                if (!value || value.trim().length === 0) {
                    return 'Resource name cannot be empty';
                }
                if (!/^[a-zA-Z0-9_\-\s()]+$/.test(value.trim())) {
                    return 'Resource name can only contain letters, numbers, underscores, hyphens, spaces, and parentheses';
                }
                return null;
            }
        });

        return newName?.trim();
    }

    /**
     * Validates that the duplicate name doesn't conflict with existing resources
     */
    private async validateDuplicateName(
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

            if (!projectBasePath) {
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
                'Failed to validate duplicate name',
                'VALIDATION_FAILED',
                'Error checking for existing resources',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Duplicates the actual resource files
     */
    private async duplicateResourceFiles(
        projectId: string,
        typeId: string,
        sourcePath: string,
        targetPath: string,
        _categoryId?: string
    ): Promise<void> {
        // Get modern services from service container
        const resourceTypeService = this.getService<any>('ResourceTypeProviderRegistry');

        // Verify resource type exists
        const resourceType = await resourceTypeService.getProvider(typeId);
        if (!resourceType) {
            throw new FlintError(`Resource type '${typeId}' not found`, 'RESOURCE_TYPE_NOT_FOUND');
        }

        // Implement actual resource duplication logic
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

            if (!projectBasePath) {
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
            const sourceFullPath = path.join(projectBasePath, resourceDirectory, sourcePath);
            const targetFullPath = path.join(projectBasePath, resourceDirectory, targetPath);

            // Copy the entire resource directory
            await this.copyDirectory(sourceFullPath, targetFullPath);

            // Update resource.json metadata if it exists
            const resourceJsonPath = path.join(targetFullPath, 'resource.json');
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

            console.log(`Duplicated resource: ${sourceFullPath} → ${targetFullPath}`);
        } catch (error) {
            throw new FlintError(
                `Failed to duplicate resource files from '${sourcePath}' to '${targetPath}'`,
                'RESOURCE_DUPLICATION_FAILED',
                'Error copying resource files',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Recursively copies a directory and all its contents
     */
    private async copyDirectory(source: string, target: string): Promise<void> {
        // Create target directory
        await fs.mkdir(target, { recursive: true });

        // Get list of items in source directory
        const items = await fs.readdir(source);

        for (const item of items) {
            const sourcePath = path.join(source, item);
            const targetPath = path.join(target, item);

            const stat = await fs.stat(sourcePath);

            if (stat.isDirectory()) {
                // Recursively copy subdirectory
                await this.copyDirectory(sourcePath, targetPath);
            } else {
                // Copy file
                await fs.copyFile(sourcePath, targetPath);
            }
        }
    }
}
