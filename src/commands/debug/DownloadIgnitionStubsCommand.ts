/**
 * @module DownloadIgnitionStubsCommand
 * @description Command to manually download Ignition Python stubs for a specific version
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants';
import { CommandContext } from '@/core/types/commands';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';
import { IgnitionStubsManagerService } from '@/services/python/IgnitionStubsManagerService';

/**
 * Command to manually download Ignition Python stubs
 */
export class DownloadIgnitionStubsCommand extends Command {
    private readonly stubsManager?: IgnitionStubsManagerService;
    private readonly configService?: WorkspaceConfigService;

    constructor(context: CommandContext) {
        super(COMMANDS.DOWNLOAD_IGNITION_STUBS, context);
        this.stubsManager = context.services.get<IgnitionStubsManagerService>('IgnitionStubsManagerService');
        this.configService = context.services.get<WorkspaceConfigService>('WorkspaceConfigService');
    }

    protected async executeImpl(): Promise<void> {
        if (!this.stubsManager) {
            void vscode.window.showErrorMessage('Ignition stubs manager is not available');
            return;
        }

        // Get available versions from configured gateways
        const availableVersions = new Set<string>();

        if (this.configService) {
            try {
                const gateways = await this.configService.getGateways();
                for (const gateway of Object.values(gateways)) {
                    if (gateway.ignitionVersion) {
                        availableVersions.add(gateway.ignitionVersion);
                    }
                }
            } catch {
                // Ignore errors getting gateways
            }
        }

        // Add common versions as suggestions
        const commonVersions = ['8.1.33', '8.1.35', '8.1.42', '8.3.0', '8.3.1'];
        for (const version of commonVersions) {
            availableVersions.add(version);
        }

        // Get already cached versions
        const cachedVersions = new Set(this.stubsManager.getCachedVersions());

        // Create quick pick items
        const items: vscode.QuickPickItem[] = Array.from(availableVersions)
            .sort((a, b) => b.localeCompare(a)) // Sort versions in reverse order (newest first)
            .map(version => ({
                label: version,
                description: cachedVersions.has(version) ? '✓ Already cached' : 'Not cached',
                detail: `Download Ignition ${version} Python stubs`
            }));

        // Add custom version option
        items.push({
            label: '$(edit) Enter custom version...',
            description: 'Specify a version manually',
            detail: 'Enter any valid Ignition version number'
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select Ignition version to download stubs for',
            title: 'Download Ignition Stubs'
        });

        if (!selected) {
            return;
        }

        let version: string;

        if (selected.label.includes('Enter custom version')) {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter Ignition version (e.g., 8.1.33)',
                placeHolder: '8.1.33',
                validateInput: value => {
                    if (!value || !/^\d+\.\d+(\.\d+)?$/.test(value)) {
                        return 'Please enter a valid version number (e.g., 8.1.33)';
                    }
                    return null;
                }
            });

            if (!input) {
                return;
            }

            version = input;
        } else {
            version = selected.label;
        }

        // Download the stubs
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Downloading Ignition ${version} stubs...`,
                    cancellable: false
                },
                async () => {
                    // Force download without prompt
                    const metadata = await this.stubsManager!.ensureStubs(version, false);
                    if (metadata) {
                        void vscode.window.showInformationMessage(
                            `Successfully downloaded Ignition ${version} Python stubs`
                        );
                    }
                }
            );
        } catch (error) {
            void vscode.window.showErrorMessage(
                `Failed to download stubs: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}
