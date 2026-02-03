/**
 * @module SearchResultFormatter
 * @description Advanced search result processing and display formatting
 * Enhanced result presentation with multiple output formats
 */

import * as vscode from 'vscode';

import { DetailedSearchResult, SearchMatch, SearchStatistics } from './SearchUtilities';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';

/**
 * Display format options
 */
export interface DisplayFormatOptions {
    readonly format: 'quickPick' | 'tree' | 'table' | 'json' | 'csv';
    readonly showLineNumbers: boolean;
    readonly showContext: boolean;
    readonly maxContextLength: number;
    readonly groupBy: 'type' | 'project' | 'none';
    readonly sortBy: 'relevance' | 'name' | 'type' | 'project';
    readonly highlightMatches: boolean;
    readonly includeStatistics: boolean;
}

/**
 * Quick pick item with search result data
 */
export interface SearchQuickPickItem extends vscode.QuickPickItem {
    readonly result: DetailedSearchResult;
    readonly matchIndex?: number;
    readonly isHeader?: boolean;
    readonly isStatistic?: boolean;
}

/**
 * Grouped search results
 */
export interface GroupedResults {
    readonly groups: ReadonlyMap<string, readonly DetailedSearchResult[]>;
    readonly totalResults: number;
    readonly groupNames: readonly string[];
}

/**
 * Export options for search results
 */
export interface ExportOptions {
    readonly format: 'json' | 'csv' | 'html' | 'markdown';
    readonly includeMetadata: boolean;
    readonly includeMatches: boolean;
    readonly includeStatistics: boolean;
    readonly filename?: string;
}

/**
 * Result highlighting information
 */
export interface HighlightInfo {
    readonly text: string;
    readonly highlights: {
        readonly start: number;
        readonly end: number;
        readonly className: string;
    }[];
}

/**
 * Advanced search result formatter with multiple output formats
 * Handles result grouping, highlighting, and export functionality
 */
export class SearchResultFormatter implements IServiceLifecycle {
    private static readonly DEFAULT_OPTIONS: DisplayFormatOptions = {
        format: 'quickPick',
        showLineNumbers: true,
        showContext: true,
        maxContextLength: 100,
        groupBy: 'type',
        sortBy: 'relevance',
        highlightMatches: true,
        includeStatistics: true
    };

    private isInitialized = false;
    private defaultOptions: DisplayFormatOptions;

    constructor(
        private readonly serviceContainer?: ServiceContainer,
        options?: Partial<DisplayFormatOptions>
    ) {
        this.defaultOptions = { ...SearchResultFormatter.DEFAULT_OPTIONS, ...options };
    }

