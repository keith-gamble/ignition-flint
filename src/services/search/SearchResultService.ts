/**
 * @module SearchResultService
 * @description Service for managing search results, formatting, and user interactions
 * Provides result ranking, highlighting, export capabilities, and user feedback integration
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ResourceSearchResult, ResourceSearchMatch } from '@/core/types/resources';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Enhanced search result with additional metadata
 */
export interface EnhancedSearchResult extends ResourceSearchResult {
    readonly searchId: string;
    readonly rank: number;
    readonly highlightedDisplayName: string;
    readonly highlightedMatches: readonly HighlightedMatch[];
    readonly previewText?: string;
    readonly relevanceFactors: readonly string[];
    readonly userRating?: number;
    readonly clickCount: number;
    readonly lastAccessed?: string;
}

/**
 * Highlighted text match with formatting information
 */
export interface HighlightedMatch {
    readonly line: number;
    readonly column: number;
    readonly text: string;
    readonly highlightedText: string;
    readonly context: string;
    readonly highlightedContext: string;
    readonly filePath?: string;
}

/**
 * Search result group for organizing results
 */
export interface SearchResultGroup {
    readonly groupKey: string;
    readonly groupName: string;
    readonly groupType: 'project' | 'resourceType' | 'category' | 'custom';
    readonly results: readonly EnhancedSearchResult[];
    readonly totalCount: number;
    readonly expanded: boolean;
}

/**
 * Search result export format
 */
export interface SearchResultExport {
    readonly searchQuery: string;
    readonly searchTime: string;
    readonly resultCount: number;
    readonly results: readonly {
        readonly resourcePath: string;
        readonly projectId: string;
        readonly resourceType: string;
        readonly displayName: string;
        readonly score: number;
        readonly matches: readonly ResourceSearchMatch[];
    }[];
    readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Result interaction tracking
 */
interface ResultInteraction {
    readonly resultId: string;
    readonly searchId: string;
    readonly action: 'click' | 'open' | 'preview' | 'rate' | 'bookmark';
    readonly timestamp: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Comprehensive search result management service
 */
export class SearchResultService implements IServiceLifecycle {
    private static readonly MAX_PREVIEW_LENGTH = 200;
    private static readonly HIGHLIGHT_START_MARKER = '[[HIGHLIGHT]]';
    private static readonly HIGHLIGHT_END_MARKER = '[[/HIGHLIGHT]]';

    private searchResults = new Map<string, EnhancedSearchResult[]>();
    private resultInteractions: ResultInteraction[] = [];
    private resultClickCounts = new Map<string, number>();
    private isInitialized = false;
    private interactionFilePath: string | null = null;

    private readonly resultSelectedEmitter = new vscode.EventEmitter<{
        result: EnhancedSearchResult;
        searchId: string;
        action: string;
    }>();
    public readonly onResultSelected = this.resultSelectedEmitter.event;

    private readonly resultGroupChangedEmitter = new vscode.EventEmitter<{
        searchId: string;
        groups: readonly SearchResultGroup[];
    }>();
    public readonly onResultGroupChanged = this.resultGroupChangedEmitter.event;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    async initialize(): Promise<void> {
        await this.setupInteractionStorage();
        await this.loadInteractionHistory();
        this.isInitialized = true;
        // console.log('SearchResultService initialized');
    }

    async start(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        if (!this.isInitialized) {
            throw new FlintError('SearchResultService must be initialized before starting', 'SERVICE_NOT_INITIALIZED');
        }
        // console.log('SearchResultService started');
    }

