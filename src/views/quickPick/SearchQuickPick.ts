/**
 * @module SearchQuickPick
 * @description Advanced search interface with filtering, history, and smart suggestions
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ProjectResource, ResourceOrigin } from '@/core/types/models';
import { ResourceTypeDefinition } from '@/core/types/resources';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';

/**
 * Search result item
 */
interface SearchResultItem extends vscode.QuickPickItem {
    readonly resource: ProjectResource;
    readonly projectId: string;
    readonly resourceType: ResourceTypeDefinition;
    readonly matchScore: number;
    readonly matchHighlights: readonly SearchHighlight[];
    readonly resultType: 'resource' | 'content' | 'property';
}

/**
 * Search highlight for matched text
 */
interface SearchHighlight {
    readonly start: number;
    readonly end: number;
    readonly type: 'exact' | 'fuzzy' | 'prefix';
}

/**
 * Search filter options
 */
interface SearchFilters {
    readonly resourceTypes?: readonly string[];
    readonly projects?: readonly string[];
    readonly includeInherited?: boolean;
    readonly includeContent?: boolean;
    readonly caseSensitive?: boolean;
    readonly useRegex?: boolean;
    readonly maxResults?: number;
}

/**
 * Search quick pick options
 */
interface SearchQuickPickOptions {
    readonly title?: string;
    readonly initialQuery?: string;
    readonly filters?: SearchFilters;
    readonly showHistory?: boolean;
    readonly showSuggestions?: boolean;
    readonly enablePreview?: boolean;
}

/**
 * Search result with context
 */
interface SearchResult {
    readonly selectedItems: readonly SearchResultItem[];
    readonly searchQuery: string;
    readonly appliedFilters: SearchFilters;
    readonly cancelled: boolean;
    readonly searchTime: number;
}

/**
 * Search history entry
 */
interface SearchHistoryEntry {
    readonly query: string;
    readonly timestamp: Date;
    readonly resultCount: number;
    readonly filters: SearchFilters;
}

/**
 * Advanced search quick pick with intelligent filtering and suggestions
 */
export class SearchQuickPick implements IServiceLifecycle {
    private quickPick?: vscode.QuickPick<SearchResultItem>;
    private searchHistory: SearchHistoryEntry[] = [];
    private currentFilters: SearchFilters = {};
    private isInitialized = false;
    private searchTimeout?: NodeJS.Timeout;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {}

    async initialize(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        try {
            this.loadSearchHistory();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize search quick pick',
                'SEARCH_QUICK_PICK_INIT_FAILED',
                'Search quick pick could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async stop(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = undefined;
        }

        if (this.quickPick) {
            this.quickPick.dispose();
            this.quickPick = undefined;
        }
    }

