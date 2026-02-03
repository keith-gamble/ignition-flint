/**
 * @module SearchHistoryService
 * @description Service for managing search query history and user search preferences
 * Tracks frequently used queries, provides suggestions, and manages search analytics
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Search history entry with metadata
 */
export interface SearchHistoryEntry {
    readonly query: string;
    readonly timestamp: string;
    readonly resultCount: number;
    readonly executionTime: number;
    readonly searchOptions: Readonly<Record<string, unknown>>;
    readonly projectIds?: readonly string[];
    readonly resourceTypes?: readonly string[];
}

/**
 * Search suggestion based on history
 */
export interface SearchSuggestion {
    readonly query: string;
    readonly frequency: number;
    readonly lastUsed: string;
    readonly averageResultCount: number;
    readonly category: 'recent' | 'frequent' | 'suggested';
}

/**
 * Search analytics data
 */
export interface SearchAnalytics {
    readonly totalSearches: number;
    readonly uniqueQueries: number;
    readonly averageResultCount: number;
    readonly averageExecutionTime: number;
    readonly topQueries: readonly { query: string; count: number }[];
    readonly topResourceTypes: readonly { type: string; count: number }[];
    readonly searchTrends: readonly { date: string; count: number }[];
}

/**
 * Parameters for adding an entry to search history
 */
interface AddToHistoryParams {
    query: string;
    resultCount: number;
    executionTime: number;
    searchOptions?: Record<string, unknown>;
    projectIds?: string[];
    resourceTypes?: string[];
}

/**
 * Search history management service with analytics and suggestions
 */
export class SearchHistoryService implements IServiceLifecycle {
    private static readonly MAX_HISTORY_SIZE = 1000;
    private static readonly HISTORY_FILE_NAME = 'search-history.json';
    private static readonly SUGGESTION_THRESHOLD = 2; // Minimum frequency for suggestions

    private searchHistory: SearchHistoryEntry[] = [];
    private queryFrequency = new Map<string, number>();
    private isInitialized = false;
    private historyFilePath: string | null = null;
    private saveDebounceTimer: NodeJS.Timeout | null = null;

    private readonly historyUpdatedEmitter = new vscode.EventEmitter<SearchHistoryEntry>();
    public readonly onHistoryUpdated =
        this.historyUpdatedEmitter.event ??
        ((): vscode.Disposable => ({
            dispose: (): void => {
                // No-op fallback disposable
            }
        }));

    private readonly suggestionsChangedEmitter = new vscode.EventEmitter<SearchSuggestion[]>();
    public readonly onSuggestionsChanged =
        this.suggestionsChangedEmitter.event ??
        ((): vscode.Disposable => ({
            dispose: (): void => {
                // No-op fallback disposable
            }
        }));

    constructor(private readonly serviceContainer: ServiceContainer) {}

