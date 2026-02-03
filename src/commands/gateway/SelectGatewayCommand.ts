/**
 * @module SelectGatewayCommand
 * @description Command to select and switch active gateway
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext } from '@/core/types/commands';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';

/**
 * Command to show gateway selection dialog and switch to selected gateway
 */
export class SelectGatewayCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.SELECT_GATEWAY, context);
    }

    protected async executeImpl(): Promise<void> {
        try {
            const gatewayManager = this.getService<GatewayManagerService>('GatewayManagerService');
            const configService = this.getService<WorkspaceConfigService>('WorkspaceConfigService');

            // Get available gateways
            const gateways = await configService.getGateways();
            const gatewayEntries = Object.entries(gateways);

            if (gatewayEntries.length === 0) {
                const choice = await vscode.window.showWarningMessage(
                    'No gateways configured in flint.config.json',
                    'Add Gateway',
                    'Open Config'
                );

                switch (choice) {
                    case 'Add Gateway':
                        await vscode.commands.executeCommand(COMMANDS.ADD_GATEWAY);
                        break;
                    case 'Open Config':
                        await vscode.commands.executeCommand(COMMANDS.OPEN_CONFIG);
                        break;
                    default:
                        // User cancelled or selected unknown option
                        break;
                }
                return;
            }

            // Get current active gateway for display
            const currentGateway = gatewayManager.getSelectedGateway();

            // Create quick pick items
            const items = gatewayEntries.map(([id, config]) => ({
                label: id,
                description: `${config.host}${config.port !== undefined && config.port > 0 ? `:${config.port}` : ''}`,
                detail: `${config.projects?.length ?? 0} project(s) configured${currentGateway === id ? ' (current)' : ''}`,
                gatewayId: id
            }));

            // Show selection dialog
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a gateway',
                title: 'Gateway Selection'
            });

            if (!selected) return;

            // Switch to selected gateway
            await gatewayManager.selectGateway(selected.gatewayId);

            // Show success message in status bar (auto-dismiss after 3 seconds)
            vscode.window.setStatusBarMessage(`Switched to gateway: ${selected.label}`, 3000);
        } catch (error) {
            throw new FlintError(
                'Failed to select gateway',
                'GATEWAY_SELECTION_FAILED',
                'Unable to switch to the selected gateway',
                error instanceof Error ? error : undefined
            );
        }
    }
}
