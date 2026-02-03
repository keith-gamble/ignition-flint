/**
 * @module SelectProjectCommand
 * @description Command to select and switch active project
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext } from '@/core/types/commands';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';

/**
 * Command to show project selection dialog and switch to selected project
 */
export class SelectProjectCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.SELECT_PROJECT, context);
    }

    protected async executeImpl(): Promise<void> {
        try {
            const gatewayManager = this.getService<GatewayManagerService>('GatewayManagerService');
            const configService = this.getService<WorkspaceConfigService>('WorkspaceConfigService');

            // Check if gateway is selected
            const activeGateway = gatewayManager.getSelectedGateway();
            if (activeGateway === null || activeGateway.length === 0) {
                const choice = await vscode.window.showWarningMessage(
                    'Please select a gateway first',
                    'Add Gateway',
                    'Select Gateway'
                );

                switch (choice) {
                    case 'Add Gateway':
                        await vscode.commands.executeCommand(COMMANDS.ADD_GATEWAY);
                        break;
                    case 'Select Gateway':
                        await vscode.commands.executeCommand(COMMANDS.SELECT_GATEWAY);
                        break;
                    default:
                        // User cancelled or selected unknown option
                        break;
                }
                return;
            }

            // Get gateway configuration to find available projects
            const gateways = await configService.getGateways();
            const gatewayConfig = gateways[activeGateway];

            // Check if gateway exists in configuration
            if (!gatewayConfig) {
                const choice = await vscode.window.showWarningMessage(
                    `Gateway '${activeGateway}' is not configured. Please add it to your flint.config.json.`,
                    'Configure Gateway',
                    'Select Different Gateway'
                );

                switch (choice) {
                    case 'Configure Gateway':
                        await vscode.commands.executeCommand(COMMANDS.OPEN_CONFIG);
                        break;
                    case 'Select Different Gateway':
                        await vscode.commands.executeCommand(COMMANDS.SELECT_GATEWAY);
                        break;
                    default:
                        // User cancelled
                        break;
                }
                return;
            }

            const availableProjects = gatewayConfig.projects ?? [];
            if (availableProjects.length === 0) {
                const choice = await vscode.window.showWarningMessage(
                    `No projects configured for gateway '${activeGateway}'`,
                    'Configure Projects',
                    'Refresh Gateway'
                );

                switch (choice) {
                    case 'Configure Projects':
                        await vscode.commands.executeCommand(COMMANDS.OPEN_CONFIG);
                        break;
                    case 'Refresh Gateway':
                        await vscode.commands.executeCommand(COMMANDS.REFRESH_PROJECTS);
                        break;
                    default:
                        // User cancelled or selected unknown option
                        break;
                }
                return;
            }

            // Get current selected project for display
            const currentProject = gatewayManager.getSelectedProject();

            // Create quick pick items
            const items = availableProjects.map(projectName => ({
                label: projectName,
                description: currentProject === projectName ? '(current)' : '',
                detail: `Project on ${activeGateway}`,
                projectName
            }));

            // Show selection dialog
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a project',
                title: `Project Selection - ${activeGateway}`
            });

            if (!selected) return;

            // Switch to selected project
            await gatewayManager.selectProject(selected.projectName);

            // Show success message in status bar (auto-dismiss after 3 seconds)
            vscode.window.setStatusBarMessage(`Switched to project: ${selected.label} (${activeGateway})`, 3000);
        } catch (error) {
            throw new FlintError(
                'Failed to select project',
                'PROJECT_SELECTION_FAILED',
                'Unable to switch to the selected project',
                error instanceof Error ? error : undefined
            );
        }
    }
}
