/**
 * @module SearchResourcesCommand
 * @description Command to search for resources across projects
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { ResourceSearchResult } from '@/core/types/resources';
import { SearchHistoryService } from '@/services/search/SearchHistoryService';
import { SearchProviderService } from '@/services/search/SearchProviderService';

/**
 * Search options for resource search
 */
interface ResourceSearchOptions {
    readonly query: string;
    readonly projectId?: string;
    readonly typeId?: string;
    readonly categoryId?: string;
    readonly includeInherited?: boolean;
    readonly caseSensitive?: boolean;
    readonly useRegex?: boolean;
    readonly maxResults?: number;
}

/**
 * Command to search for resources by name, path, or content
 */
export class SearchResourcesCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.SEARCH_RESOURCES, context);
    }

    protected validateArguments(_query?: string, _options?: Partial<ResourceSearchOptions>): CommandValidationResult {
        // Don't show any warnings - just let the command proceed silently
        return {
            isValid: true,
            errors: [],
            warnings: []
        };
    }

    protected async executeImpl(query?: unknown, options?: Partial<ResourceSearchOptions>): Promise<void> {
        try {
            const searchHistory = this.getService<SearchHistoryService>('SearchHistoryService');

            // Get search query from user if not provided or if provided value is not a string
            // (VS Code may pass context objects when command is invoked from UI elements)
            let searchQuery = typeof query === 'string' ? query : undefined;
            if (!searchQuery) {
                // Get recent searches from history service
                let recentSearches: readonly string[] = [];
                try {
                    recentSearches = searchHistory.getRecentQueries(10);
                } catch (error) {
                    console.warn('Failed to get recent searches:', error);
                }
                searchQuery = await this.promptForSearchQuery([...recentSearches]);
                if (!searchQuery) return;
            }

            // Build search options
            const searchOptions = this.buildSearchOptions(searchQuery, options);

            // Perform search with progress indication
            const searchStartTime = Date.now();
            const searchResults = await this.executeWithProgress(
                async progress => {
                    progress?.(25, 'Preparing search...');

                    // Query will be added to history after search completes

                    progress?.(50, 'Searching resources...');

                    // Use SearchProviderService to perform the actual search
                    const searchProvider = this.getService<SearchProviderService>('SearchProviderService');

                    // Convert search options to provider format
                    const providerOptions = {
                        projectIds: searchOptions.projectId ? [searchOptions.projectId] : undefined,
                        resourceTypes: searchOptions.typeId ? [searchOptions.typeId] : undefined,
                        caseSensitive: searchOptions.caseSensitive,
                        useRegex: searchOptions.useRegex,
                        includeInherited: searchOptions.includeInherited,
                        maxResults: searchOptions.maxResults
                    };

                    // console.log('Search options:', {
                    //     query: searchQuery,
                    //     projectId: searchOptions.projectId,
                    //     providerOptions
                    // });

                    const aggregatedResults = await searchProvider.executeSearch(searchQuery, providerOptions);

                    // Convert aggregated results to ResourceSearchResult format
                    const results: ResourceSearchResult[] = aggregatedResults.map(result => ({
                        projectId: result.projectId,
                        resourcePath: result.resourcePath,
                        resourceType: result.resourceType,
                        displayName: result.displayName || result.resourcePath,
                        score: result.score,
                        matches: result.matches,
                        metadata: result.metadata
                    }));

                    // Add query to search history after successful search
                    try {
                        await searchHistory.addToHistory({
                            query: searchQuery,
                            resultCount: results.length,
                            executionTime: Date.now() - searchStartTime,
                            searchOptions: providerOptions,
                            projectIds: providerOptions.projectIds ? [...providerOptions.projectIds] : undefined,
                            resourceTypes: providerOptions.resourceTypes
                                ? [...providerOptions.resourceTypes]
                                : undefined
                        });
                    } catch (error) {
                        console.warn('Failed to add query to search history:', error);
                    }

                    progress?.(100, 'Search completed');

                    return results;
                },
                {
                    showProgress: true,
                    progressTitle: `Searching for "${searchQuery}"...`
                }
            );

            // Display search results
            await this.displaySearchResults(searchQuery, searchResults, searchOptions);
        } catch (error) {
            throw new FlintError(
                'Search failed',
                'RESOURCE_SEARCH_FAILED',
                'Unable to complete resource search',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Prompts user for search query with history suggestions
     */
    private async promptForSearchQuery(recentSearches: string[]): Promise<string | undefined> {
        // Use createQuickPick for better control and allow typing
        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = 'Type to search or select a recent search...';
        quickPick.title = 'Resource Search';

        // Set up items with recent searches
        const recentItems = recentSearches.slice(0, 5).map(search => ({
            label: search,
            description: '$(history) Recent search'
        }));

        quickPick.items = recentItems;

        return new Promise<string | undefined>(resolve => {
            // Handle when user types something
            quickPick.onDidChangeValue(value => {
                if (value && value.trim().length > 0) {
                    // Show recent searches that match what's typed
                    const filtered = recentItems.filter(item => item.label.toLowerCase().includes(value.toLowerCase()));
                    quickPick.items = filtered;
                } else {
                    // Show all recent searches when input is empty
                    quickPick.items = recentItems;
                }
            });

            // Handle when user accepts (Enter key)
            quickPick.onDidAccept(() => {
                const selection = quickPick.activeItems[0];
                const value = quickPick.value.trim();

                quickPick.hide();

                // If user typed something, use that; otherwise use selection
                if (value.length >= 2) {
                    resolve(value);
                } else if (selection) {
                    resolve(selection.label);
                } else {
                    resolve(undefined);
                }
            });

            // Handle when user cancels (Escape key)
            quickPick.onDidHide(() => {
                quickPick.dispose();
                resolve(undefined);
            });

            quickPick.show();
        });
    }

    /**
     * Gets custom search query from user
     */
    private async getCustomSearchQuery(): Promise<string | undefined> {
        return vscode.window.showInputBox({
            placeHolder: 'Enter search query...',
            prompt: 'Search resources by name, path, or content',
            validateInput: value => {
                if (!value || value.trim().length === 0) {
                    return 'Search query cannot be empty';
                }
                if (value.trim().length < 2) {
                    return 'Search query must be at least 2 characters';
                }
                return null;
            }
        });
    }

    /**
     * Builds complete search options from input
     */
    private buildSearchOptions(query: string, partialOptions?: Partial<ResourceSearchOptions>): ResourceSearchOptions {
        // Don't filter by project by default - search all projects
        // Only use project filter if explicitly provided in options
        const currentProject = partialOptions?.projectId;

        return {
            query: query.trim(),
            projectId: currentProject,
            typeId: partialOptions?.typeId,
            categoryId: partialOptions?.categoryId,
            includeInherited: partialOptions?.includeInherited ?? true,
            caseSensitive: partialOptions?.caseSensitive ?? false,
            useRegex: partialOptions?.useRegex ?? false,
            maxResults: partialOptions?.maxResults ?? 100
        };
    }

    /**
     * Displays search results to user
     */
    private async displaySearchResults(query: string, results: any[], options: ResourceSearchOptions): Promise<void> {
        if (results.length === 0) {
            const choice = await vscode.window.showInformationMessage(
                `No results found for "${query}"`,
                'Modify Search',
                'Search All Projects'
            );

            switch (choice) {
                case 'Modify Search':
                    await vscode.commands.executeCommand(COMMANDS.SEARCH_RESOURCES);
                    break;
                case 'Search All Projects':
                    await vscode.commands.executeCommand(COMMANDS.SEARCH_RESOURCES, query, {
                        ...options,
                        projectId: undefined
                    });
                    break;
                default:
                    // User cancelled or chose unknown option
                    break;
            }
            return;
        }

        // Create quick pick items for results - map from ResourceSearchResult format
        const resultItems: Array<{
            label: string;
            description?: string;
            detail?: string;
            resource: {
                project: string;
                type: string;
                path: string;
                category?: string;
                displayName?: string;
                metadata?: any;
                matches?: any[]; // Add matches to the type
            } | null;
        }> = results.slice(0, 50).map((result: any) => {
            // Get first match line number if this is a content search result
            const firstMatch = result.matches && result.matches.length > 0 ? result.matches[0] : null;
            const lineInfo = firstMatch?.line ? ` • Line ${firstMatch.line}` : '';

            return {
                label: result.displayName || result.resourcePath.split('/').pop() || 'Unnamed Resource',
                description: `${result.resourceType || 'Unknown'}${result.metadata?.projectName ? ` • ${result.metadata.projectName}` : ''}${lineInfo}`,
                detail: result.resourcePath || result.description,
                resource: {
                    // Map to expected format for openSearchResult
                    project: result.projectId,
                    type: result.resourceType,
                    path: result.resourcePath,
                    category: result.metadata?.category,
                    // Keep original data for reference
                    displayName: result.displayName,
                    metadata: result.metadata,
                    // Include matches for line navigation
                    matches: result.matches
                }
            };
        });

        if (results.length > 50) {
            resultItems.push({
                label: `$(list-flat) Show all ${results.length} results...`,
                description: 'View complete results',
                detail: 'Opens detailed search results view',
                resource: null
            });
        }

        const selected = await vscode.window.showQuickPick(resultItems, {
            placeHolder: `${results.length} result${results.length > 1 ? 's' : ''} found for "${query}"`,
            title: 'Search Results',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (!selected) return;

        if (!selected.resource) {
            // Show all results in detailed view
            await this.showDetailedResults(query, results, options);
        } else {
            // Open selected resource
            await this.openSearchResult(selected.resource);
        }
    }

    /**
     * Shows detailed search results in a document
     */
    private async showDetailedResults(query: string, results: any[], options: ResourceSearchOptions): Promise<void> {
        const resultText = [
            `Search Results for "${query}"`,
            `Project: ${options.projectId ?? 'All projects'}`,
            `Type: ${options.typeId ?? 'All types'}`,
            `Found ${results.length} result${results.length > 1 ? 's' : ''}`,
            '',
            ...results.map(
                (result, index) =>
                    `${index + 1}. ${result.displayName || result.resourcePath || 'Unnamed Resource'}\n` +
                    `   Type: ${result.resourceType || 'Unknown'}\n   Path: ${result.resourcePath || 'Unknown'}\n` +
                    `   Project: ${result.metadata?.projectName || result.projectId || 'Unknown'}`
            )
        ].join('\n');

        const document = await vscode.workspace.openTextDocument({
            content: resultText,
            language: 'plaintext'
        });

        await vscode.window.showTextDocument(document);
    }

    /**
     * Opens a search result resource
     */
    private async openSearchResult(resource: any): Promise<void> {
        try {
            // Get the first match line number if available (for content searches)
            const firstMatch = resource.matches && resource.matches.length > 0 ? resource.matches[0] : null;
            const lineNumber = firstMatch?.line ? firstMatch.line : undefined;

            // Open the resource using the appropriate command, passing line number if available
            await vscode.commands.executeCommand(
                COMMANDS.OPEN_RESOURCE,
                resource.project,
                resource.type,
                resource.path,
                resource.category,
                lineNumber // Pass line number as 5th parameter
            );
        } catch (error) {
            console.warn('Failed to open search result:', error);
            await vscode.window.showWarningMessage(`Failed to open resource: ${resource.displayName || resource.path}`);
        }
    }
}
