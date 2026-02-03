import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { ProjectResource } from '@/core/types/models';
import { ResourceSearchOptions, ResourceSearchResult } from '@/core/types/resources';

/**
 * Search history item structure
 */
export interface SearchHistoryItem {
    query: string;
    resourceTypes?: string[];
    timestamp: number;
    searchType: 'all' | 'specific' | 'content';
}

/**
 * Centralized helper for search operations
 * Consolidates search logic from resourceSearchService.ts
 */
export class SearchHelper {
    // ============================================================================
    // QUERY MATCHING
    // ============================================================================

    /**
     * Checks if text matches a search query based on options
     */
    static matchesQuery(text: string, query: string, options: ResourceSearchOptions): boolean {
        if (!query.trim()) {
            return false;
        }

        const searchText = (options.caseSensitive ?? false) ? text : text.toLowerCase();
        const searchQuery = (options.caseSensitive ?? false) ? query : query.toLowerCase();

        if (options.useRegex ?? false) {
            return this.matchesRegex(searchText, searchQuery, options);
        }

        return this.matchesText(searchText, searchQuery);
    }

    /**
     * Tests regex pattern matching
     */
    private static matchesRegex(text: string, pattern: string, options: ResourceSearchOptions): boolean {
        try {
            const flags = (options.caseSensitive ?? false) ? 'g' : 'gi';
            const regex = new RegExp(pattern, flags);
            return regex.test(text);
        } catch {
            // Invalid regex, fall back to text search
            return text.includes(pattern);
        }
    }

    /**
     * Tests text matching with path segment support
     */
    private static matchesText(text: string, query: string): boolean {
        // Direct substring match
        if (text.includes(query)) {
            return true;
        }

        // Path segment matching
        const pathSegments = text.split('/');
        return pathSegments.some(segment => segment.includes(query)) || pathSegments[pathSegments.length - 1] === query;
    }

    // ============================================================================
    // FILE CONTENT SEARCH
    // ============================================================================

    /**
     * Searches within resource files for text content
     */
    static async searchInResourceFiles(
        resource: ProjectResource,
        query: string,
        options: ResourceSearchOptions
    ): Promise<Array<{ line: number; column: number; text: string; context?: string }>> {
        const matches: Array<{ line: number; column: number; text: string; context?: string }> = [];

        for (const file of resource.files) {
            if (!this.isSearchableFile(file.path)) {
                continue;
            }

            try {
                const fileMatches = await this.searchInFile(file.path, query, options);
                matches.push(...fileMatches);
            } catch (error) {
                console.warn(`Failed to search in file ${file.path}:`, error);
            }
        }

        return matches;
    }

