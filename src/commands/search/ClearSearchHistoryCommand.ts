/**
 * @module ClearSearchHistoryCommand
 * @description Command to clear search history and cache
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext } from '@/core/types/commands';
import { SearchHistoryService } from '@/services/search/SearchHistoryService';
import { SearchIndexService } from '@/services/search/SearchIndexService';

/**
 * Command to clear search history and optionally search cache/index
 */
export class ClearSearchHistoryCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.CLEAR_SEARCH_HISTORY, context);
    }

    protected async executeImpl(): Promise<void> {
        try {
            const searchHistory = this.getService<SearchHistoryService>('SearchHistoryService');
            const searchIndex = this.getService<SearchIndexService>('SearchIndexService');

            // Show options for what to clear
            const clearOptions = await this.showClearOptions();
            if (clearOptions === null || clearOptions === undefined) return;

            // Confirm the operation
            const confirmed = await this.confirmClearOperation(clearOptions);
            if (confirmed === false) return;

            // Clear selected items with progress indication
            await this.executeWithProgress(
                async progress => {
                    let completedTasks = 0;
                    const totalTasks = clearOptions.length;

                    for (const option of clearOptions) {
                        const progressPercent = Math.floor((completedTasks / totalTasks) * 100);

                        switch (option) {
                            case 'history':
                                progress?.(progressPercent, 'Clearing search history...');
                                await searchHistory.clearHistory();
                                break;

                            case 'suggestions':
                                progress?.(progressPercent, 'Clearing search suggestions...');
                                // Suggestions are cleared when history is cleared
                                // No separate method needed as they are generated from history
                                break;

                            case 'cache':
                                progress?.(progressPercent, 'Clearing search index...');
                                try {
                                    // Clear the search index completely
                                    await searchIndex.clearIndex();
                                } catch (error) {
                                    console.warn('Failed to clear search index:', error);
                                }
                                break;

                            case 'index':
                                progress?.(progressPercent, 'Rebuilding search index...');
                                try {
                                    // Clear index first, then it will be rebuilt on next scan
                                    await searchIndex.clearIndex();

                                    // Trigger project rescan to rebuild index
                                    const projectScanner = this.getService<any>('ProjectScannerService');
                                    if (projectScanner && typeof projectScanner.rescanAllProjects === 'function') {
                                        await projectScanner.rescanAllProjects();
                                    }
                                } catch (error) {
                                    console.warn('Failed to rebuild search index:', error);
                                }
                                break;

                            default:
                                console.warn(`Unknown clear option: ${option}`);
                                break;
                        }

                        completedTasks++;
                    }

                    progress?.(100, 'Clear operation completed');
                },
                {
                    showProgress: true,
                    progressTitle: 'Clearing Search Data...'
                }
            );

            // Show completion message
            const clearedItems = clearOptions.map(opt => this.getOptionDisplayName(opt)).join(', ');
            await vscode.window.showInformationMessage(`✅ Cleared: ${clearedItems}`, 'Restart Search').then(choice => {
                if (choice === 'Restart Search') {
                    vscode.commands.executeCommand(COMMANDS.SEARCH_RESOURCES);
                }
            });
        } catch (_error) {
            throw new FlintError(
                'Failed to clear search history',
                'SEARCH_HISTORY_CLEAR_FAILED',
                'Unable to clear search data',
                _error instanceof Error ? _error : undefined
            );
        }
    }

    /**
     * Shows options for what to clear
     */
    private async showClearOptions(): Promise<string[] | undefined> {
        const options = [
            {
                label: '$(history) Search History',
                description: 'Clear recent search queries',
                detail: 'Removes all stored search queries and their metadata',
                id: 'history',
                picked: true
            },
            {
                label: '$(lightbulb) Search Suggestions',
                description: 'Clear auto-complete suggestions',
                detail: 'Removes learned patterns and suggestion cache',
                id: 'suggestions'
            },
            {
                label: '$(database) Search Cache',
                description: 'Clear cached search results',
                detail: 'Forces fresh search on next query',
                id: 'cache'
            },
            {
                label: '$(refresh) Rebuild Search Index',
                description: 'Recreate search index',
                detail: 'Rebuilds index from current project state (slower)',
                id: 'index'
            }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select what to clear',
            title: 'Clear Search Data',
            canPickMany: true,
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected?.map(item => item.id);
    }

    /**
     * Confirms the clear operation with details
     */
    private async confirmClearOperation(options: string[]): Promise<boolean> {
        const itemNames = options.map(opt => this.getOptionDisplayName(opt));
        const warningMessages = this.getWarningMessages(options);

        let detail = `This will clear: ${itemNames.join(', ')}`;
        if (warningMessages.length > 0) {
            detail += `\n\nWarnings:\n${warningMessages.map(msg => `• ${msg}`).join('\n')}`;
        }

        const choice = await vscode.window.showWarningMessage(
            `Clear ${itemNames.length} item${itemNames.length > 1 ? 's' : ''}?`,
            {
                detail,
                modal: true
            },
            'Clear',
            'Clear All Search Data'
        );

        if (choice === 'Clear All Search Data') {
            // Clear everything
            return this.confirmClearOperation(['history', 'suggestions', 'cache', 'index']);
        }

        return choice === 'Clear';
    }

    /**
     * Gets display name for clear option
     */
    private getOptionDisplayName(option: string): string {
        switch (option) {
            case 'history':
                return 'Search History';
            case 'suggestions':
                return 'Search Suggestions';
            case 'cache':
                return 'Search Cache';
            case 'index':
                return 'Search Index';
            default:
                return option;
        }
    }

    /**
     * Gets warning messages for selected options
     */
    private getWarningMessages(options: string[]): string[] {
        const warnings: string[] = [];

        if (options.includes('history')) {
            warnings.push('Recent searches will no longer appear in search suggestions');
        }

        if (options.includes('cache')) {
            warnings.push('Next search may be slower as results need to be recalculated');
        }

        if (options.includes('index')) {
            warnings.push('Index rebuild can take several minutes for large projects');
        }

        return warnings;
    }
}