    async initialize(): Promise<void> {
        await this.setupHistoryStorage();
        await this.loadSearchHistory();
        this.buildQueryFrequencyMap();
        this.isInitialized = true;
        // console.log(`SearchHistoryService initialized with ${this.searchHistory.length} entries`);
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            return Promise.reject(
                new FlintError('SearchHistoryService must be initialized before starting', 'SERVICE_NOT_INITIALIZED')
            );
        }
        // console.log('SearchHistoryService started');
        return Promise.resolve();
    }

    async stop(): Promise<void> {
        // Save any pending changes
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            await this.saveSearchHistory();
        }
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.searchHistory = [];
        this.queryFrequency.clear();

        // Safely dispose of event emitters (dispose may not exist in test environment)
        if (typeof this.historyUpdatedEmitter.dispose === 'function') {
            this.historyUpdatedEmitter.dispose();
        }
        if (typeof this.suggestionsChangedEmitter.dispose === 'function') {
            this.suggestionsChangedEmitter.dispose();
        }

        this.isInitialized = false;
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Adds a search query to the history
     */
    async addToHistory(params: AddToHistoryParams): Promise<void> {
        const { query, resultCount, executionTime, searchOptions = {}, projectIds, resourceTypes } = params;

        if (!query.trim()) {
            return; // Don't add empty queries
        }

        const entry: SearchHistoryEntry = {
            query: query.trim(),
            timestamp: new Date().toISOString(),
            resultCount,
            executionTime,
            searchOptions: Object.freeze(searchOptions),
            projectIds: projectIds ? Object.freeze(projectIds) : undefined,
            resourceTypes: resourceTypes ? Object.freeze(resourceTypes) : undefined
        };

        // Add to history (most recent first)
        this.searchHistory.unshift(entry);

        // Update frequency map
        const currentFreq = this.queryFrequency.get(entry.query) ?? 0;
        this.queryFrequency.set(entry.query, currentFreq + 1);

        // Trim history if too large
        if (this.searchHistory.length > SearchHistoryService.MAX_HISTORY_SIZE) {
            const removed = this.searchHistory.splice(SearchHistoryService.MAX_HISTORY_SIZE);
            // Update frequency map for removed entries
            for (const removedEntry of removed) {
                const freq = this.queryFrequency.get(removedEntry.query);
                if (freq && freq > 1) {
                    this.queryFrequency.set(removedEntry.query, freq - 1);
                } else {
                    this.queryFrequency.delete(removedEntry.query);
                }
            }
        }

        // Emit events (safely handle test environment)
        if (typeof this.historyUpdatedEmitter.fire === 'function') {
            this.historyUpdatedEmitter.fire(entry);
        }

        const suggestions = await this.generateSuggestions();
        if (typeof this.suggestionsChangedEmitter.fire === 'function') {
            this.suggestionsChangedEmitter.fire([...suggestions]);
        }

        // Debounced save
        this.debouncedSave();
    }

    /**
     * Gets the complete search history
     */
    getSearchHistory(limit?: number): readonly SearchHistoryEntry[] {
        const history = limit ? this.searchHistory.slice(0, limit) : this.searchHistory;
        return Object.freeze(history);
    }

    /**
     * Gets recent search queries (unique)
     */
    getRecentQueries(limit = 10): readonly string[] {
        const uniqueQueries = new Set<string>();
        const recent: string[] = [];

        for (const entry of this.searchHistory) {
            if (!uniqueQueries.has(entry.query)) {
                uniqueQueries.add(entry.query);
                recent.push(entry.query);

                if (recent.length >= limit) {
                    break;
                }
            }
        }

        return Object.freeze(recent);
    }

    /**
     * Gets search suggestions based on history
     */
    generateSuggestions(partialQuery?: string): Promise<readonly SearchSuggestion[]> {
        const suggestions: SearchSuggestion[] = [];
        const now = new Date();

        // Recent suggestions (last 24 hours)
        const recentEntries = this.searchHistory.filter(entry => {
            const entryDate = new Date(entry.timestamp);
            const hoursDiff = (now.getTime() - entryDate.getTime()) / (1000 * 60 * 60);
            return hoursDiff <= 24;
        });

        const recentQueries = new Map<string, SearchHistoryEntry[]>();
        for (const entry of recentEntries) {
            if (!partialQuery || entry.query.toLowerCase().includes(partialQuery.toLowerCase())) {
                if (!recentQueries.has(entry.query)) {
                    recentQueries.set(entry.query, []);
                }
                recentQueries.get(entry.query)!.push(entry);
            }
        }

        for (const [query, entries] of recentQueries) {
            const avgResults = entries.reduce((sum, e) => sum + e.resultCount, 0) / entries.length;
            suggestions.push({
                query,
                frequency: entries.length,
                lastUsed: entries[0].timestamp,
                averageResultCount: Math.round(avgResults),
                category: 'recent'
            });
        }

        // Frequent suggestions
        for (const [query, frequency] of this.queryFrequency.entries()) {
            if (frequency >= SearchHistoryService.SUGGESTION_THRESHOLD) {
                if (!partialQuery || query.toLowerCase().includes(partialQuery.toLowerCase())) {
                    const lastEntry = this.searchHistory.find(e => e.query === query);
                    const allEntries = this.searchHistory.filter(e => e.query === query);
                    const avgResults = allEntries.reduce((sum, e) => sum + e.resultCount, 0) / allEntries.length;

                    if (!suggestions.find(s => s.query === query)) {
                        suggestions.push({
                            query,
                            frequency,
                            lastUsed: lastEntry?.timestamp ?? '',
                            averageResultCount: Math.round(avgResults),
                            category: 'frequent'
                        });
                    }
                }
            }
        }

        // Smart suggestions based on patterns
        if (partialQuery) {
            const smartSuggestions = this.generateSmartSuggestions(partialQuery);
            suggestions.push(...smartSuggestions);
        }

        // Sort suggestions by relevance
        suggestions.sort((a, b) => {
            // Prioritize by category
            const categoryOrder: Record<string, number> = { recent: 0, frequent: 1, suggested: 2 };
            const categoryDiff = (categoryOrder[a.category] ?? 0) - (categoryOrder[b.category] ?? 0);
            if (categoryDiff !== 0) return categoryDiff;

            // Then by frequency
            return b.frequency - a.frequency;
        });

        return Promise.resolve(Object.freeze(suggestions.slice(0, 20))); // Limit to top 20 suggestions
    }

    /**
     * Clears search history
     */
    async clearHistory(): Promise<void> {
        this.searchHistory = [];
        this.queryFrequency.clear();

        await this.saveSearchHistory();

        // Safely emit event (fire may not exist in test environment)
        if (typeof this.suggestionsChangedEmitter.fire === 'function') {
            this.suggestionsChangedEmitter.fire([]);
        }
    }

    /**
     * Removes a specific query from history
     */
    async removeFromHistory(query: string): Promise<void> {
        const initialLength = this.searchHistory.length;
        this.searchHistory = this.searchHistory.filter(entry => entry.query !== query);

        this.queryFrequency.delete(query);

        if (this.searchHistory.length < initialLength) {
            await this.saveSearchHistory();
            const suggestions = await this.generateSuggestions();
            // Safely emit event (fire may not exist in test environment)
            if (typeof this.suggestionsChangedEmitter.fire === 'function') {
                this.suggestionsChangedEmitter.fire([...suggestions]);
            }
        }
    }

    /**
     * Gets search analytics
     */
    getSearchAnalytics(): SearchAnalytics {
        const totalSearches = this.searchHistory.length;
        const uniqueQueries = this.queryFrequency.size;

        const avgResultCount =
            totalSearches > 0
                ? this.searchHistory.reduce((sum, entry) => sum + entry.resultCount, 0) / totalSearches
                : 0;

        const avgExecutionTime =
            totalSearches > 0
                ? this.searchHistory.reduce((sum, entry) => sum + entry.executionTime, 0) / totalSearches
                : 0;

        // Top queries
        const topQueries = Array.from(this.queryFrequency.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([query, count]) => ({ query, count }));

        // Top resource types
        const resourceTypeCounts = new Map<string, number>();
        for (const entry of this.searchHistory) {
            if (entry.resourceTypes) {
                for (const type of entry.resourceTypes) {
                    resourceTypeCounts.set(type, (resourceTypeCounts.get(type) ?? 0) + 1);
                }
            }
        }

        const topResourceTypes = Array.from(resourceTypeCounts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([type, count]) => ({ type, count }));

        // Search trends (last 30 days by day)
        const searchTrends = this.calculateSearchTrends();

        return Object.freeze({
            totalSearches,
            uniqueQueries,
            averageResultCount: Math.round(avgResultCount * 100) / 100,
            averageExecutionTime: Math.round(avgExecutionTime * 100) / 100,
            topQueries: Object.freeze(topQueries),
            topResourceTypes: Object.freeze(topResourceTypes),
            searchTrends: Object.freeze(searchTrends)
        });
    }

    /**
     * Sets up history storage location (directory created on first write)
     */
    private setupHistoryStorage(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const flintDir = path.join(workspaceFolder.uri.fsPath, '.flint');
                // Don't create directory yet - only create when we need to write
                this.historyFilePath = path.join(flintDir, SearchHistoryService.HISTORY_FILE_NAME);
            } else {
                // Fall back to extension global storage
                this.historyFilePath = null;
            }
        } catch (error) {
            console.warn('Failed to setup search history storage:', error);
            this.historyFilePath = null;
        }
        return Promise.resolve();
    }

    /**
     * Loads search history from disk
     */
    private async loadSearchHistory(): Promise<void> {
        if (!this.historyFilePath) {
            return;
        }

        try {
            const content = await fs.readFile(this.historyFilePath, 'utf8');
            const data = JSON.parse(content);

            if (Array.isArray(data.history)) {
                this.searchHistory = data.history.slice(0, SearchHistoryService.MAX_HISTORY_SIZE);
            }
        } catch {
            // File doesn't exist or is invalid, start with empty history
        }
    }

    /**
     * Saves search history to disk
     */
    private async saveSearchHistory(): Promise<void> {
        if (!this.historyFilePath) {
            return;
        }

        try {
            // Create directory only when we need to write
            const dir = path.dirname(this.historyFilePath);
            await fs.mkdir(dir, { recursive: true });

            const data = {
                version: '1.0',
                lastUpdated: new Date().toISOString(),
                history: this.searchHistory
            };

            await fs.writeFile(this.historyFilePath, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            console.warn('Failed to save search history:', error);
        }
    }

    /**
     * Debounced save to avoid too frequent disk writes
     */
    private debouncedSave(): void {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }

        this.saveDebounceTimer = setTimeout(async () => {
            await this.saveSearchHistory();
            this.saveDebounceTimer = null;
        }, 5000); // 5 second debounce
    }

    /**
     * Builds frequency map from history
     */
    private buildQueryFrequencyMap(): void {
        this.queryFrequency.clear();

        for (const entry of this.searchHistory) {
            const current = this.queryFrequency.get(entry.query) ?? 0;
            this.queryFrequency.set(entry.query, current + 1);
        }
    }

    /**
     * Generates smart suggestions based on query patterns
     */
    private generateSmartSuggestions(partialQuery: string): SearchSuggestion[] {
        const suggestions: SearchSuggestion[] = [];

        // Add common search patterns
        const patterns = ['type:perspective', 'type:vision', 'type:script', 'project:', 'name:', 'modified:'];

        for (const pattern of patterns) {
            if (
                pattern.toLowerCase().includes(partialQuery.toLowerCase()) &&
                !suggestions.find(s => s.query === pattern)
            ) {
                suggestions.push({
                    query: pattern,
                    frequency: 0,
                    lastUsed: '',
                    averageResultCount: 0,
                    category: 'suggested'
                });
            }
        }

        return suggestions;
    }

    /**
     * Calculates search trends over time
     */
    private calculateSearchTrends(): { date: string; count: number }[] {
        const trends = new Map<string, number>();
        const now = new Date();

        // Initialize last 30 days
        for (let i = 29; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            trends.set(dateStr, 0);
        }

        // Count searches by date
        for (const entry of this.searchHistory) {
            const entryDate = new Date(entry.timestamp).toISOString().split('T')[0];
            if (trends.has(entryDate)) {
                trends.set(entryDate, trends.get(entryDate)! + 1);
            }
        }

        return Array.from(trends.entries()).map(([date, count]) => ({ date, count }));
    }
}
