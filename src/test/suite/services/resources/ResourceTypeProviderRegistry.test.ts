/**
 * @module ResourceTypeProviderRegistry.test
 * @description Unit tests for ResourceTypeProviderRegistry
 */

import * as assert from 'assert';

import { ServiceContainer } from '../../../../core/ServiceContainer';
import {
    ResourceTypeProvider,
    ResourceSearchConfig,
    ResourceEditorConfig,
    ResourceTemplateConfig
} from '../../../../core/types/resourceProviders';
import { ServiceStatus } from '../../../../core/types/services';
import { ResourceValidationResult } from '../../../../core/types/validation';
import { ResourceTypeProviderRegistry } from '../../../../services/resources/ResourceTypeProviderRegistry';

/**
 * Mock ResourceTypeProvider for testing
 */
function createMockProvider(
    resourceTypeId: string,
    options: {
        supportsContentSearch?: boolean;
        supportsCreation?: boolean;
        supportsValidation?: boolean;
    } = {}
): ResourceTypeProvider {
    return {
        resourceTypeId,
        displayName: `Mock ${resourceTypeId}`,
        getSearchConfig: (): ResourceSearchConfig => ({
            supportsContentSearch: options.supportsContentSearch ?? false,
            searchableExtensions: ['.txt'],
            directoryPaths: ['test']
        }),
        getEditorConfig: (): ResourceEditorConfig => ({
            editorType: 'text',
            priority: 1,
            primaryFile: 'data.txt'
        }),
        getTemplateConfig: (): ResourceTemplateConfig => ({
            templates: [],
            defaultTemplateId: 'default'
        }),
        getValidationRules: () => [],
        createResource: options.supportsCreation ? async (): Promise<void> => Promise.resolve() : undefined,
        validateResource: options.supportsValidation
            ? async (): Promise<ResourceValidationResult> =>
                  Promise.resolve({
                      isValid: true,
                      errors: [],
                      warnings: [],
                      info: [],
                      summary: {
                          totalIssues: 0,
                          errorCount: 0,
                          warningCount: 0,
                          infoCount: 0
                      }
                  })
            : undefined
    };
}

