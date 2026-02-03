/**
 * @module services.mock
 * @description Mock implementations for Flint services used in unit tests
 */

import { ServiceStatus, IServiceLifecycle } from '../../core/types/services';

/**
 * Base mock service with lifecycle support
 */
export class MockLifecycleService implements IServiceLifecycle {
    public initializeCalled = false;
    public startCalled = false;
    public stopCalled = false;
    public disposeCalled = false;
    protected status: ServiceStatus = ServiceStatus.NOT_INITIALIZED;

    initialize(): Promise<void> {
        this.initializeCalled = true;
        this.status = ServiceStatus.INITIALIZED;
        return Promise.resolve();
    }

    start(): Promise<void> {
        this.startCalled = true;
        this.status = ServiceStatus.RUNNING;
        return Promise.resolve();
    }

    stop(): Promise<void> {
        this.stopCalled = true;
        this.status = ServiceStatus.STOPPED;
        return Promise.resolve();
    }

    dispose(): Promise<void> {
        this.disposeCalled = true;
        this.status = ServiceStatus.DISPOSED;
        return Promise.resolve();
    }

    getStatus(): ServiceStatus {
        return this.status;
    }

    reset(): void {
        this.initializeCalled = false;
        this.startCalled = false;
        this.stopCalled = false;
        this.disposeCalled = false;
        this.status = ServiceStatus.NOT_INITIALIZED;
    }
}

/**
 * Mock ServiceContainer for isolated testing
 */
export class MockServiceContainer {
    private services: Map<string, unknown> = new Map();
    private factories: Map<string, () => unknown> = new Map();

    register<T>(key: string, instance: T): void {
        this.services.set(key, instance);
    }

    registerFactory<T>(key: string, factory: () => T): void {
        this.factories.set(key, factory);
    }

    get<T>(key: string): T {
        if (this.services.has(key)) {
            return this.services.get(key) as T;
        }
        if (this.factories.has(key)) {
            const instance = this.factories.get(key)!() as T;
            this.services.set(key, instance);
            return instance;
        }
        throw new Error(`Service not found: ${key}`);
    }

    has(key: string): boolean {
        return this.services.has(key) || this.factories.has(key);
    }

    getServiceKeys(): string[] {
        return [...new Set([...this.services.keys(), ...this.factories.keys()])];
    }

    async initializeServices(): Promise<void> {
        for (const service of this.services.values()) {
            if (this.isLifecycleService(service)) {
                await service.initialize();
            }
        }
    }

    async startServices(): Promise<void> {
        for (const service of this.services.values()) {
            if (this.isLifecycleService(service)) {
                await service.start();
            }
        }
    }

    async stopServices(): Promise<void> {
        for (const service of this.services.values()) {
            if (this.isLifecycleService(service)) {
                await service.stop();
            }
        }
    }

    async dispose(): Promise<void> {
        for (const service of this.services.values()) {
            if (this.isLifecycleService(service)) {
                await service.dispose();
            }
        }
        this.services.clear();
        this.factories.clear();
    }

    private isLifecycleService(service: unknown): service is IServiceLifecycle {
        return (
            typeof service === 'object' &&
            service !== null &&
            'initialize' in service &&
            'start' in service &&
            'stop' in service &&
            'dispose' in service
        );
    }

    reset(): void {
        this.services.clear();
        this.factories.clear();
    }
}

/**
 * Mock WorkspaceConfigService
 */
export class MockWorkspaceConfigService extends MockLifecycleService {
    private config: Record<string, unknown> = {};

    setConfig(config: Record<string, unknown>): void {
        this.config = config;
    }

    getConfig(): Record<string, unknown> {
        return this.config;
    }

    getGateways(): Record<string, unknown> {
        return (this.config['gateways'] as Record<string, unknown>) || {};
    }

    getProjectPaths(): string[] {
        return (this.config['project-paths'] as string[]) || [];
    }
}

/**
 * Mock GatewayManagerService
 */
export class MockGatewayManagerService extends MockLifecycleService {
    private activeGatewayId: string | undefined;
    private activeProjectId: string | undefined;

    setActiveGateway(gatewayId: string | undefined): void {
        this.activeGatewayId = gatewayId;
    }

    getActiveGatewayId(): string | undefined {
        return this.activeGatewayId;
    }

    setActiveProject(projectId: string | undefined): void {
        this.activeProjectId = projectId;
    }

    getActiveProjectId(): string | undefined {
        return this.activeProjectId;
    }
}

/**
 * Mock ProjectScannerService
 */
export class MockProjectScannerService extends MockLifecycleService {
    private projects: Map<string, unknown> = new Map();

    addProject(projectId: string, project: unknown): void {
        this.projects.set(projectId, project);
    }

    getProject(projectId: string): unknown {
        return this.projects.get(projectId);
    }

    getAllProjects(): Map<string, unknown> {
        return new Map(this.projects);
    }

    async scanProjects(): Promise<void> {
        // Mock implementation
    }
}

/**
 * Mock ResourceTypeProviderRegistry
 */
export class MockResourceTypeProviderRegistry extends MockLifecycleService {
    private providers: Map<string, unknown> = new Map();

    registerProvider(typeId: string, provider: unknown): void {
        this.providers.set(typeId, provider);
    }

    getProvider(typeId: string): unknown {
        return this.providers.get(typeId);
    }

    getAllProviders(): Map<string, unknown> {
        return new Map(this.providers);
    }

    getProviderIds(): string[] {
        return [...this.providers.keys()];
    }
}

/**
 * Mock SearchProviderService
 */
export class MockSearchProviderService extends MockLifecycleService {
    private searchResults: unknown[] = [];

    setSearchResults(results: unknown[]): void {
        this.searchResults = results;
    }

    search(_query: string): Promise<unknown[]> {
        return Promise.resolve(this.searchResults);
    }
}

/**
 * Creates a fully configured mock service container with common services
 */
export function createMockServiceContainer(): MockServiceContainer {
    const container = new MockServiceContainer();

    container.register('WorkspaceConfigService', new MockWorkspaceConfigService());
    container.register('GatewayManagerService', new MockGatewayManagerService());
    container.register('ProjectScannerService', new MockProjectScannerService());
    container.register('ResourceTypeProviderRegistry', new MockResourceTypeProviderRegistry());
    container.register('SearchProviderService', new MockSearchProviderService());

    return container;
}
