/**
 * @module ResourceSearchService
 * @description Service for searching resources across projects with advanced filtering
 * Provides full-text search, pattern matching, and metadata-based search capabilities
 */

import * as fs from 'fs/promises';
type BufferEncoding =
    | 'ascii'
    | 'utf8'
    | 'utf-8'
    | 'utf16le'
    | 'ucs2'
    | 'ucs-2'
    | 'base64'
    | 'latin1'
    | 'binary'
    | 'hex';
import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ResourceSearchConfig } from '@/core/types/resourceProviders';
import {
    ResourceSearchOptions,
    ResourceSearchResult,
    ResourceSearchMatch,
    ResourceSearchProvider,
    ProjectResource
} from '@/core/types/resources';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';

/**
 * Search index entry for efficient searching
 */
interface SearchIndexEntry {
    readonly resourcePath: string;
    readonly projectId: string;
    readonly resourceType: string;
    readonly displayName: string;
    readonly content?: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly lastIndexed: number;
}

/**
 * Search query with parsed components
 */
interface ParsedSearchQuery {
    readonly text: string;
    readonly filters: Readonly<Record<string, unknown>>;
    readonly isRegex: boolean;
    readonly caseSensitive: boolean;
}

/**
 * Advanced resource search service with indexing and full-text capabilities
 */
export class ResourceSearchService implements IServiceLifecycle {
    private static readonly INDEX_UPDATE_INTERVAL_MS = 300000; // 5 minutes
    private static readonly MAX_CONTENT_SIZE = 1024 * 1024; // 1MB max content indexing

    private searchIndex = new Map<string, SearchIndexEntry>();
    private searchProviders = new Map<string, ResourceSearchProvider>();
    private isInitialized = false;
    private indexUpdateTimer: NodeJS.Timeout | null = null;

