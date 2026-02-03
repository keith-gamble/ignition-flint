/**
 * @module ClearIgnitionStubsCacheCommand
 * @description Command to clear the cached Ignition Python stubs
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants';
import { CommandContext } from '@/core/types/commands';
import { IgnitionStubsManagerService } from '@/services/python/IgnitionStubsManagerService';

/**
 * Command to clear the cached Ignition Python stubs
 */
export class ClearIgnitionStubsCacheCommand extends Command {
    private readonly stubsManager?: IgnitionStubsManagerService;

    constructor(context: CommandContext) {
        super(COMMANDS.CLEAR_IGNITION_STUBS_CACHE, context);
        this.stubsManager = context.services.get<IgnitionStubsManagerService>('IgnitionStubsManagerService');
    }

    protected async executeImpl(): Promise<void> {
        if (!this.stubsManager) {
            void vscode.window.showErrorMessage('Ignition stubs manager is not available');
            return;
        }

        // Get cached versions
        const cachedVersions = this.stubsManager.getCachedVersions();

        if (cachedVersions.length === 0) {
            void vscode.window.showInformationMessage('No cached Ignition stubs found');
            return;
        }

        // Ask which version to clear or all
        const items: vscode.QuickPickItem[] = [
            {
                label: 'Clear All',
                description: `Remove all ${cachedVersions.length} cached versions`,
                detail: 'This will remove all cached Ignition Python stubs'
            },
            ...cachedVersions.map(version => ({
                label: version,
                description: 'Ignition version',
                detail: `Clear cached stubs for Ignition ${version}`
            }))
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select which cached stubs to clear',
            title: 'Clear Ignition Stubs Cache'
        });

        if (!selected) {
            return;
        }

        try {
            if (selected.label === 'Clear All') {
                await this.stubsManager.clearAllVersions();
                void vscode.window.showInformationMessage('All cached Ignition stubs have been cleared');
            } else {
                await this.stubsManager.clearVersion(selected.label);
                void vscode.window.showInformationMessage(
                    `Cached stubs for Ignition ${selected.label} have been cleared`
                );
            }
        } catch (error) {
            void vscode.window.showErrorMessage(
                `Failed to clear stubs: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}
