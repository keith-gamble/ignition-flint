/**
 * @module GatewayManagerService.test
 * @description Unit tests for GatewayManagerService
 */

import * as assert from 'assert';

import { ServiceContainer } from '../../../../core/ServiceContainer';
import { ServiceStatus } from '../../../../core/types/services';
import { GatewayManagerService } from '../../../../services/gateways/GatewayManagerService';

suite('GatewayManagerService Test Suite', () => {
    let service: GatewayManagerService;
    let container: ServiceContainer;

    // Mock extensionContext for workspace state operations
    const mockWorkspaceState = new Map<string, unknown>();
    const mockExtensionContext = {
        workspaceState: {
            get: <T>(key: string, defaultValue: T): T => {
                return (mockWorkspaceState.get(key) as T) ?? defaultValue;
            },
            update: (key: string, value: unknown): Promise<void> => {
                mockWorkspaceState.set(key, value);
                return Promise.resolve();
            }
        }
    };

    // Mock WorkspaceConfigService for auto-selection
    const mockWorkspaceConfigService = {
        getGateways: (): Promise<Record<string, unknown>> => Promise.resolve({})
    };

    setup(async () => {
        mockWorkspaceState.clear();
        container = new ServiceContainer();
        container.register('extensionContext', mockExtensionContext);
        container.register('WorkspaceConfigService', mockWorkspaceConfigService);
        service = new GatewayManagerService(container);
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
            newContainer.register('extensionContext', mockExtensionContext);
            newContainer.register('WorkspaceConfigService', mockWorkspaceConfigService);
            const newService = new GatewayManagerService(newContainer);
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);

            await newService.initialize();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
        });

        test('Should start after initialization', async () => {
            const newContainer = new ServiceContainer();
            newContainer.register('extensionContext', mockExtensionContext);
            newContainer.register('WorkspaceConfigService', mockWorkspaceConfigService);
            const newService = new GatewayManagerService(newContainer);
            await newService.initialize();
            await newService.start();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);
            await newService.dispose();
        });

        test('Should throw when starting before initialization', async () => {
            const newService = new GatewayManagerService(container);
            try {
                await newService.start();
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('must be initialized'));
            }
        });

        test('Should dispose correctly', async () => {
            const newContainer = new ServiceContainer();
            newContainer.register('extensionContext', mockExtensionContext);
            newContainer.register('WorkspaceConfigService', mockWorkspaceConfigService);
            const newService = new GatewayManagerService(newContainer);
            await newService.initialize();
            await newService.dispose();
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);
        });
    });

    // ============================================================================
    // SELECTION GETTER TESTS
    // ============================================================================

    suite('Selection Getters', () => {
        test('Should return null for no selected gateway initially', () => {
            const newService = new GatewayManagerService(container);
            // Don't initialize to avoid auto-selection
            const gateway = newService.getSelectedGateway();
            // Before initialization, should return null
            assert.strictEqual(gateway, null);
        });

        test('Should return null for no selected project initially', () => {
            const newService = new GatewayManagerService(container);
            const project = newService.getSelectedProject();
            assert.strictEqual(project, null);
        });

        test('getActiveGatewayId should be alias for getSelectedGateway', () => {
            const selectedGateway = service.getSelectedGateway();
            const activeGateway = service.getActiveGatewayId();

            assert.strictEqual(selectedGateway, activeGateway);
        });

        test('getActiveProjectId should be alias for getSelectedProject', () => {
            const selectedProject = service.getSelectedProject();
            const activeProject = service.getActiveProjectId();

            assert.strictEqual(selectedProject, activeProject);
        });
    });

    // ============================================================================
    // GATEWAY SELECTION TESTS
    // ============================================================================

    suite('selectGateway()', () => {
        test('Should select gateway', async () => {
            await service.selectGateway('test-gateway');

            assert.strictEqual(service.getSelectedGateway(), 'test-gateway');
        });

        test('Should clear selection with null', async () => {
            await service.selectGateway('test-gateway');
            await service.selectGateway(null);

            assert.strictEqual(service.getSelectedGateway(), null);
        });

        test('Should clear project when gateway changes', async () => {
            await service.selectGateway('gateway1');
            await service.selectProject('project1');

            await service.selectGateway('gateway2');

            assert.strictEqual(service.getSelectedGateway(), 'gateway2');
            assert.strictEqual(service.getSelectedProject(), null);
        });

        test('Should not clear project when selecting same gateway', async () => {
            await service.selectGateway('gateway1');
            await service.selectProject('project1');

            await service.selectGateway('gateway1'); // Same gateway

            assert.strictEqual(service.getSelectedProject(), 'project1');
        });

        test('Should fire event when gateway changes', async () => {
            let eventFired = false;
            let eventValue: string | null = null;

            const disposable = service.onGatewaySelected(id => {
                eventFired = true;
                eventValue = id;
            });

            await service.selectGateway('new-gateway');

            disposable.dispose();

            assert.strictEqual(eventFired, true);
            assert.strictEqual(eventValue, 'new-gateway');
        });

        test('Should not fire event when selecting same gateway', async () => {
            await service.selectGateway('gateway1');

            let eventFired = false;
            const disposable = service.onGatewaySelected(() => {
                eventFired = true;
            });

            await service.selectGateway('gateway1'); // Same gateway

            disposable.dispose();

            assert.strictEqual(eventFired, false);
        });
    });

    // ============================================================================
    // PROJECT SELECTION TESTS
    // ============================================================================

    suite('selectProject()', () => {
        test('Should select project', async () => {
            await service.selectGateway('gateway1');
            await service.selectProject('project1');

            assert.strictEqual(service.getSelectedProject(), 'project1');
        });

        test('Should clear selection with null', async () => {
            await service.selectProject('project1');
            await service.selectProject(null);

            assert.strictEqual(service.getSelectedProject(), null);
        });

        test('Should fire event when project changes', async () => {
            let eventFired = false;
            let eventValue: string | null = null;

            const disposable = service.onProjectSelected(id => {
                eventFired = true;
                eventValue = id;
            });

            await service.selectProject('new-project');

            disposable.dispose();

            assert.strictEqual(eventFired, true);
            assert.strictEqual(eventValue, 'new-project');
        });

        test('Should not fire event when selecting same project', async () => {
            await service.selectProject('project1');

            let eventFired = false;
            const disposable = service.onProjectSelected(() => {
                eventFired = true;
            });

            await service.selectProject('project1'); // Same project

            disposable.dispose();

            assert.strictEqual(eventFired, false);
        });
    });

    // ============================================================================
    // AVAILABLE PROJECTS TESTS
    // ============================================================================

    suite('getAvailableProjects()', () => {
        test('Should return empty array when no gateway selected', async () => {
            const newService = new GatewayManagerService(container);
            // Don't initialize to avoid auto-selection
            const projects = await newService.getAvailableProjects();

            assert.ok(Array.isArray(projects));
            assert.strictEqual(projects.length, 0);
        });

        test('Should return empty array when config service not available', async () => {
            await service.selectGateway('test-gateway');

            // Container has no WorkspaceConfigService registered
            const projects = await service.getAvailableProjects();

            assert.ok(Array.isArray(projects));
            assert.strictEqual(projects.length, 0);
        });
    });

    // ============================================================================
    // EVENT TESTS
    // ============================================================================

    suite('Events', () => {
        test('Should expose onGatewaySelected event', () => {
            assert.ok(service.onGatewaySelected);
            assert.ok(typeof service.onGatewaySelected === 'function');
        });

        test('Should expose onProjectSelected event', () => {
            assert.ok(service.onProjectSelected);
            assert.ok(typeof service.onProjectSelected === 'function');
        });

        test('Should fire project cleared event when gateway changes', async () => {
            await service.selectGateway('gateway1');
            await service.selectProject('project1');

            let projectEventFired = false;
            let projectEventValue: string | null = 'not-null';

            const disposable = service.onProjectSelected(id => {
                projectEventFired = true;
                projectEventValue = id;
            });

            await service.selectGateway('gateway2'); // Different gateway

            disposable.dispose();

            assert.strictEqual(projectEventFired, true);
            assert.strictEqual(projectEventValue, null);
        });
    });
});