    /**
     * Searches within a single file
     */
    private static async searchInFile(
        filePath: string,
        query: string,
        options: ResourceSearchOptions
    ): Promise<Array<{ line: number; column: number; text: string; context?: string }>> {
        const matches: Array<{ line: number; column: number; text: string; context?: string }> = [];

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (this.matchesQuery(line, query, options)) {
                    const column = this.findQueryColumn(line, query, options);
                    matches.push({
                        line: i + 1,
                        column,
                        text: line.trim(),
                        context: this.getLineContext(lines, i)
                    });
                }
            }
        } catch {
            // File might not be readable or might be binary
            console.warn(`Could not read file for search: ${filePath}`);
        }

        return matches;
    }

    /**
     * Finds the column position of a query in a line
     */
    private static findQueryColumn(line: string, query: string, options: ResourceSearchOptions): number {
        const searchText = (options.caseSensitive ?? false) ? line : line.toLowerCase();
        const searchQuery = (options.caseSensitive ?? false) ? query : query.toLowerCase();

        if (options.useRegex ?? false) {
            try {
                const flags = (options.caseSensitive ?? false) ? '' : 'i';
                const regex = new RegExp(searchQuery, flags);
                const match = regex.exec(searchText);
                return match ? match.index + 1 : 1;
            } catch {
                return searchText.indexOf(searchQuery) + 1;
            }
        }

        return searchText.indexOf(searchQuery) + 1; // 1-based column
    }

    /**
     * Gets context lines around a match
     */
    private static getLineContext(lines: string[], lineIndex: number, contextSize: number = 1): string {
        const start = Math.max(0, lineIndex - contextSize);
        const end = Math.min(lines.length - 1, lineIndex + contextSize);

        return lines
            .slice(start, end + 1)
            .map((line, idx) => `${start + idx + 1}: ${line}`)
            .join('\n');
    }

    /**
     * Determines if a file is searchable (text-based)
     */
    static isSearchableFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        const textExtensions = [
            '.py',
            '.sql',
            '.json',
            '.js',
            '.ts',
            '.xml',
            '.txt',
            '.md',
            '.yaml',
            '.yml',
            '.html',
            '.css',
            '.scss',
            '.less'
        ];
        return textExtensions.includes(ext);
    }

    // ============================================================================
    // RESULT PROCESSING
    // ============================================================================

    /**
     * Sorts search results by relevance
     */
    static sortResults(
        results: ResourceSearchResult[],
        query: string,
        options: ResourceSearchOptions
    ): ResourceSearchResult[] {
        return results.sort((a, b) => {
            // Primary: Match score (lower = better)
            const scoreA = this.getMatchScore(a, query, options);
            const scoreB = this.getMatchScore(b, query, options);
            if (scoreA !== scoreB) {
                return scoreA - scoreB;
            }

            // Secondary: Exact name matches
            const queryLower = query.toLowerCase();
            const aExact = a.displayName.toLowerCase() === queryLower;
            const bExact = b.displayName.toLowerCase() === queryLower;
            if (aExact && !bExact) {
                return -1;
            }
            if (!aExact && bExact) {
                return 1;
            }

            // Tertiary: Project ID
            if (a.projectId !== b.projectId) {
                return a.projectId.localeCompare(b.projectId);
            }

            // Quaternary: Resource type
            if (a.resourceType !== b.resourceType) {
                return a.resourceType.localeCompare(b.resourceType);
            }

            // Final: Path
            return a.resourcePath.localeCompare(b.resourcePath);
        });
    }

    /**
     * Calculates match relevance score (lower = more relevant)
     */
    private static getMatchScore(result: ResourceSearchResult, query: string, options: ResourceSearchOptions): number {
        const queryToUse = (options.caseSensitive ?? false) ? query : query.toLowerCase();
        const pathToCheck = (options.caseSensitive ?? false) ? result.resourcePath : result.resourcePath.toLowerCase();
        const nameToCheck = (options.caseSensitive ?? false) ? result.displayName : result.displayName.toLowerCase();

        // Perfect matches
        if (pathToCheck === queryToUse || nameToCheck === queryToUse) {
            return 0;
        }

        // Prefix matches
        if (pathToCheck.startsWith(queryToUse) || nameToCheck.startsWith(queryToUse)) {
            return 1;
        }

        // Suffix matches (resource name)
        if (pathToCheck.endsWith(queryToUse) || nameToCheck.endsWith(queryToUse)) {
            return 2;
        }

        // Contains matches
        if (pathToCheck.includes(queryToUse) || nameToCheck.includes(queryToUse)) {
            return 3;
        }

        // Content matches
        if (result.matches && result.matches.length > 0) {
            return 4;
        }

        return 5; // Fallback
    }

    /**
     * Groups search results by resource type
     */
    static groupResultsByType(results: ResourceSearchResult[]): Map<string, ResourceSearchResult[]> {
        const grouped = new Map<string, ResourceSearchResult[]>();

        for (const result of results) {
            if (!grouped.has(result.resourceType)) {
                grouped.set(result.resourceType, []);
            }
            grouped.get(result.resourceType)!.push(result);
        }

        return grouped;
    }

    /**
     * Limits results to prevent UI overload
     */
    static limitResults(results: ResourceSearchResult[], maxResults: number = 1000): ResourceSearchResult[] {
        return results.slice(0, maxResults);
    }

    // ============================================================================
    // SEARCH SUGGESTIONS
    // ============================================================================

    /**
     * Generates search suggestions based on query and available resources
     */
    static generateSuggestions(
        query: string,
        allResources: Map<string, ProjectResource>,
        maxSuggestions: number = 5
    ): string[] {
        const _suggestions: string[] = [];
        const queryLower = query.toLowerCase();

        // Collect potential matches
        const potentialMatches = new Set<string>();

        for (const [resourceKey, _resource] of allResources) {
            const cleanPath = this.extractPath(resourceKey);
            const pathSegments = cleanPath.split('/');

            // Add path segments that partially match
            for (const segment of pathSegments) {
                if (segment.toLowerCase().includes(queryLower) && segment.length > query.length) {
                    potentialMatches.add(segment);
                }
            }

            // Add full paths that partially match
            if (cleanPath.toLowerCase().includes(queryLower) && cleanPath.length > query.length) {
                potentialMatches.add(cleanPath);
            }
        }

        // Convert to sorted array and limit
        const sortedSuggestions = Array.from(potentialMatches)
            .sort((a, b) => {
                // Prefer shorter suggestions (more likely to be relevant)
                const lengthDiff = a.length - b.length;
                if (lengthDiff !== 0) {
                    return lengthDiff;
                }

                return a.localeCompare(b);
            })
            .slice(0, maxSuggestions);

        return sortedSuggestions;
    }

    /**
     * Extracts the path portion from a resource key
     */
    private static extractPath(resourceKey: string): string {
        // Resource keys are in format "typeId:categoryId/path" or "typeId:path"
        if (resourceKey.includes(':')) {
            return resourceKey.split(':', 2)[1] ?? '';
        }
        return resourceKey;
    }

    // ============================================================================
    // SEARCH RESULT DISPLAY
    // ============================================================================

    /**
     * Formats search results for quick pick display
     */
    static formatResultsForQuickPick(
        results: ResourceSearchResult[],
        query: string,
        typeIcons: Map<string, string> = new Map()
    ): vscode.QuickPickItem[] {
        const items: vscode.QuickPickItem[] = [];

        // Add summary
        items.push({
            label: `Found ${results.length} result${results.length === 1 ? '' : 's'} for "${query}"`,
            kind: vscode.QuickPickItemKind.Separator
        });

        // Group by type
        const groupedResults = this.groupResultsByType(results);

        for (const [typeId, typeResults] of groupedResults) {
            const typeIcon = typeIcons.get(typeId) ?? 'file';

            // Type header
            items.push({
                label: `${typeId} (${typeResults.length})`,
                kind: vscode.QuickPickItemKind.Separator
            });

            // Results for this type
            for (const result of typeResults) {
                const displayPath = this.formatDisplayPath(result.resourcePath, result.resourceType);

                let description = `📁 ${result.projectId}`;
                let detail = displayPath;

                if (result.matches && result.matches.length > 0) {
                    description += ` • 🔍 ${result.matches.length} content match${result.matches.length === 1 ? '' : 'es'}`;
                    detail = `${displayPath} • "${result.matches[0].text.trim() || (result.matches[0].context ?? '')}"`;
                }

                items.push({
                    label: `  $(${typeIcon}) ${displayPath}`,
                    description,
                    detail
                });
            }
        }

        return items;
    }

    /**
     * Formats a resource path for display
     */
    static formatDisplayPath(resourcePath: string, _resourceType?: string): string {
        // Remove compound key prefix if present
        const cleanPath = resourcePath.includes(':') ? resourcePath.split(':', 2)[1] : resourcePath;

        // Apply delimiter transformation if needed (could be enhanced with type registry)
        return cleanPath.replace(/\//g, '/'); // Default to forward slash
    }
}

