/**
 * @module SearchUtilities
 * @description Enhanced search utilities with service lifecycle support
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ProjectResource } from '@/core/types/models';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Search configuration options
 */
export interface SearchConfiguration {
    readonly caseSensitive: boolean;
    readonly useRegex: boolean;
    readonly wholeWord: boolean;
    readonly includeHidden: boolean;
    readonly maxResults: number;
    readonly maxFileSize: number;
    readonly searchTimeout: number;
    readonly enableContentSearch: boolean;
    readonly searchableExtensions: readonly string[];
    readonly excludePatterns: readonly string[];
}

/**
 * Search query with options
 */
export interface SearchQuery {
    readonly term: string;
    readonly type: 'name' | 'content' | 'path' | 'all';
    readonly resourceTypes?: readonly string[];
    readonly projectIds?: readonly string[];
    readonly caseSensitive?: boolean;
    readonly useRegex?: boolean;
    readonly wholeWord?: boolean;
}

/**
 * Search match information
 */
export interface SearchMatch {
    readonly line: number;
    readonly column: number;
    readonly text: string;
    readonly context?: string;
    readonly highlightStart: number;
    readonly highlightEnd: number;
}

/**
 * Search result with detailed match information
 */
export interface DetailedSearchResult {
    readonly resourcePath: string;
    readonly resourceType: string;
    readonly projectId: string;
    readonly displayName: string;
    readonly matches: readonly SearchMatch[];
    readonly score: number;
    readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Search statistics
 */
export interface SearchStatistics {
    readonly totalFiles: number;
    readonly filesSearched: number;
    readonly totalMatches: number;
    readonly searchTime: number;
    readonly byResourceType: ReadonlyMap<string, number>;
    readonly byProject: ReadonlyMap<string, number>;
}

/**
 * Search progress callback
 */
export type SearchProgressCallback = (progress: {
    readonly current: number;
    readonly total: number;
    readonly message: string;
}) => void;

/**
 * Enhanced search utilities with service lifecycle support
 * Provides comprehensive search capabilities with performance optimization
 */
export class SearchUtilities implements IServiceLifecycle {
    private static readonly DEFAULT_CONFIG: SearchConfiguration = {
        caseSensitive: false,
        useRegex: false,
        wholeWord: false,
        includeHidden: false,
        maxResults: 1000,
        maxFileSize: 1024 * 1024, // 1MB
        searchTimeout: 30000, // 30 seconds
        enableContentSearch: true,
        searchableExtensions: [
            '.py',
            '.sql',
            '.json',
            '.js',
            '.ts',
            '.xml',
            '.html',
            '.css',
            '.txt',
            '.md',
            '.yaml',
            '.yml',
            '.properties',
            '.conf'
        ],
        excludePatterns: ['**/.git/**', '**/node_modules/**', '**/.ignition/**', '**/build/**', '**/dist/**']
    };

    private isInitialized = false;
    private config: SearchConfiguration;
    private searchIndex: Map<string, string[]> = new Map();
    private lastIndexUpdate = 0;

    constructor(
        private readonly serviceContainer?: ServiceContainer,
        config?: Partial<SearchConfiguration>
    ) {
        this.config = { ...SearchUtilities.DEFAULT_CONFIG, ...config };
    }

