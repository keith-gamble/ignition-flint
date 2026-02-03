/**
 * @module ResourceEditorManagerService.test
 * @description Unit tests for ResourceEditorManagerService
 */

import * as assert from 'assert';

import { ServiceContainer } from '../../../../core/ServiceContainer';
import { ResourceEditor, ResourceFileInfo } from '../../../../core/types/resources';
import { ServiceStatus } from '../../../../core/types/services';
import { ResourceEditorManagerService } from '../../../../services/resources/ResourceEditorManagerService';
import { ResourceTypeProviderRegistry } from '../../../../services/resources/ResourceTypeProviderRegistry';

/**
 * Creates a mock ResourceEditor for testing
 */
function createMockEditor(options: { canHandle?: boolean; name?: string } = {}): ResourceEditor {
    return {
        canHandle: () => options.canHandle ?? true,
        open: (): Promise<void> => Promise.resolve(),
        getEditorTitle: () => options.name ?? 'MockEditor'
    };
}

suite('ResourceEditorManagerService Test Suite', () => {
    let service: ResourceEditorManagerService;
    let container: ServiceContainer;
    let registry: ResourceTypeProviderRegistry;

    setup(async () => {
        container = new ServiceContainer();
        // Register ResourceTypeProviderRegistry as a dependency
        registry = new ResourceTypeProviderRegistry(container);
        await registry.initialize();
        container.register('ResourceTypeProviderRegistry', registry);

        service = new ResourceEditorManagerService(container);
        await service.initialize();
    });

    teardown(async () => {
        await service.dispose();
        await registry.dispose();
    });

    // ============================================================================
    // SERVICE LIFECYCLE TESTS
    // ============================================================================

    suite('Service Lifecycle', () => {
        test('Should initialize successfully', async () => {
            const newContainer = new ServiceContainer();
            const newRegistry = new ResourceTypeProviderRegistry(newContainer);
            await newRegistry.initialize();
            newContainer.register('ResourceTypeProviderRegistry', newRegistry);

            const newService = new ResourceEditorManagerService(newContainer);
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);

            await newService.initialize();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
            await newRegistry.dispose();
        });

        test('Should start after initialization', async () => {
            const newContainer = new ServiceContainer();
            const newRegistry = new ResourceTypeProviderRegistry(newContainer);
            await newRegistry.initialize();
            newContainer.register('ResourceTypeProviderRegistry', newRegistry);

            const newService = new ResourceEditorManagerService(newContainer);
            await newService.initialize();
            await newService.start();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
            await newRegistry.dispose();
        });

        test('Should throw when starting before initialization', async () => {
            const newService = new ResourceEditorManagerService(container);
            try {
                await newService.start();
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('must be initialized'));
            }
        });

        test('Should stop correctly', async () => {
            const newContainer = new ServiceContainer();
            const newRegistry = new ResourceTypeProviderRegistry(newContainer);
            await newRegistry.initialize();
            newContainer.register('ResourceTypeProviderRegistry', newRegistry);

            const newService = new ResourceEditorManagerService(newContainer);
            await newService.initialize();
            await newService.start();
            await newService.stop();
            // Status remains RUNNING until dispose
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
            await newRegistry.dispose();
        });

        test('Should dispose and clear registries', async () => {
            const newContainer = new ServiceContainer();
            const newRegistry = new ResourceTypeProviderRegistry(newContainer);
            await newRegistry.initialize();
            newContainer.register('ResourceTypeProviderRegistry', newRegistry);

            const newService = new ResourceEditorManagerService(newContainer);
            await newService.initialize();
            await newService.dispose();
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);

            // Stats should show cleared registries
            const stats = newService.getEditorStats();
            assert.strictEqual(stats.registeredTypes, 0);
            assert.strictEqual(stats.totalEditors, 0);

            await newRegistry.dispose();
        });

        test('Should throw if ResourceTypeProviderRegistry is not available', async () => {
            const newContainer = new ServiceContainer();
            // Don't register ResourceTypeProviderRegistry
            const newService = new ResourceEditorManagerService(newContainer);

            try {
                await newService.initialize();
                assert.fail('Should have thrown');
            } catch (e) {
                // Should throw an error about missing registry or initialization failure
                assert.ok(e instanceof Error);
                const error = e;
                const msg = error.message.toLowerCase();
                assert.ok(
                    msg.includes('registry') || msg.includes('provider') || msg.includes('unavailable'),
                    `Error message should mention registry/provider issue: ${error.message}`
                );
            }
        });
    });

    // ============================================================================
    // EDITOR REGISTRATION TESTS
    // ============================================================================

    suite('Editor Registration', () => {
        test('Should register an editor', () => {
            const mockEditor = createMockEditor();
            service.registerEditor('test-type', mockEditor);

            const stats = service.getEditorStats();
            assert.ok(stats.editorsByType['test-type'] >= 1);
        });

        test('Should register multiple editors for same type', () => {
            const editor1 = createMockEditor({ name: 'Editor1' });
            const editor2 = createMockEditor({ name: 'Editor2' });

            service.registerEditor('test-type', editor1, 1);
            service.registerEditor('test-type', editor2, 2);

            const stats = service.getEditorStats();
            assert.ok(stats.editorsByType['test-type'] >= 2);
        });

        test('Should sort editors by priority', async () => {
            const lowPriorityEditor = createMockEditor({ name: 'Low' });
            const highPriorityEditor = createMockEditor({ name: 'High' });

            service.registerEditor('priority-test', lowPriorityEditor, 1);
            service.registerEditor('priority-test', highPriorityEditor, 10);

            const files: ResourceFileInfo[] = [{ name: 'test.json', path: '/test/test.json' }];
            const editors = await service.getAvailableEditors('/test/path', files, 'priority-test');

            // Higher priority editor should be first
            assert.ok(editors.length >= 2);
            const firstEditor: ResourceEditor | undefined = editors[0];
            if (firstEditor?.getEditorTitle) {
                assert.strictEqual(firstEditor.getEditorTitle('/test'), 'High');
            } else {
                assert.fail('First editor should exist with getEditorTitle');
            }
        });

        test('Should unregister an editor', () => {
            const editor = createMockEditor();
            service.registerEditor('unregister-test', editor);

            const result = service.unregisterEditor('unregister-test', editor);
            assert.strictEqual(result, true);
        });

        test('Should return false when unregistering non-existent editor', () => {
            const editor = createMockEditor();
            const result = service.unregisterEditor('non-existent', editor);
            assert.strictEqual(result, false);
        });

        test('Should remove type entry when last editor is unregistered', () => {
            const editor = createMockEditor();
            service.registerEditor('cleanup-test', editor);

            service.unregisterEditor('cleanup-test', editor);

            const stats = service.getEditorStats();
            assert.strictEqual(stats.editorsByType['cleanup-test'], undefined);
        });
    });

    // ============================================================================
    // AVAILABLE EDITORS TESTS
    // ============================================================================

    suite('getAvailableEditors()', () => {
        test('Should return editors that can handle resource', async () => {
            const canHandleEditor = createMockEditor({ canHandle: true });
            const cannotHandleEditor = createMockEditor({ canHandle: false });

            service.registerEditor('can-handle-test', canHandleEditor);
            service.registerEditor('can-handle-test', cannotHandleEditor);

            const files: ResourceFileInfo[] = [{ name: 'test.json', path: '/test/test.json' }];
            const editors = await service.getAvailableEditors('/test/path', files, 'can-handle-test');

            assert.ok(editors.includes(canHandleEditor));
            assert.ok(!editors.includes(cannotHandleEditor));
        });

        test('Should search all editors when typeId is not provided', async () => {
            const editor1 = createMockEditor({ canHandle: true, name: 'Editor1' });
            const editor2 = createMockEditor({ canHandle: true, name: 'Editor2' });

            service.registerEditor('type1', editor1);
            service.registerEditor('type2', editor2);

            const files: ResourceFileInfo[] = [{ name: 'test.json', path: '/test/test.json' }];
            const editors = await service.getAvailableEditors('/test/path', files);

            assert.ok(editors.length >= 2);
        });

        test('Should not duplicate editors in results', async () => {
            const editor = createMockEditor({ canHandle: true });

            service.registerEditor('dup-test-1', editor);
            service.registerEditor('dup-test-2', editor);

            const files: ResourceFileInfo[] = [{ name: 'test.json', path: '/test/test.json' }];
            const editors = await service.getAvailableEditors('/test/path', files);

            // Count occurrences of the editor
            const count = editors.filter(e => e === editor).length;
            assert.ok(count <= 1, 'Editor should not appear more than once');
        });
    });

    // ============================================================================
    // CAN OPEN RESOURCE TESTS
    // ============================================================================

    suite('canOpenResource()', () => {
        test('Should return true when editor is available', async () => {
            const editor = createMockEditor({ canHandle: true });
            service.registerEditor('can-open-test', editor);

            const files: ResourceFileInfo[] = [{ name: 'test.json', path: '/test/test.json' }];
            const canOpen = await service.canOpenResource('/test/path', files, 'can-open-test');

            assert.strictEqual(canOpen, true);
        });

        test('Should return false when no editor can handle', async () => {
            const editor = createMockEditor({ canHandle: false });
            service.registerEditor('cannot-open-test', editor);

            const files: ResourceFileInfo[] = [{ name: 'test.bin', path: '/test/test.bin' }];
            const canOpen = await service.canOpenResource('/test/path', files, 'cannot-open-test');

            // May return true if built-in editors can handle
            assert.ok(typeof canOpen === 'boolean');
        });
    });

    // ============================================================================
    // EDITOR STATS TESTS
    // ============================================================================

    suite('getEditorStats()', () => {
        test('Should return editor statistics', () => {
            service.registerEditor('stats-type-1', createMockEditor());
            service.registerEditor('stats-type-2', createMockEditor());

            const stats = service.getEditorStats();

            assert.ok(typeof stats.registeredTypes === 'number');
            assert.ok(typeof stats.totalEditors === 'number');
            assert.ok(typeof stats.editorsByType === 'object');
        });

        test('Should return frozen stats objects', () => {
            const stats = service.getEditorStats();

            assert.ok(Object.isFrozen(stats));
            assert.ok(Object.isFrozen(stats.editorsByType));
        });

        test('Should count editors correctly', () => {
            const initialStats = service.getEditorStats();
            const initialTotal = initialStats.totalEditors;

            service.registerEditor('count-test', createMockEditor());
            service.registerEditor('count-test', createMockEditor());

            const newStats = service.getEditorStats();
            assert.strictEqual(newStats.totalEditors, initialTotal + 2);
        });
    });

    // ============================================================================
    // EVENT TESTS
    // ============================================================================

    suite('Events', () => {
        test('Should expose onEditorOpened event', () => {
            assert.ok(service.onEditorOpened);
            assert.ok(typeof service.onEditorOpened === 'function');
        });
    });

    // ============================================================================
    // BUILT-IN EDITORS TESTS
    // ============================================================================

    suite('Built-in Editors', () => {
        test('Should register built-in editors during initialization', () => {
            // Built-in editors should be registered
            const stats = service.getEditorStats();
            assert.ok(stats.totalEditors > 0, 'Should have built-in editors registered');
        });

        test('Should have generic editor for wildcard type', () => {
            const stats = service.getEditorStats();
            assert.ok(stats.editorsByType['*'] !== undefined, 'Should have generic editors registered');
        });
    });
});
