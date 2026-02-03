/**
 * @module SelectEnvironmentCommand
 * @description Command to select environment for a gateway
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext } from '@/core/types/commands';
import { GatewayConfig } from '@/core/types/configuration';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';
import { EnvironmentService } from '@/services/environments/EnvironmentService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';

/**
 * Command to show environment selection dialog for the active gateway
 */
export class SelectEnvironmentCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.SELECT_ENVIRONMENT, context);
    }

    protected async executeImpl(): Promise<void> {
        try {
            const gatewayManager = this.getService<GatewayManagerService>('GatewayManagerService');
            const configService = this.getService<WorkspaceConfigService>('WorkspaceConfigService');
            const environmentService = this.getService<EnvironmentService>('EnvironmentService');

            // Check if gateway is selected
            const activeGateway = gatewayManager.getSelectedGateway();
            if (activeGateway === null || activeGateway.length === 0) {
                vscode.window.showWarningMessage('Please select a gateway first');
                return;
            }

            // Get gateway configuration
            const gateways = await configService.getGateways();
            const gatewayConfig = gateways[activeGateway] as GatewayConfig | undefined;
            if (gatewayConfig === undefined) {
                throw new FlintError(
                    `Gateway configuration not found for '${activeGateway}'`,
                    'GATEWAY_CONFIG_NOT_FOUND'
                );
            }

            // Get available environments
            const environments = environmentService.getAvailableEnvironments(gatewayConfig);

            if (environments.length === 1) {
                // Show info message in status bar (auto-dismiss after 3 seconds)
                vscode.window.setStatusBarMessage(
                    `Gateway '${activeGateway}' only has one environment: ${environments[0]}`,
                    3000
                );
                return;
            }

            // Get current selection
            const currentEnv = environmentService.getSelectedEnvironment(activeGateway);

            // Create quick pick items
            const items = environments.map(env => {
                const config = environmentService.resolveEnvironmentConfig(gatewayConfig, env);
                return {
                    label: env,
                    description: `${config.host}:${config.port} (${config.ssl ? 'HTTPS' : 'HTTP'})`,
                    detail: env === currentEnv ? 'Currently selected' : undefined,
                    env
                };
            });

            // Show quick pick
            const selected = await vscode.window.showQuickPick(items, {
                title: `Select Environment for Gateway: ${activeGateway}`,
                placeHolder: `Choose an environment (current: ${currentEnv ?? 'default'})`,
                matchOnDescription: true
            });

            if (!selected) {
                return; // User cancelled
            }

            // Update selection
            await environmentService.setSelectedEnvironment(activeGateway, selected.env);

            // Show confirmation in status bar (auto-dismiss after 3 seconds)
            const config = environmentService.resolveEnvironmentConfig(gatewayConfig, selected.env);
            vscode.window.setStatusBarMessage(
                `Selected environment '${selected.env}' for gateway '${activeGateway}' (${config.host}:${config.port})`,
                3000
            );

            // Refresh tree to update any environment-specific displays
            await vscode.commands.executeCommand(COMMANDS.REFRESH_PROJECTS);
        } catch (error) {
            console.error(`Failed to select environment: ${String(error)}`);
            throw new FlintError(
                'Failed to select environment',
                'ENVIRONMENT_SELECTION_FAILED',
                'Unable to change the selected environment',
                error instanceof Error ? error : undefined
            );
        }
    }
}
