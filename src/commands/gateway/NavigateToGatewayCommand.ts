/**
 * @module NavigateToGatewayCommand
 * @description Command to navigate to gateway web interface
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';
import { EnvironmentService } from '@/services/environments/EnvironmentService';

/**
 * Command to open gateway web interface in default browser
 */
export class NavigateToGatewayCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.NAVIGATE_TO_GATEWAY, context);
    }

    protected validateArguments(_gatewayId?: string): CommandValidationResult {
        return {
            isValid: true, // gatewayId is optional - will prompt for selection if not provided
            errors: [],
            warnings: []
        };
    }

    protected async executeImpl(gatewayId?: string): Promise<void> {
        try {
            const configService = this.getService<WorkspaceConfigService>('WorkspaceConfigService');
            const environmentService = this.getService<EnvironmentService>('EnvironmentService');

            // Determine which gateway to use
            let targetGatewayId = gatewayId;
            if (targetGatewayId === undefined || targetGatewayId.length === 0) {
                // Show gateway selection dialog
                targetGatewayId = await this.selectGatewayInteractively(configService);
                if (targetGatewayId === undefined || targetGatewayId.length === 0) {
                    // User cancelled selection
                    return;
                }
            }

            // Get gateway configuration
            const gateways = await configService.getGateways();
            const gatewayConfig = gateways[targetGatewayId];
            // TypeScript ensures gatewayConfig exists due to prior validation

            // Build gateway URL using environment service
            const gatewayUrl = environmentService.buildGatewayUrl(gatewayConfig, '');
            const uri = vscode.Uri.parse(gatewayUrl);
            await vscode.env.openExternal(uri);
        } catch (error) {
            throw new FlintError(
                'Failed to navigate to gateway',
                'GATEWAY_NAVIGATION_FAILED',
                'Unable to open gateway web interface',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Shows gateway selection dialog and returns the selected gateway ID
     */
    private async selectGatewayInteractively(configService: WorkspaceConfigService): Promise<string | undefined> {
        try {
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
                return undefined;
            }

            // Get environment service for URL building
            const environmentService = this.getService<EnvironmentService>('EnvironmentService');

            // Create quick pick items
            const items = gatewayEntries.map(([id, config]) => {
                const envConfig = environmentService.getActiveEnvironmentConfig(config);
                return {
                    label: id,
                    description: `${envConfig.host}${envConfig.port !== (envConfig.ssl ? 443 : 80) ? `:${envConfig.port}` : ''}`,
                    detail: `${config.projects?.length ?? 0} project(s) configured`,
                    gatewayId: id
                };
            });

            // Show selection dialog
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a gateway to open',
                title: 'Open Gateway Webpage'
            });

            return selected?.gatewayId;
        } catch (error) {
            console.error('Failed to show gateway selection:', error);
            return undefined;
        }
    }
}
