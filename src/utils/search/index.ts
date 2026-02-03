/**
 * @module SearchUtilities
 * @description Search utilities module exports
 * Enhanced search operations and result formatting
 */

export * from './SearchUtilities';
export * from './SearchResultFormatter';

// Re-export commonly used types
export type {
    SearchConfiguration,
    SearchQuery,
    SearchMatch,
    DetailedSearchResult,
    SearchStatistics,
    SearchProgressCallback
} from './SearchUtilities';

export type {
    DisplayFormatOptions,
    SearchQuickPickItem,
    GroupedResults,
    ExportOptions,
    HighlightInfo
} from './SearchResultFormatter';

// Export type aliases for convenience
export type {
    SearchConfiguration as SearchConfig,
    DetailedSearchResult as SearchResult,
    SearchStatistics as SearchStats
} from './SearchUtilities';

export type {
    DisplayFormatOptions as DisplayOptions,
    SearchQuickPickItem as QuickPickItem
} from './SearchResultFormatter';

// Export common format types
export type ExportFormat = 'json' | 'csv' | 'html' | 'markdown';