    async initialize(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        try {
            this.loadConfiguration();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize search result formatter',
                'SEARCH_FORMATTER_INIT_FAILED',
                'Search result formatter could not start properly',
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
        // Nothing to stop
    }

    async dispose(): Promise<void> {
        // Nothing to dispose
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    // ============================================================================
    // RESULT FORMATTING
    // ============================================================================

    /**
     * Formats search results for VS Code QuickPick
     */
    formatForQuickPick(
        results: readonly DetailedSearchResult[],
        statistics: SearchStatistics,
        query: string,
        options?: Partial<DisplayFormatOptions>
    ): readonly SearchQuickPickItem[] {
        const opts = { ...this.defaultOptions, ...options };
        const items: SearchQuickPickItem[] = [];

        // Add statistics header if requested
        if (opts.includeStatistics && results.length > 0) {
            items.push(this.createStatisticsItem(statistics, query));
        }

        // Group results if requested
        if (opts.groupBy !== 'none') {
            const grouped = this.groupResults(results, opts.groupBy);
            return this.formatGroupedQuickPick(grouped, opts, items);
        }

        // Add results directly
        const sortedResults = this.sortResults(results, opts.sortBy);
        for (const result of sortedResults) {
            items.push(...this.createQuickPickItems(result, opts));
        }

        return items;
    }

    /**
     * Formats results as tree view data
     */
    formatAsTreeData(
        results: readonly DetailedSearchResult[],
        options?: Partial<DisplayFormatOptions>
    ): readonly vscode.TreeItem[] {
        const opts = { ...this.defaultOptions, ...options };
        const treeItems: vscode.TreeItem[] = [];

        const grouped = this.groupResults(results, opts.groupBy);

        for (const [groupName, groupResults] of grouped.groups) {
            // Group header
            const groupItem = new vscode.TreeItem(
                `${groupName} (${groupResults.length})`,
                vscode.TreeItemCollapsibleState.Expanded
            );
            groupItem.contextValue = 'searchGroup';
            treeItems.push(groupItem);

            // Group items
            for (const result of groupResults) {
                const resultItem = new vscode.TreeItem(
                    result.displayName,
                    result.matches.length > 1
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None
                );

                resultItem.description = this.formatResultDescription(result, opts);
                resultItem.tooltip = this.formatResultTooltip(result);
                resultItem.iconPath = new vscode.ThemeIcon(this.getTypeIcon(result.resourceType));
                resultItem.contextValue = 'searchResult';

                treeItems.push(resultItem);

                // Add match items if multiple matches
                if (result.matches.length > 1) {
                    for (let i = 0; i < result.matches.length; i++) {
                        const match = result.matches[i];
                        const matchItem = new vscode.TreeItem(
                            this.formatMatchLabel(match, opts),
                            vscode.TreeItemCollapsibleState.None
                        );
                        matchItem.description = opts.showContext ? match.context : undefined;
                        matchItem.contextValue = 'searchMatch';
                        treeItems.push(matchItem);
                    }
                }
            }
        }

        return treeItems;
    }

    /**
     * Formats results as markdown text
     */
    formatAsMarkdown(
        results: readonly DetailedSearchResult[],
        statistics: SearchStatistics,
        query: string,
        options?: Partial<DisplayFormatOptions>
    ): string {
        const opts = { ...this.defaultOptions, ...options };
        const parts: string[] = [];

        // Title
        parts.push(`# Search Results for "${query}"\n`);

        // Statistics
        if (opts.includeStatistics) {
            parts.push(this.formatStatisticsAsMarkdown(statistics));
            parts.push('');
        }

        // Results
        const grouped = this.groupResults(results, opts.groupBy);
        for (const [groupName, groupResults] of grouped.groups) {
            parts.push(`## ${groupName} (${groupResults.length} results)\n`);

            for (const result of groupResults) {
                parts.push(`### ${result.displayName}`);
                parts.push(`**Path:** ${result.resourcePath}`);
                parts.push(`**Type:** ${result.resourceType}`);
                parts.push(`**Project:** ${result.projectId}`);

                if (result.matches.length > 0) {
                    parts.push(`**Matches:** ${result.matches.length}`);

                    if (opts.showContext) {
                        parts.push('\n**Match Details:**');
                        for (const match of result.matches.slice(0, 3)) {
                            // Limit to 3 matches
                            const context =
                                opts.showContext && match.context
                                    ? match.context.slice(0, opts.maxContextLength)
                                    : match.text.slice(0, opts.maxContextLength);

                            parts.push(`- Line ${match.line}: \`${context}\``);
                        }

                        if (result.matches.length > 3) {
                            parts.push(`- ... and ${result.matches.length - 3} more matches`);
                        }
                    }
                }

                parts.push(''); // Empty line between results
            }
        }

        return parts.join('\n');
    }

    /**
     * Exports results to various formats
     */
    exportResults(
        results: readonly DetailedSearchResult[],
        statistics: SearchStatistics,
        query: string,
        options: ExportOptions
    ): string {
        switch (options.format) {
            case 'json':
                return this.exportAsJson(results, statistics, query, options);

            case 'csv':
                return this.exportAsCsv(results, options);

            case 'html':
                return this.exportAsHtml(results, statistics, query, options);

            case 'markdown':
                return this.formatAsMarkdown(results, statistics, query);

            default:
                throw new FlintError(
                    `Unsupported export format: ${String(options.format)}`,
                    'UNSUPPORTED_EXPORT_FORMAT'
                );
        }
    }

    // ============================================================================
    // RESULT PROCESSING
    // ============================================================================

    /**
     * Groups results by specified criteria
     */
    groupResults(results: readonly DetailedSearchResult[], groupBy: 'type' | 'project' | 'none'): GroupedResults {
        if (groupBy === 'none') {
            return {
                groups: new Map([['All Results', results]]),
                totalResults: results.length,
                groupNames: ['All Results']
            };
        }

        const groups = new Map<string, DetailedSearchResult[]>();

        for (const result of results) {
            const key = groupBy === 'type' ? this.getTypeDisplayName(result.resourceType) : result.projectId;

            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(result);
        }

        // Sort groups by name
        const sortedGroups = new Map(Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)));

        return {
            groups: sortedGroups,
            totalResults: results.length,
            groupNames: Array.from(sortedGroups.keys())
        };
    }

