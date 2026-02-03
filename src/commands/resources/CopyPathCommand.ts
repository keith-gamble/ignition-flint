/**
 * @module CopyPathCommand
 * @description Command to copy resource path to clipboard
 */

import * as path from 'path';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError, InvalidArgumentError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';

/**
 * Command to copy a resource path to the clipboard
 * Provides different path formats for different use cases
 */
export class CopyPathCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.COPY_RESOURCE_PATH, context);
    }

    protected validateArguments(resourcePath?: string, _pathType?: string): CommandValidationResult {
        const errors: string[] = [];

        if (resourcePath === undefined || resourcePath === '') {
            errors.push('Resource path is required');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings: []
        };
    }

    protected async executeImpl(resourcePath?: string, pathType: string = 'resource'): Promise<void> {
        if (resourcePath === undefined || resourcePath === '') {
            throw new InvalidArgumentError('arguments', 'resourcePath', [resourcePath]);
        }

        try {
            let pathToCopy: string;
            let displayMessage: string;

            switch (pathType) {
                case 'file':
                    // Copy file system path
                    pathToCopy = await this.convertToFilePath(resourcePath);
                    displayMessage = `Copied file path: ${pathToCopy}`;
                    break;
                case 'resource':
                default:
                    // Copy resource path (default)
                    pathToCopy = resourcePath;
                    displayMessage = `Copied resource path: ${pathToCopy}`;
                    break;
            }

            // Copy to clipboard
            await vscode.env.clipboard.writeText(pathToCopy);

            // Show confirmation message in status bar (auto-dismiss after 3 seconds)
            vscode.window.setStatusBarMessage(`${displayMessage}`, 3000);
        } catch (error) {
            throw new FlintError(
                'Failed to copy path',
                'COPY_PATH_FAILED',
                'Unable to copy the resource path to clipboard',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Converts resource path to file system path using project context
     */
    private async convertToFilePath(resourcePath: string): Promise<string> {
        try {
            // Get workspace config service
            const workspaceConfig = this.getService<{ getProjectPaths(): Promise<string[]> }>('WorkspaceConfigService');

            if (workspaceConfig === undefined) {
                return resourcePath;
            }

            // Get project paths from workspace config
            const projectPaths = await workspaceConfig.getProjectPaths();

            // For now, assume the resource path is relative to the first project path
            // In a more sophisticated implementation, we would need to determine which project
            // this resource belongs to based on the full context
            if (projectPaths.length > 0) {
                return path.join(projectPaths[0], resourcePath);
            }

            return resourcePath;
        } catch (error) {
            console.warn('Failed to convert resource path to file path:', error);
            return resourcePath;
        }
    }
}
