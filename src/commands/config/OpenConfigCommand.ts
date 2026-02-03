/**
 * @module OpenConfigCommand
 * @description Command to open the flint.config.json file or create it if it doesn't exist
 */

import * as fs from 'fs/promises';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError, ConfigurationNotFoundError } from '@/core/errors';
import { CommandContext } from '@/core/types/commands';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';

/**
 * Command to open the configuration file for manual editing
 * Creates default configuration if file doesn't exist
 */
export class OpenConfigCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.OPEN_CONFIG, context);
    }

    protected async executeImpl(): Promise<void> {
        try {
            const configService = this.getService<WorkspaceConfigService>('WorkspaceConfigService');

            const configPath = this.getConfigurationPath();

            // Check if config exists, create if not
            const configExists = await this.fileExists(configPath);
            if (configExists === false) {
                await configService.createDefaultConfiguration();
                // Show success message in status bar (auto-dismiss after 3 seconds)
                vscode.window.setStatusBarMessage('✅ Created default flint.config.json', 3000);
            }

            // Open the config file
            const configUri = vscode.Uri.file(configPath);
            const document = await vscode.workspace.openTextDocument(configUri);
            await vscode.window.showTextDocument(document);
        } catch (_error) {
            if (_error instanceof ConfigurationNotFoundError) {
                throw _error;
            }
            throw new FlintError(
                'Failed to open configuration file',
                'CONFIG_OPEN_FAILED',
                'Unable to access the flint.config.json file',
                _error instanceof Error ? _error : undefined
            );
        }
    }

    /**
     * Gets the path to the configuration file
     */
    private getConfigurationPath(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder === undefined) {
            throw new ConfigurationNotFoundError('No workspace folder found');
        }

        return vscode.Uri.joinPath(workspaceFolder.uri, 'flint.config.json').fsPath;
    }

    /**
     * Utility method to check if file exists
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}