    /**
     * Sorts results by specified criteria
     */
    sortResults(
        results: readonly DetailedSearchResult[],
        sortBy: 'relevance' | 'name' | 'type' | 'project'
    ): readonly DetailedSearchResult[] {
        return [...results].sort((a, b) => {
            switch (sortBy) {
                case 'relevance':
                    return b.score - a.score;

                case 'name':
                    return a.displayName.localeCompare(b.displayName);

                case 'type': {
                    const typeCompare = a.resourceType.localeCompare(b.resourceType);
                    return typeCompare !== 0 ? typeCompare : a.displayName.localeCompare(b.displayName);
                }
                case 'project': {
                    const projectCompare = a.projectId.localeCompare(b.projectId);
                    return projectCompare !== 0 ? projectCompare : a.displayName.localeCompare(b.displayName);
                }

                default:
                    return 0;
            }
        });
    }

    /**
     * Highlights matches within text
     */
    highlightMatches(
        text: string,
        matches: readonly SearchMatch[],
        highlightClass: string = 'search-highlight'
    ): HighlightInfo {
        const highlights: HighlightInfo['highlights'] = [];

        for (const match of matches) {
            highlights.push({
                start: match.highlightStart,
                end: match.highlightEnd,
                className: highlightClass
            });
        }

        // Sort highlights by position
        highlights.sort((a: { start: number }, b: { start: number }) => a.start - b.start);

        return {
            text,
            highlights
        };
    }

    /**
     * Truncates text with ellipsis
     */
    truncateText(text: string, maxLength: number, ellipsis: string = '...'): string {
        if (text.length <= maxLength) {
            return text;
        }

        return text.slice(0, maxLength - ellipsis.length) + ellipsis;
    }

    // ============================================================================
    // PRIVATE FORMATTING METHODS
    // ============================================================================

    /**
     * Creates statistics quick pick item
     */
    private createStatisticsItem(statistics: SearchStatistics, query: string): SearchQuickPickItem {
        const searchTime =
            statistics.searchTime < 1000
                ? `${statistics.searchTime}ms`
                : `${(statistics.searchTime / 1000).toFixed(1)}s`;

        return {
            label: `$(search) Search Results for "${query}"`,
            description: `${statistics.totalMatches} matches in ${statistics.filesSearched} files (${searchTime})`,
            kind: vscode.QuickPickItemKind.Separator,
            result: {} as DetailedSearchResult,
            isStatistic: true
        };
    }

    /**
     * Formats grouped quick pick results
     */
    private formatGroupedQuickPick(
        grouped: GroupedResults,
        options: DisplayFormatOptions,
        items: SearchQuickPickItem[]
    ): SearchQuickPickItem[] {
        for (const [groupName, groupResults] of grouped.groups) {
            // Group header
            items.push({
                label: `${groupName} (${groupResults.length})`,
                kind: vscode.QuickPickItemKind.Separator,
                result: {} as DetailedSearchResult,
                isHeader: true
            });

            // Group items
            const sortedResults = this.sortResults(groupResults, options.sortBy);
            for (const result of sortedResults) {
                items.push(...this.createQuickPickItems(result, options));
            }
        }

        return items;
    }

    /**
     * Creates quick pick items for a result
     */
    private createQuickPickItems(result: DetailedSearchResult, options: DisplayFormatOptions): SearchQuickPickItem[] {
        const items: SearchQuickPickItem[] = [];
        const icon = this.getTypeIcon(result.resourceType);

        if (result.matches.length <= 1) {
            // Single item for results with 0 or 1 matches
            items.push({
                label: `$(${icon}) ${result.displayName}`,
                description: this.formatResultDescription(result, options),
                detail: this.formatResultDetail(result, options),
                result,
                matchIndex: result.matches.length > 0 ? 0 : undefined
            });
        } else {
            // Multiple items for results with multiple matches
            items.push({
                label: `$(${icon}) ${result.displayName}`,
                description: `${result.matches.length} matches • ${result.resourceType}`,
                detail: result.resourcePath,
                result,
                matchIndex: -1 // Indicates parent item
            });

            // Add individual match items (indented)
            for (let i = 0; i < Math.min(result.matches.length, 5); i++) {
                const match = result.matches[i];
                items.push({
                    label: `  $(arrow-right) ${this.formatMatchLabel(match, options)}`,
                    description: options.showContext ? this.truncateText(match.context || match.text, 50) : undefined,
                    detail: `Line ${match.line}, Column ${match.column}`,
                    result,
                    matchIndex: i
                });
            }

            if (result.matches.length > 5) {
                items.push({
                    label: `  $(ellipsis) ... and ${result.matches.length - 5} more matches`,
                    description: 'Click to see all matches',
                    result,
                    matchIndex: -2 // Indicates "more" item
                });
            }
        }

        return items;
    }

