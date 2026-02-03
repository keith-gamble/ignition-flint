/**
 * @module CreateResourceJsonCommand
 * @description Command to create missing resource.json files for individual resources
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
import { ResourceValidationService } from '@/services/resources/ResourceValidationService';

/**
 * Type guard to check if argument is a TreeNode
 */
function isTreeNode(arg: unknown): arg is TreeNode {
    return typeof arg === 'object' && arg !== null && 'projectId' in arg && ('typeId' in arg || 'resourceType' in arg);
}

/**
 * Command to create resource.json file for a specific resource
 * Handles resource metadata generation and validation
 */
export class CreateResourceJsonCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.CREATE_RESOURCE_JSON, context);
    }

    protected validateArguments(
        projectIdOrNode?: string | TreeNode,
        typeId?: string,
        _resourcePath?: string,
        _categoryId?: string
    ): CommandValidationResult {
        const errors: string[] = [];

        // Handle both calling conventions: TreeNode object or individual parameters
        let projectId: string | undefined;
        let actualTypeId: string | undefined;

        if (isTreeNode(projectIdOrNode)) {
            // Called with TreeNode object
            projectId = projectIdOrNode.projectId;
            actualTypeId = projectIdOrNode.typeId ?? projectIdOrNode.resourceType;
            // resourcePath can be empty for empty singletons - we'll handle that in executeImpl
        } else {
            // Called with individual parameters
            projectId = projectIdOrNode;
            actualTypeId = typeId;
        }

        if (projectId === undefined || projectId.length === 0) {
            errors.push('Project ID is required');
        }

        if (actualTypeId === undefined || actualTypeId.length === 0) {
            errors.push('Resource type ID is required');
        }

        // Note: We don't validate resourcePath here because empty singletons have empty paths
        // and need to determine the path from the provider

        return {
            isValid: errors.length === 0,
            errors,
            warnings: []
        };
    }

    protected async executeImpl(
        projectIdOrNode?: string | TreeNode,
        typeId?: string,
        resourcePath?: string,
        categoryId?: string
    ): Promise<void> {
        // Handle both calling conventions: TreeNode object or individual parameters
        let projectId: string | undefined;
        let actualTypeId: string | undefined;
        let actualResourcePath: string | undefined;
        let actualCategoryId: string | undefined;

        if (isTreeNode(projectIdOrNode)) {
            // Called with TreeNode object
            projectId = projectIdOrNode.projectId;
            actualTypeId = projectIdOrNode.typeId ?? projectIdOrNode.resourceType;
            actualResourcePath = projectIdOrNode.resourcePath;
            actualCategoryId = projectIdOrNode.categoryId;
        } else {
            // Called with individual parameters
            projectId = projectIdOrNode;
            actualTypeId = typeId;
            actualResourcePath = resourcePath;
            actualCategoryId = categoryId;
        }

        if (!projectId || !actualTypeId) {
            throw new InvalidArgumentError('arguments', 'projectId and typeId', [projectId, actualTypeId]);
        }

        // At this point, projectId and actualTypeId are guaranteed to be strings
        const validProjectId: string = projectId;
        const validTypeId: string = actualTypeId;

        // Handle empty singletons - determine resource path from provider
        if (!actualResourcePath || actualResourcePath.length === 0) {
            const providerRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
            const provider = providerRegistry.getProvider(validTypeId);

            if (!provider) {
                throw new FlintError(`No provider found for resource type '${validTypeId}'`, 'PROVIDER_NOT_FOUND');
            }

            const searchConfig = provider.getSearchConfig();
            if (!searchConfig.isSingleton) {
                throw new InvalidArgumentError(
                    'resourcePath',
                    'non-empty resource path for non-singleton resources',
                    actualResourcePath
                );
            }

            // For singletons, build the resource path from the directory path
            const directoryPaths = searchConfig.directoryPaths || [];
            if (directoryPaths.length === 0) {
                throw new FlintError(
                    `Resource type '${validTypeId}' has no directory paths configured`,
                    'NO_DIRECTORY_PATHS'
                );
            }

            actualResourcePath = directoryPaths[0];
        }

        // At this point, actualResourcePath is guaranteed to be a string
        const validResourcePath: string = actualResourcePath;

        try {
            const resourceValidator = this.getService<ResourceValidationService>('ResourceValidationService');
            const _projectScanner = this.getService<ProjectScannerService>('ProjectScannerService');

            // Create resource.json with progress indication
            await this.executeWithProgress(
                async progress => {
                    progress?.(25, 'Analyzing resource structure...');

                    // Validate resource exists and analyze its structure
                    const resourceMetadata = await this.analyzeResource(
                        validProjectId,
                        validTypeId,
                        validResourcePath,
                        actualCategoryId
                    );

                    progress?.(50, 'Generating resource.json content...');

                    // Generate resource.json content
                    const resourceJsonContent = this.generateResourceJson(resourceMetadata);

                    progress?.(75, 'Creating resource.json file...');

                    // Create the resource.json file
                    await this.createResourceJsonFile(
                        validProjectId,
                        validTypeId,
                        validResourcePath,
                        actualCategoryId,
                        resourceJsonContent
                    );

                    progress?.(90, 'Validating created file...');

                    const files = Array.isArray(resourceMetadata.files)
                        ? (resourceMetadata.files as string[]).map(filename => ({
                              filename,
                              name: filename,
                              path: filename
                          }))
                        : [];

                    await resourceValidator.validateResource(
                        validResourcePath, // resourcePath
                        validTypeId, // resourceType
                        validProjectId, // projectPath
                        files, // files: ResourceFileInfo[]
                        resourceMetadata // metadata
                    );

                    progress?.(100, 'Resource.json created successfully');
                },
                {
                    showProgress: true,
                    progressTitle: 'Creating resource.json...'
                }
            );

            // Show success message
            const resourceName = this.getResourceDisplayName(validResourcePath);
            vscode.window.showInformationMessage(`Created resource.json for ${resourceName}`);
        } catch (_error) {
            throw new FlintError(
                'Failed to create resource.json',
                'RESOURCE_JSON_CREATION_FAILED',
                'Unable to create resource.json file',
                _error instanceof Error ? _error : undefined
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
     * Analyzes resource structure to generate metadata
     */
    private async analyzeResource(
        projectId: string,
        typeId: string,
        resourcePath: string,
        categoryId?: string
    ): Promise<Record<string, unknown>> {
        const configService = this.getService<{
            getProjectPaths: () => Promise<string[]>;
        }>('WorkspaceConfigService');

        try {
            // Get project paths and find the correct project directory
            const projectPaths = await configService.getProjectPaths();
            let projectBasePath: string | undefined;

            for (const basePath of projectPaths) {
                const candidatePath = path.join(String(basePath), projectId);
                try {
                    await fs.access(candidatePath);
                    projectBasePath = candidatePath;
                    break;
                } catch {
                    // Try next path
                }
            }

            if (projectBasePath === undefined) {
                throw new FlintError(`Project directory not found for '${projectId}'`, 'PROJECT_DIR_NOT_FOUND');
            }

            // Build full resource path
            const fullResourcePath = path.join(projectBasePath, resourcePath);

            // Check if resource directory exists, create if it doesn't (for empty singletons)
            let directoryExists = false;
            try {
                await fs.access(fullResourcePath);
                directoryExists = true;
            } catch {
                // Directory doesn't exist - create it (this is expected for empty singletons)
                console.log(`Creating directory for empty singleton: ${fullResourcePath}`);
                try {
                    await fs.mkdir(fullResourcePath, { recursive: true });
                    console.log(`Created directory: ${fullResourcePath}`);
                } catch (mkdirError) {
                    throw new FlintError(
                        `Failed to create resource directory '${resourcePath}'`,
                        'RESOURCE_DIR_CREATION_FAILED',
                        'Unable to create directory for resource',
                        mkdirError instanceof Error ? mkdirError : undefined
                    );
                }
            }

            // Analyze resource structure - get list of files (will be empty for new singletons)
            const resourceFiles: string[] = [];
            if (directoryExists) {
                try {
                    const items = await fs.readdir(fullResourcePath);
                    for (const item of items) {
                        const itemPath = path.join(fullResourcePath, item);
                        const stat = await fs.stat(itemPath);
                        if (stat.isFile() && item !== 'resource.json') {
                            resourceFiles.push(item);
                        }
                    }
                } catch (error) {
                    console.warn('Could not analyze resource files:', error);
                }
            }

            return {
                projectId,
                typeId,
                resourcePath,
                categoryId,
                name: this.getResourceDisplayName(resourcePath),
                timestamp: Date.now(),
                files: resourceFiles
            };
        } catch (_error) {
            if (_error instanceof FlintError) {
                throw _error;
            }
            throw new FlintError(
                'Failed to analyze resource structure',
                'RESOURCE_ANALYSIS_FAILED',
                'Unable to analyze resource for metadata generation',
                _error instanceof Error ? _error : undefined
            );
        }
    }

    /**
     * Generates resource.json content from metadata
     */
    private generateResourceJson(metadata: { files?: string[]; timestamp?: number }): string {
        const resourceJson = {
            scope: 'A',
            version: 1,
            restricted: false,
            overridable: true,
            files: metadata.files ?? [],
            attributes: {
                lastModification: {
                    actor: 'extension',
                    timestamp: metadata.timestamp ?? Date.now()
                }
            }
        };

        return JSON.stringify(resourceJson, null, 2);
    }

    /**
     * Creates the actual resource.json file
     */
    private async createResourceJsonFile(
        projectId: string,
        typeId: string,
        resourcePath: string,
        categoryId: string | undefined,
        content: string
    ): Promise<void> {
        const configService = this.getService<{
            getProjectPaths: () => Promise<string[]>;
        }>('WorkspaceConfigService');

        try {
            // Get project paths and find the correct project directory
            const projectPaths = await configService.getProjectPaths();
            let projectBasePath: string | undefined;

            for (const basePath of projectPaths) {
                const candidatePath = path.join(String(basePath), projectId);
                try {
                    await fs.access(candidatePath);
                    projectBasePath = candidatePath;
                    break;
                } catch {
                    // Try next path
                }
            }

            if (projectBasePath === undefined) {
                throw new FlintError(`Project directory not found for '${projectId}'`, 'PROJECT_DIR_NOT_FOUND');
            }

            // Build full path to resource.json
            const fullResourcePath = path.join(projectBasePath, resourcePath);
            const resourceJsonPath = path.join(fullResourcePath, 'resource.json');

            // Check if resource.json already exists
            try {
                await fs.access(resourceJsonPath);
                throw new FlintError(`resource.json already exists for '${resourcePath}'`, 'RESOURCE_JSON_EXISTS');
            } catch (_error) {
                if (_error instanceof FlintError) {
                    throw _error;
                }
                // File doesn't exist, which is what we want
            }

            // Create the resource.json file
            await fs.writeFile(resourceJsonPath, content, 'utf8');

            console.log(`Created resource.json at: ${resourceJsonPath}`);
        } catch (_error) {
            throw new FlintError(
                'Failed to write resource.json file',
                'FILE_WRITE_FAILED',
                'Unable to create resource.json file on disk',
                _error instanceof Error ? _error : undefined
            );
        }
    }

    /**
     * Opens the created resource.json file in editor
     */
    private async openResourceJsonFile(
        projectId: string,
        typeId: string,
        resourcePath: string,
        _categoryId?: string
    ): Promise<void> {
        const configService = this.getService<{
            getProjectPaths: () => Promise<string[]>;
        }>('WorkspaceConfigService');

        try {
            // Get project paths and find the correct project directory
            const projectPaths = await configService.getProjectPaths();
            let projectBasePath: string | undefined;

            for (const basePath of projectPaths) {
                const candidatePath = path.join(String(basePath), projectId);
                try {
                    await fs.access(candidatePath);
                    projectBasePath = candidatePath;
                    break;
                } catch {
                    // Try next path
                }
            }

            if (projectBasePath === undefined) {
                console.warn(`Project directory not found for '${projectId}'`);
                return;
            }

            // Build full path to resource.json
            const fullResourcePath = path.join(projectBasePath, resourcePath);
            const resourceJsonPath = path.join(fullResourcePath, 'resource.json');

            // Open the file in VS Code
            const uri = vscode.Uri.file(resourceJsonPath);
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (error) {
            console.warn('Failed to open resource.json file:', error);
        }
    }
}
