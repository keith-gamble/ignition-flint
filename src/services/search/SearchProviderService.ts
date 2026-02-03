/**
 * @module SearchProviderService
 * @description Service for managing search providers and coordinating search operations
 * Acts as the central hub for all search functionality across different resource types
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import {
    ResourceSearchProvider,
    ResourceSearchOptions,
    ResourceSearchResult,
    ResourceSearchFilter
} from '@/core/types/resources';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';

/**
 * Search provider registration
 */
interface SearchProviderRegistration {
    readonly providerId: string;
    readonly provider: ResourceSearchProvider;
    readonly resourceTypes: readonly string[];
    readonly priority: number;
    readonly isEnabled: boolean;
}

/**
 * Aggregated search result with provider information
 */
export interface AggregatedSearchResult extends ResourceSearchResult {
    readonly providerId: string;
    readonly providerName: string;
}

/**
 * Search execution context
 */
interface SearchExecutionContext {
    readonly query: string;
    readonly options: ResourceSearchOptions;
    readonly startTime: number;
    readonly providers: SearchProviderRegistration[];
}

/**
 * Search provider performance metrics
 */
interface SearchProviderMetrics {
    readonly providerId: string;
    readonly totalSearches: number;
    readonly averageExecutionTime: number;
    readonly successRate: number;
    readonly errorCount: number;
    readonly lastError?: string;
}

/**
 * Central search provider coordination service
 */
export class SearchProviderService implements IServiceLifecycle {
    private static readonly DEFAULT_SEARCH_TIMEOUT_MS = 30000;
    private static readonly MAX_CONCURRENT_SEARCHES = 5;

    private searchProviders = new Map<string, SearchProviderRegistration>();
    private providerMetrics = new Map<string, SearchProviderMetrics>();
    private activeSearches = new Set<string>();
    private isInitialized = false;

    private readonly searchStartedEmitter = new vscode.EventEmitter<{
        searchId: string;
        query: string;
        providers: readonly string[];
    }>();
    public readonly onSearchStarted = this.searchStartedEmitter.event;

    private readonly searchCompletedEmitter = new vscode.EventEmitter<{
        searchId: string;
        query: string;
        resultCount: number;
        duration: number;
        errors: readonly string[];
    }>();
    public readonly onSearchCompleted = this.searchCompletedEmitter.event;

    private readonly providerRegisteredEmitter = new vscode.EventEmitter<SearchProviderRegistration>();
    public readonly onProviderRegistered = this.providerRegisteredEmitter.event;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    initialize(): Promise<void> {
        this.registerBuiltInProviders();
        this.isInitialized = true;
        // console.log(`SearchProviderService initialized with ${this.searchProviders.size} providers`);
        return Promise.resolve();
    }

    async start(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        if (!this.isInitialized) {
            throw new FlintError(
                'SearchProviderService must be initialized before starting',
                'SERVICE_NOT_INITIALIZED'
            );
        }
        // console.log('SearchProviderService started');
    }

