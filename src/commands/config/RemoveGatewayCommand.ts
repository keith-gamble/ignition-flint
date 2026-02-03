/**
 * @module RemoveGatewayCommand
 * @description Command to remove a gateway from the configuration
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext } from '@/core/types/commands';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';

/**
 * Command to remove a gateway from the workspace configuration
 * Shows list of gateways and confirms deletion
 */
export class RemoveGatewayCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.REMOVE_GATEWAY, context);
    }

    protected async executeImpl(): Promise<void> {
        try {
            const configService = this.getService<WorkspaceConfigService>('WorkspaceConfigService');

            // Get existing gateways
            const gateways = await configService.getGateways();

            if (Object.keys(gateways).length === 0) {
                await vscode.window.showWarningMessage('No gateways configured');
                return;
            }

            // Create quick pick items from gateways
            const gatewayItems = Object.entries(gateways).map(([id, config]) => ({
                label: id,
                description:
                    config.host +
                    (typeof config.port === 'number' && !isNaN(config.port) && config.port !== 0
                        ? `:${config.port}`
                        : ''),
                detail: `${config.projects && typeof config.projects.length === 'number' && !isNaN(config.projects.length) && config.projects.length > 0 ? config.projects.length : 0} project(s) configured`,
                gatewayId: id
            }));

            // Show gateway selection
            const selected = await vscode.window.showQuickPick(gatewayItems, {
                placeHolder: 'Select a gateway to remove',
                title: 'Remove Gateway'
            });

            if (!selected) return;

            // Confirm deletion
            const confirmed = await this.confirmDeletion(selected.label);
            if (!confirmed) return;

            // Remove the gateway
            await configService.removeGateway(selected.gatewayId);

            // Show success message in status bar (auto-dismiss after 3 seconds)
            vscode.window.setStatusBarMessage(`Removed gateway "${selected.label}"`, 3000);
        } catch (_error) {
            throw new FlintError(
                'Failed to remove gateway',
                'GATEWAY_REMOVE_FAILED',
                'Unable to remove gateway from configuration',
                _error instanceof Error ? _error : undefined
            );
        }
    }

    /**
     * Confirms gateway deletion with user
     */
    private async confirmDeletion(gatewayName: string): Promise<boolean> {
        const choice = await vscode.window.showWarningMessage(
            `Remove Gateway "${gatewayName}"?`,
            {
                modal: true,
                detail: `This will remove the gateway "${gatewayName}" and all its project associations from the configuration.`
            },
            'Remove'
        );

        return choice === 'Remove';
    }
}