    private readonly searchExecutedEmitter = new vscode.EventEmitter<{
        query: string;
        options: ResourceSearchOptions;
        resultCount: number;
        duration: number;
    }>();
    public readonly onSearchExecuted = this.searchExecutedEmitter.event;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    async initialize(): Promise<void> {
        await this.buildSearchIndex();
        await this.registerBuiltInProviders();
        this.setupIndexUpdateTimer();
        this.isInitialized = true;
        // console.log(`ResourceSearchService initialized with ${this.searchIndex.size} indexed resources`);
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            throw new FlintError(
                'ResourceSearchService must be initialized before starting',
                'SERVICE_NOT_INITIALIZED'
            );
        }
        // console.log('ResourceSearchService started');
        return Promise.resolve();
    }

    stop(): Promise<void> {
        if (this.indexUpdateTimer) {
            clearInterval(this.indexUpdateTimer);
            this.indexUpdateTimer = null;
        }
        console.log('ResourceSearchService stopped');
        return Promise.resolve();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.searchIndex.clear();
        this.searchProviders.clear();
        this.searchExecutedEmitter.dispose();
        this.isInitialized = false;
        console.log('ResourceSearchService disposed');
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Searches for resources matching the query
     */
    async searchResources(query: string, options: ResourceSearchOptions = {}): Promise<ResourceSearchResult[]> {
        const searchStartTime = Date.now();

        try {
            // Parse the search query
            const parsedQuery = this.parseSearchQuery(query);

            // Perform the search
            const results = await this.performSearch(parsedQuery, options);

            // Sort results by relevance score
            results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

            // Apply result limit
            const limitedResults = options.maxResults ? results.slice(0, options.maxResults) : results;

            const searchDuration = Date.now() - searchStartTime;

            // Emit search event
            this.searchExecutedEmitter.fire({
                query,
                options,
                resultCount: limitedResults.length,
                duration: searchDuration
            });

            console.log(`Search completed in ${searchDuration}ms: ${limitedResults.length} results for "${query}"`);

            return limitedResults;
        } catch (error) {
            console.error('Search failed:', error);
            throw new FlintError(
                `Search failed: ${error instanceof Error ? error.message : String(error)}`,
                'SEARCH_FAILED',
                'Search operation failed',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Registers a search provider for a specific resource type
     */
    registerSearchProvider(typeId: string, provider: ResourceSearchProvider): void {
        this.searchProviders.set(typeId, provider);
    }

    /**
     * Unregisters a search provider
     */
    unregisterSearchProvider(typeId: string): boolean {
        const result = this.searchProviders.delete(typeId);
        if (result) {
            console.log(`Unregistered search provider for resource type: ${typeId}`);
        }
        return result;
    }

    /**
     * Updates the search index for a specific project
     */
    async updateProjectIndex(projectId: string, projectPath: string): Promise<void> {
        try {
            console.log(`Updating search index for project: ${projectId}`);

            // Remove existing entries for this project
            for (const [key, entry] of this.searchIndex.entries()) {
                if (entry.projectId === projectId) {
                    this.searchIndex.delete(key);
                }
            }

            // Re-index the project
            await this.indexProjectResources(projectId, projectPath);

            console.log(`Search index updated for project: ${projectId}`);
        } catch (error) {
            console.error(`Failed to update search index for project ${projectId}:`, error);
        }
    }

    /**
     * Clears the entire search index
     */
    clearSearchIndex(): void {
        this.searchIndex.clear();
        console.log('Search index cleared');
    }

    /**
     * Gets search index statistics
     */
    getSearchIndexStats(): {
        readonly totalEntries: number;
        readonly entriesByType: Readonly<Record<string, number>>;
        readonly entriesByProject: Readonly<Record<string, number>>;
        readonly indexSize: number;
        readonly lastUpdated: number;
    } {
        const entriesByType: Record<string, number> = {};
        const entriesByProject: Record<string, number> = {};
        let indexSize = 0;
        let lastUpdated = 0;

        for (const entry of this.searchIndex.values()) {
            // Count by type
            entriesByType[entry.resourceType] = (entriesByType[entry.resourceType] ?? 0) + 1;

            // Count by project
            entriesByProject[entry.projectId] = (entriesByProject[entry.projectId] ?? 0) + 1;

            // Calculate approximate size
            indexSize += JSON.stringify(entry).length;

            // Track last updated
            if (entry.lastIndexed > lastUpdated) {
                lastUpdated = entry.lastIndexed;
            }
        }

        return Object.freeze({
            totalEntries: this.searchIndex.size,
            entriesByType: Object.freeze(entriesByType),
            entriesByProject: Object.freeze(entriesByProject),
            indexSize,
            lastUpdated
        });
    }

    /**
     * Parses a search query into components
     */
    private parseSearchQuery(query: string): ParsedSearchQuery {
        // Simple query parsing - can be enhanced with more sophisticated parsing
        const filters: Record<string, unknown> = {};
        let text = query;
        let isRegex = false;
        let caseSensitive = false;

        // Extract filters (type:value format)
        const filterRegex = /(\w+):(\S+)/g;
        let match;
        while ((match = filterRegex.exec(query)) !== null) {
            const [fullMatch, filterKey, filterValue] = match;
            filters[filterKey] = filterValue;
            text = text.replace(fullMatch, '').trim();
        }

        // Check for regex flag
        if (text.startsWith('/') && text.endsWith('/')) {
            isRegex = true;
            text = text.slice(1, -1);
        }

        // Check for case sensitivity flag
        if (text.includes('(?-i)')) {
            caseSensitive = true;
            text = text.replace('(?-i)', '');
        }

        return {
            text: text.trim(),
            filters: Object.freeze(filters),
            isRegex,
            caseSensitive
        };
    }

    /**
     * Performs the actual search against the index
     */
    private performSearch(
        parsedQuery: ParsedSearchQuery,
        options: ResourceSearchOptions
    ): Promise<ResourceSearchResult[]> {
        const results: ResourceSearchResult[] = [];

        for (const entry of this.searchIndex.values()) {
            // Apply project filter
            if (options.projectIds && !options.projectIds.includes(entry.projectId)) {
                continue;
            }

            // Apply resource type filter
            if (options.resourceTypes && !options.resourceTypes.includes(entry.resourceType)) {
                continue;
            }

            // Apply query filters
            if (!this.matchesFilters(entry, parsedQuery.filters)) {
                continue;
            }

            // Perform text search
            const textMatches = this.searchInContent(entry, parsedQuery);
            if (parsedQuery.text && textMatches.matches.length === 0) {
                continue;
            }

            // Create search result
            const result: ResourceSearchResult = {
                resourcePath: entry.resourcePath,
                projectId: entry.projectId,
                resourceType: entry.resourceType,
                displayName: entry.displayName,
                score: textMatches.score,
                matches: textMatches.matches,
                metadata: entry.metadata
            };

            results.push(result);
        }

        return Promise.resolve(results);
    }

    /**
     * Checks if an entry matches the given filters
     */
    private matchesFilters(entry: SearchIndexEntry, filters: Readonly<Record<string, unknown>>): boolean {
        for (const [key, value] of Object.entries(filters)) {
            switch (key) {
                case 'type':
                    if (entry.resourceType !== value) return false;
                    break;
                case 'project':
                    if (entry.projectId !== value) return false;
                    break;
                default:
                    // Check metadata
                    if (entry.metadata[key] !== value) return false;
                    break;
            }
        }
        return true;
    }

    /**
     * Searches for text within an entry's content
     */
    private searchInContent(
        entry: SearchIndexEntry,
        parsedQuery: ParsedSearchQuery
    ): { matches: ResourceSearchMatch[]; score: number } {
        if (!parsedQuery.text) {
            return { matches: [], score: 0 };
        }

        const matches: ResourceSearchMatch[] = [];
        let score = 0;

        // Search in display name
        const nameMatches = this.findTextMatches(
            entry.displayName,
            parsedQuery.text,
            parsedQuery.isRegex,
            parsedQuery.caseSensitive
        );

        for (const match of nameMatches) {
            matches.push({
                ...match,
                filePath: entry.resourcePath
            });
            score += 10; // Higher score for name matches
        }

        // Search in content if available
        if (entry.content) {
            const contentMatches = this.findTextMatches(
                entry.content,
                parsedQuery.text,
                parsedQuery.isRegex,
                parsedQuery.caseSensitive
            );

            for (const match of contentMatches) {
                matches.push({
                    ...match,
                    filePath: entry.resourcePath
                });
                score += 1; // Lower score for content matches
            }
        }

        return { matches, score };
    }

    /**
     * Finds text matches within a string
     */
    private findTextMatches(
        text: string,
        searchText: string,
        isRegex: boolean,
        caseSensitive: boolean
    ): ResourceSearchMatch[] {
        const matches: ResourceSearchMatch[] = [];

        try {
            const searchPattern = isRegex
                ? new RegExp(searchText, caseSensitive ? 'g' : 'gi')
                : new RegExp(this.escapeRegex(searchText), caseSensitive ? 'g' : 'gi');

            const lines = text.split('\n');

            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];
                let match;

                while ((match = searchPattern.exec(line)) !== null) {
                    matches.push({
                        line: lineIndex + 1,
                        column: match.index + 1,
                        text: match[0],
                        context: this.getMatchContext(line, match.index, match[0].length)
                    });
                }
            }
        } catch (error) {
            console.warn('Search pattern error:', error);
        }

        return matches;
    }

    /**
     * Gets context around a text match
     */
    private getMatchContext(line: string, startIndex: number, matchLength: number): string {
        const contextLength = 50;
        const start = Math.max(0, startIndex - contextLength);
        const end = Math.min(line.length, startIndex + matchLength + contextLength);

        let context = line.substring(start, end);

        if (start > 0) context = `...${context}`;
        if (end < line.length) context = `${context}...`;

        return context;
    }

    /**
     * Escapes regex special characters
     */
    private escapeRegex(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Builds the search index by scanning all configured projects
     */
    private async buildSearchIndex(): Promise<void> {
        console.log('Building initial search index...');

        try {
            // Get the workspace config service to find configured projects
            const configService = this.serviceContainer.get<any>('WorkspaceConfigService');

            if (!configService) {
                console.warn('WorkspaceConfigService not available, search index will be populated on-demand');
                return;
            }

            // Get all configured project paths
            const projectPaths = await configService.getProjectPaths();

            if (!projectPaths || projectPaths.length === 0) {
                console.log('No project paths configured, search index will be populated on-demand');
                return;
            }

            console.log(`Found ${projectPaths.length} configured project paths, building index...`);

            // Index each configured project
            const indexPromises = projectPaths.map(async (projectPath: string) => {
                try {
                    const projectName = path.basename(projectPath);
                    console.log(`Indexing project: ${projectName} at ${projectPath}`);
                    await this.indexProjectResources(projectName, projectPath);
                } catch (error) {
                    console.warn(`Failed to index project at ${projectPath}:`, error);
                }
            });

            // Wait for all projects to be indexed
            await Promise.allSettled(indexPromises);

            console.log(`Search index built with ${this.searchIndex.size} total entries`);
        } catch (error) {
            console.error('Failed to build search index:', error);
            console.log('Search index will be populated on-demand');
        }
    }

    /**
     * Indexes resources for a specific project using ProjectScannerService and ResourceTypeProviderRegistry
     */
    private async indexProjectResources(projectId: string, projectPath: string): Promise<void> {
        try {
            console.log(`Starting resource indexing for project: ${projectId} at ${projectPath}`);

            // Get the ProjectScannerService to properly scan resources
            const projectScannerService = this.serviceContainer.get<any>('ProjectScannerService');
            const providerRegistry = this.serviceContainer.get<any>('ResourceTypeProviderRegistry');

            if (!projectScannerService) {
                console.warn('ProjectScannerService not available, falling back to basic directory scan');
                await this.fallbackDirectoryScan(projectId, projectPath);
                return;
            }

            // Use ProjectScannerService to scan the project properly
            const scanResult = await projectScannerService.scanProject(projectPath);

            if (!scanResult?.resources) {
                console.warn(`No resources found in project scan for ${projectId}`);
                return;
            }

            console.log(`Found ${scanResult.resources.length} resources to index for project ${projectId}`);

            // Index each resource found by the scanner
            for (const resource of scanResult.resources) {
                try {
                    await this.indexResource(resource, projectId, projectPath, providerRegistry);
                } catch (error) {
                    console.warn(`Failed to index resource ${resource.key ?? resource.path}:`, error);
                }
            }

            console.log(`Successfully indexed ${scanResult.resources.length} resources for project ${projectId}`);
        } catch (error) {
            console.error(`Failed to index project ${projectId}:`, error);
            // Fall back to basic directory scan
            await this.fallbackDirectoryScan(projectId, projectPath);
        }
    }

    /**
     * Indexes a single resource using provider information
     */
    private async indexResource(
        resource: ProjectResource,
        projectId: string,
        projectPath: string,
        providerRegistry: ResourceTypeProviderRegistry
    ): Promise<void> {
        const resourceKey = resource.key ?? `${resource.type}:${resource.path}`;
        const resourceType = resource.type ?? 'unknown';

        // Get the provider for this resource type to understand how to index it
        let searchConfig = null;
        let displayName = resource.name ?? path.basename(resource.path ?? resourceKey);

        if (providerRegistry) {
            const provider = providerRegistry.getProvider(resourceType);
            if (provider) {
                searchConfig = provider.getSearchConfig();
                // Use provider's display name if available
                displayName = resource.displayName ?? provider.displayName ?? displayName;
            }
        }

        // Extract content if the resource supports content search
        let content: string | undefined;
        if (searchConfig?.supportsContentSearch && resource.path) {
            const fullResourcePath = path.isAbsolute(resource.path)
                ? resource.path
                : path.join(projectPath, resource.path);
            content = await this.extractResourceContent(fullResourcePath, searchConfig);
        }

        // Build comprehensive metadata
        const resourceObj = resource as unknown as Record<string, unknown>;
        const metadata: Record<string, unknown> = {
            category: resource.category,
            size: resource.size,
            lastModified: resource.lastModified,
            hasResourceJson: resourceObj.hasResourceJson,
            ...((resourceObj.metadata as Record<string, unknown>) ?? {})
        };

        // Create the search index entry
        const indexEntry: SearchIndexEntry = {
            resourcePath: resource.path ?? resourceKey,
            projectId,
            resourceType,
            displayName,
            content,
            metadata: Object.freeze(metadata),
            lastIndexed: Date.now()
        };

        // Add to search index
        this.searchIndex.set(resourceKey, indexEntry);
    }

    /**
     * Extracts content from a resource file based on provider configuration
     */
    private async extractResourceContent(
        filePath: string,
        searchConfig: ResourceSearchConfig
    ): Promise<string | undefined> {
        try {
            const stats = await fs.stat(filePath);

            // Check file size limits from provider
            const maxSize = searchConfig.maxSearchableFileSize ?? ResourceSearchService.MAX_CONTENT_SIZE;
            if (stats.size > maxSize) {
                console.debug(
                    `Skipping content extraction for ${filePath}: file too large (${stats.size} > ${maxSize})`
                );
                return undefined;
            }

            // Use encoding specified by provider
            const encoding = searchConfig.searchEncoding ?? 'utf8';

            // Skip binary files unless provider explicitly supports them
            if (encoding === 'binary') {
                console.debug(`Skipping content extraction for binary resource: ${filePath}`);
                return undefined;
            }

            const content = await fs.readFile(filePath, encoding as BufferEncoding);
            return content.toString();
        } catch (error) {
            console.debug(`Failed to extract content from ${filePath}:`, error);
            return undefined;
        }
    }

    /**
     * Fallback directory scan when ProjectScannerService is unavailable
     */
    private async fallbackDirectoryScan(projectId: string, projectPath: string): Promise<void> {
        console.log(`Performing fallback directory scan for project: ${projectId}`);

        try {
            const entries = await fs.readdir(projectPath, { withFileTypes: true });
            let indexedCount = 0;

            for (const entry of entries) {
                if (entry.isFile()) {
                    const fullPath = path.join(projectPath, entry.name);
                    const relativePath = path.relative(projectPath, fullPath);

                    // Only index files that look like Ignition resources
                    if (this.looksLikeIgnitionResource(entry.name, relativePath)) {
                        const content = await this.extractFileContent(fullPath);

                        const indexEntry: SearchIndexEntry = {
                            resourcePath: relativePath,
                            projectId,
                            resourceType: this.getResourceTypeFromProviders(entry.name, relativePath),
                            displayName: path.parse(entry.name).name,
                            content,
                            metadata: Object.freeze({
                                fileName: entry.name,
                                directory: path.dirname(relativePath)
                            }),
                            lastIndexed: Date.now()
                        };

                        this.searchIndex.set(`${projectId}:${relativePath}`, indexEntry);
                        indexedCount++;
                    }
                }
            }

            console.log(`Fallback scan indexed ${indexedCount} resources for project ${projectId}`);
        } catch (error) {
            console.error(`Fallback directory scan failed for ${projectId}:`, error);
        }
    }

    /**
     * Determines if a file looks like an Ignition resource
     */
    private looksLikeIgnitionResource(fileName: string, filePath: string): boolean {
        // Check for common Ignition resource file patterns
        const resourceIndicators = ['resource.json', '.json', '.py', '.sql', '.bin'];

        // Check for Ignition-specific directory patterns
        const ignitionDirectories = ['com.inductiveautomation.perspective', 'ignition', 'project-library'];

        const hasResourceExtension = resourceIndicators.some(indicator => fileName.endsWith(indicator));

        const inIgnitionDirectory = ignitionDirectories.some(dir => filePath.includes(dir));

        return hasResourceExtension && (inIgnitionDirectory || fileName === 'resource.json');
    }

    /**
     * Determines resource type from file name and path using ResourceTypeProviderRegistry only - NO INFERENCE
     */
    private getResourceTypeFromProviders(fileName: string, filePath: string): string {
        try {
            const providerRegistry = this.serviceContainer.get<any>('ResourceTypeProviderRegistry');

            if (!providerRegistry) {
                throw new Error(
                    'ResourceTypeProviderRegistry is unavailable - cannot determine resource type without provider registry'
                );
            }

            const allProviders = providerRegistry.getAllProviders();

            // Check each provider to see if the file path matches its directory patterns
            for (const provider of allProviders) {
                const searchConfig = provider.getSearchConfig();

                // Check if file is in any of the provider's directory paths
                const isInProviderDirectory = searchConfig.directoryPaths?.some((dir: string) =>
                    filePath.includes(dir)
                );

                // Check if file extension matches provider's searchable extensions
                const fileExtension = path.extname(fileName).toLowerCase();
                const hasMatchingExtension = searchConfig.searchableExtensions?.includes(fileExtension);

                if (isInProviderDirectory && hasMatchingExtension) {
                    return String(provider.resourceTypeId);
                }
            }

            // No provider matched - fail explicitly rather than guessing
            throw new Error(`No resource type provider found for file ${fileName} in path ${filePath}`);
        } catch (error) {
            console.error(`Failed to determine resource type for ${fileName} at ${filePath}:`, error);
            throw new Error(
                'Cannot determine resource type without explicit provider definition - file system of Ignition is rigid, no guessing allowed'
            );
        }
    }

    /**
     * Extracts content from a file for indexing
     */
    private async extractFileContent(filePath: string): Promise<string | undefined> {
        try {
            const stats = await fs.stat(filePath);

            // Skip files that are too large
            if (stats.size > ResourceSearchService.MAX_CONTENT_SIZE) {
                return undefined;
            }

            const content = await fs.readFile(filePath, 'utf8');
            return content;
        } catch {
            // Return undefined for binary files or files that can't be read
            return undefined;
        }
    }

    /**
     * Sets up periodic index updates and file watching
     */
    private setupIndexUpdateTimer(): void {
        this.indexUpdateTimer = setInterval(async () => {
            console.log('Performing periodic search index update');

            try {
                // Get current project paths
                const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
                if (!configService) return;

                const projectPaths = await configService.getProjectPaths();
                if (!projectPaths || projectPaths.length === 0) return;

                // Check each project for changes and update index if needed
                for (const projectPath of projectPaths) {
                    const projectName = path.basename(projectPath);

                    // Check if project directory still exists
                    try {
                        await fs.access(projectPath);

                        // Refresh index for this project
                        // This will scan for new/changed/deleted resources
                        await this.updateProjectIndex(projectName, projectPath);
                    } catch {
                        console.warn(`Project path no longer accessible: ${projectPath}`);

                        // Remove entries for this project from index
                        for (const [key, entry] of this.searchIndex.entries()) {
                            if (entry.projectId === projectName) {
                                this.searchIndex.delete(key);
                            }
                        }
                    }
                }

                console.log(`Periodic index update completed. Index now has ${this.searchIndex.size} entries`);
            } catch (error) {
                console.error('Periodic index update failed:', error);
            }
        }, ResourceSearchService.INDEX_UPDATE_INTERVAL_MS);
    }

    /**
     * Registers built-in search providers from ResourceTypeProviderRegistry
     */
    private registerBuiltInProviders(): Promise<void> {
        try {
            const providerRegistry = this.serviceContainer.get<any>('ResourceTypeProviderRegistry');

            if (!providerRegistry) {
                console.warn('ResourceTypeProviderRegistry not available, using default search implementation');
                return Promise.resolve();
            }

            // Get all resource type providers and register them as search providers
            const allProviders = providerRegistry.getAllProviders();

            for (const provider of allProviders) {
                try {
                    const searchConfig = provider.getSearchConfig();

                    // Register a search provider for each resource type that supports content search
                    if (searchConfig.supportsContentSearch) {
                        const searchProvider: ResourceSearchProvider = {
                            search: async (query: string, options: ResourceSearchOptions) => {
                                // Delegate to provider's custom search if available
                                if (provider.searchContent) {
                                    return (await provider.searchContent(query, options)) as ResourceSearchResult[];
                                }

                                // Otherwise use default search implementation
                                return this.performDefaultSearch(query, provider.resourceTypeId, options);
                            },
                            supportsTextSearch: () => Boolean(searchConfig.supportsContentSearch)
                        };

                        this.registerSearchProvider(provider.resourceTypeId, searchProvider);
                        console.log(`Registered search provider for resource type: ${provider.resourceTypeId}`);
                    }
                } catch (error) {
                    console.warn(`Failed to register search provider for ${provider.resourceTypeId}:`, error);
                }
            }

            console.log(`Registered ${allProviders.length} search providers from ResourceTypeProviderRegistry`);
        } catch (error) {
            console.error('Failed to register built-in search providers:', error);
        }
        return Promise.resolve();
    }

    /**
     * Performs default search for a specific resource type
     */
    private async performDefaultSearch(
        query: string,
        resourceTypeId: string,
        options: ResourceSearchOptions = {}
    ): Promise<ResourceSearchResult[]> {
        // Filter search to only include the specific resource type
        const typeFilteredOptions: ResourceSearchOptions = {
            ...options,
            resourceTypes: [resourceTypeId]
        };

        return this.searchResources(query, typeFilteredOptions);
    }
}
