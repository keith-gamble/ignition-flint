/**
 * @module AddProjectPathsCommand
 * @description Command to add project paths to the configuration
 */

import * as path from 'path';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError, ConfigurationNotFoundError } from '@/core/errors';
import { CommandContext } from '@/core/types/commands';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';

/**
 * Command to add project paths to the workspace configuration
 * Allows users to select directories containing Ignition projects
 */
export class AddProjectPathsCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.ADD_PROJECT_PATHS, context);
    }

    protected async executeImpl(): Promise<void> {
        try {
            const configService = this.getService<WorkspaceConfigService>('WorkspaceConfigService');

            // Get workspace folder for default path
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new ConfigurationNotFoundError('No workspace folder found');
            }

            // Show folder selection dialog
            const selectedFolders = await this.showFolderSelectionDialog(workspaceFolder);
            if (!selectedFolders || selectedFolders.length === 0) {
                return;
            }

            // Convert paths to relative paths where possible
            const projectPaths = this.convertToRelativePaths(selectedFolders, workspaceFolder);

            // Add paths to configuration
            await configService.addProjectPaths(projectPaths);

            // Show success message
            const pathsList = projectPaths.map(p => `• ${p}`).join('\n');
            const choice = await vscode.window.showInformationMessage(
                `Added ${projectPaths.length} project path(s):\n${pathsList}`,
                'Open Config'
            );

            // Handle user choice
            if (choice === 'Open Config') {
                await vscode.commands.executeCommand(COMMANDS.OPEN_CONFIG);
            }
        } catch (_error) {
            throw new FlintError(
                'Failed to add project paths',
                'PROJECT_PATHS_ADD_FAILED',
                'Unable to add project paths to configuration',
                _error instanceof Error ? _error : undefined
            );
        }
    }

    /**
     * Shows folder selection dialog
     */
    private async showFolderSelectionDialog(
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<vscode.Uri[] | undefined> {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: true,
            canSelectFiles: false,
            canSelectFolders: true,
            defaultUri: workspaceFolder.uri,
            title: 'Select Project Directories',
            openLabel: 'Add Project Paths'
        };

        return vscode.window.showOpenDialog(options);
    }

    /**
     * Converts absolute paths to relative paths where possible
     */
    private convertToRelativePaths(selectedFolders: vscode.Uri[], workspaceFolder: vscode.WorkspaceFolder): string[] {
        const workspaceRoot = workspaceFolder.uri.fsPath;
        const projectPaths: string[] = [];

        for (const folderUri of selectedFolders) {
            const folderPath = folderUri.fsPath;

            // Convert to relative path if inside workspace
            let relativePath: string;
            if (folderPath.startsWith(workspaceRoot)) {
                relativePath = path.relative(workspaceRoot, folderPath);
                if (relativePath === '') {
                    relativePath = '.';
                }
            } else {
                relativePath = folderPath; // Absolute path
            }

            projectPaths.push(relativePath);
        }

        return projectPaths;
    }
}