    async dispose(): Promise<void> {
        await this.stop();
        await this.saveSearchHistory();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Shows the main search interface
     */
    async showSearchInterface(options: SearchQuickPickOptions = {}): Promise<SearchResult> {
        try {
            // Initialize filters
            this.currentFilters = options.filters || {};

            // Create and configure quick pick
            this.quickPick = vscode.window.createQuickPick<SearchResultItem>();
            this.configureSearchQuickPick(this.quickPick, options);

            // Setup initial state
            if (options.initialQuery) {
                this.quickPick.value = options.initialQuery;
                await this.performSearch(options.initialQuery);
            } else {
                this.showInitialState(options);
            }

            // Handle user interaction
            const result = await this.handleSearchInteraction(this.quickPick);

            return result;
        } catch (error) {
            throw new FlintError(
                'Failed to show search interface',
                'SEARCH_INTERFACE_FAILED',
                'Search interface could not be displayed',
                error instanceof Error ? error : undefined
            );
        } finally {
            if (this.quickPick) {
                this.quickPick.dispose();
                this.quickPick = undefined;
            }
        }
    }

    /**
     * Shows quick resource search
     */
    async showQuickSearch(): Promise<SearchResult> {
        return this.showSearchInterface({
            title: 'Quick Search',
            showHistory: true,
            showSuggestions: true,
            filters: {
                maxResults: 50,
                includeInherited: false
            }
        });
    }

    /**
     * Shows advanced search with filters
     */
    async showAdvancedSearch(): Promise<SearchResult> {
        // First, let user configure filters
        const filters = await this.showFilterConfiguration();
        if (!filters) {
            return {
                selectedItems: [],
                searchQuery: '',
                appliedFilters: {},
                cancelled: true,
                searchTime: 0
            };
        }

        return this.showSearchInterface({
            title: 'Advanced Search',
            filters,
            showHistory: true,
            enablePreview: true
        });
    }

    /**
     * Shows content search in resources
     */
    async showContentSearch(): Promise<SearchResult> {
        return this.showSearchInterface({
            title: 'Search in Files',
            filters: {
                includeContent: true,
                maxResults: 100
            },
            showHistory: true
        });
    }

    /**
     * Configures the search quick pick
     */
    private configureSearchQuickPick(
        quickPick: vscode.QuickPick<SearchResultItem>,
        options: SearchQuickPickOptions
    ): void {
        quickPick.title = options.title || 'Search Resources';
        quickPick.placeholder = this.getSearchPlaceholder(options);
        quickPick.canSelectMany = false;
        quickPick.ignoreFocusOut = true;
        quickPick.matchOnDescription = false;
        quickPick.matchOnDetail = false;

        // Setup buttons for filter access
        quickPick.buttons = [
            {
                iconPath: new vscode.ThemeIcon('filter'),
                tooltip: 'Configure search filters'
            },
            {
                iconPath: new vscode.ThemeIcon('history'),
                tooltip: 'Search history'
            }
        ];
    }

    /**
     * Shows initial state with history and suggestions
     */
    private showInitialState(options: SearchQuickPickOptions): void {
        if (!this.quickPick) return;

        const items: SearchResultItem[] = [];

        // Add search history if enabled
        if (options.showHistory && this.searchHistory.length > 0) {
            const historyItems = this.createHistoryItems();
            items.push(...historyItems);
        }

        // Add suggestions if enabled
        if (options.showSuggestions) {
            const suggestionItems = this.createSuggestionItems();
            items.push(...suggestionItems);
        }

        this.quickPick.items = items;
    }

    /**
     * Handles search interaction and user input
     */
    private async handleSearchInteraction(quickPick: vscode.QuickPick<SearchResultItem>): Promise<SearchResult> {
        const searchStartTime = Date.now();

        return new Promise<SearchResult>(resolve => {
            // Handle search input changes
            quickPick.onDidChangeValue(query => {
                if (query.length >= 2) {
                    // Debounce search
                    if (this.searchTimeout) {
                        clearTimeout(this.searchTimeout);
                    }

                    this.searchTimeout = setTimeout(async () => {
                        await this.performSearch(query);
                    }, 300);
                } else {
                    this.showInitialState({});
                }
            });

            // Handle button clicks
            quickPick.onDidTriggerButton(async button => {
                if (button.tooltip === 'Configure search filters') {
                    await this.showFilterPanel();
                } else if (button.tooltip === 'Search history') {
                    await this.showSearchHistory();
                }
            });

            // Handle selection
            quickPick.onDidAccept(() => {
                const selected = quickPick.selectedItems[0];
                const searchTime = Date.now() - searchStartTime;

                if (selected) {
                    // Record search in history
                    this.recordSearch(quickPick.value, [selected], searchTime);

                    resolve({
                        selectedItems: [selected],
                        searchQuery: quickPick.value,
                        appliedFilters: this.currentFilters,
                        cancelled: false,
                        searchTime
                    });
                } else {
                    resolve({
                        selectedItems: [],
                        searchQuery: quickPick.value,
                        appliedFilters: this.currentFilters,
                        cancelled: false,
                        searchTime
                    });
                }

                quickPick.hide();
            });

            // Handle cancellation
            quickPick.onDidHide(() => {
                if (quickPick.selectedItems.length === 0) {
                    resolve({
                        selectedItems: [],
                        searchQuery: '',
                        appliedFilters: {},
                        cancelled: true,
                        searchTime: 0
                    });
                }
            });

            // Show the quick pick
            quickPick.show();
        });
    }

    /**
     * Performs the actual search
     */
    private async performSearch(query: string): Promise<void> {
        if (!this.quickPick) return;

        try {
            this.quickPick.busy = true;

            // Use actual search service if available
            let results: Array<{
                resource: ProjectResource;
                projectId: string;
                matchScore: number;
            }> = [];

            try {
                const _searchService = this.serviceContainer.get<any>('SearchService');
                const resourceSearchService = this.serviceContainer.get<any>('ResourceSearchService');

                if (resourceSearchService?.searchResources) {
                    const searchResults = await resourceSearchService.searchResources(query, {
                        ...this.currentFilters,
                        maxResults: this.currentFilters.maxResults || 50
                    });

                    // Convert search results to expected format
                    if (searchResults?.results) {
                        results = searchResults.results.map((result: any) => ({
                            resource: {
                                type: result.resourceType,
                                path: result.resourcePath,
                                origin: result.origin,
                                sourceProject: result.projectId,
                                files: result.files || []
                            },
                            projectId: result.projectId,
                            matchScore: result.score || 0.5
                        }));
                    }
                } else {
                    throw new FlintError(
                        'Search service not available',
                        'SERVICE_UNAVAILABLE',
                        'Search functionality requires the ResourceSearchService to be initialized'
                    );
                }
            } catch (error) {
                if (error instanceof FlintError) {
                    throw error;
                } else {
                    throw new FlintError(
                        'Search operation failed',
                        'SEARCH_FAILED',
                        'Search operation encountered an error',
                        error instanceof Error ? error : undefined
                    );
                }
            }

            // Convert to quick pick items
            const searchItems = results.map(result => this.createSearchResultItem(result, query));

            // Sort by relevance
            searchItems.sort((a, b) => b.matchScore - a.matchScore);

            this.quickPick.items = searchItems;
        } catch (error) {
            console.error('Search failed:', error);

            // Show error item
            this.quickPick.items = [
                {
                    label: '$(error) Search failed',
                    description: 'An error occurred while searching',
                    detail: error instanceof Error ? error.message : 'Unknown error',
                    resource: {} as ProjectResource,
                    projectId: '',
                    resourceType: {} as ResourceTypeDefinition,
                    matchScore: 0,
                    matchHighlights: [],
                    resultType: 'resource'
                }
            ];
        } finally {
            this.quickPick.busy = false;
        }
    }

    /**
     * Creates a search result quick pick item
     */
    private createSearchResultItem(
        result: { resource: ProjectResource; projectId: string; matchScore: number },
        query: string
    ): SearchResultItem {
        const { resource, projectId, matchScore } = result;

        // Calculate highlights
        const highlights = this.calculateHighlights(resource.path, query);

        // Build label with highlights
        const label = this.buildHighlightedLabel(resource.path, highlights);

        // Build description
        let description = `$(${this.getResourceTypeIcon(resource.type)}) ${this.getResourceTypeName(resource.type)}`;
        if (resource.origin === ResourceOrigin.INHERITED) {
            description += ' (inherited)';
        }

        // Build detail
        let detail = `Project: ${projectId}`;
        if (resource.files.length > 1) {
            detail += ` • ${resource.files.length} files`;
        }

        return {
            label,
            description,
            detail,
            resource,
            projectId,
            resourceType: this.getResourceTypeDefinition(resource.type),
            matchScore,
            matchHighlights: highlights,
            resultType: 'resource'
        };
    }

    /**
     * Shows filter configuration panel
     */
    private async showFilterPanel(): Promise<void> {
        const filterOptions = [
            { label: '$(symbol-class) Resource Types', action: 'types' },
            { label: '$(folder) Projects', action: 'projects' },
            { label: '$(eye) Include Inherited', action: 'inherited' },
            { label: '$(search) Include Content', action: 'content' },
            { label: '$(case-sensitive) Case Sensitive', action: 'case' },
            { label: '$(regex) Use Regex', action: 'regex' }
        ];

        const selected = await vscode.window.showQuickPick(filterOptions, {
            placeHolder: 'Select filter to configure...'
        });

        if (selected) {
            await this.configureFilter(selected.action);
        }
    }

    /**
     * Shows filter configuration dialog
     */
    private async showFilterConfiguration(): Promise<SearchFilters | undefined> {
        // Show comprehensive filter configuration UI
        const choices = [
            { label: 'Resource Types', action: 'resourceTypes' },
            { label: 'Projects', action: 'projects' },
            { label: 'Include Inherited Resources', action: 'includeInherited' },
            { label: 'Search in Content', action: 'includeContent' },
            { label: 'Case Sensitive', action: 'caseSensitive' },
            { label: 'Use Regular Expressions', action: 'useRegex' },
            { label: 'Maximum Results', action: 'maxResults' }
        ];

        const selected = await vscode.window.showQuickPick(choices, {
            placeHolder: 'Configure search filters (select multiple options)',
            canPickMany: true
        });

        if (!selected || selected.length === 0) {
            return undefined;
        }

        let maxResults = 50;
        let includeInherited = true;
        let includeContent = false;
        let caseSensitive = false;
        let useRegex = false;

        // Configure each selected filter
        for (const choice of selected) {
            switch (choice.action) {
                case 'maxResults': {
                    const maxStr = await vscode.window.showInputBox({
                        prompt: 'Maximum number of search results',
                        value: '50',
                        validateInput: value => {
                            const num = parseInt(value);
                            return isNaN(num) || num < 1 || num > 1000
                                ? 'Must be a number between 1 and 1000'
                                : undefined;
                        }
                    });
                    if (maxStr) maxResults = parseInt(maxStr);
                    break;
                }
                case 'includeInherited':
                    includeInherited = true;
                    break;
                case 'includeContent':
                    includeContent = true;
                    break;
                case 'caseSensitive':
                    caseSensitive = true;
                    break;
                case 'useRegex':
                    useRegex = true;
                    break;
                default:
                    // Unknown action, ignore
                    break;
            }
        }

        const filters: SearchFilters = {
            maxResults,
            includeInherited,
            includeContent,
            caseSensitive,
            useRegex
        };

        return filters;
    }

    /**
     * Shows search history
     */
    private async showSearchHistory(): Promise<void> {
        if (this.searchHistory.length === 0) {
            vscode.window.showInformationMessage('No search history available');
            return;
        }

        const historyItems = this.searchHistory.map(entry => ({
            label: entry.query,
            description: `${entry.resultCount} results`,
            detail: `${entry.timestamp.toLocaleString()}`,
            query: entry.query
        }));

        const selected = await vscode.window.showQuickPick(historyItems, {
            placeHolder: 'Select a previous search...'
        });

        if (selected && this.quickPick) {
            this.quickPick.value = selected.query;
            await this.performSearch(selected.query);
        }
    }

    /**
     * Creates history items for display
     */
    private createHistoryItems(): SearchResultItem[] {
        return this.searchHistory.slice(0, 5).map(entry => ({
            label: `$(history) ${entry.query}`,
            description: `${entry.resultCount} results`,
            detail: entry.timestamp.toLocaleString(),
            resource: {} as ProjectResource,
            projectId: '',
            resourceType: {} as ResourceTypeDefinition,
            matchScore: 0,
            matchHighlights: [],
            resultType: 'resource'
        }));
    }

    /**
     * Creates suggestion items - dynamically generate from available resource types
     */
    private createSuggestionItems(): SearchResultItem[] {
        const suggestions: string[] = [];

        try {
            // Generate suggestions from ResourceTypeProviderRegistry
            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (providerRegistry) {
                const allProviders = providerRegistry.getAllProviders();

                // Add resource type display names as suggestions
                for (const provider of allProviders.slice(0, 5)) {
                    // Limit to first 5
                    suggestions.push(provider.displayName);
                }
            }
        } catch (error) {
            console.warn('SearchQuickPick: Failed to generate suggestions from provider registry:', error);
        }

        // If no suggestions from providers, show a simple general search tip
        if (suggestions.length === 0) {
            suggestions.push('*'); // Universal wildcard suggestion
        }

        return suggestions.map(suggestion => ({
            label: `$(lightbulb) ${suggestion}`,
            description: 'Search suggestion',
            resource: {} as ProjectResource,
            projectId: '',
            resourceType: {} as ResourceTypeDefinition,
            matchScore: 0,
            matchHighlights: [],
            resultType: 'resource'
        }));
    }

    /**
     * Records a search in history
     */
    private recordSearch(query: string, results: SearchResultItem[], _searchTime: number): void {
        const entry: SearchHistoryEntry = {
            query,
            timestamp: new Date(),
            resultCount: results.length,
            filters: { ...this.currentFilters }
        };

        // Add to beginning of history
        this.searchHistory.unshift(entry);

        // Keep only last 50 entries
        if (this.searchHistory.length > 50) {
            this.searchHistory = this.searchHistory.slice(0, 50);
        }

        // Save to persistent storage
        void this.saveSearchHistory();
    }

    /**
     * Gets search placeholder text
     */
    private getSearchPlaceholder(options: SearchQuickPickOptions): string {
        if (options.filters?.includeContent) {
            return 'Search in file contents...';
        }
        return 'Search resources by name, path, or type...';
    }

    /**
     * Calculates text highlights for search matches
     */
    private calculateHighlights(text: string, query: string): SearchHighlight[] {
        const highlights: SearchHighlight[] = [];

        if (!query) return highlights;

        // Simple exact match highlighting
        const index = text.toLowerCase().indexOf(query.toLowerCase());
        if (index !== -1) {
            highlights.push({
                start: index,
                end: index + query.length,
                type: 'exact'
            });
        }

        return highlights;
    }

    /**
     * Builds label with highlight formatting
     */
    private buildHighlightedLabel(text: string, _highlights: SearchHighlight[]): string {
        // For now, just return the original text
        // In a real implementation, you might format with markdown or other highlighting
        return text;
    }

    /**
     * Configures a specific filter
     */
    private async configureFilter(filterType: string): Promise<void> {
        switch (filterType) {
            case 'types': {
                // Show resource type selection from ResourceTypeProviderRegistry
                const providerRegistry =
                    this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
                const availableTypes = providerRegistry
                    ? providerRegistry.getAllProviders().map(p => p.resourceTypeId)
                    : [];

                const selectedTypes = await vscode.window.showQuickPick(
                    availableTypes.map(type => ({
                        label: this.getResourceTypeName(type),
                        description: type,
                        picked: this.currentFilters.resourceTypes?.includes(type) ?? false
                    })),
                    {
                        placeHolder: 'Select resource types to include in search...',
                        canPickMany: true
                    }
                );

                if (selectedTypes) {
                    this.currentFilters = {
                        ...this.currentFilters,
                        resourceTypes: selectedTypes.map(item => item.description)
                    };
                }
                break;
            }
            case 'projects': {
                // Show project selection - would need to load actual projects
                try {
                    const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
                    if (configService) {
                        const projectPaths = await configService.getProjectPaths();
                        const projectIds = projectPaths.map((path: string) => path.split('/').pop() || path);

                        const selectedProjects = await vscode.window.showQuickPick(
                            projectIds.map((id: string) => ({
                                label: id,
                                picked: this.currentFilters.projects?.includes(id) ?? false
                            })),
                            {
                                placeHolder: 'Select projects to include in search...',
                                canPickMany: true
                            }
                        );

                        if (selectedProjects) {
                            this.currentFilters = {
                                ...this.currentFilters,
                                projects: selectedProjects.map((item: any) => String(item.label))
                            };
                        }
                    }
                } catch {
                    vscode.window.showErrorMessage('Failed to load projects for filtering');
                }
                break;
            }
            case 'inherited':
                this.currentFilters = {
                    ...this.currentFilters,
                    includeInherited: !this.currentFilters.includeInherited
                };
                break;
            default:
                // Unknown filter type, ignore
                break;
        }
    }

    /**
     * Gets resource type icon from provider
     */
    private getResourceTypeIcon(resourceType: string): string {
        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

        if (!providerRegistry) {
            console.warn(
                `SearchQuickPick: ResourceTypeProviderRegistry unavailable, using generic icon for ${resourceType}`
            );
            return 'file';
        }

        const provider = providerRegistry.getProvider(resourceType);
        if (!provider) {
            console.warn(`SearchQuickPick: No provider found for resource type ${resourceType}, using generic icon`);
            return 'file';
        }

        // Get explicit icon from provider's search configuration
        const searchConfig = provider.getSearchConfig();

        // Check if provider defines a specific icon for its category
        if (searchConfig.categoryIcon) {
            return searchConfig.categoryIcon;
        }

        console.warn(
            `SearchQuickPick: No explicit icon defined for resource type: ${resourceType} - provider should define categoryIcon in search configuration`
        );
        return 'file';
    }

    /**
     * Gets resource type display name
     */
    private getResourceTypeName(resourceType: string): string {
        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

        if (providerRegistry) {
            const provider = providerRegistry.getProvider(resourceType);
            if (provider) {
                return provider.displayName;
            }
        }

        console.warn(`SearchQuickPick: No provider found for resource type ${resourceType}, using raw type name`);
        return resourceType;
    }

    /**
     * Gets resource type definition
     */
    private getResourceTypeDefinition(resourceType: string): ResourceTypeDefinition {
        return {
            id: resourceType,
            name: this.getResourceTypeName(resourceType),
            icon: this.getResourceTypeIcon(resourceType)
        };
    }

    /**
     * Loads search history from storage
     */
    private loadSearchHistory(): void {
        try {
            const stored = this.context.globalState.get<SearchHistoryEntry[]>('flint.search.history');
            if (stored && Array.isArray(stored)) {
                this.searchHistory = stored.map(entry => ({
                    ...entry,
                    timestamp: new Date(entry.timestamp)
                }));
            }
        } catch (error) {
            console.warn('Failed to load search history:', error);
            this.searchHistory = [];
        }
    }

    /**
     * Saves search history to storage
     */
    private async saveSearchHistory(): Promise<void> {
        try {
            await this.context.globalState.update('flint.search.history', this.searchHistory);
        } catch (error) {
            console.warn('Failed to save search history:', error);
        }
    }
}
