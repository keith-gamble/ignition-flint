/**
 * @module SearchServices
 * @description Entry point for all search-related services
 * Provides a centralized export for search functionality components
 */

// Search service implementations
export { SearchHistoryService } from './SearchHistoryService';
export { SearchProviderService } from './SearchProviderService';
export { SearchIndexService } from './SearchIndexService';
export { SearchResultService } from './SearchResultService';

// Type exports for search services
export type { SearchHistoryEntry, SearchSuggestion, SearchAnalytics } from './SearchHistoryService';

export type { AggregatedSearchResult } from './SearchProviderService';

export type { SearchIndexDocument, IndexStatistics, IndexQueryOptions, IndexQueryResult } from './SearchIndexService';

export type {
    EnhancedSearchResult,
    HighlightedMatch,
    SearchResultGroup,
    SearchResultExport
} from './SearchResultService';

// Import the services and service container to use in the factory
import { SearchHistoryService } from './SearchHistoryService';
import { SearchIndexService } from './SearchIndexService';
import { SearchProviderService } from './SearchProviderService';
import { SearchResultService } from './SearchResultService';

import { ServiceContainer } from '@/core/ServiceContainer';

/**
 * Factory function to create and configure search services
 */
export function createSearchServices(serviceContainer: ServiceContainer): {
    historyService: SearchHistoryService;
    indexService: SearchIndexService;
    providerService: SearchProviderService;
    resultService: SearchResultService;
} {
    return {
        historyService: new SearchHistoryService(serviceContainer),
        providerService: new SearchProviderService(serviceContainer),
        indexService: new SearchIndexService(serviceContainer),
        resultService: new SearchResultService(serviceContainer)
    };
}
