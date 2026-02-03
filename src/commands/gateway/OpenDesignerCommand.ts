/**
 * @module OpenDesignerCommand
 * @description Command to open Ignition Designer for selected gateway
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';
import { EnvironmentService } from '@/services/environments/EnvironmentService';

/**
 * Command to launch Ignition Designer for a specific gateway
 */
export class OpenDesignerCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.OPEN_DESIGNER, context);
    }

    protected validateArguments(_gatewayId?: string, _projectName?: string): CommandValidationResult {
        return {
            isValid: true, // Both parameters are optional
            errors: [],
            warnings: []
        };
    }

    protected async executeImpl(gatewayId?: string, _projectName?: string): Promise<void> {
        try {
            const configService = this.getService<WorkspaceConfigService>('WorkspaceConfigService');
            const environmentService = this.getService<EnvironmentService>('EnvironmentService');
            // TypeScript ensures environmentService is available from getService()

            // Determine which gateway to use
            let targetGatewayId = gatewayId;
            if (targetGatewayId === undefined || targetGatewayId.length === 0) {
                // Show gateway selection dialog
                targetGatewayId = await this.selectGatewayInteractively(configService, environmentService);
                if (targetGatewayId === undefined || targetGatewayId.length === 0) {
                    // User cancelled selection
                    return;
                }
            }

            // Get gateway configuration
            const gateways = await configService.getGateways();
            const gatewayConfig = gateways[targetGatewayId];
            // TypeScript ensures gatewayConfig exists due to prior validation

            // Get the environment-specific configuration
            const envConfig = environmentService.getActiveEnvironmentConfig(gatewayConfig);

            // Check if user has Designer installed (one-time check)
            const hasConfirmedDesigner = Boolean(
                (this.context.extensionContext as vscode.ExtensionContext).globalState.get(
                    'flint.designerConfirmed',
                    false
                )
            );

            if (hasConfirmedDesigner === false) {
                const choice = await vscode.window.showInformationMessage(
                    'Do you have Ignition Designer 8.3+ installed?',
                    {
                        detail:
                            'This command will open designer:// links which require Ignition Designer 8.3 or later.\n\n' +
                            "If you don't have Designer installed, the link may not work.",
                        modal: true
                    },
                    'Yes, I have Designer 8.3+',
                    'Cancel'
                );

                if (choice === 'Yes, I have Designer 8.3+') {
                    await (this.context.extensionContext as vscode.ExtensionContext).globalState.update(
                        'flint.designerConfirmed',
                        true
                    );
                } else {
                    return;
                }
            }

            // Build designer URL using environment-specific configuration
            const port = envConfig.port !== (envConfig.ssl ? 443 : 80) ? `:${envConfig.port}` : '';
            const designerUrl = `designer://${envConfig.host}${port}`;

            // Show which environment is being used
            const environmentInfo = envConfig.environment !== 'default' ? ` (${envConfig.environment})` : '';
            vscode.window.showInformationMessage(
                `Opening Designer for ${targetGatewayId}${environmentInfo}: ${envConfig.host}${port}`
            );

            const uri = vscode.Uri.parse(designerUrl);
            await vscode.env.openExternal(uri);
        } catch (error) {
            throw new FlintError(
                'Failed to open designer',
                'DESIGNER_LAUNCH_FAILED',
                'Unable to launch Ignition Designer',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Shows gateway selection dialog and returns the selected gateway ID
     */
    private async selectGatewayInteractively(
        configService: WorkspaceConfigService,
        environmentService: EnvironmentService
    ): Promise<string | undefined> {
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

            // Create quick pick items
            const items = gatewayEntries.map(([id, config]) => {
                try {
                    // Get environment configuration for this gateway
                    const envConfig = environmentService.getActiveEnvironmentConfig(config);
                    const environmentInfo = envConfig.environment !== 'default' ? ` (${envConfig.environment})` : '';
                    const port = envConfig.port !== (envConfig.ssl ? 443 : 80) ? `:${envConfig.port}` : '';

                    return {
                        label: `${id}${environmentInfo}`,
                        description: `${envConfig.host}${port}`,
                        detail: `${config.projects?.length ?? 0} project(s) configured`,
                        gatewayId: id
                    };
                } catch {
                    // Fallback to basic info if environment resolution fails
                    return {
                        label: id,
                        description: `${config.host ?? 'No host configured'}${config.port !== undefined && config.port > 0 ? `:${config.port}` : ''}`,
                        detail: `${config.projects?.length ?? 0} project(s) configured`,
                        gatewayId: id
                    };
                }
            });

            // Show selection dialog
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a gateway to open in Designer',
                title: 'Open Ignition Designer'
            });

            return selected?.gatewayId;
        } catch (error) {
            console.error('Failed to show gateway selection:', error);
            return undefined;
        }
    }

    /**
     * Launches designer using designer:// deeplink
     */
    private async launchDesigner(url: string): Promise<void> {
        const uri = vscode.Uri.parse(url);
        await vscode.env.openExternal(uri);
    }
}
