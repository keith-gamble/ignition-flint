/**
 * @module OpenWithKindlingCommand
 * @description Command to open resources with Kindling external tool
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError, InvalidArgumentError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { KindlingHelper } from '@/utils/kindlingHelper';

/**
 * Command to open resources with the Kindling external tool
 * Provides integration with the Kindling Ignition resource viewer
 */
export class OpenWithKindlingCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.OPEN_WITH_KINDLING, context);
    }

    protected validateArguments(
        uriOrProjectId?: vscode.Uri | string,
        typeId?: string,
        resourcePath?: string
    ): CommandValidationResult {
        // If first argument is a URI (from file explorer context), it's valid
        if (uriOrProjectId && typeof uriOrProjectId === 'object' && uriOrProjectId.fsPath) {
            return {
                isValid: true,
                errors: [],
                warnings: []
            };
        }

        // Otherwise validate as individual parameters
        const errors: string[] = [];
        const projectId = uriOrProjectId as string;

        if (!projectId) {
            errors.push('Project ID is required');
        }

        if (!resourcePath) {
            errors.push('Resource path is required');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings: typeId ? [] : ['Resource type not specified - will attempt auto-detection']
        };
    }

    protected async executeImpl(
        uriOrProjectId?: vscode.Uri | string,
        typeId?: string,
        resourcePath?: string,
        categoryId?: string
    ): Promise<void> {
        let fileUri: vscode.Uri;
        let resourceDisplayName: string;

        try {
            // Handle case where command is called from file explorer (first argument is a URI)
            if (uriOrProjectId && typeof uriOrProjectId === 'object' && uriOrProjectId.fsPath) {
                fileUri = uriOrProjectId;
                resourceDisplayName = this.getResourceDisplayNameFromPath(fileUri.fsPath);
            } else {
                // Handle case where command is called programmatically with parameters
                const projectId = uriOrProjectId as string;
                if (!projectId || !resourcePath) {
                    throw new InvalidArgumentError('arguments', 'projectId and resourcePath or file URI', [
                        projectId,
                        resourcePath
                    ]);
                }

                // Build the actual file path for the resource
                const filePath = await this.buildFilePath(projectId, typeId, resourcePath, categoryId);
                fileUri = vscode.Uri.file(filePath);
                resourceDisplayName = this.getResourceDisplayName(resourcePath);
            }

            // Check if file is supported by Kindling
            if (!KindlingHelper.isSupportedFileType(fileUri.fsPath)) {
                await vscode.window.showWarningMessage(
                    `Resource type for ${resourceDisplayName} may not be supported by Kindling. ` +
                        'Supported types: .gwbk, .modl, .idb, .log'
                );
            }

            // Use the enhanced KindlingHelper to open the file
            await this.executeWithProgress(
                async progress => {
                    progress?.(25, 'Preparing resource for Kindling...');

                    progress?.(50, 'Launching Kindling...');

                    // Launch Kindling with proper error handling
                    await KindlingHelper.openWithKindling(fileUri);

                    progress?.(100, 'Kindling launched successfully');
                },
                {
                    showProgress: true,
                    progressTitle: 'Opening with Kindling...'
                }
            );

            // Show success message in status bar (auto-dismiss after 3 seconds)
            vscode.window.setStatusBarMessage(`Opened ${resourceDisplayName} in Kindling`, 3000);
        } catch (error) {
            throw new FlintError(
                'Failed to open with Kindling',
                'KINDLING_LAUNCH_FAILED',
                'Unable to launch Kindling with the specified resource',
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
     * Gets display name from file system path
     */
    private getResourceDisplayNameFromPath(filePath: string): string {
        const pathParts = filePath.split(/[/\\]/);
        return pathParts[pathParts.length - 1];
    }

    /**
     * Builds the actual file system path for the resource
     */
    private async buildFilePath(
        projectId: string,
        typeId: string | undefined,
        resourcePath: string,
        _categoryId?: string
    ): Promise<string> {
        try {
            // Get project paths from workspace configuration
            const config = vscode.workspace.getConfiguration();
            const projectPaths = config.get<string[]>('flint.projectPaths') ?? [];

            // For now, use a simple approach to find the project file
            // In the future, this could use the ProjectScannerService
            for (const projectPath of projectPaths) {
                // Build potential file path (simplified - would need proper resource type mapping)
                const potentialPath = `${projectPath}/${projectId}/${resourcePath}`;

                // Check if file exists (basic implementation)
                try {
                    const uri = vscode.Uri.file(potentialPath);
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat) {
                        return potentialPath;
                    }
                } catch {
                    // File doesn't exist, continue searching
                }
            }

            // If not found, return the best guess path
            return projectPaths.length > 0 ? `${projectPaths[0]}/${projectId}/${resourcePath}` : resourcePath;
        } catch (error) {
            throw new FlintError(
                'Failed to build file path',
                'FILE_PATH_BUILD_FAILED',
                'Unable to determine resource file location',
                error instanceof Error ? error : undefined
            );
        }
    }
}
