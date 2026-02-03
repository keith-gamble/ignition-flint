/**
 * @module AddGatewayCommand
 * @description Command to add a new gateway to the configuration
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext } from '@/core/types/commands';
import { GatewayConfig } from '@/core/types/configuration';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';

/**
 * Command to add a new gateway to the workspace configuration
 * Guides user through gateway setup with validation
 */
export class AddGatewayCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.ADD_GATEWAY, context);
    }

    protected async executeImpl(): Promise<void> {
        try {
            const configService = this.getService<WorkspaceConfigService>('WorkspaceConfigService');

            // Get gateway name with validation
            const gatewayName = await this.promptForGatewayName(configService);
            if (gatewayName === undefined || gatewayName.length === 0) return;

            // Get gateway URL with validation
            const gatewayUrl = await this.promptForGatewayUrl();
            if (gatewayUrl === undefined || gatewayUrl.length === 0) return;

            // Parse URL and create gateway configuration
            const gatewayConfig = await this.createGatewayConfig(gatewayUrl);

            // Add the gateway to configuration
            await configService.setGateway(gatewayName, gatewayConfig);

            // Show success message and offer next steps
            const choice = await vscode.window.showInformationMessage(
                `Added gateway "${gatewayName}" (${gatewayUrl})`,
                'Open Config',
                'Add Projects'
            );

            // Handle user choice
            switch (choice) {
                case 'Open Config':
                    await vscode.commands.executeCommand(COMMANDS.OPEN_CONFIG);
                    break;
                case 'Add Projects':
                    await vscode.commands.executeCommand(COMMANDS.ADD_PROJECT_PATHS);
                    break;
                default:
                    // User cancelled or selected unknown option
                    break;
            }
        } catch (_error) {
            throw new FlintError(
                'Failed to add gateway',
                'GATEWAY_ADD_FAILED',
                'Unable to add gateway to configuration',
                _error instanceof Error ? _error : undefined
            );
        }
    }

    /**
     * Prompts user for gateway name with validation
     */
    private async promptForGatewayName(_configService: WorkspaceConfigService): Promise<string | undefined> {
        const gatewayName = await vscode.window.showInputBox({
            placeHolder: 'Enter gateway name (e.g., "dev-gateway")',
            prompt: 'Gateway Name',
            validateInput: value => {
                if (!value || value.trim().length === 0) {
                    return 'Gateway name cannot be empty';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
                    return 'Gateway name can only contain letters, numbers, underscores, and hyphens';
                }

                // Check for duplicate names - Note: This is basic validation,
                // full validation will be done when actually saving the config
                return null;
            }
        });

        return gatewayName?.trim();
    }

    /**
     * Prompts user for gateway URL with validation
     */
    private async promptForGatewayUrl(): Promise<string | undefined> {
        const gatewayUrl = await vscode.window.showInputBox({
            placeHolder: 'Enter gateway URL (e.g., "http://localhost:8088" or "https://ignition.localtest.me")',
            prompt: 'Gateway URL',
            validateInput: value => {
                if (!value || value.trim().length === 0) {
                    return 'Gateway URL cannot be empty';
                }
                try {
                    new URL(value.trim());
                    return null;
                } catch {
                    return 'Please enter a valid URL';
                }
            }
        });

        return gatewayUrl?.trim();
    }

    /**
     * Creates gateway configuration from URL
     */
    private async createGatewayConfig(gatewayUrl: string): Promise<Omit<GatewayConfig, 'id'>> {
        const parsedUrl = new URL(gatewayUrl);
        let ignoreSSLErrors = false;

        // Ask about SSL certificate validation for HTTPS
        if (parsedUrl.protocol === 'https:') {
            const sslChoice = await vscode.window.showQuickPick(
                [
                    { label: 'Validate SSL certificates (recommended)', value: false },
                    { label: 'Ignore SSL certificate errors (for self-signed certs)', value: true }
                ],
                {
                    placeHolder: 'SSL Certificate Validation',
                    title: 'How should SSL certificates be handled?'
                }
            );

            if (sslChoice) {
                ignoreSSLErrors = sslChoice.value;
            }
        }

        const gatewayConfig: Omit<GatewayConfig, 'id'> = {
            host: `${parsedUrl.protocol}//${parsedUrl.hostname}`,
            port: parsedUrl.port ? parseInt(parsedUrl.port) : parsedUrl.protocol === 'https:' ? 443 : 80,
            ssl: parsedUrl.protocol === 'https:',
            ignoreSSLErrors,
            projects: [],
            enabled: true
        };

        return gatewayConfig;
    }
}