    async stop(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        // Cancel any active searches
        this.activeSearches.clear();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.searchProviders.clear();
        this.providerMetrics.clear();
        this.searchStartedEmitter.dispose();
        this.searchCompletedEmitter.dispose();
        this.providerRegisteredEmitter.dispose();
        this.isInitialized = false;
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Registers a search provider
     */
    registerSearchProvider(
        providerId: string,
        provider: ResourceSearchProvider,
        resourceTypes: string[],
        priority = 0
    ): void {
        const registration: SearchProviderRegistration = {
            providerId,
            provider,
            resourceTypes: Object.freeze(resourceTypes),
            priority,
            isEnabled: true
        };

        this.searchProviders.set(providerId, registration);

        // Initialize metrics
        this.providerMetrics.set(providerId, {
            providerId,
            totalSearches: 0,
            averageExecutionTime: 0,
            successRate: 1.0,
            errorCount: 0
        });

        this.providerRegisteredEmitter.fire(registration);
    }

    /**
     * Unregisters a search provider
     */
    unregisterSearchProvider(providerId: string): boolean {
        const removed = this.searchProviders.delete(providerId);
        if (removed) {
            this.providerMetrics.delete(providerId);
        }
        return removed;
    }

    /**
     * Enables or disables a search provider
     */
    setProviderEnabled(providerId: string, enabled: boolean): void {
        const registration = this.searchProviders.get(providerId);
        if (registration) {
            const updated: SearchProviderRegistration = {
                ...registration,
                isEnabled: enabled
            };
            this.searchProviders.set(providerId, updated);
        }
    }

    /**
     * Executes a search across all applicable providers
     */
    async executeSearch(query: string, options: ResourceSearchOptions = {}): Promise<AggregatedSearchResult[]> {
        const searchId = this.generateSearchId();
        const context: SearchExecutionContext = {
            query,
            options,
            startTime: Date.now(),
            providers: this.getApplicableProviders(options)
        };

        this.activeSearches.add(searchId);

        try {
            // Emit search started event
            this.searchStartedEmitter.fire({
                searchId,
                query,
                providers: context.providers.map(p => p.providerId)
            });

            // Execute searches across providers
            const results = await this.executeProviderSearches(context);

            const duration = Date.now() - context.startTime;
            const errors = results.filter(r => r.error).map(r => r.error!);
            const successfulResults = results.filter(r => !r.error).flatMap(r => r.results);

            // Emit search completed event
            this.searchCompletedEmitter.fire({
                searchId,
                query,
                resultCount: successfulResults.length,
                duration,
                errors: Object.freeze(errors)
            });

            return this.deduplicateResults(successfulResults);
        } catch (error) {
            console.error(`Search failed for query "${query}":`, error);
            throw new FlintError(
                `Search execution failed: ${error instanceof Error ? error.message : String(error)}`,
                'SEARCH_EXECUTION_FAILED',
                'Search operation failed',
                error instanceof Error ? error : undefined
            );
        } finally {
            this.activeSearches.delete(searchId);
        }
    }

    /**
     * Gets all available search filters from registered providers
     */
    getAvailableSearchFilters(): readonly ResourceSearchFilter[] {
        const allFilters: ResourceSearchFilter[] = [];
        const seenFilters = new Set<string>();

        for (const registration of this.searchProviders.values()) {
            if (registration.isEnabled && registration.provider.getSearchFilters) {
                try {
                    const providerFilters = registration.provider.getSearchFilters();

                    for (const filter of providerFilters) {
                        if (!seenFilters.has(filter.id)) {
                            allFilters.push(filter);
                            seenFilters.add(filter.id);
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to get filters from provider ${registration.providerId}:`, error);
                }
            }
        }

        return Object.freeze(allFilters);
    }

    /**
     * Gets registered search providers
     */
    getSearchProviders(): readonly SearchProviderRegistration[] {
        return Object.freeze(Array.from(this.searchProviders.values()));
    }

    /**
     * Gets search provider metrics
     */
    getProviderMetrics(): readonly SearchProviderMetrics[] {
        return Object.freeze(Array.from(this.providerMetrics.values()));
    }

    /**
     * Gets provider performance statistics
     */
    getProviderStats(): {
        readonly totalProviders: number;
        readonly enabledProviders: number;
        readonly totalSearches: number;
        readonly averageSearchTime: number;
        readonly successRate: number;
    } {
        const providers = Array.from(this.searchProviders.values());
        const metrics = Array.from(this.providerMetrics.values());

        const enabledCount = providers.filter(p => p.isEnabled).length;
        const totalSearches = metrics.reduce((sum, m) => sum + m.totalSearches, 0);
        const avgSearchTime =
            metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.averageExecutionTime, 0) / metrics.length : 0;
        const successRate =
            metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length : 1.0;

        return Object.freeze({
            totalProviders: providers.length,
            enabledProviders: enabledCount,
            totalSearches,
            averageSearchTime: Math.round(avgSearchTime * 100) / 100,
            successRate: Math.round(successRate * 1000) / 1000
        });
    }

    /**
     * Gets providers applicable for the given search options
     */
    private getApplicableProviders(options: ResourceSearchOptions): SearchProviderRegistration[] {
        const applicable: SearchProviderRegistration[] = [];

        for (const registration of this.searchProviders.values()) {
            if (!registration.isEnabled) {
                continue;
            }

            // Check if provider supports any of the requested resource types
            if (options.resourceTypes) {
                const hasMatchingType = registration.resourceTypes.some(type => options.resourceTypes!.includes(type));
                if (!hasMatchingType) {
                    continue;
                }
            }

            applicable.push(registration);
        }

        // Sort by priority (higher priority first)
        applicable.sort((a, b) => b.priority - a.priority);

        return applicable;
    }

    /**
     * Executes searches across multiple providers
     */
    private async executeProviderSearches(
        context: SearchExecutionContext
    ): Promise<Array<{ providerId: string; results: AggregatedSearchResult[]; error?: string }>> {
        // console.log(`Executing search with ${context.providers.length} providers for query: "${context.query}"`);
        const searchPromises = context.providers.map(async registration => {
            const providerStartTime = Date.now();

            try {
                // Execute search with timeout
                const searchPromise = registration.provider.search(context.query, context.options);
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(
                        () => reject(new Error('Search timeout')),
                        context.options.timeoutMs ?? SearchProviderService.DEFAULT_SEARCH_TIMEOUT_MS
                    );
                });

                const results = await Promise.race([searchPromise, timeoutPromise]);
                const duration = Date.now() - providerStartTime;

                // Convert to aggregated results
                const aggregatedResults: AggregatedSearchResult[] = results.map(result => ({
                    ...result,
                    providerId: registration.providerId,
                    providerName: registration.providerId
                }));

                // Update metrics
                this.updateProviderMetrics(registration.providerId, duration, true);

                return {
                    providerId: registration.providerId,
                    results: aggregatedResults
                };
            } catch (error) {
                const duration = Date.now() - providerStartTime;
                const errorMessage = error instanceof Error ? error.message : String(error);

                console.warn(`Search failed for provider ${registration.providerId}:`, error);

                // Update metrics
                this.updateProviderMetrics(registration.providerId, duration, false, errorMessage);

                return {
                    providerId: registration.providerId,
                    results: [],
                    error: errorMessage
                };
            }
        });

        return Promise.all(searchPromises);
    }

    /**
     * Deduplicates search results across providers
     */
    private deduplicateResults(results: AggregatedSearchResult[]): AggregatedSearchResult[] {
        const seen = new Map<string, AggregatedSearchResult>();
        const deduplicated: AggregatedSearchResult[] = [];

        for (const result of results) {
            // Create deduplication key based on resource path and project
            const key = `${result.projectId}:${result.resourcePath}`;

            if (!seen.has(key)) {
                seen.set(key, result);
                deduplicated.push(result);
            } else {
                // If duplicate, prefer result with higher score or from higher priority provider
                const existing = seen.get(key)!;
                if ((result.score ?? 0) > (existing.score ?? 0)) {
                    seen.set(key, result);
                    const index = deduplicated.findIndex(r => r === existing);
                    if (index !== -1) {
                        deduplicated[index] = result;
                    }
                }
            }
        }

        return deduplicated;
    }

    /**
     * Updates provider performance metrics
     */
    private updateProviderMetrics(providerId: string, executionTime: number, success: boolean, error?: string): void {
        const current = this.providerMetrics.get(providerId);
        if (!current) {
            return;
        }

        const totalSearches = current.totalSearches + 1;
        const averageExecutionTime =
            (current.averageExecutionTime * current.totalSearches + executionTime) / totalSearches;
        const successfulSearches = Math.round(current.successRate * current.totalSearches) + (success ? 1 : 0);
        const successRate = successfulSearches / totalSearches;
        const errorCount = current.errorCount + (success ? 0 : 1);

        const updated: SearchProviderMetrics = {
            providerId,
            totalSearches,
            averageExecutionTime: Math.round(averageExecutionTime * 100) / 100,
            successRate: Math.round(successRate * 1000) / 1000,
            errorCount,
            lastError: error ?? current.lastError
        };

        this.providerMetrics.set(providerId, updated);
    }

    /**
     * Generates a unique search ID
     */
    private generateSearchId(): string {
        return `search-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Registers built-in search providers using ResourceTypeProviderRegistry
     */
    private registerBuiltInProviders(): void {
        try {
            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            // Built-in file system search provider - supports all resource types
            const fileSystemProvider = new FileSystemSearchProvider();
            fileSystemProvider.setServiceContainer(this.serviceContainer);
            this.registerSearchProvider(
                'filesystem',
                fileSystemProvider,
                ['*'], // Supports all resource types
                100 // High priority
            );

            // Built-in content search provider - dynamically discover searchable resource types
            if (providerRegistry) {
                const searchableProviders = providerRegistry.getSearchableProviders();
                const searchableResourceTypes = searchableProviders.map(provider => provider.resourceTypeId);

                if (searchableResourceTypes.length > 0) {
                    const contentProvider = new ContentSearchProvider();
                    contentProvider.setServiceContainer(this.serviceContainer);
                    this.registerSearchProvider('content', contentProvider, searchableResourceTypes, 90);
                } else {
                    console.warn('No searchable resource types found, content search provider not registered');
                }
            } else {
                // Cannot provide search without provider registry
                throw new FlintError(
                    'ResourceTypeProviderRegistry is not available',
                    'RESOURCE_PROVIDER_REGISTRY_UNAVAILABLE',
                    'Cannot initialize search providers without resource type information'
                );
            }
        } catch (error) {
            console.error('Error registering built-in search providers:', error);
            throw new FlintError(
                'Failed to register search providers',
                'SEARCH_PROVIDER_REGISTRATION_FAILED',
                'Could not initialize search providers',
                error instanceof Error ? error : undefined
            );
        }
    }
}

/**
 * Match result for a resource search
 */
interface ResourceMatchResult {
    matches: boolean;
    score: number;
}

/**
 * Options for checking if a resource matches search query
 */
interface MatchQueryOptions {
    resourceName: string;
    resourcePath: string;
    query: string;
    queryLower: string;
    options: ResourceSearchOptions | undefined;
    isInherited: boolean;
}

/**
 * Options for searching through a resource list
 */
interface SearchResourceListOptions {
    resources: any[];
    query: string;
    queryLower: string;
    options: ResourceSearchOptions | undefined;
    project: any;
    pathModule: typeof import('path');
    isInherited: boolean;
    results: ResourceSearchResult[];
}

/**
 * Built-in file system search provider
 */
class FileSystemSearchProvider implements ResourceSearchProvider {
    private serviceContainer?: ServiceContainer;

    setServiceContainer(container: ServiceContainer): void {
        this.serviceContainer = container;
    }

    /**
     * Checks if a resource matches the search query
     */
    private matchesSearchQuery(opts: MatchQueryOptions): ResourceMatchResult {
        const { resourceName, resourcePath, query, queryLower, options, isInherited } = opts;
        const baseScore = isInherited ? 90 : 100;
        const nameMatchScore = isInherited ? 70 : 80;
        const pathMatchScore = isInherited ? 50 : 60;

        if (options?.caseSensitive) {
            if (resourceName === query) {
                return { matches: true, score: baseScore };
            }
            if (resourceName.includes(query)) {
                return { matches: true, score: nameMatchScore };
            }
            if (resourcePath.includes(query)) {
                return { matches: true, score: pathMatchScore };
            }
        } else {
            const nameLower = resourceName.toLowerCase();
            const pathLower = resourcePath.toLowerCase();

            if (nameLower === queryLower) {
                return { matches: true, score: baseScore };
            }
            if (nameLower.includes(queryLower)) {
                return { matches: true, score: nameMatchScore };
            }
            if (pathLower.includes(queryLower)) {
                return { matches: true, score: pathMatchScore };
            }
        }

        return { matches: false, score: 0 };
    }

    /**
     * Creates a search result for a matching resource
     */
    private createResourceSearchResult(
        resource: any,
        project: any,
        score: number,
        pathModule: typeof import('path'),
        sourceProject?: string
    ): ResourceSearchResult {
        const resourceName = resource.metadata?.name || '';
        return {
            projectId: pathModule.basename(project.projectPath),
            resourcePath: resource.path,
            resourceType: resource.type,
            displayName: resourceName,
            score,
            matches: [
                {
                    line: 0,
                    column: 0,
                    text: resourceName,
                    context: resourceName
                }
            ],
            metadata: {
                category: resource.metadata?.category,
                projectPath: project.projectPath,
                projectName: project.projectName,
                origin: resource.origin,
                sourceProject
            }
        };
    }

    /**
     * Searches through a list of resources
     */
    private searchResourceList(opts: SearchResourceListOptions): void {
        const { resources, query, queryLower, options, project, pathModule, isInherited, results } = opts;

        for (const resource of resources) {
            if (resource.metadata?.isFolder) {
                continue;
            }

            if (options?.resourceTypes && !options.resourceTypes.includes(resource.type)) {
                continue;
            }

            const resourceName = resource.metadata?.name || '';
            const resourcePath = resource.path || '';
            const matchResult = this.matchesSearchQuery({
                resourceName,
                resourcePath,
                query,
                queryLower,
                options,
                isInherited
            });

            if (matchResult.matches) {
                results.push(
                    this.createResourceSearchResult(
                        resource,
                        project,
                        matchResult.score,
                        pathModule,
                        isInherited ? resource.sourceProject : undefined
                    )
                );
            }
        }
    }

    async search(query: string, options?: ResourceSearchOptions): Promise<ResourceSearchResult[]> {
        if (!this.serviceContainer) {
            console.warn('FileSystemSearchProvider: ServiceContainer not available');
            return [];
        }

        try {
            const pathModule = await import('path');
            const scannerService = this.serviceContainer.get<any>('ProjectScannerService');
            if (!scannerService) {
                console.warn('FileSystemSearchProvider: ProjectScannerService not available');
                return [];
            }

            const allProjects = scannerService.getAllCachedResults();
            if (!allProjects || allProjects.length === 0) {
                console.warn('FileSystemSearchProvider: No cached projects available');
                return [];
            }

            const searchResults: ResourceSearchResult[] = [];
            const queryLower = query.toLowerCase();

            for (const project of allProjects) {
                if (options?.projectIds && !options.projectIds.includes(project.projectName)) {
                    continue;
                }

                // Search local resources
                this.searchResourceList({
                    resources: project.resources,
                    query,
                    queryLower,
                    options,
                    project,
                    pathModule,
                    isInherited: false,
                    results: searchResults
                });

                // Search inherited resources if requested
                if (options?.includeInherited !== false && project.inheritedResources) {
                    this.searchResourceList({
                        resources: project.inheritedResources,
                        query,
                        queryLower,
                        options,
                        project,
                        pathModule,
                        isInherited: true,
                        results: searchResults
                    });
                }
            }

            // Sort results by score (highest first)
            searchResults.sort((a, b) => (b.score || 0) - (a.score || 0));

            // Apply max results limit if specified
            if (options?.maxResults && searchResults.length > options.maxResults) {
                return searchResults.slice(0, options.maxResults);
            }

            return searchResults;
        } catch (error) {
            console.error('FileSystemSearchProvider: Search failed', error);
            return [];
        }
    }

    supportsTextSearch(): boolean {
        return false;
    }

    getSearchFilters(): ResourceSearchFilter[] {
        // Try to get dynamic options from ResourceTypeProviderRegistry
        try {
            // Note: We can't inject ServiceContainer into these provider classes easily
            // Cannot provide search options without provider registry
            throw new FlintError(
                'ResourceTypeProviderRegistry is not available',
                'RESOURCE_PROVIDER_REGISTRY_UNAVAILABLE',
                'Cannot determine search options without resource type information'
            );
        } catch {
            // Fallback to basic options
            return [
                {
                    id: 'resourceType',
                    name: 'Resource Type',
                    type: 'select',
                    options: [{ label: 'All Types', value: '*' }],
                    description: 'Filter by resource type'
                }
            ];
        }
    }
}

/**
 * Content search match info
 */
interface ContentMatch {
    line: number;
    column: number;
    text: string;
    context: string;
}

/**
 * Options for searching a resource file
 */
interface SearchResourceFileOptions {
    fsModule: typeof import('fs/promises');
    pathModule: typeof import('path');
    filePath: string;
    resourceJsonPath: string;
    resource: any;
    project: any;
    query: string;
    queryLower: string;
    searchOptions: ResourceSearchOptions | undefined;
    results: ResourceSearchResult[];
}

/**
 * Built-in content search provider
 */
class ContentSearchProvider implements ResourceSearchProvider {
    private serviceContainer?: ServiceContainer;

    setServiceContainer(container: ServiceContainer): void {
        this.serviceContainer = container;
    }

    /**
     * Finds all matching lines in content
     */
    private findLineMatches(
        content: string,
        query: string,
        queryLower: string,
        caseSensitive: boolean
    ): ContentMatch[] {
        const matches: ContentMatch[] = [];
        const lines = content.split('\n');

        lines.forEach((line, index) => {
            const lineLower = line.toLowerCase();
            const hasMatch = caseSensitive ? line.includes(query) : lineLower.includes(queryLower);

            if (hasMatch) {
                const column = caseSensitive ? line.indexOf(query) : lineLower.indexOf(queryLower);
                matches.push({
                    line: index + 1,
                    column: column + 1,
                    text: line.trim(),
                    context: line.trim()
                });
            }
        });

        return matches;
    }

    /**
     * Gets the content file path for a resource type
     */
    private getContentFilePath(resourceType: string): string | null {
        switch (resourceType) {
            case 'script-python':
                return 'code.py';
            case 'named-query':
                return 'query.sql';
            default:
                return null;
        }
    }

    private async searchResourceFile(opts: SearchResourceFileOptions): Promise<void> {
        const {
            fsModule,
            pathModule,
            filePath,
            resourceJsonPath,
            resource,
            project,
            query,
            queryLower,
            searchOptions,
            results
        } = opts;

        try {
            await fsModule.access(resourceJsonPath);
            const content = await fsModule.readFile(filePath, 'utf8');
            const contentLower = content.toLowerCase();

            const hasMatch = searchOptions?.caseSensitive ? content.includes(query) : contentLower.includes(queryLower);

            if (hasMatch) {
                const matches = this.findLineMatches(content, query, queryLower, searchOptions?.caseSensitive ?? false);

                if (matches.length > 0) {
                    results.push({
                        projectId: pathModule.basename(project.projectPath),
                        resourcePath: resource.path,
                        resourceType: resource.type,
                        displayName: resource.metadata?.name || resource.path,
                        score: matches.length * 10,
                        matches: matches.slice(0, 10),
                        metadata: {
                            category: resource.metadata?.category,
                            projectPath: project.projectPath,
                            projectName: project.projectName,
                            origin: resource.origin,
                            fileCount: matches.length,
                            matchType: 'content'
                        }
                    });
                }
            }
        } catch {
            // File might not exist or be readable, skip silently
        }
    }

    async search(query: string, options?: ResourceSearchOptions): Promise<ResourceSearchResult[]> {
        if (!this.serviceContainer) {
            console.warn('ContentSearchProvider: ServiceContainer not available');
            return [];
        }

        try {
            const fsModule = await import('fs/promises');
            const pathModule = await import('path');

            const scannerService = this.serviceContainer.get<any>('ProjectScannerService');
            if (!scannerService) {
                console.warn('ContentSearchProvider: ProjectScannerService not available');
                return [];
            }

            const allProjects = scannerService.getAllCachedResults();
            if (!allProjects || allProjects.length === 0) {
                console.warn('ContentSearchProvider: No cached projects available');
                return [];
            }

            const searchResults: ResourceSearchResult[] = [];
            const queryLower = query.toLowerCase();

            for (const project of allProjects) {
                if (options?.projectIds && !options.projectIds.includes(project.projectName)) {
                    continue;
                }

                for (const resource of project.resources) {
                    if (resource.metadata?.isFolder) {
                        continue;
                    }

                    if (options?.resourceTypes && !options.resourceTypes.includes(resource.type)) {
                        continue;
                    }

                    const contentFileName = this.getContentFilePath(resource.type);
                    if (!contentFileName) {
                        continue;
                    }

                    await this.searchResourceFile({
                        fsModule,
                        pathModule,
                        filePath: pathModule.join(project.projectPath, resource.path, contentFileName),
                        resourceJsonPath: pathModule.join(project.projectPath, resource.path, 'resource.json'),
                        resource,
                        project,
                        query,
                        queryLower,
                        searchOptions: options,
                        results: searchResults
                    });
                }
            }

            // Sort results by score (highest first)
            searchResults.sort((a, b) => (b.score || 0) - (a.score || 0));

            // Apply max results limit if specified
            if (options?.maxResults && searchResults.length > options.maxResults) {
                return searchResults.slice(0, options.maxResults);
            }

            return searchResults;
        } catch (error) {
            console.error('ContentSearchProvider: Search failed', error);
            return [];
        }
    }

    supportsTextSearch(): boolean {
        return true;
    }

    getSearchFilters(): ResourceSearchFilter[] {
        return [
            {
                id: 'caseSensitive',
                name: 'Case Sensitive',
                type: 'boolean',
                defaultValue: false,
                description: 'Match case exactly'
            }
        ];
    }
}