    /**
     * Formats result description
     */
    private formatResultDescription(result: DetailedSearchResult, _options: DisplayFormatOptions): string {
        const parts: string[] = [];

        if (result.matches.length > 0) {
            parts.push(`${result.matches.length} match${result.matches.length === 1 ? '' : 'es'}`);
        }

        parts.push(this.getTypeDisplayName(result.resourceType));

        if (result.projectId) {
            parts.push(`📁 ${result.projectId}`);
        }

        return parts.join(' • ');
    }

    /**
     * Formats result detail
     */
    private formatResultDetail(result: DetailedSearchResult, options: DisplayFormatOptions): string {
        if (result.matches.length > 0 && options.showContext) {
            const match = result.matches[0];
            const context = match.context || match.text;
            return this.truncateText(context, options.maxContextLength);
        }

        return result.resourcePath;
    }

    /**
     * Formats result tooltip
     */
    private formatResultTooltip(result: DetailedSearchResult): string {
        const parts: string[] = [];
        parts.push(`Path: ${result.resourcePath}`);
        parts.push(`Type: ${result.resourceType}`);
        parts.push(`Project: ${result.projectId}`);
        parts.push(`Score: ${result.score}`);

        if (result.matches.length > 0) {
            parts.push(`Matches: ${result.matches.length}`);
        }

        return parts.join('\n');
    }

    /**
     * Formats match label
     */
    private formatMatchLabel(match: SearchMatch, options: DisplayFormatOptions): string {
        if (options.showLineNumbers) {
            return `Line ${match.line}: ${this.truncateText(match.text, 80)}`;
        }

        return this.truncateText(match.text, 80);
    }

    /**
     * Formats statistics as markdown
     */
    private formatStatisticsAsMarkdown(statistics: SearchStatistics): string {
        const parts: string[] = [];

        parts.push('## Search Statistics');
        parts.push(`- **Total matches:** ${statistics.totalMatches}`);
        parts.push(`- **Files searched:** ${statistics.filesSearched}/${statistics.totalFiles}`);
        parts.push(`- **Search time:** ${statistics.searchTime}ms`);

        if (statistics.byResourceType.size > 0) {
            parts.push('\n### By Resource Type');
            for (const [type, count] of statistics.byResourceType) {
                parts.push(`- **${this.getTypeDisplayName(type)}:** ${count}`);
            }
        }

        if (statistics.byProject.size > 0) {
            parts.push('\n### By Project');
            for (const [project, count] of statistics.byProject) {
                parts.push(`- **${project}:** ${count}`);
            }
        }

        return parts.join('\n');
    }

    /**
     * Gets type icon name using ResourceTypeProviderRegistry
     */
    private getTypeIcon(resourceType: string): string {
        if (!this.serviceContainer) {
            console.warn(`SearchResultFormatter: ServiceContainer unavailable, using generic icon for ${resourceType}`);
            return 'file';
        }

        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

        if (!providerRegistry) {
            console.warn(
                `SearchResultFormatter: ResourceTypeProviderRegistry unavailable, using generic icon for ${resourceType}`
            );
            return 'file';
        }

        const provider = providerRegistry.getProvider(resourceType);
        if (!provider) {
            console.warn(
                `SearchResultFormatter: No provider found for resource type ${resourceType}, using generic icon`
            );
            return 'file';
        }

        // Try to get icon from provider's template config or use generic icon
        const templateConfig = provider.getTemplateConfig();

        // Check if provider has specific icon configuration in templates
        if (templateConfig.templates.length > 0) {
            const template = templateConfig.templates[0];
            if (template.files) {
                const fileNames = Object.keys(template.files);

                // Use more generic logic based on template file patterns
                if (fileNames.some(f => f.includes('view'))) {
                    return 'browser';
                }
                if (fileNames.some(f => f.includes('style'))) {
                    return 'symbol-color';
                }
                if (fileNames.some(f => f.includes('code'))) {
                    return 'file-code';
                }
                if (fileNames.some(f => f.includes('query') || f.includes('sql'))) {
                    return 'database';
                }
            }
        }

        // Fallback to generic file icon
        return 'file';
    }