    async initialize(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        try {
            this.loadConfiguration();
            this.buildSearchIndex();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize search utilities',
                'SEARCH_UTILITIES_INIT_FAILED',
                'Search utilities could not start properly',
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
        // Clear search index to free memory
        this.searchIndex.clear();
    }

    async dispose(): Promise<void> {
        await this.stop();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    // ============================================================================
    // SEARCH OPERATIONS
    // ============================================================================

    /**
     * Performs comprehensive search across resources
     */
    async search(
        query: SearchQuery,
        resources: ReadonlyMap<string, ProjectResource>,
        progressCallback?: SearchProgressCallback
    ): Promise<{
        results: readonly DetailedSearchResult[];
        statistics: SearchStatistics;
    }> {
        const startTime = Date.now();
        const results: DetailedSearchResult[] = [];
        const stats = {
            totalFiles: 0,
            filesSearched: 0,
            totalMatches: 0,
            byResourceType: new Map<string, number>(),
            byProject: new Map<string, number>()
        };

        if (!query.term.trim()) {
            return {
                results: [],
                statistics: {
                    ...stats,
                    searchTime: Date.now() - startTime
                }
            };
        }

        // Filter resources by query constraints
        const filteredResources = this.filterResourcesByQuery(resources, query);
        const resourceArray = Array.from(filteredResources.values());
        stats.totalFiles = resourceArray.length;

        // Search through resources
        let current = 0;
        for (const resource of resourceArray) {
            current++;

            progressCallback?.({
                current,
                total: resourceArray.length,
                message: `Searching ${resource.path}...`
            });

            try {
                const result = await this.searchResource(resource, query);
                if (result && result.matches.length > 0) {
                    results.push(result);
                    stats.totalMatches += result.matches.length;

                    // Update statistics
                    this.updateSearchStatistics(stats, result);
                }
                stats.filesSearched++;

                // Check timeout
                if (Date.now() - startTime > this.config.searchTimeout) {
                    console.warn(`Search timeout reached after ${this.config.searchTimeout}ms`);
                    break;
                }
            } catch (error) {
                console.warn(`Failed to search resource ${resource.path}:`, error);
            }
        }

        // Sort results by relevance score
        const sortedResults = this.sortResultsByRelevance(results, query);
        const limitedResults = sortedResults.slice(0, this.config.maxResults);

        return {
            results: limitedResults,
            statistics: {
                ...stats,
                searchTime: Date.now() - startTime
            }
        };
    }

    /**
     * Searches within a single resource
     */
    async searchResource(resource: ProjectResource, query: SearchQuery): Promise<DetailedSearchResult | null> {
        const matches: SearchMatch[] = [];
        let score = 0;

        // Search in resource path/name
        if (query.type === 'all' || query.type === 'name' || query.type === 'path') {
            const pathMatches = this.searchInText(resource.path, query, 'path');
            matches.push(...pathMatches);
            score += pathMatches.length * 10; // Higher score for name matches
        }

        // Search in file contents
        if (this.config.enableContentSearch && (query.type === 'all' || query.type === 'content')) {
            const contentMatches = await this.searchInResourceFiles(resource, query);
            matches.push(...contentMatches);
            score += contentMatches.length * 5; // Lower score for content matches
        }

        if (matches.length === 0) {
            return null;
        }

        return {
            resourcePath: resource.path,
            resourceType: resource.type,
            projectId: resource.sourceProject,
            displayName: this.getResourceDisplayName(resource),
            matches,
            score,
            metadata: resource.metadata || {}
        };
    }

    /**
     * Searches for query suggestions
     */
    generateSearchSuggestions(
        partialQuery: string,
        resources: ReadonlyMap<string, ProjectResource>,
        maxSuggestions: number = 5
    ): readonly string[] {
        if (!partialQuery || partialQuery.length < 2) {
            return [];
        }

        const suggestions = new Set<string>();
        const queryLower = partialQuery.toLowerCase();

        // Use search index for fast lookups
        for (const [term, _paths] of this.searchIndex) {
            if (term.includes(queryLower) && term.length > partialQuery.length) {
                suggestions.add(term);
                if (suggestions.size >= maxSuggestions * 2) break;
            }
        }

        // Sort by relevance and length
        return Array.from(suggestions)
            .sort((a, b) => {
                const aScore = this.calculateSuggestionScore(a, partialQuery);
                const bScore = this.calculateSuggestionScore(b, partialQuery);
                return bScore - aScore;
            })
            .slice(0, maxSuggestions);
    }

    /**
     * Validates search query for potential issues
     */
    validateQuery(query: SearchQuery): {
        isValid: boolean;
        errors: readonly string[];
        warnings: readonly string[];
    } {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!query.term.trim()) {
            errors.push('Search term cannot be empty');
        }

        if (query.useRegex) {
            try {
                new RegExp(query.term);
            } catch (error) {
                errors.push(`Invalid regular expression: ${String(error)}`);
            }
        }

        if (query.term.length < 2 && query.type === 'content') {
            warnings.push('Content search with very short terms may be slow');
        }

        if (query.term.length > 100) {
            warnings.push('Very long search terms may not produce useful results');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    // ============================================================================
    // TEXT MATCHING
    // ============================================================================

    /**
     * Searches for query matches within text
     */
    searchInText(text: string, query: SearchQuery, context: string = 'text'): SearchMatch[] {
        const matches: SearchMatch[] = [];
        const searchTerm = query.caseSensitive ? query.term : query.term.toLowerCase();
        const searchText = query.caseSensitive ? text : text.toLowerCase();

        if (query.useRegex) {
            return this.searchWithRegex(text, query, context);
        }

        if (query.wholeWord) {
            return this.searchWholeWords(text, query, context);
        }

        // Simple substring search
        let index = 0;
        while ((index = searchText.indexOf(searchTerm, index)) !== -1) {
            matches.push({
                line: 1, // Text is treated as single line for path search
                column: index + 1,
                text: text.substring(Math.max(0, index - 20), index + searchTerm.length + 20),
                context,
                highlightStart: Math.max(0, 20 - index),
                highlightEnd: Math.max(0, 20 - index) + searchTerm.length
            });

            index += searchTerm.length;
        }

        return matches;
    }

    /**
     * Searches with regular expression
     */
    private searchWithRegex(text: string, query: SearchQuery, context: string): SearchMatch[] {
        const matches: SearchMatch[] = [];

        try {
            const flags = query.caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(query.term, flags);
            const lines = text.split('\n');

            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];
                let match;

                while ((match = regex.exec(line)) !== null) {
                    matches.push({
                        line: lineIndex + 1,
                        column: match.index + 1,
                        text: line,
                        context,
                        highlightStart: match.index,
                        highlightEnd: match.index + match[0].length
                    });

                    // Prevent infinite loop with zero-width matches
                    if (match.index === regex.lastIndex) {
                        regex.lastIndex++;
                    }
                }
            }
        } catch (error) {
            console.warn(`Regex search failed: ${String(error)}`);
        }

        return matches;
    }

    /**
     * Searches for whole word matches
     */
    private searchWholeWords(text: string, query: SearchQuery, context: string): SearchMatch[] {
        const matches: SearchMatch[] = [];
        const searchTerm = query.caseSensitive ? query.term : query.term.toLowerCase();
        const wordBoundary = /\b/;

        const lines = text.split('\n');
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = query.caseSensitive ? lines[lineIndex] : lines[lineIndex].toLowerCase();
            const originalLine = lines[lineIndex];

            const words = line.split(/\s+/);
            let columnOffset = 0;

            for (const word of words) {
                if (word === searchTerm || (wordBoundary.test(word) && word.includes(searchTerm))) {
                    const wordStart = line.indexOf(word, columnOffset);
                    if (wordStart !== -1) {
                        matches.push({
                            line: lineIndex + 1,
                            column: wordStart + 1,
                            text: originalLine,
                            context,
                            highlightStart: wordStart,
                            highlightEnd: wordStart + word.length
                        });
                    }
                }
                columnOffset += word.length + 1; // +1 for space
            }
        }

        return matches;
    }

