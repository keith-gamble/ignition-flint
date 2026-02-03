/**
 * @module OpenResourceCommand
 * @description Command to open resources in appropriate editors
 */

import { promises as fs } from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError, InvalidArgumentError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { TreeNode } from '@/core/types/tree';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';

/**
 * Type guard to check if argument is a TreeNode
 */
function isTreeNode(arg: unknown): arg is TreeNode {
    return (
        typeof arg === 'object' &&
        arg !== null &&
        'projectId' in arg &&
        'resourcePath' in arg &&
        ('typeId' in arg || 'resourceType' in arg)
    );
}

/**
 * Command to open a resource in the appropriate editor
 * Handles different resource types and editor configurations
 */
export class OpenResourceCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.OPEN_RESOURCE, context);
    }

    protected validateArguments(
        projectIdOrNode?: string | TreeNode,
        typeId?: string,
        resourcePath?: string,
        _categoryId?: string
    ): CommandValidationResult {
        const errors: string[] = [];

        // Handle both calling conventions: TreeNode object or individual parameters
        let projectId: string | undefined;
        let actualTypeId: string | undefined;
        let actualResourcePath: string | undefined;

        if (isTreeNode(projectIdOrNode)) {
            // Called with TreeNode object
            projectId = projectIdOrNode.projectId;
            actualTypeId = projectIdOrNode.typeId ?? projectIdOrNode.resourceType;
            actualResourcePath = projectIdOrNode.resourcePath;
        } else {
            // Called with individual parameters
            projectId = projectIdOrNode;
            actualTypeId = typeId;
            actualResourcePath = resourcePath;
        }

        if (!projectId) {
            errors.push('Project ID is required');
        }

        if (!actualTypeId) {
            errors.push('Resource type ID is required');
        }

        if (!actualResourcePath) {
            errors.push('Resource path is required');
        }

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
        categoryId?: string,
        lineNumberOrEditorType?: string | number
    ): Promise<void> {
        // Handle both calling conventions: TreeNode object or individual parameters
        let projectId: string | undefined;
        let actualTypeId: string | undefined;
        let actualResourcePath: string | undefined;
        let actualCategoryId: string | undefined;
        let lineNumber: number | undefined;

        if (isTreeNode(projectIdOrNode)) {
            // Called with TreeNode object
            projectId = projectIdOrNode.projectId;
            actualTypeId = projectIdOrNode.typeId ?? projectIdOrNode.resourceType;
            actualResourcePath = projectIdOrNode.resourcePath;
            actualCategoryId = projectIdOrNode.categoryId;
            // Line number would be passed as the 5th parameter when called with TreeNode
            lineNumber = typeof lineNumberOrEditorType === 'number' ? lineNumberOrEditorType : undefined;
        } else {
            // Called with individual parameters
            projectId = projectIdOrNode;
            actualTypeId = typeId;
            actualResourcePath = resourcePath;
            actualCategoryId = categoryId;
            // Line number is passed as the 5th parameter for search results
            lineNumber = typeof lineNumberOrEditorType === 'number' ? lineNumberOrEditorType : undefined;
        }

        if (!projectId || !actualTypeId || !actualResourcePath) {
            throw new InvalidArgumentError('arguments', 'projectId, typeId, and resourcePath', [
                projectId,
                actualTypeId,
                actualResourcePath
            ]);
        }

        try {
            const resourceRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            // Get resource file path using registry
            const filePath = await this.getResourceFilePath(
                projectId,
                actualTypeId,
                actualResourcePath,
                actualCategoryId,
                resourceRegistry
            );

            // Check if this is a binary file that should be opened differently
            const fileName = path.basename(filePath);
            const isBinaryFile = fileName.endsWith('.bin');

            if (isBinaryFile) {
                // For binary files, use VS Code's default file opener which handles binary files better
                const uri = vscode.Uri.file(filePath);
                await vscode.commands.executeCommand('vscode.open', uri);
            } else {
                // Open text files normally in VS Code text editor
                const uri = vscode.Uri.file(filePath);
                const document = await vscode.workspace.openTextDocument(uri);

                // Show the document
                const editor = await vscode.window.showTextDocument(document, { preview: false });

                // If a line number was provided (from content search), navigate to that line
                if (lineNumber && lineNumber > 0) {
                    // VS Code uses 0-based line numbers internally, but our search results use 1-based
                    const position = new vscode.Position(lineNumber - 1, 0);
                    const range = new vscode.Range(position, position);

                    // Set cursor position and reveal the line
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                }
            }
        } catch (error) {
            console.error(`Failed to open resource: ${String(error)}`);
            throw new FlintError(
                'Failed to open resource',
                'RESOURCE_OPEN_FAILED',
                'Unable to open the requested resource',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Gets the file path for the resource using the resource registry
     */
    private async getResourceFilePath(
        projectId: string,
        typeId: string,
        resourcePath: string,
        categoryId?: string,
        resourceRegistry?: ResourceTypeProviderRegistry
    ): Promise<string> {
        if (!resourceRegistry) {
            throw new FlintError('Resource registry service not available', 'RESOURCE_REGISTRY_NOT_AVAILABLE');
        }

        // Get workspace config service
        const workspaceConfig = this.getService<any>('WorkspaceConfigService');

        // Get project paths from workspace config (both resolved and raw as fallback)
        let projectPaths: string[];
        try {
            projectPaths = await workspaceConfig.getProjectPaths();
        } catch {
            console.warn('Failed to get resolved project paths, trying raw paths fallback');
            const rawPaths = await workspaceConfig.getRawProjectPaths();
            // Manually resolve relative to workspace root
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? process.cwd();
            projectPaths = rawPaths.map((p: string) => (path.isAbsolute(p) ? p : path.resolve(workspaceRoot, p)));
        }

        // Find the actual project directory
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
            throw new FlintError(`Project '${projectId}' not found in configured paths`, 'PROJECT_NOT_FOUND');
        }

        // Get primary file from resource provider
        const provider = resourceRegistry.getProvider(typeId);
        if (!provider) {
            throw new FlintError(`No provider found for resource type '${typeId}'`, 'RESOURCE_PROVIDER_NOT_FOUND');
        }

        // Get the directory path from the resource type provider
        const searchConfig = provider.getSearchConfig();
        const directoryPaths = searchConfig.directoryPaths || [];
        if (directoryPaths.length === 0) {
            throw new FlintError(`Resource type '${typeId}' has no directory paths configured`, 'NO_DIRECTORY_PATHS');
        }

        // Use the first directory path (most resource types have only one)
        const resourceDirectory = directoryPaths[0];

        // Strip the resource directory from the resource path if it's already included
        // This happens when the TreeNode's resourcePath includes the full path from project root
        let relativeResourcePath = resourcePath;
        if (
            resourcePath.startsWith(`${resourceDirectory}/`) ||
            resourcePath.startsWith(`${resourceDirectory}${path.sep}`)
        ) {
            relativeResourcePath = resourcePath.substring(resourceDirectory.length + 1);
        } else if (resourcePath === resourceDirectory) {
            relativeResourcePath = '';
        }

        // Build the full resource path within the correct resource type directory
        const fullResourcePath = path.join(projectBasePath, resourceDirectory, relativeResourcePath);

        const editorConfig = provider.getEditorConfig();
        const primaryFileName = editorConfig?.primaryFile;
        if (!primaryFileName) {
            throw new FlintError(`No primary file defined for resource type '${typeId}'`, 'NO_PRIMARY_FILE_DEFINED');
        }

        // Check if the primary file exists
        const primaryFilePath = path.join(fullResourcePath, primaryFileName);
        try {
            await fs.access(primaryFilePath);
            return primaryFilePath;
        } catch {
            // File doesn't exist, throw error
            throw new FlintError(
                `Primary file '${primaryFileName}' not found for resource '${resourcePath}'`,
                'RESOURCE_FILE_NOT_FOUND'
            );
        }
    }
}
