/**
 * @module FindInResourcesCommand
 * @description Command to search for text content within resource files
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';
import { SearchHistoryService } from '@/services/search/SearchHistoryService';
import { SearchProviderService } from '@/services/search/SearchProviderService';

/**
 * Content search options
 */
interface ContentSearchOptions {
    readonly query: string;
    readonly projectId?: string;
    readonly typeId?: string;
    readonly categoryId?: string;
    readonly caseSensitive?: boolean;
    readonly wholeWord?: boolean;
    readonly useRegex?: boolean;
    readonly fileExtensions?: string[];
    readonly excludePatterns?: string[];
    readonly maxResults?: number;
}

/**
 * Content search result
 */
interface ContentSearchResult {
    readonly resourcePath: string;
    readonly resourceName: string;
    readonly resourceType: string;
    readonly projectId: string;
    readonly filePath: string;
    readonly matches: readonly {
        readonly line: number;
        readonly column: number;
        readonly text: string;
        readonly context: string;
    }[];
    readonly matchCount: number;
}

/**
 * Command to search for text content within resource files
 */
export class FindInResourcesCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.FIND_IN_RESOURCES, context);
    }

    protected validateArguments(query?: string, _options?: Partial<ContentSearchOptions>): CommandValidationResult {
        const warnings: string[] = [];

        if (!query) {
            warnings.push('Search query will be prompted from user');
        }

        return {
            isValid: true,
            errors: [],
            warnings
        };
    }

    protected async executeImpl(query?: string, options?: Partial<ContentSearchOptions>): Promise<void> {
        try {
            const searchHistory = this.getService<SearchHistoryService>('SearchHistoryService');
            const _searchProvider = this.getService<SearchProviderService>('SearchProviderService');
            const _gatewayManager = this.getService<GatewayManagerService>('GatewayManagerService');

            // Get search query from user if not provided
            let searchQuery = query;
            if (!searchQuery) {
                searchQuery = await this.promptForContentSearch();
                if (!searchQuery) return;
            }

            // Build search options with content search settings
            const searchOptions = this.buildContentSearchOptions(searchQuery, options);

            // Show search options configuration
            const confirmedOptions = await this.confirmSearchOptions(searchOptions);
            if (!confirmedOptions) return;

            // Perform content search with progress indication
            const searchResults = await this.executeWithProgress(
                async progress => {
                    progress?.(25, 'Preparing content search...');

                    // Add to search history for future reference
                    try {
                        await searchHistory.addToHistory({
                            query: searchQuery,
                            resultCount: 0,
                            executionTime: 0,
                            searchOptions: { type: 'content' }
                        });
                    } catch (error) {
                        console.warn('Failed to add search to history:', error);
                    }

                    progress?.(50, 'Searching file contents...');

                    // Execute content search
                    const results = await this.performContentSearch(confirmedOptions);

                    progress?.(100, 'Content search completed');

                    return results;
                },
                {
                    showProgress: true,
                    progressTitle: `Searching content for "${searchQuery}"...`,
                    timeoutMs: 60000 // Content search can take longer
                }
            );

            // Display search results
            await this.displayContentSearchResults(searchQuery, searchResults, confirmedOptions);
        } catch (error) {
            throw new FlintError(
                'Content search failed',
                'CONTENT_SEARCH_FAILED',
                'Unable to complete content search',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Prompts user for content search query with regex hints
     */
    private async promptForContentSearch(): Promise<string | undefined> {
        return vscode.window.showInputBox({
            placeHolder: 'Enter text to search for in resource files...',
            prompt: 'Search content within resource files (supports regex)',
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
     * Builds content search options
     */
    private buildContentSearchOptions(
        query: string,
        partialOptions?: Partial<ContentSearchOptions>
    ): ContentSearchOptions {
        const gatewayManager = this.getService<GatewayManagerService>('GatewayManagerService');
        const currentProject = partialOptions?.projectId ?? gatewayManager.getSelectedProject() ?? undefined;

        // Get default file extensions from provider registry instead of hardcoding
        const defaultExtensions = this.getSearchableExtensions();

        return {
            query: query.trim(),
            projectId: currentProject,
            typeId: partialOptions?.typeId,
            categoryId: partialOptions?.categoryId,
            caseSensitive: partialOptions?.caseSensitive ?? false,
            wholeWord: partialOptions?.wholeWord ?? false,
            useRegex: partialOptions?.useRegex ?? false,
            fileExtensions: partialOptions?.fileExtensions ?? defaultExtensions,
            excludePatterns: partialOptions?.excludePatterns ?? ['*.git*', '*.vscode*'],
            maxResults: partialOptions?.maxResults ?? 500
        };
    }

    /**
     * Shows confirmation dialog for search options
     */
    private async confirmSearchOptions(options: ContentSearchOptions): Promise<ContentSearchOptions | null> {
        const optionsText = [
            `Query: "${options.query}"`,
            `Project: ${options.projectId ?? 'All projects'}`,
            `Case Sensitive: ${options.caseSensitive ? 'Yes' : 'No'}`,
            `Whole Word: ${options.wholeWord ? 'Yes' : 'No'}`,
            `Use Regex: ${options.useRegex ? 'Yes' : 'No'}`,
            `File Extensions: ${options.fileExtensions?.join(', ') ?? 'All'}`,
            `Max Results: ${options.maxResults}`
        ].join('\n');

        const choice = await vscode.window.showInformationMessage(
            'Content Search Options',
            {
                detail: optionsText,
                modal: false
            },
            'Search',
            'Configure Options'
        );

        switch (choice) {
            case 'Search':
                return options;
            case 'Configure Options':
                return this.configureSearchOptions(options);
            default:
                return null;
        }
    }

    /**
     * Shows detailed search options configuration
     */
    private async configureSearchOptions(currentOptions: ContentSearchOptions): Promise<ContentSearchOptions | null> {
        const configItems = [
            {
                label: `Case Sensitive: ${currentOptions.caseSensitive ? 'On' : 'Off'}`,
                description: 'Toggle case sensitivity',
                option: 'caseSensitive'
            },
            {
                label: `Whole Word: ${currentOptions.wholeWord ? 'On' : 'Off'}`,
                description: 'Match whole words only',
                option: 'wholeWord'
            },
            {
                label: `Use Regex: ${currentOptions.useRegex ? 'On' : 'Off'}`,
                description: 'Enable regular expression matching',
                option: 'useRegex'
            },
            {
                label: 'Configure File Extensions',
                description: `Currently: ${currentOptions.fileExtensions?.join(', ')}`,
                option: 'fileExtensions'
            },
            {
                label: '$(search) Start Search',
                description: 'Begin searching with current options',
                option: 'search'
            }
        ];

        const selected = await vscode.window.showQuickPick(configItems, {
            placeHolder: 'Configure search options',
            title: 'Content Search Configuration'
        });

        if (!selected) return null;

        switch (selected.option) {
            case 'caseSensitive':
                return this.confirmSearchOptions({ ...currentOptions, caseSensitive: !currentOptions.caseSensitive });
            case 'wholeWord':
                return this.confirmSearchOptions({ ...currentOptions, wholeWord: !currentOptions.wholeWord });
            case 'useRegex':
                return this.confirmSearchOptions({ ...currentOptions, useRegex: !currentOptions.useRegex });
            case 'fileExtensions': {
                const extensions = await this.configureFileExtensions(currentOptions.fileExtensions ?? []);
                if (extensions !== null) {
                    return this.confirmSearchOptions({ ...currentOptions, fileExtensions: extensions });
                }
                return this.configureSearchOptions(currentOptions);
            }
            case 'search':
                return currentOptions;
            default:
                return null;
        }
    }

    /**
     * Configures file extensions for search
     */
    private async configureFileExtensions(current: string[]): Promise<string[] | null> {
        // Get available extensions from provider registry for placeholder
        const availableExtensions = this.getSearchableExtensions();
        const placeholderText = availableExtensions.slice(0, 4).join(', '); // Show first 4 as examples

        const extensionsText = await vscode.window.showInputBox({
            value: current.join(', '),
            placeHolder: placeholderText,
            prompt: 'Enter file extensions to search (comma-separated)',
            validateInput: value => {
                if (!value || value.trim().length === 0) {
                    return 'At least one file extension is required';
                }
                return null;
            }
        });

        if (!extensionsText) return null;

        return extensionsText
            .split(',')
            .map(ext => ext.trim())
            .filter(ext => ext.length > 0)
            .map(ext => (ext.startsWith('.') ? ext : `.${ext}`));
    }

    /**
     * Performs the actual content search
     */
    private async performContentSearch(options: ContentSearchOptions): Promise<ContentSearchResult[]> {
        const configService = this.getService<any>('WorkspaceConfigService');
        const results: ContentSearchResult[] = [];

        try {
            // Get project paths
            const projectPaths = await configService.getProjectPaths();

            // Filter paths if specific project is requested
            const targetPaths = options.projectId
                ? projectPaths.filter(
                      (p: string) => p.includes(options.projectId!) || path.basename(p) === options.projectId
                  )
                : projectPaths;

            // Search each project
            for (const projectPath of targetPaths) {
                try {
                    const projectName = path.basename(projectPath);
                    const projectResults = await this.searchProjectContent(projectPath, projectName, options);
                    results.push(...projectResults);

                    // Limit total results
                    if (results.length >= (options.maxResults ?? 500)) {
                        break;
                    }
                } catch (error) {
                    console.warn(`Failed to search project at ${projectPath}:`, error);
                }
            }

            return results.slice(0, options.maxResults ?? 500);
        } catch (error) {
            throw new FlintError(
                'Content search execution failed',
                'CONTENT_SEARCH_EXECUTION_FAILED',
                'Unable to search file contents',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Displays content search results
     */
    private async displayContentSearchResults(
        query: string,
        results: ContentSearchResult[],
        options: ContentSearchOptions
    ): Promise<void> {
        if (results.length === 0) {
            const choice = await vscode.window.showInformationMessage(
                `No content matches found for "${query}"`,
                'Modify Search',
                'Search All Projects'
            );

            switch (choice) {
                case 'Modify Search':
                    await vscode.commands.executeCommand(COMMANDS.FIND_IN_RESOURCES);
                    break;
                case 'Search All Projects':
                    await vscode.commands.executeCommand(COMMANDS.FIND_IN_RESOURCES, query, {
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

        const totalMatches = results.reduce((sum, result) => sum + result.matchCount, 0);

        // Create grouped results by resource
        const resultItems = results.slice(0, 50).map(result => ({
            label: `$(file) ${result.resourceName}`,
            description: `${result.matchCount} match${result.matchCount > 1 ? 'es' : ''} • ${result.resourceType}`,
            detail: result.resourcePath,
            result
        }));

        if (results.length > 50) {
            resultItems.push({
                label: `$(list-flat) Show all ${results.length} resources...`,
                description: `${totalMatches} total matches`,
                detail: 'View complete search results',
                result: null as any
            });
        }

        const selected = await vscode.window.showQuickPick(resultItems, {
            placeHolder: `Found "${query}" in ${results.length} resource${results.length > 1 ? 's' : ''} (${totalMatches} matches)`,
            title: 'Content Search Results'
        });

        if (!selected) return;

        if (!selected.result) {
            await this.showDetailedContentResults(query, results, options);
        } else {
            await this.showResourceMatches(selected.result);
        }
    }

    /**
     * Shows detailed content search results in a document
     */
    private async showDetailedContentResults(
        query: string,
        results: ContentSearchResult[],
        options: ContentSearchOptions
    ): Promise<void> {
        const totalMatches = results.reduce((sum, result) => sum + result.matchCount, 0);

        const resultText = [
            `Content Search Results for "${query}"`,
            `Project: ${options.projectId ?? 'All projects'}`,
            `Found ${totalMatches} match${totalMatches > 1 ? 'es' : ''} in ${results.length} resource${results.length > 1 ? 's' : ''}`,
            `Options: Case=${options.caseSensitive}, Whole Word=${options.wholeWord}, Regex=${options.useRegex}`,
            '',
            ...results
                .flatMap(result => [
                    `${result.resourceName} (${result.matchCount} match${result.matchCount > 1 ? 'es' : ''})`,
                    `  Path: ${result.resourcePath}`,
                    `  Type: ${result.resourceType}`,
                    ...result.matches.slice(0, 3).map(match => `    Line ${match.line}: ${match.context.trim()}`),
                    result.matches.length > 3 ? `    ... and ${result.matches.length - 3} more matches` : '',
                    ''
                ])
                .filter(line => line !== '')
        ].join('\n');

        const document = await vscode.workspace.openTextDocument({
            content: resultText,
            language: 'plaintext'
        });

        await vscode.window.showTextDocument(document);
    }

    /**
     * Shows matches within a specific resource
     */
    private async showResourceMatches(result: ContentSearchResult): Promise<void> {
        const matchItems = result.matches.map((match, _index) => ({
            label: `Line ${match.line}: ${match.text.trim()}`,
            description: `Column ${match.column}`,
            detail: match.context.trim(),
            match
        }));

        const selectedMatch = await vscode.window.showQuickPick(matchItems, {
            placeHolder: `${result.matchCount} match${result.matchCount > 1 ? 'es' : ''} in ${result.resourceName}`,
            title: 'Content Matches'
        });

        if (selectedMatch) {
            // Open file and navigate to the specific line/column
            try {
                const uri = vscode.Uri.file(result.filePath);
                const document = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(document);

                // Navigate to the specific line and column
                const position = new vscode.Position(selectedMatch.match.line - 1, selectedMatch.match.column - 1);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            } catch (error) {
                console.warn('Failed to open file and navigate to match:', error);
                await vscode.window.showWarningMessage(`Failed to open ${result.resourceName}`);
            }
        }
    }

    /**
     * Searches content within a specific project directory
     */
    private async searchProjectContent(
        projectPath: string,
        projectName: string,
        options: ContentSearchOptions
    ): Promise<ContentSearchResult[]> {
        const results: ContentSearchResult[] = [];

        try {
            // Recursively search all resource directories
            await this.searchDirectoryContent(projectPath, projectPath, projectName, options, results);
        } catch (error) {
            console.warn(`Failed to search content in project '${projectName}':`, error);
        }

        return results;
    }

    /**
     * Recursively searches content in a directory
     */
    private async searchDirectoryContent(
        basePath: string,
        currentPath: string,
        projectName: string,
        options: ContentSearchOptions,
        results: ContentSearchResult[]
    ): Promise<void> {
        try {
            const items = await fs.readdir(currentPath);

            for (const item of items) {
                const itemPath = path.join(currentPath, item);
                const stat = await fs.stat(itemPath);

                if (stat.isDirectory()) {
                    // Skip excluded patterns
                    const relativePath = path.relative(basePath, itemPath);
                    if (this.shouldExcludePath(relativePath, options.excludePatterns)) {
                        continue;
                    }

                    // Recurse into subdirectory
                    await this.searchDirectoryContent(basePath, itemPath, projectName, options, results);
                } else if (stat.isFile()) {
                    // Check if file matches extension filter
                    if (this.shouldSearchFile(item, options.fileExtensions)) {
                        const fileResults = await this.searchFileContent(basePath, itemPath, projectName, options);
                        if (fileResults && fileResults.matches.length > 0) {
                            results.push(fileResults);
                        }
                    }
                }

                // Limit results to prevent excessive memory usage
                if (results.length >= (options.maxResults ?? 500)) {
                    break;
                }
            }
        } catch (error) {
            console.warn(`Failed to search directory ${currentPath}:`, error);
        }
    }

    /**
     * Searches content within a specific file
     */
    private async searchFileContent(
        basePath: string,
        filePath: string,
        projectName: string,
        options: ContentSearchOptions
    ): Promise<ContentSearchResult | null> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\\n');
            const matches: any[] = [];

            // Create search pattern
            let pattern: RegExp;
            if (options.useRegex) {
                const flags = options.caseSensitive ? 'g' : 'gi';
                pattern = new RegExp(options.query, flags);
            } else {
                const escapedQuery = options.query.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
                const wordBoundary = options.wholeWord ? '\\\\b' : '';
                const flags = options.caseSensitive ? 'g' : 'gi';
                pattern = new RegExp(`${wordBoundary}${escapedQuery}${wordBoundary}`, flags);
            }

            // Search each line
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                let match;
                pattern.lastIndex = 0; // Reset regex state

                while ((match = pattern.exec(line)) !== null) {
                    const contextStart = Math.max(0, i - 1);
                    const contextEnd = Math.min(lines.length - 1, i + 1);
                    const context = lines.slice(contextStart, contextEnd + 1).join('\\n');

                    matches.push({
                        line: i + 1,
                        column: match.index + 1,
                        text: match[0],
                        context
                    });

                    // Prevent infinite loop with zero-width matches
                    if (match.index === pattern.lastIndex) {
                        pattern.lastIndex++;
                    }
                }
            }

            if (matches.length > 0) {
                const relativePath = path.relative(basePath, path.dirname(filePath));
                const resourceName = this.extractResourceName(relativePath);
                const resourceType = this.inferResourceType(filePath);

                return {
                    resourcePath: relativePath,
                    resourceName: resourceName ?? path.basename(path.dirname(filePath)),
                    resourceType,
                    projectId: projectName,
                    filePath,
                    matches,
                    matchCount: matches.length
                };
            }
        } catch (error) {
            // Skip files that can't be read as text
            if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
                console.warn(`Failed to search file ${filePath}:`, error);
            }
        }

        return null;
    }

    /**
     * Checks if a path should be excluded from search
     */
    private shouldExcludePath(relativePath: string, excludePatterns?: string[]): boolean {
        if (!excludePatterns || excludePatterns.length === 0) return false;

        return excludePatterns.some(pattern => {
            // Simple glob-like pattern matching
            const regex = new RegExp(pattern.replace(/\\*/g, '.*').replace(/\\?/g, '.'));
            return regex.test(relativePath);
        });
    }

    /**
     * Checks if a file should be searched based on extension filters
     */
    private shouldSearchFile(filename: string, extensions?: string[]): boolean {
        if (!extensions || extensions.length === 0) return true;

        const fileExtension = path.extname(filename).toLowerCase();
        return extensions.some(ext => ext.toLowerCase() === fileExtension);
    }

    /**
     * Extracts a meaningful resource name from a path
     */
    private extractResourceName(relativePath: string): string {
        const pathParts = relativePath.split(path.sep);

        // Try to find the resource name (usually the last meaningful directory)
        for (let i = pathParts.length - 1; i >= 0; i--) {
            const part = pathParts[i];
            if (part && !part.startsWith('.')) {
                return part;
            }
        }

        return pathParts[pathParts.length - 1] || 'Unknown Resource';
    }

    /**
     * Determines resource type from file path using ResourceTypeProviderRegistry
     */
    private inferResourceType(filePath: string): string {
        try {
            const providerRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (!providerRegistry) {
                console.warn(`ResourceTypeProviderRegistry unavailable, cannot determine type for: ${filePath}`);
                return 'unknown-resource-type';
            }

            const allProviders = providerRegistry.getAllProviders();
            const fileExtension = path.extname(filePath).toLowerCase();

            // Find providers that support this file extension
            for (const provider of allProviders) {
                const searchConfig = provider.getSearchConfig();

                if (searchConfig.searchableExtensions.includes(fileExtension)) {
                    // Use provider's directory paths to validate if file is in correct location
                    if (searchConfig.directoryPaths && searchConfig.directoryPaths.length > 0) {
                        const pathLower = filePath.toLowerCase();

                        // Check if file path contains any of the provider's directory paths
                        const matchesDirectory = searchConfig.directoryPaths.some(dirPath =>
                            pathLower.includes(dirPath.toLowerCase())
                        );

                        if (matchesDirectory) {
                            return provider.resourceTypeId;
                        }
                    } else {
                        // If no directory restrictions, extension match is sufficient
                        return provider.resourceTypeId;
                    }
                }
            }

            console.warn(`No provider found for file type ${fileExtension} at path: ${filePath}`);
            return 'unknown-resource-type';
        } catch (error) {
            console.error(`Failed to determine resource type from provider registry for ${filePath}:`, error);
            return 'unknown-resource-type';
        }
    }

    /**
     * Gets all searchable file extensions from registered providers
     */
    private getSearchableExtensions(): string[] {
        try {
            const providerRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (!providerRegistry) {
                console.warn('ResourceTypeProviderRegistry unavailable, using basic default extensions');
                return ['.json', '.txt', '.md']; // Basic fallback
            }

            const allProviders = providerRegistry.getAllProviders();
            const extensionSet = new Set<string>();

            // Collect all searchable extensions from all providers
            allProviders.forEach(provider => {
                const searchConfig = provider.getSearchConfig();
                searchConfig.searchableExtensions.forEach(ext => extensionSet.add(ext));
            });

            // Convert to array and sort for consistency
            const extensions = Array.from(extensionSet).sort();

            // Add common text extensions if none found
            if (extensions.length === 0) {
                console.warn('No searchable extensions found from providers, using defaults');
                return ['.json', '.txt', '.md'];
            }

            return extensions;
        } catch (error) {
            console.warn('Failed to get searchable extensions from provider registry:', error);
            return ['.json', '.txt', '.md']; // Basic fallback
        }
    }
}