    /**
     * Searches within resource files
     */
    private async searchInResourceFiles(resource: ProjectResource, query: SearchQuery): Promise<SearchMatch[]> {
        const matches: SearchMatch[] = [];

        for (const file of resource.files) {
            if (!this.isSearchableFile(file.path)) {
                continue;
            }

            try {
                const fileMatches = await this.searchInFile(file.path, query);
                matches.push(...fileMatches);
            } catch (error) {
                console.warn(`Failed to search file ${file.path}:`, error);
            }
        }

        return matches;
    }

    /**
     * Searches within a single file
     */
    private async searchInFile(filePath: string, query: SearchQuery): Promise<SearchMatch[]> {
        try {
            const stats = await fs.stat(filePath);

            if (stats.size > this.config.maxFileSize) {
                console.warn(`File ${filePath} too large for content search (${stats.size} bytes)`);
                return [];
            }

            const content = await fs.readFile(filePath, 'utf-8');
            return this.searchInText(content, query, 'content');
        } catch {
            // File might not be readable or might be binary
            return [];
        }
    }

    // ============================================================================
    // RESULT PROCESSING
    // ============================================================================

    /**
     * Sorts results by relevance score
     */
    private sortResultsByRelevance(results: DetailedSearchResult[], query: SearchQuery): DetailedSearchResult[] {
        return results.sort((a, b) => {
            // Primary sort: score (higher is better)
            if (a.score !== b.score) {
                return b.score - a.score;
            }

            // Secondary sort: exact name matches
            const queryLower = query.term.toLowerCase();
            const aExactName = a.displayName.toLowerCase() === queryLower;
            const bExactName = b.displayName.toLowerCase() === queryLower;

            if (aExactName && !bExactName) return -1;
            if (!aExactName && bExactName) return 1;

            // Tertiary sort: resource type
            if (a.resourceType !== b.resourceType) {
                return a.resourceType.localeCompare(b.resourceType);
            }

            // Final sort: path length (shorter is better)
            return a.resourcePath.length - b.resourcePath.length;
        });
    }