/**
 * Search history management utilities
 */
export class SearchHistoryManager {
    private static readonly MAX_HISTORY_ITEMS = 15;

    /**
     * Adds an item to search history
     */
    static addToHistory(
        history: SearchHistoryItem[],
        query: string,
        resourceTypes?: string[],
        searchType: 'all' | 'specific' | 'content' = 'all'
    ): SearchHistoryItem[] {
        if (!query || query.trim().length === 0) {
            return history;
        }

        const trimmedQuery = query.trim();
        const newItem: SearchHistoryItem = {
            query: trimmedQuery,
            resourceTypes,
            timestamp: Date.now(),
            searchType
        };

        // Remove duplicate
        const filteredHistory = history.filter(
            item =>
                !(
                    item.query === trimmedQuery &&
                    JSON.stringify(item.resourceTypes?.sort()) === JSON.stringify(resourceTypes?.sort()) &&
                    item.searchType === searchType
                )
        );

        // Add to beginning
        const newHistory = [newItem, ...filteredHistory];

        // Limit size
        return newHistory.slice(0, this.MAX_HISTORY_ITEMS);
    }

    /**
     * Filters history by search type
     */
    static filterHistoryByType(
        history: SearchHistoryItem[],
        searchType: 'all' | 'specific' | 'content'
    ): SearchHistoryItem[] {
        return history.filter(item => item.searchType === searchType);
    }

    /**
     * Gets recent queries for a specific resource type
     */
    static getRecentQueriesForType(
        history: SearchHistoryItem[],
        resourceTypeId: string,
        maxItems: number = 3
    ): string[] {
        return history
            .filter(item => (item.resourceTypes ?? []).length === 1 && item.resourceTypes?.[0] === resourceTypeId)
            .slice(0, maxItems)
            .map(item => item.query);
    }

    /**
     * Formats time ago string for display
     */
    static formatTimeAgo(timestamp: number): string {
        const now = Date.now();
        const diffMs = now - timestamp;
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMinutes < 1) {
            return 'just now';
        }
        if (diffMinutes < 60) {
            return `${diffMinutes}m ago`;
        }
        if (diffHours < 24) {
            return `${diffHours}h ago`;
        }
        if (diffDays < 7) {
            return `${diffDays}d ago`;
        }
        return 'over a week ago';
    }
}
