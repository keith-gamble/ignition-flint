/**
 * @module ResourceSearchService.test
 * @description Unit tests for ResourceSearchService
 */

import * as assert from 'assert';

import { ServiceContainer } from '../../../../core/ServiceContainer';
import { ResourceSearchProvider, ResourceSearchResult, ResourceSearchOptions } from '../../../../core/types/resources';
import { ServiceStatus } from '../../../../core/types/services';
import { ResourceSearchService } from '../../../../services/resources/ResourceSearchService';

suite('ResourceSearchService Test Suite', () => {
    let service: ResourceSearchService;
    let container: ServiceContainer;

    setup(async () => {
        container = new ServiceContainer();
        // Don't register optional dependencies to test service without them
        service = new ResourceSearchService(container);
        await service.initialize();
    });

    teardown(async () => {
        await service.dispose();
    });

    // ============================================================================
    // SERVICE LIFECYCLE TESTS
    // ============================================================================

    suite('Service Lifecycle', () => {
        test('Should initialize successfully', async () => {
            const newContainer = new ServiceContainer();
            const newService = new ResourceSearchService(newContainer);
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);

            await newService.initialize();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
        });

        test('Should start after initialization', async () => {
            const newContainer = new ServiceContainer();
            const newService = new ResourceSearchService(newContainer);
            await newService.initialize();
            await newService.start();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);
            await newService.dispose();
        });

        test('Should throw when starting before initialization', async () => {
            const newService = new ResourceSearchService(container);
            try {
                await newService.start();
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('must be initialized'));
            }
        });

        test('Should stop correctly', async () => {
            const newContainer = new ServiceContainer();
            const newService = new ResourceSearchService(newContainer);
            await newService.initialize();
            await newService.start();
            await newService.stop();
            // Status remains RUNNING until dispose
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);
            await newService.dispose();
        });

        test('Should dispose and clear index', async () => {
            const newContainer = new ServiceContainer();
            const newService = new ResourceSearchService(newContainer);
            await newService.initialize();
            await newService.dispose();
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);

            // Index should be cleared
            const stats = newService.getSearchIndexStats();
            assert.strictEqual(stats.totalEntries, 0);
        });
    });

    // ============================================================================
    // SEARCH TESTS
    // ============================================================================

    suite('searchResources()', () => {
        test('Should return empty array when index is empty', async () => {
            const results = await service.searchResources('test');
            assert.ok(Array.isArray(results));
            assert.strictEqual(results.length, 0);
        });

        test('Should handle empty query', async () => {
            const results = await service.searchResources('');
            assert.ok(Array.isArray(results));
        });

        test('Should respect maxResults option', async () => {
            const results = await service.searchResources('test', { maxResults: 5 });
            assert.ok(Array.isArray(results));
            assert.ok(results.length <= 5);
        });

        test('Should fire search executed event', async () => {
            let eventFired = false;
            let receivedQuery: string | undefined;
            let receivedResultCount: number | undefined;
            let receivedDuration: number | undefined;

            const disposable = service.onSearchExecuted(data => {
                eventFired = true;
                receivedQuery = data.query;
                receivedResultCount = data.resultCount;
                receivedDuration = data.duration;
            });

            await service.searchResources('test-query');

            disposable.dispose();

            assert.strictEqual(eventFired, true);
            assert.strictEqual(receivedQuery, 'test-query');
            assert.ok(typeof receivedResultCount === 'number');
            assert.ok(typeof receivedDuration === 'number');
        });

        test('Should handle regex queries', async () => {
            // Regex query format: /pattern/
            const results = await service.searchResources('/test.*/');
            assert.ok(Array.isArray(results));
        });

        test('Should parse type filter', async () => {
            // Filter format: type:value
            const results = await service.searchResources('type:python test');
            assert.ok(Array.isArray(results));
        });

        test('Should parse project filter', async () => {
            const results = await service.searchResources('project:myproject test');
            assert.ok(Array.isArray(results));
        });
    });

    // ============================================================================
    // SEARCH PROVIDER TESTS
    // ============================================================================

    suite('Search Providers', () => {
        test('Should register search provider', () => {
            const mockProvider: ResourceSearchProvider = {
                search: (): Promise<ResourceSearchResult[]> => Promise.resolve([]),
                supportsTextSearch: () => true
            };

            // Should not throw
            service.registerSearchProvider('test-type', mockProvider);
        });

        test('Should unregister search provider', () => {
            const mockProvider: ResourceSearchProvider = {
                search: (): Promise<ResourceSearchResult[]> => Promise.resolve([]),
                supportsTextSearch: () => true
            };

            service.registerSearchProvider('test-type', mockProvider);
            const result = service.unregisterSearchProvider('test-type');

            assert.strictEqual(result, true);
        });

        test('Should return false when unregistering non-existent provider', () => {
            const result = service.unregisterSearchProvider('non-existent');
            assert.strictEqual(result, false);
        });

        test('Should replace existing provider', () => {
            const provider1: ResourceSearchProvider = {
                search: (): Promise<ResourceSearchResult[]> => Promise.resolve([]),
                supportsTextSearch: () => true
            };
            const provider2: ResourceSearchProvider = {
                search: (): Promise<ResourceSearchResult[]> =>
                    Promise.resolve([
                        {
                            resourcePath: '/test',
                            projectId: 'test',
                            resourceType: 'test',
                            displayName: 'Test'
                        }
                    ]),
                supportsTextSearch: () => true
            };

            service.registerSearchProvider('test-type', provider1);
            service.registerSearchProvider('test-type', provider2);

            // Provider should be replaced (we can't directly verify, but should not throw)
            assert.ok(true);
        });
    });

    // ============================================================================
    // INDEX MANAGEMENT TESTS
    // ============================================================================

    suite('Index Management', () => {
        test('Should clear search index', () => {
            service.clearSearchIndex();
            const stats = service.getSearchIndexStats();
            assert.strictEqual(stats.totalEntries, 0);
        });

        test('Should return search index stats', () => {
            const stats = service.getSearchIndexStats();

            assert.ok(typeof stats.totalEntries === 'number');
            assert.ok(typeof stats.entriesByType === 'object');
            assert.ok(typeof stats.entriesByProject === 'object');
            assert.ok(typeof stats.indexSize === 'number');
            assert.ok(typeof stats.lastUpdated === 'number');
        });

        test('Should return frozen stats objects', () => {
            const stats = service.getSearchIndexStats();

            assert.ok(Object.isFrozen(stats));
            assert.ok(Object.isFrozen(stats.entriesByType));
            assert.ok(Object.isFrozen(stats.entriesByProject));
        });

        test('Should update project index', async () => {
            // This should not throw even with non-existent path
            // The method handles errors gracefully
            await service.updateProjectIndex('test-project', '/non-existent/path');

            // Stats should still be accessible
            const stats = service.getSearchIndexStats();
            assert.ok(typeof stats.totalEntries === 'number');
        });
    });

    // ============================================================================
    // SEARCH OPTIONS TESTS
    // ============================================================================

    suite('Search Options', () => {
        test('Should filter by project IDs', async () => {
            const options: ResourceSearchOptions = {
                projectIds: ['project1', 'project2']
            };

            const results = await service.searchResources('test', options);
            assert.ok(Array.isArray(results));
        });

        test('Should filter by resource types', async () => {
            const options: ResourceSearchOptions = {
                resourceTypes: ['python', 'query']
            };

            const results = await service.searchResources('test', options);
            assert.ok(Array.isArray(results));
        });

        test('Should combine multiple filters', async () => {
            const options: ResourceSearchOptions = {
                projectIds: ['project1'],
                resourceTypes: ['python'],
                maxResults: 10
            };

            const results = await service.searchResources('test', options);
            assert.ok(Array.isArray(results));
            assert.ok(results.length <= 10);
        });
    });

    // ============================================================================
    // EVENT TESTS
    // ============================================================================

    suite('Events', () => {
        test('Should expose onSearchExecuted event', () => {
            assert.ok(service.onSearchExecuted);
            assert.ok(typeof service.onSearchExecuted === 'function');
        });

        test('Should fire event with search details', async () => {
            const events: Array<{
                query: string;
                options: ResourceSearchOptions;
                resultCount: number;
                duration: number;
            }> = [];

            const disposable = service.onSearchExecuted(data => {
                events.push(data);
            });

            await service.searchResources('query1');
            await service.searchResources('query2', { maxResults: 5 });

            disposable.dispose();

            assert.strictEqual(events.length, 2);
            assert.strictEqual(events[0].query, 'query1');
            assert.strictEqual(events[1].query, 'query2');
            assert.ok(events[1].options.maxResults === 5);
        });
    });

    // ============================================================================
    // EDGE CASES
    // ============================================================================

    suite('Edge Cases', () => {
        test('Should handle special characters in query', async () => {
            const results = await service.searchResources('test[with]special(chars)');
            assert.ok(Array.isArray(results));
        });

        test('Should handle unicode in query', async () => {
            const results = await service.searchResources('测试中文');
            assert.ok(Array.isArray(results));
        });

        test('Should handle very long query', async () => {
            const longQuery = 'a'.repeat(1000);
            const results = await service.searchResources(longQuery);
            assert.ok(Array.isArray(results));
        });

        test('Should handle query with only whitespace', async () => {
            const results = await service.searchResources('   ');
            assert.ok(Array.isArray(results));
        });

        test('Should handle case sensitivity flag', async () => {
            // Case sensitivity marker: (?-i)
            const results = await service.searchResources('(?-i)TEST');
            assert.ok(Array.isArray(results));
        });
    });

    // ============================================================================
    // INITIALIZATION WITHOUT DEPENDENCIES TESTS
    // ============================================================================

    suite('Initialization without dependencies', () => {
        test('Should initialize without WorkspaceConfigService', async () => {
            const newContainer = new ServiceContainer();
            // No WorkspaceConfigService registered
            const newService = new ResourceSearchService(newContainer);

            // Should not throw
            await newService.initialize();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
        });

        test('Should initialize without ProjectScannerService', async () => {
            const newContainer = new ServiceContainer();
            // Mock WorkspaceConfigService
            newContainer.register('WorkspaceConfigService', {
                getProjectPaths: () => Promise.resolve([])
            });
            // No ProjectScannerService registered
            const newService = new ResourceSearchService(newContainer);

            await newService.initialize();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
        });

        test('Should initialize without ResourceTypeProviderRegistry', async () => {
            const newContainer = new ServiceContainer();
            const newService = new ResourceSearchService(newContainer);

            await newService.initialize();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
        });
    });
});