    /**
     * Filters resources based on query constraints
     */
    private filterResourcesByQuery(
        resources: ReadonlyMap<string, ProjectResource>,
        query: SearchQuery
    ): ReadonlyMap<string, ProjectResource> {
        const filtered = new Map<string, ProjectResource>();

        for (const [key, resource] of resources) {
            let shouldInclude = true;

            // Filter by resource types
            if (query.resourceTypes && query.resourceTypes.length > 0) {
                shouldInclude = query.resourceTypes.includes(resource.type);
            }

            // Filter by project IDs
            if (shouldInclude && query.projectIds && query.projectIds.length > 0) {
                shouldInclude = query.projectIds.includes(resource.sourceProject);
            }

            if (shouldInclude) {
                filtered.set(key, resource);
            }
        }

        return filtered;
    }

    /**
     * Updates search statistics
     */
    private updateSearchStatistics(
        stats: {
            byResourceType: Map<string, number>;
            byProject: Map<string, number>;
        },
        result: DetailedSearchResult
    ): void {
        // Update by resource type
        const typeCount = stats.byResourceType.get(result.resourceType) || 0;
        stats.byResourceType.set(result.resourceType, typeCount + 1);

        // Update by project
        const projectCount = stats.byProject.get(result.projectId) || 0;
        stats.byProject.set(result.projectId, projectCount + 1);
    }

    /**
     * Calculates suggestion relevance score
     */
    private calculateSuggestionScore(suggestion: string, partialQuery: string): number {
        const query = partialQuery.toLowerCase();
        const term = suggestion.toLowerCase();

        // Perfect prefix match gets highest score
        if (term.startsWith(query)) {
            return 100 - (term.length - query.length);
        }

        // Word boundary matches get medium score
        if (term.includes(` ${query}`) || term.includes(`_${query}`) || term.includes(`-${query}`)) {
            return 50 - (term.length - query.length);
        }

        // Contains matches get lower score
        if (term.includes(query)) {
            return 25 - (term.length - query.length);
        }

        return 0;
    }

    // ============================================================================
    // UTILITY METHODS
    // ============================================================================

    /**
     * Determines if a file is searchable
     */
    private isSearchableFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return this.config.searchableExtensions.includes(ext);
    }

    /**
     * Gets display name for a resource
     */
    private getResourceDisplayName(resource: ProjectResource): string {
        const segments = resource.path.split('/');
        return segments[segments.length - 1] || resource.path;
    }

    /**
     * Builds search index for fast suggestions
     */
    private buildSearchIndex(): void {
        // This would be enhanced to index actual resources
        // For now, create basic index structure
        this.searchIndex.clear();
        this.lastIndexUpdate = Date.now();
        console.log('Search index built successfully');
    }

    /**
     * Updates configuration
     */
    updateConfiguration(newConfig: Partial<SearchConfiguration>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Gets current configuration
     */
    getConfiguration(): Readonly<SearchConfiguration> {
        return Object.freeze({ ...this.config });
    }

    /**
     * Loads configuration from workspace
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.search');
        this.config = { ...this.config, ...(config as Partial<SearchConfiguration>) };
    }

    /**
     * String representation for debugging
     */
    toString(): string {
        return `SearchUtilities(maxResults: ${this.config.maxResults}, timeout: ${this.config.searchTimeout}ms)`;
    }
}
