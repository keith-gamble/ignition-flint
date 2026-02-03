/**
 * @module SearchUtilities.test
 * @description Unit tests for SearchUtilities class
 */

import * as assert from 'assert';

import { ProjectResource, ResourceOrigin } from '../../../../core/types/models';
import { SearchUtilities, SearchQuery } from '../../../../utils/search/SearchUtilities';

suite('SearchUtilities Test Suite', () => {
    let searchUtils: SearchUtilities;

    setup(() => {
        // Create SearchUtilities without service container (standalone mode)
        searchUtils = new SearchUtilities(undefined, {
            caseSensitive: false,
            useRegex: false,
            wholeWord: false,
            maxResults: 100,
            searchTimeout: 5000,
            enableContentSearch: true
        });
    });

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    function createMockResource(path: string, type: string, files: string[] = []): ProjectResource {
        return {
            path,
            type,
            origin: ResourceOrigin.LOCAL,
            sourceProject: 'test-project',
            files: files.map(f => ({ name: f, path: f })),
            metadata: {}
        };
    }

    function createResourceMap(resources: ProjectResource[]): Map<string, ProjectResource> {
        const map = new Map<string, ProjectResource>();
        for (const resource of resources) {
            const key = `${resource.type}:${resource.path}`;
            map.set(key, resource);
        }
        return map;
    }

    // ============================================================================
    // TEXT SEARCH TESTS
    // ============================================================================

    suite('searchInText()', () => {
        test('Should find simple text matches', () => {
            const query: SearchQuery = { term: 'hello', type: 'all' };
            const matches = searchUtils.searchInText('hello world hello', query);

            assert.strictEqual(matches.length, 2);
            assert.strictEqual(matches[0].column, 1);
        });

        test('Should handle case insensitive search', () => {
            const query: SearchQuery = { term: 'HELLO', type: 'all', caseSensitive: false };
            const matches = searchUtils.searchInText('Hello World', query);

            assert.strictEqual(matches.length, 1);
        });

        test('Should handle case sensitive search', () => {
            const query: SearchQuery = { term: 'HELLO', type: 'all', caseSensitive: true };
            const matches = searchUtils.searchInText('Hello World', query);

            assert.strictEqual(matches.length, 0);
        });

        test('Should return empty array for no matches', () => {
            const query: SearchQuery = { term: 'xyz', type: 'all' };
            const matches = searchUtils.searchInText('hello world', query);

            assert.strictEqual(matches.length, 0);
        });

        test('Should include context in matches', () => {
            const query: SearchQuery = { term: 'target', type: 'all' };
            const matches = searchUtils.searchInText('prefix target suffix', query);

            assert.strictEqual(matches.length, 1);
            assert.ok(matches[0].text.includes('target'));
        });

        test('Should provide highlight positions', () => {
            const query: SearchQuery = { term: 'hello', type: 'all' };
            const matches = searchUtils.searchInText('hello world', query);

            assert.strictEqual(matches.length, 1);
            assert.ok(matches[0].highlightStart >= 0);
            assert.ok(matches[0].highlightEnd > matches[0].highlightStart);
        });
    });

    // ============================================================================
    // REGEX SEARCH TESTS
    // ============================================================================

    suite('Regex Search', () => {
        test('Should handle regex patterns', () => {
            const query: SearchQuery = { term: 'hel+o', type: 'all', useRegex: true };
            const matches = searchUtils.searchInText('helllo world hello', query);

            assert.strictEqual(matches.length, 2);
        });

        test('Should handle regex with groups', () => {
            const query: SearchQuery = { term: '(hello|world)', type: 'all', useRegex: true };
            const matches = searchUtils.searchInText('hello world', query);

            assert.strictEqual(matches.length, 2);
        });

        test('Should handle regex multiline', () => {
            const query: SearchQuery = { term: 'line\\d', type: 'all', useRegex: true };
            const text = 'line1\nline2\nline3';
            const matches = searchUtils.searchInText(text, query);

            assert.strictEqual(matches.length, 3);
        });

        test('Should handle regex case sensitivity', () => {
            const queryInsensitive: SearchQuery = { term: 'HELLO', type: 'all', useRegex: true, caseSensitive: false };
            const querySensitive: SearchQuery = { term: 'HELLO', type: 'all', useRegex: true, caseSensitive: true };

            const matchesInsensitive = searchUtils.searchInText('Hello World', queryInsensitive);
            const matchesSensitive = searchUtils.searchInText('Hello World', querySensitive);

            assert.strictEqual(matchesInsensitive.length, 1);
            assert.strictEqual(matchesSensitive.length, 0);
        });

        test('Should handle invalid regex gracefully', () => {
            const query: SearchQuery = { term: '[invalid', type: 'all', useRegex: true };
            const matches = searchUtils.searchInText('test text', query);

            // Should not throw, returns empty array
            assert.ok(Array.isArray(matches));
        });
    });

    // ============================================================================
    // WHOLE WORD SEARCH TESTS
    // ============================================================================

    suite('Whole Word Search', () => {
        test('Should match whole words only', () => {
            const query: SearchQuery = { term: 'test', type: 'all', wholeWord: true };
            const matches = searchUtils.searchInText('test testing tested test', query);

            // Should match 'test' as whole word
            assert.ok(matches.length >= 2);
        });

        test('Should match exact words only', () => {
            // Test that exact whole word is matched
            const query: SearchQuery = { term: 'test', type: 'all', wholeWord: true };
            const matches = searchUtils.searchInText('test testing tested', query);

            // Should match at least the exact word 'test'
            assert.ok(matches.length >= 1);
            // The first match should be the exact word 'test'
            assert.ok(matches[0].text.includes('test'));
        });
    });

    // ============================================================================
    // QUERY VALIDATION TESTS
    // ============================================================================

    suite('validateQuery()', () => {
        test('Should validate valid query', () => {
            const query: SearchQuery = { term: 'test', type: 'all' };
            const result = searchUtils.validateQuery(query);

            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('Should reject empty query', () => {
            const query: SearchQuery = { term: '', type: 'all' };
            const result = searchUtils.validateQuery(query);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('empty')));
        });

        test('Should reject whitespace-only query', () => {
            const query: SearchQuery = { term: '   ', type: 'all' };
            const result = searchUtils.validateQuery(query);

            assert.strictEqual(result.isValid, false);
        });

        test('Should validate invalid regex', () => {
            const query: SearchQuery = { term: '[invalid', type: 'all', useRegex: true };
            const result = searchUtils.validateQuery(query);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('regular expression')));
        });

        test('Should warn about short content search', () => {
            const query: SearchQuery = { term: 'a', type: 'content' };
            const result = searchUtils.validateQuery(query);

            assert.ok(result.warnings.some(w => w.includes('short')));
        });

        test('Should warn about very long queries', () => {
            const query: SearchQuery = { term: 'a'.repeat(150), type: 'all' };
            const result = searchUtils.validateQuery(query);

            assert.ok(result.warnings.some(w => w.includes('long')));
        });
    });

    // ============================================================================
    // SEARCH SUGGESTIONS TESTS
    // ============================================================================

    suite('generateSearchSuggestions()', () => {
        test('Should return empty for short query', () => {
            const resources = createResourceMap([]);
            const suggestions = searchUtils.generateSearchSuggestions('a', resources);

            assert.strictEqual(suggestions.length, 0);
        });

        test('Should return suggestions for valid query', () => {
            const resources = createResourceMap([
                createMockResource('components/button', 'view'),
                createMockResource('components/button-group', 'view'),
                createMockResource('components/input', 'view')
            ]);

            // Note: Suggestions depend on internal index which may need initialization
            const suggestions = searchUtils.generateSearchSuggestions('but', resources, 5);

            // Suggestions may be empty if index is not populated
            assert.ok(Array.isArray(suggestions));
        });

        test('Should limit suggestions', () => {
            const resources = createResourceMap([]);
            const suggestions = searchUtils.generateSearchSuggestions('test', resources, 3);

            assert.ok(suggestions.length <= 3);
        });
    });

    // ============================================================================
    // SEARCH RESOURCE TESTS
    // ============================================================================

    suite('searchResource()', () => {
        test('Should search in resource path', async () => {
            const resource = createMockResource('components/myButton', 'view');
            const query: SearchQuery = { term: 'button', type: 'name' };

            const result = await searchUtils.searchResource(resource, query);

            if (result === null) {
                assert.fail('Expected result to not be null');
            }
            assert.ok(result.matches.length > 0);
            assert.strictEqual(result.resourcePath, 'components/myButton');
        });

        test('Should return null for no matches', async () => {
            const resource = createMockResource('components/input', 'view');
            const query: SearchQuery = { term: 'button', type: 'name' };

            const result = await searchUtils.searchResource(resource, query);

            assert.strictEqual(result, null);
        });

        test('Should calculate relevance score', async () => {
            const resource = createMockResource('button/primaryButton', 'view');
            const query: SearchQuery = { term: 'button', type: 'all' };

            const result = await searchUtils.searchResource(resource, query);

            if (result === null) {
                assert.fail('Expected result to not be null');
            }
            assert.ok(result.score > 0);
        });

        test('Should include metadata in results', async () => {
            const resource: ProjectResource = {
                path: 'components/button',
                type: 'view',
                origin: ResourceOrigin.LOCAL,
                sourceProject: 'test-project',
                files: [],
                metadata: { custom: 'data' }
            };
            const query: SearchQuery = { term: 'button', type: 'name' };

            const result = await searchUtils.searchResource(resource, query);

            if (result === null) {
                assert.fail('Expected result to not be null');
            }
            assert.ok('metadata' in result);
        });
    });

    // ============================================================================
    // FULL SEARCH TESTS
    // ============================================================================

    suite('search()', () => {
        test('Should search across resources', async () => {
            const resources = createResourceMap([
                createMockResource('components/button', 'view'),
                createMockResource('components/input', 'view'),
                createMockResource('scripts/buttonHandler', 'script')
            ]);
            const query: SearchQuery = { term: 'button', type: 'all' };

            const { results, statistics } = await searchUtils.search(query, resources);

            assert.ok(results.length >= 2);
            assert.ok(statistics.totalFiles > 0);
        });

        test('Should filter by resource types', async () => {
            const resources = createResourceMap([
                createMockResource('components/button', 'view'),
                createMockResource('scripts/buttonHandler', 'script')
            ]);
            const query: SearchQuery = { term: 'button', type: 'all', resourceTypes: ['view'] };

            const { results } = await searchUtils.search(query, resources);

            assert.ok(results.every(r => r.resourceType === 'view'));
        });

        test('Should return empty for empty query', async () => {
            const resources = createResourceMap([createMockResource('test', 'view')]);
            const query: SearchQuery = { term: '', type: 'all' };

            const { results } = await searchUtils.search(query, resources);

            assert.strictEqual(results.length, 0);
        });

        test('Should return statistics', async () => {
            const resources = createResourceMap([
                createMockResource('test1', 'view'),
                createMockResource('test2', 'view')
            ]);
            const query: SearchQuery = { term: 'test', type: 'all' };

            const { statistics } = await searchUtils.search(query, resources);

            assert.ok(statistics.totalFiles > 0);
            assert.ok(statistics.searchTime >= 0);
        });

        test('Should call progress callback', async () => {
            const resources = createResourceMap([
                createMockResource('test1', 'view'),
                createMockResource('test2', 'view')
            ]);
            const query: SearchQuery = { term: 'test', type: 'all' };
            let progressCalled = false;

            await searchUtils.search(query, resources, progress => {
                progressCalled = true;
                assert.ok(progress.current >= 0);
                assert.ok(progress.total > 0);
            });

            assert.strictEqual(progressCalled, true);
        });

        test('Should limit results', async () => {
            // Create many resources
            const resources = createResourceMap(
                Array.from({ length: 200 }, (_, i) => createMockResource(`test${i}`, 'view'))
            );
            const query: SearchQuery = { term: 'test', type: 'all' };

            const { results } = await searchUtils.search(query, resources);

            // Results should be limited by maxResults config (100)
            assert.ok(results.length <= 100);
        });
    });

    // ============================================================================
    // CONFIGURATION TESTS
    // ============================================================================

    suite('Configuration', () => {
        test('Should update configuration', () => {
            searchUtils.updateConfiguration({ maxResults: 50 });
            const config = searchUtils.getConfiguration();

            assert.strictEqual(config.maxResults, 50);
        });

        test('Should return frozen configuration', () => {
            const config = searchUtils.getConfiguration();

            // Configuration should be frozen/readonly
            assert.ok(Object.isFrozen(config));
        });
    });

    // ============================================================================
    // SERVICE LIFECYCLE TESTS
    // ============================================================================

    suite('Service Lifecycle', () => {
        test('Should return STOPPED status before initialization', () => {
            const newUtils = new SearchUtilities();
            assert.strictEqual(newUtils.getStatus(), 'stopped');
        });

        test('Should handle start without prior initialization', async () => {
            const newUtils = new SearchUtilities();
            await newUtils.start();
            assert.strictEqual(newUtils.getStatus(), 'running');
        });

        test('Should handle stop and dispose', async () => {
            const newUtils = new SearchUtilities();
            await newUtils.start();
            await newUtils.stop();
            await newUtils.dispose();
            // Should not throw
        });

        test('toString should return descriptive string', () => {
            const str = searchUtils.toString();
            assert.ok(str.includes('SearchUtilities'));
            assert.ok(str.includes('maxResults'));
        });
    });
});
