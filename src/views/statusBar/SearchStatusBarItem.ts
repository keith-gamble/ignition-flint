/**
 * @module SearchStatusBarItem
 * @description Status bar item for displaying search status and quick search access
 */

import * as vscode from 'vscode';

import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Search status information
 */
interface SearchStatus {
    readonly isSearching: boolean;
    readonly lastQuery?: string;
    readonly resultCount?: number;
    readonly searchTime?: number;
    readonly error?: string;
}

/**
 * Search status bar configuration
 */
interface SearchStatusBarConfig {
    readonly showResultCount: boolean;
    readonly showSearchTime: boolean;
    readonly enableQuickSearch: boolean;
    readonly position: vscode.StatusBarAlignment;
    readonly priority: number;
}

/**
 * Search statistics for analytics
 */
interface SearchStats {
    readonly totalSearches: number;
    readonly averageSearchTime: number;
    readonly mostCommonQueries: readonly string[];
    readonly errorCount: number;
}

/**
 * Status bar item that displays search status and provides quick search access
 */
export class SearchStatusBarItem implements IServiceLifecycle {
    private statusBarItem?: vscode.StatusBarItem;
    private currentStatus: SearchStatus = { isSearching: false };
    private searchHistory: string[] = [];
    private searchStats: SearchStats = {
        totalSearches: 0,
        averageSearchTime: 0,
        mostCommonQueries: [],
        errorCount: 0
    };

    private config: SearchStatusBarConfig = {
        showResultCount: true,
        showSearchTime: true,
        enableQuickSearch: true,
        position: vscode.StatusBarAlignment.Left,
        priority: 100
    };

    private isInitialized = false;
    private isVisible = false;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {}