suite('ResourceTypeProviderRegistry Test Suite', () => {
    let service: ResourceTypeProviderRegistry;
    let container: ServiceContainer;

    setup(async () => {
        container = new ServiceContainer();
        service = new ResourceTypeProviderRegistry(container);
        await service.initialize();
    });

    teardown(async () => {
        await service.dispose();
    });

    // ============================================================================
    // SERVICE LIFECYCLE TESTS
    // ============================================================================

    suite('Service Lifecycle', () => {
        test('Should initialize with built-in providers', async () => {
            const newService = new ResourceTypeProviderRegistry(container);
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);

            await newService.initialize();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            // Should have built-in providers
            const providers = newService.getAllProviders();
            assert.ok(providers.length > 0, 'Should have built-in providers');

            await newService.dispose();
        });

        test('Should start after initialization', async () => {
            const newService = new ResourceTypeProviderRegistry(container);
            await newService.initialize();
            await newService.start();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);
            await newService.dispose();
        });

        test('Should throw when starting before initialization', async () => {
            const newService = new ResourceTypeProviderRegistry(container);
            try {
                await newService.start();
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('must be initialized'));
            }
        });

        test('Should dispose and clear providers', async () => {
            const newService = new ResourceTypeProviderRegistry(container);
            await newService.initialize();
            await newService.dispose();
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);
            // Providers should be cleared
            const providers = newService.getAllProviders();
            assert.strictEqual(providers.length, 0);
        });
    });

    // ============================================================================
    // PROVIDER REGISTRATION TESTS
    // ============================================================================

    suite('registerProvider()', () => {
        test('Should register a provider', () => {
            const mockProvider = createMockProvider('custom-type');
            service.registerProvider(mockProvider);

            assert.ok(service.hasProvider('custom-type'));
        });

        test('Should replace existing provider', () => {
            const provider1 = createMockProvider('custom-type');
            // Create a second provider with modified displayName
            const provider2: ResourceTypeProvider = {
                ...createMockProvider('custom-type'),
                displayName: 'Replaced Provider'
            };

            service.registerProvider(provider1);
            service.registerProvider(provider2);

            const retrieved = service.getProvider('custom-type');
            assert.strictEqual(retrieved?.displayName, 'Replaced Provider');
        });

        test('Should fire event when provider registered', () => {
            let eventFired = false;
            let receivedResourceTypeId: string | undefined;

            const disposable = service.onProviderRegistered(provider => {
                eventFired = true;
                receivedResourceTypeId = provider.resourceTypeId;
            });

            const mockProvider = createMockProvider('event-test');
            service.registerProvider(mockProvider);

            disposable.dispose();

            assert.strictEqual(eventFired, true);
            assert.strictEqual(receivedResourceTypeId, 'event-test');
        });
    });

    // ============================================================================
    // PROVIDER RETRIEVAL TESTS
    // ============================================================================

    suite('getProvider()', () => {
        test('Should get existing provider', () => {
            const mockProvider = createMockProvider('test-type');
            service.registerProvider(mockProvider);

            const retrieved = service.getProvider('test-type');
            assert.ok(retrieved);
            assert.strictEqual(retrieved.resourceTypeId, 'test-type');
        });

        test('Should return undefined for non-existent provider', () => {
            const retrieved = service.getProvider('non-existent');
            assert.strictEqual(retrieved, undefined);
        });
    });

    suite('getAllProviders()', () => {
        test('Should return all registered providers', () => {
            service.registerProvider(createMockProvider('type-1'));
            service.registerProvider(createMockProvider('type-2'));

            const allProviders = service.getAllProviders();

            // Includes built-in + custom providers
            assert.ok(allProviders.some(p => p.resourceTypeId === 'type-1'));
            assert.ok(allProviders.some(p => p.resourceTypeId === 'type-2'));
        });

        test('Should return frozen array', () => {
            const providers = service.getAllProviders();
            assert.ok(Object.isFrozen(providers));
        });
    });

    suite('getSearchableProviders()', () => {
        test('Should return only searchable providers', () => {
            service.registerProvider(createMockProvider('searchable', { supportsContentSearch: true }));
            service.registerProvider(createMockProvider('not-searchable', { supportsContentSearch: false }));

            const searchable = service.getSearchableProviders();

            assert.ok(searchable.some(p => p.resourceTypeId === 'searchable'));
            assert.ok(!searchable.some(p => p.resourceTypeId === 'not-searchable'));
        });

        test('Should return frozen array', () => {
            const providers = service.getSearchableProviders();
            assert.ok(Object.isFrozen(providers));
        });
    });

    // ============================================================================
    // CONFIGURATION RETRIEVAL TESTS
    // ============================================================================

    suite('Configuration Retrieval', () => {
        test('Should get validation rules', () => {
            const mockProvider = createMockProvider('test-type');
            service.registerProvider(mockProvider);

            const rules = service.getValidationRules('test-type');
            assert.ok(Array.isArray(rules));
        });

        test('Should return empty array for non-existent provider', () => {
            const rules = service.getValidationRules('non-existent');
            assert.ok(Array.isArray(rules));
            assert.strictEqual(rules.length, 0);
        });

        test('Should get editor config', () => {
            const mockProvider = createMockProvider('test-type');
            service.registerProvider(mockProvider);

            const config = service.getEditorConfig('test-type');
            assert.ok(config);
            assert.ok('editorType' in config);
        });

        test('Should return undefined for non-existent provider editor config', () => {
            const config = service.getEditorConfig('non-existent');
            assert.strictEqual(config, undefined);
        });

        test('Should get search config', () => {
            const mockProvider = createMockProvider('test-type');
            service.registerProvider(mockProvider);

            const config = service.getSearchConfig('test-type');
            assert.ok(config);
            assert.ok('supportsContentSearch' in config);
        });

        test('Should get template config', () => {
            const mockProvider = createMockProvider('test-type');
            service.registerProvider(mockProvider);

            const config = service.getTemplateConfig('test-type');
            assert.ok(config);
            assert.ok('templates' in config);
        });
    });

    // ============================================================================
    // HAS PROVIDER TESTS
    // ============================================================================

    suite('hasProvider()', () => {
        test('Should return true for existing provider', () => {
            service.registerProvider(createMockProvider('test-type'));

            assert.strictEqual(service.hasProvider('test-type'), true);
        });

        test('Should return false for non-existent provider', () => {
            assert.strictEqual(service.hasProvider('non-existent'), false);
        });

        test('Should return true for built-in providers', () => {
            // Built-in providers are registered during initialization
            // PythonScriptProvider uses 'script-python' as resourceTypeId
            assert.strictEqual(service.hasProvider('script-python'), true);
        });
    });

    // ============================================================================
    // RESOURCE CREATION TESTS
    // ============================================================================

    suite('createResource()', () => {
        test('Should create resource using provider', async () => {
            const mockProvider = createMockProvider('creatable', { supportsCreation: true });
            service.registerProvider(mockProvider);

            // Should not throw
            await service.createResource('creatable', '/test/path');
        });

        test('Should throw for non-existent provider', async () => {
            try {
                await service.createResource('non-existent', '/test/path');
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('No provider found'));
            }
        });

        test('Should throw when provider does not support creation', async () => {
            const mockProvider = createMockProvider('no-create', { supportsCreation: false });
            service.registerProvider(mockProvider);

            try {
                await service.createResource('no-create', '/test/path');
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('does not support resource creation'));
            }
        });
    });

    // ============================================================================
    // RESOURCE VALIDATION TESTS
    // ============================================================================

    suite('validateResource()', () => {
        test('Should validate resource using provider', async () => {
            const mockProvider = createMockProvider('validatable', { supportsValidation: true });
            service.registerProvider(mockProvider);

            const result = await service.validateResource('validatable', '/test/path', 'content');

            assert.ok(result);
            assert.strictEqual(result.isValid, true);
        });

        test('Should return default valid result when provider has no validate method', async () => {
            const mockProvider = createMockProvider('no-validate', { supportsValidation: false });
            service.registerProvider(mockProvider);

            const result = await service.validateResource('no-validate', '/test/path', 'content');

            assert.ok(result);
            assert.strictEqual(result.isValid, true);
            assert.deepStrictEqual(result.errors, []);
        });

        test('Should throw for non-existent provider', async () => {
            try {
                await service.validateResource('non-existent', '/test/path', 'content');
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('No provider found'));
            }
        });
    });

    // ============================================================================
    // BUILT-IN PROVIDERS TESTS
    // ============================================================================

    suite('Built-in Providers', () => {
        test('Should register PythonScriptProvider', () => {
            assert.ok(service.hasProvider('script-python'));
        });

        test('Should register NamedQueryProvider', () => {
            assert.ok(service.hasProvider('named-query'));
        });

        test('Should register PerspectiveViewProvider', () => {
            assert.ok(service.hasProvider('perspective-view'));
        });

        test('Should register PerspectiveStyleClassProvider', () => {
            assert.ok(service.hasProvider('perspective-style-class'));
        });

        test('Should register PerspectivePageConfigProvider', () => {
            assert.ok(service.hasProvider('perspective-page-config'));
        });

        test('Should register PerspectiveSessionPropsProvider', () => {
            assert.ok(service.hasProvider('perspective-session-props'));
        });

        test('Should register PerspectiveSessionEventsProvider', () => {
            assert.ok(service.hasProvider('perspective-session-events'));
        });

        test('Should have correct number of built-in providers', () => {
            // 7 built-in providers based on the code
            const providers = service.getAllProviders();
            assert.ok(providers.length >= 7, `Expected at least 7 providers, got ${providers.length}`);
        });
    });

    // ============================================================================
    // EVENT TESTS
    // ============================================================================

    suite('Events', () => {
        test('Should expose onProviderRegistered event', () => {
            assert.ok(service.onProviderRegistered);
            assert.ok(typeof service.onProviderRegistered === 'function');
        });
    });
});