    /**
     * Gets type display name using ResourceTypeProviderRegistry
     */
    private getTypeDisplayName(resourceType: string): string {
        try {
            // Get display name from ResourceTypeProviderRegistry
            if (this.serviceContainer) {
                const providerRegistry =
                    this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

                if (providerRegistry) {
                    const provider = providerRegistry.getProvider(resourceType);
                    if (provider) {
                        return provider.displayName;
                    }
                }
            }
        } catch (error) {
            console.warn(
                `SearchResultFormatter: Failed to get display name from provider registry for ${resourceType}, using fallback:`,
                error
            );
        }

        // No fallback - return the resource type as-is if provider registry is unavailable
        console.warn(
            `SearchResultFormatter: ResourceTypeProviderRegistry unavailable, using raw type name for ${resourceType}`
        );
        return resourceType;
    }

    /**
     * Exports results as JSON
     */
    private exportAsJson(
        results: readonly DetailedSearchResult[],
        statistics: SearchStatistics,
        query: string,
        options: ExportOptions
    ): string {
        const exportData: any = {
            query,
            timestamp: new Date().toISOString()
        };

        if (options.includeStatistics) {
            exportData.statistics = {
                totalMatches: statistics.totalMatches,
                filesSearched: statistics.filesSearched,
                searchTime: statistics.searchTime,
                byResourceType: Object.fromEntries(statistics.byResourceType),
                byProject: Object.fromEntries(statistics.byProject)
            };
        }

        exportData.results = results.map(result => ({
            resourcePath: result.resourcePath,
            resourceType: result.resourceType,
            projectId: result.projectId,
            displayName: result.displayName,
            score: result.score,
            matches: options.includeMatches ? result.matches : result.matches.length,
            metadata: options.includeMetadata ? result.metadata : undefined
        }));

        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Exports results as CSV
     */
    private exportAsCsv(results: readonly DetailedSearchResult[], options: ExportOptions): string {
        const headers = ['Resource Path', 'Resource Type', 'Project ID', 'Display Name', 'Score', 'Match Count'];

        if (options.includeMatches) {
            headers.push('Match Details');
        }

        const rows = [headers];

        for (const result of results) {
            const row = [
                result.resourcePath,
                result.resourceType,
                result.projectId,
                result.displayName,
                result.score.toString(),
                result.matches.length.toString()
            ];

            if (options.includeMatches) {
                const matchDetails = result.matches
                    .map(m => `Line ${m.line}: ${m.text.replace(/"/g, '""')}`)
                    .join('; ');
                row.push(matchDetails);
            }

            rows.push(row);
        }

        return rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    }

    /**
     * Exports results as HTML
     */
    private exportAsHtml(
        results: readonly DetailedSearchResult[],
        statistics: SearchStatistics,
        query: string,
        options: ExportOptions
    ): string {
        const html = [
            '<!DOCTYPE html>',
            '<html>',
            '<head>',
            '<title>Search Results</title>',
            '<style>',
            'body { font-family: Arial, sans-serif; margin: 20px; }',
            'table { border-collapse: collapse; width: 100%; }',
            'th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }',
            'th { background-color: #f2f2f2; }',
            '.highlight { background-color: yellow; }',
            '</style>',
            '</head>',
            '<body>',
            `<h1>Search Results for "${query}"</h1>`
        ];

        if (options.includeStatistics) {
            html.push('<h2>Statistics</h2>');
            html.push(`<p>Total matches: ${statistics.totalMatches}</p>`);
            html.push(`<p>Files searched: ${statistics.filesSearched}</p>`);
            html.push(`<p>Search time: ${statistics.searchTime}ms</p>`);
        }

        html.push('<h2>Results</h2>');
        html.push('<table>');
        html.push('<tr><th>Resource</th><th>Type</th><th>Project</th><th>Matches</th></tr>');

        for (const result of results) {
            html.push('<tr>');
            html.push(`<td>${result.resourcePath}</td>`);
            html.push(`<td>${result.resourceType}</td>`);
            html.push(`<td>${result.projectId}</td>`);
            html.push(`<td>${result.matches.length}</td>`);
            html.push('</tr>');
        }

        html.push('</table>');
        html.push('</body>');
        html.push('</html>');

        return html.join('\n');
    }

    /**
     * Loads configuration from workspace
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.search.display');
        this.defaultOptions = { ...this.defaultOptions, ...config };
    }

    /**
     * String representation for debugging
     */
    toString(): string {
        return `SearchResultFormatter(format: ${this.defaultOptions.format}, groupBy: ${this.defaultOptions.groupBy})`;
    }
}