    async initialize(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        try {
            this.loadConfiguration();
            this.createStatusBarItem();
            this.setupEventHandlers();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize search status bar item',
                'SEARCH_STATUS_BAR_INIT_FAILED',
                'Search status bar item could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
        this.show();
    }

    async stop(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        this.hide();
    }

    async dispose(): Promise<void> {
        await this.stop();
        if (this.statusBarItem) {
            this.statusBarItem.dispose();
            this.statusBarItem = undefined;
        }
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Shows the status bar item
     */
    show(): void {
        if (this.statusBarItem && !this.isVisible) {
            this.statusBarItem.show();
            this.isVisible = true;
        }
    }

    /**
     * Hides the status bar item
     */
    hide(): void {
        if (this.statusBarItem && this.isVisible) {
            this.statusBarItem.hide();
            this.isVisible = false;
        }
    }

    /**
     * Updates search status
     */
    updateSearchStatus(status: Partial<SearchStatus>): void {
        this.currentStatus = { ...this.currentStatus, ...status };
        this.updateDisplay();

        // Update statistics
        if (status.isSearching === false && this.currentStatus.lastQuery) {
            this.updateSearchStats();
        }
    }

    /**
     * Sets search in progress
     */
    setSearchInProgress(query: string): void {
        this.updateSearchStatus({
            isSearching: true,
            lastQuery: query,
            resultCount: undefined,
            searchTime: undefined,
            error: undefined
        });
    }

    /**
     * Sets search completed
     */
    setSearchCompleted(resultCount: number, searchTime: number): void {
        this.updateSearchStatus({
            isSearching: false,
            resultCount,
            searchTime,
            error: undefined
        });
    }

    /**
     * Sets search error
     */
    setSearchError(error: string): void {
        this.updateSearchStatus({
            isSearching: false,
            resultCount: 0,
            error
        });
    }

    /**
     * Clears search status
     */
    clearSearch(): void {
        this.currentStatus = { isSearching: false };
        this.updateDisplay();
    }

    /**
     * Gets current search status
     */
    getCurrentStatus(): Readonly<SearchStatus> {
        return Object.freeze({ ...this.currentStatus });
    }

    /**
     * Gets search statistics
     */
    getSearchStats(): Readonly<SearchStats> {
        return Object.freeze({ ...this.searchStats });
    }

    /**
     * Updates configuration
     */
    updateConfiguration(newConfig: Partial<SearchStatusBarConfig>): void {
        this.config = { ...this.config, ...newConfig };

        // Recreate status bar item if position or priority changed
        if (this.statusBarItem && (newConfig.position !== undefined || newConfig.priority !== undefined)) {
            this.statusBarItem.dispose();
            this.createStatusBarItem();
            if (this.isVisible) {
                this.statusBarItem.show();
            }
        }

        this.updateDisplay();
    }

    /**
     * Gets current configuration
     */
    getConfiguration(): Readonly<SearchStatusBarConfig> {
        return Object.freeze({ ...this.config });
    }

    /**
     * Creates the VS Code status bar item
     */
    private createStatusBarItem(): void {
        this.statusBarItem = vscode.window.createStatusBarItem(this.config.position, this.config.priority);

        this.statusBarItem.command = this.config.enableQuickSearch ? COMMANDS.SEARCH_RESOURCES : undefined;

        this.updateDisplay();
    }

    /**
     * Updates the status bar item display
     */
    private updateDisplay(): void {
        if (!this.statusBarItem) return;

        const { isSearching, lastQuery, resultCount, searchTime, error } = this.currentStatus;

        // Build display text
        let text = '$(search)';
        let tooltip = 'Flint Search';

        if (isSearching) {
            text = '$(loading~spin) Searching...';
            tooltip = `Searching for: ${lastQuery}`;
        } else if (error) {
            text = '$(error) Search Error';
            tooltip = `Search failed: ${error}`;
        } else if (lastQuery) {
            // Show last search results
            text = '$(search)';

            if (this.config.showResultCount && resultCount !== undefined) {
                text += ` ${resultCount}`;
            }

            tooltip = `Last search: "${lastQuery}"`;

            if (resultCount !== undefined) {
                tooltip += `\nResults: ${resultCount}`;
            }

            if (this.config.showSearchTime && searchTime !== undefined) {
                tooltip += `\nTime: ${searchTime}ms`;
            }
        }

        // Add click instruction if quick search is enabled
        if (this.config.enableQuickSearch && !isSearching) {
            tooltip += '\n\nClick to search resources';
        }

        this.statusBarItem.text = text;
        this.statusBarItem.tooltip = tooltip;

        // Set background color for states
        if (isSearching) {
            this.statusBarItem.backgroundColor = undefined;
        } else if (error) {
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else {
            this.statusBarItem.backgroundColor = undefined;
        }
    }

    /**
     * Updates search statistics
     */
    private updateSearchStats(): void {
        const { lastQuery, searchTime } = this.currentStatus;

        if (!lastQuery) return;

        // Update search history
        if (!this.searchHistory.includes(lastQuery)) {
            this.searchHistory.unshift(lastQuery);

            // Keep only last 50 queries
            if (this.searchHistory.length > 50) {
                this.searchHistory = this.searchHistory.slice(0, 50);
            }
        }

        // Update statistics
        const newTotalSearches = this.searchStats.totalSearches + 1;
        let newAverageTime = this.searchStats.averageSearchTime;

        if (searchTime !== undefined) {
            newAverageTime =
                (this.searchStats.averageSearchTime * this.searchStats.totalSearches + searchTime) / newTotalSearches;
        }

        // Calculate most common queries
        const queryCount = new Map<string, number>();
        for (const query of this.searchHistory) {
            queryCount.set(query, (queryCount.get(query) || 0) + 1);
        }

        const mostCommonQueries = Array.from(queryCount.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([query]) => query);

        this.searchStats = {
            totalSearches: newTotalSearches,
            averageSearchTime: newAverageTime,
            mostCommonQueries,
            errorCount: this.currentStatus.error ? this.searchStats.errorCount + 1 : this.searchStats.errorCount
        };

        // Persist statistics
        this.persistSearchStats();
    }

    /**
     * Sets up event handlers for search events
     */
    private setupEventHandlers(): void {
        // Search service events are available through the service layer
        // SearchProviderService and SearchHistoryService provide comprehensive event handling
        // const searchService = this.serviceContainer.get<SearchProviderService>('SearchProviderService');
        // if (searchService) {
        //     searchService.onSearchStarted((query) => {
        //         this.setSearchInProgress(query);
        //     });
        //
        //     searchService.onSearchCompleted((results, time) => {
        //         this.setSearchCompleted(results.length, time);
        //     });
        //
        //     searchService.onSearchError((error) => {
        //         this.setSearchError(error.message);
        //     });
        // }

        // Configuration change listener
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('flint.ui.statusBar.search')) {
                this.loadConfiguration();
            }
        });
    }

    /**
     * Loads configuration from VS Code settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.ui.statusBar.search');

        this.config = {
            showResultCount: config.get<boolean>('showResultCount') ?? true,
            showSearchTime: config.get<boolean>('showSearchTime') ?? true,
            enableQuickSearch: config.get<boolean>('enableQuickSearch') ?? true,
            position: config.get<vscode.StatusBarAlignment>('position') ?? vscode.StatusBarAlignment.Left,
            priority: config.get<number>('priority') ?? 100
        };
    }

    /**
     * Persists search statistics to extension context
     */
    private persistSearchStats(): void {
        try {
            this.context.globalState.update('flint.search.stats', {
                ...this.searchStats,
                history: this.searchHistory
            });
        } catch (error) {
            console.warn('Failed to persist search statistics:', error);
        }
    }

    /**
     * Restores search statistics from extension context
     */
    private restoreSearchStats(): void {
        try {
            const stored = this.context.globalState.get<any>('flint.search.stats');
            if (stored) {
                this.searchStats = {
                    totalSearches: stored.totalSearches || 0,
                    averageSearchTime: stored.averageSearchTime || 0,
                    mostCommonQueries: stored.mostCommonQueries || [],
                    errorCount: stored.errorCount || 0
                };

                this.searchHistory = stored.history || [];
            }
        } catch (error) {
            console.warn('Failed to restore search statistics:', error);
        }
    }
}
