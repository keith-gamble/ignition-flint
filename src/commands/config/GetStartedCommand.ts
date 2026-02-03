/**
 * @module GetStartedCommand
 * @description Command to help users get started with Flint configuration
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext } from '@/core/types/commands';
import { SetupWizardWebview } from '@/views/webview/SetupWizardWebview';

/**
 * Command to help users get started with Flint configuration
 * Opens the setup wizard for initial configuration
 */
export class GetStartedCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.GET_STARTED, context);
    }

    protected async executeImpl(): Promise<void> {
        try {
            // Open the setup wizard - it will create the config when completed
            const setupWizard = this.getService<SetupWizardWebview>('SetupWizardWebview');
            const result = await setupWizard.openWizard();

            if (result.completed) {
                vscode.window.showInformationMessage(
                    `Configuration created! Added ${result.gatewayCount} gateway(s) and ${result.projectPathsAdded} project path(s).`
                );
            }
        } catch (_error) {
            throw new FlintError(
                'Failed to create initial configuration',
                'CONFIG_CREATION_FAILED',
                'Unable to set up initial Flint configuration',
                _error instanceof Error ? _error : undefined
            );
        }
    }
}
