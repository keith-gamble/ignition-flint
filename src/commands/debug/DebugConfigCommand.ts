/**
 * @module DebugConfigCommand
 * @description Debug command to inspect loaded configuration
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
// FlintError import removed as it's no longer used
import { CommandContext } from '@/core/types/commands';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';

/**
 * Debug command to show loaded configuration
 */
export class DebugConfigCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.DEBUG_CONFIG, context);
    }

    protected async executeImpl(): Promise<void> {
        try {
            const configService = this.getService<WorkspaceConfigService>('WorkspaceConfigService');
            const gatewayManager = this.getService<GatewayManagerService>('GatewayManagerService');

            // TypeScript ensures configService is available from getService()

            // Get current configuration
            const config = await configService.getConfiguration();
            const gateways = await configService.getGateways();
            const activeGateway = gatewayManager.getSelectedGateway();

            // Show debug information
            const debugInfo: {
                activeGateway: string | undefined;
                configSchemaVersion: string;
                gatewayCount: number;
                gateways: Record<string, unknown>;
            } = {
                activeGateway: activeGateway ?? undefined,
                configSchemaVersion: config.schemaVersion,
                gatewayCount: Object.keys(gateways).length,
                gateways: {}
            };

            // Add gateway details
            for (const [id, gateway] of Object.entries(gateways)) {
                debugInfo.gateways[id] = {
                    id: gateway.id,
                    hasHost: Boolean(gateway.host),
                    hasPort: Boolean(gateway.port !== undefined && gateway.port > 0),
                    hasEnvironments: Boolean(gateway.environments),
                    environmentCount: Object.keys((gateway.environments as Record<string, unknown> | undefined) ?? {})
                        .length,
                    environmentNames: Object.keys((gateway.environments as Record<string, unknown> | undefined) ?? {}),
                    defaultEnvironment: gateway.defaultEnvironment as unknown
                };
            }

            console.log('FLINT CONFIG DEBUG:', JSON.stringify(debugInfo, null, 2));

            // Also show in a VS Code info dialog
            const message = `Config Debug:
Active Gateway: ${activeGateway ?? 'None'}
Gateway Count: ${String(debugInfo.gatewayCount)}
Schema Version: ${String(debugInfo.configSchemaVersion)}

Check VS Code Developer Console (Help → Toggle Developer Tools → Console) for full details.`;

            vscode.window.showInformationMessage(message);
        } catch (error) {
            console.error('Debug config command failed:', error);
            vscode.window.showErrorMessage(`Debug failed: ${String(error)}`);
        }
    }
}