    async stop(): Promise<void> {
        await this.saveInteractionHistory();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.searchResults.clear();
        this.resultInteractions = [];
        this.resultClickCounts.clear();
        this.resultSelectedEmitter.dispose();
        this.resultGroupChangedEmitter.dispose();
        this.isInitialized = false;
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Processes and enhances raw search results
     */
    processSearchResults(
        searchId: string,
        query: string,
        rawResults: ResourceSearchResult[]
    ): Promise<EnhancedSearchResult[]> {
        const enhancedResults: EnhancedSearchResult[] = [];

        for (let i = 0; i < rawResults.length; i++) {
            const rawResult = rawResults[i];
            const _resultId = `${searchId}-${i}`;

            // Get historical interaction data
            const clickCount = this.resultClickCounts.get(rawResult.resourcePath) ?? 0;
            const lastAccessed = this.getLastAccessTime(rawResult.resourcePath);

            // Create enhanced result
            const enhancedResult: EnhancedSearchResult = {
                ...rawResult,
                searchId,
                rank: i + 1,
                highlightedDisplayName: this.highlightText(rawResult.displayName, query),
                highlightedMatches: this.enhanceMatches(rawResult.matches ?? [], query),
                previewText: this.generatePreviewText(rawResult),
                relevanceFactors: this.calculateRelevanceFactors(rawResult, query),
                clickCount,
                lastAccessed
            };

            enhancedResults.push(enhancedResult);
        }

        // Store results for future reference
        this.searchResults.set(searchId, enhancedResults);

        console.log(`Processed ${enhancedResults.length} search results for query: "${query}"`);

        return Promise.resolve(enhancedResults);
    }

    /**
     * Groups search results by various criteria
     */
    groupSearchResults(
        searchId: string,
        groupBy: 'project' | 'resourceType' | 'category' | 'none' = 'none'
    ): SearchResultGroup[] {
        const results = this.searchResults.get(searchId);
        if (!results) {
            return [];
        }

        if (groupBy === 'none') {
            return [
                {
                    groupKey: 'all',
                    groupName: 'All Results',
                    groupType: 'custom',
                    results,
                    totalCount: results.length,
                    expanded: true
                }
            ];
        }

        const groups = new Map<string, EnhancedSearchResult[]>();

        for (const result of results) {
            let groupKey: string;
            let _groupName: string;

            switch (groupBy) {
                case 'project':
                    groupKey = result.projectId;
                    _groupName = result.projectId;
                    break;
                case 'resourceType':
                    groupKey = result.resourceType;
                    _groupName = this.formatResourceTypeName(result.resourceType);
                    break;
                case 'category':
                    groupKey = (result.metadata?.category as string) ?? 'other';
                    _groupName = this.formatCategoryName(groupKey);
                    break;
                default:
                    groupKey = 'all';
                    _groupName = 'All Results';
                    break;
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(result);
        }

        // Convert to result groups
        const resultGroups: SearchResultGroup[] = Array.from(groups.entries()).map(([groupKey, groupResults]) => ({
            groupKey,
            groupName: groups.get(groupKey) ? this.getGroupDisplayName(groupKey, groupBy) : groupKey,
            groupType: groupBy,
            results: Object.freeze(groupResults),
            totalCount: groupResults.length,
            expanded: true
        }));

        // Sort groups by result count (descending)
        resultGroups.sort((a, b) => b.totalCount - a.totalCount);

        this.resultGroupChangedEmitter.fire({
            searchId,
            groups: Object.freeze(resultGroups)
        });

        return resultGroups;
    }

    /**
     * Records a user interaction with a search result
     */
    recordResultInteraction(
        searchId: string,
        result: EnhancedSearchResult,
        action: 'click' | 'open' | 'preview' | 'rate' | 'bookmark',
        metadata?: Record<string, unknown>
    ): void {
        const interaction: ResultInteraction = {
            resultId: `${result.projectId}:${result.resourcePath}`,
            searchId,
            action,
            timestamp: new Date().toISOString(),
            metadata: metadata ? Object.freeze(metadata) : undefined
        };

        this.resultInteractions.push(interaction);

        // Update click count
        if (action === 'click' || action === 'open') {
            const currentCount = this.resultClickCounts.get(result.resourcePath) ?? 0;
            this.resultClickCounts.set(result.resourcePath, currentCount + 1);
        }

        // Emit selection event
        this.resultSelectedEmitter.fire({
            result,
            searchId,
            action
        });

        // Debounced save
        setTimeout(() => this.saveInteractionHistory(), 5000);

        console.log(`Recorded result interaction: ${action} on ${result.resourcePath}`);
    }

    /**
     * Exports search results to various formats
     */
    async exportSearchResults(
        searchId: string,
        format: 'json' | 'csv' | 'html' = 'json',
        filePath?: string
    ): Promise<string> {
        const results = this.searchResults.get(searchId);
        if (!results) {
            throw new FlintError(`No search results found for search ID: ${searchId}`, 'SEARCH_RESULTS_NOT_FOUND');
        }

        const exportData: SearchResultExport = {
            searchQuery: 'Unknown', // Would be stored with search results
            searchTime: new Date().toISOString(),
            resultCount: results.length,
            results: results.map(result => ({
                resourcePath: result.resourcePath,
                projectId: result.projectId,
                resourceType: result.resourceType,
                displayName: result.displayName,
                score: result.score ?? 0,
                matches: result.matches ?? []
            })),
            metadata: {
                exportFormat: format,
                exportTime: new Date().toISOString(),
                searchId
            }
        };

        let exportContent: string;
        let defaultExtension: string;

        switch (format) {
            case 'json':
                exportContent = JSON.stringify(exportData, null, 2);
                defaultExtension = 'json';
                break;
            case 'csv':
                exportContent = this.exportToCsv(exportData);
                defaultExtension = 'csv';
                break;
            case 'html':
                exportContent = this.exportToHtml(exportData);
                defaultExtension = 'html';
                break;
            default:
                throw new FlintError(`Unsupported export format: ${String(format)}`, 'UNSUPPORTED_EXPORT_FORMAT');
        }

        // Save to file if path specified
        if (filePath) {
            await fs.writeFile(filePath, exportContent, 'utf8');
            console.log(`Exported search results to: ${filePath}`);
            return filePath;
        }

        // Generate default file path
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const defaultPath = path.join(process.cwd(), `search-results-${searchId}-${timestamp}.${defaultExtension}`);

        await fs.writeFile(defaultPath, exportContent, 'utf8');
        console.log(`Exported search results to: ${defaultPath}`);
        return defaultPath;
    }

    /**
     * Gets search result analytics and insights
     */
    getResultAnalytics(searchId?: string): {
        readonly totalResults: number;
        readonly averageScore: number;
        readonly resultsByType: Readonly<Record<string, number>>;
        readonly resultsByProject: Readonly<Record<string, number>>;
        readonly topInteractedResults: readonly { resourcePath: string; interactions: number }[];
        readonly interactionsByAction: Readonly<Record<string, number>>;
    } {
        let allResults: EnhancedSearchResult[] = [];

        if (searchId) {
            allResults = this.searchResults.get(searchId) ?? [];
        } else {
            for (const results of this.searchResults.values()) {
                allResults.push(...results);
            }
        }

        const resultsByType: Record<string, number> = {};
        const resultsByProject: Record<string, number> = {};
        let totalScore = 0;

        for (const result of allResults) {
            resultsByType[result.resourceType] = (resultsByType[result.resourceType] ?? 0) + 1;
            resultsByProject[result.projectId] = (resultsByProject[result.projectId] ?? 0) + 1;
            totalScore += result.score ?? 0;
        }

        const averageScore = allResults.length > 0 ? totalScore / allResults.length : 0;

        // Top interacted results
        const interactionCounts = new Map<string, number>();
        for (const interaction of this.resultInteractions) {
            const current = interactionCounts.get(interaction.resultId) ?? 0;
            interactionCounts.set(interaction.resultId, current + 1);
        }

        const topInteractedResults = Array.from(interactionCounts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([resourcePath, interactions]) => ({ resourcePath, interactions }));

        // Interactions by action
        const interactionsByAction: Record<string, number> = {};
        for (const interaction of this.resultInteractions) {
            interactionsByAction[interaction.action] = (interactionsByAction[interaction.action] ?? 0) + 1;
        }

        return Object.freeze({
            totalResults: allResults.length,
            averageScore: Math.round(averageScore * 1000) / 1000,
            resultsByType: Object.freeze(resultsByType),
            resultsByProject: Object.freeze(resultsByProject),
            topInteractedResults: Object.freeze(topInteractedResults),
            interactionsByAction: Object.freeze(interactionsByAction)
        });
    }

    /**
     * Clears search results and interaction history
     */
    async clearResults(searchId?: string): Promise<void> {
        if (searchId) {
            this.searchResults.delete(searchId);
            console.log(`Cleared results for search: ${searchId}`);
        } else {
            this.searchResults.clear();
            this.resultInteractions = [];
            this.resultClickCounts.clear();
            await this.saveInteractionHistory();
            console.log('Cleared all search results and interactions');
        }
    }

    /**
     * Highlights query terms in text
     */
    private highlightText(text: string, query: string): string {
        if (!query.trim()) {
            return text;
        }

        const queryTerms = query
            .toLowerCase()
            .split(/\s+/)
            .filter(term => term.length > 0);
        let highlightedText = text;

        for (const term of queryTerms) {
            const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');
            highlightedText = highlightedText.replace(
                regex,
                `${SearchResultService.HIGHLIGHT_START_MARKER}$1${SearchResultService.HIGHLIGHT_END_MARKER}`
            );
        }

        return highlightedText;
    }

    /**
     * Enhances search matches with highlighting
     */
    private enhanceMatches(matches: readonly ResourceSearchMatch[], query: string): HighlightedMatch[] {
        const enhanced: HighlightedMatch[] = [];

        for (const match of matches) {
            const highlightedMatch: HighlightedMatch = {
                line: match.line,
                column: match.column,
                text: match.text,
                highlightedText: this.highlightText(match.text, query),
                context: match.context ?? '',
                highlightedContext: this.highlightText(match.context ?? '', query),
                filePath: match.filePath
            };

            enhanced.push(highlightedMatch);
        }

        return enhanced;
    }

    /**
     * Generates preview text for a search result
     */
    private generatePreviewText(result: ResourceSearchResult): string | undefined {
        // Use first match context as preview, or generate from metadata
        if (result.matches && result.matches.length > 0) {
            const firstMatch = result.matches[0];
            if (firstMatch.context) {
                return firstMatch.context.length > SearchResultService.MAX_PREVIEW_LENGTH
                    ? `${firstMatch.context.substring(0, SearchResultService.MAX_PREVIEW_LENGTH)}...`
                    : firstMatch.context;
            }
        }

        // Generate preview from metadata or resource path
        const parts = [result.resourceType, result.resourcePath, JSON.stringify(result.metadata)].filter(
            part => part && part.length > 0
        );

        const preview = parts.join(' • ');
        return preview.length > SearchResultService.MAX_PREVIEW_LENGTH
            ? `${preview.substring(0, SearchResultService.MAX_PREVIEW_LENGTH)}...`
            : preview;
    }

    /**
     * Calculates relevance factors for a search result
     */
    private calculateRelevanceFactors(result: ResourceSearchResult, query: string): string[] {
        const factors: string[] = [];

        if (result.score && result.score > 0.8) {
            factors.push('High relevance score');
        }

        if (result.displayName.toLowerCase().includes(query.toLowerCase())) {
            factors.push('Name match');
        }

        if (result.matches && result.matches.length > 0) {
            factors.push(`${result.matches.length} content matches`);
        }

        if (result.resourcePath.toLowerCase().includes(query.toLowerCase())) {
            factors.push('Path match');
        }

        return factors;
    }

    /**
     * Gets the last access time for a resource
     */
    private getLastAccessTime(resourcePath: string): string | undefined {
        const interactions = this.resultInteractions
            .filter(interaction => interaction.resultId.includes(resourcePath))
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        return interactions.length > 0 ? interactions[0].timestamp : undefined;
    }

    /**
     * Formats resource type names for display
     */
    private formatResourceTypeName(resourceType: string): string {
        return resourceType
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Formats category names for display
     */
    private formatCategoryName(category: string): string {
        return category.charAt(0).toUpperCase() + category.slice(1);
    }

    /**
     * Gets display name for a result group
     */
    private getGroupDisplayName(groupKey: string, groupBy: string): string {
        switch (groupBy) {
            case 'resourceType':
                return this.formatResourceTypeName(groupKey);
            case 'category':
                return this.formatCategoryName(groupKey);
            default:
                return groupKey;
        }
    }

    /**
     * Escapes regex special characters
     */
    private escapeRegex(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Exports results to CSV format
     */
    private exportToCsv(exportData: SearchResultExport): string {
        const headers = ['Resource Path', 'Project ID', 'Resource Type', 'Display Name', 'Score', 'Matches'];
        const rows = exportData.results.map(result => [
            result.resourcePath,
            result.projectId,
            result.resourceType,
            result.displayName,
            result.score.toString(),
            result.matches.length.toString()
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        return csvContent;
    }

    /**
     * Exports results to HTML format
     */
    private exportToHtml(exportData: SearchResultExport): string {
        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Search Results - ${exportData.searchQuery}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { border-bottom: 2px solid #ccc; padding-bottom: 10px; margin-bottom: 20px; }
        .result { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .result-title { font-size: 18px; font-weight: bold; color: #333; }
        .result-path { color: #666; font-size: 14px; margin: 5px 0; }
        .result-score { color: #007acc; font-weight: bold; }
        .matches { margin-top: 10px; }
        .match { background: #f5f5f5; padding: 5px; margin: 3px 0; border-radius: 3px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Search Results</h1>
        <p>Query: <strong>${exportData.searchQuery}</strong></p>
        <p>Results: ${exportData.resultCount} • Exported: ${exportData.searchTime}</p>
    </div>
    <div class="results">
        ${exportData.results
            .map(
                result => `
            <div class="result">
                <div class="result-title">${result.displayName}</div>
                <div class="result-path">${result.projectId}/${result.resourcePath}</div>
                <div class="result-score">Score: ${result.score}</div>
                ${
                    result.matches.length > 0
                        ? `
                    <div class="matches">
                        <strong>Matches:</strong>
                        ${result.matches
                            .map(
                                match => `
                            <div class="match">Line ${match.line}: ${match.context ?? match.text}</div>
                        `
                            )
                            .join('')}
                    </div>
                `
                        : ''
                }
            </div>
        `
            )
            .join('')}
    </div>
</body>
</html>`;

        return html;
    }

    /**
     * Sets up interaction storage
     */
    private async setupInteractionStorage(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const flintDir = path.join(workspaceFolder.uri.fsPath, '.flint');
                await fs.mkdir(flintDir, { recursive: true });
                this.interactionFilePath = path.join(flintDir, 'result-interactions.json');
            }
        } catch (error) {
            console.warn('Failed to setup interaction storage:', error);
        }
    }

    /**
     * Loads interaction history from disk
     */
    private async loadInteractionHistory(): Promise<void> {
        if (!this.interactionFilePath) {
            return;
        }

        try {
            const content = await fs.readFile(this.interactionFilePath, 'utf8');
            const data = JSON.parse(content);

            if (Array.isArray(data.interactions)) {
                this.resultInteractions = data.interactions;
            }

            if (data.clickCounts && typeof data.clickCounts === 'object') {
                this.resultClickCounts = new Map(Object.entries(data.clickCounts));
            }

            console.log(`Loaded ${this.resultInteractions.length} result interactions`);
        } catch {
            // File doesn't exist or is invalid, start fresh
        }
    }

    /**
     * Saves interaction history to disk
     */
    private async saveInteractionHistory(): Promise<void> {
        if (!this.interactionFilePath) {
            return;
        }

        try {
            const data = {
                version: '1.0',
                lastUpdated: new Date().toISOString(),
                interactions: this.resultInteractions,
                clickCounts: Object.fromEntries(this.resultClickCounts)
            };

            await fs.writeFile(this.interactionFilePath, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            console.warn('Failed to save interaction history:', error);
        }
    }
}
