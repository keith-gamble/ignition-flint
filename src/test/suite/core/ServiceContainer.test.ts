/**
 * @module ServiceContainer.test
 * @description Unit tests for the ServiceContainer dependency injection system
 */

import * as assert from 'assert';

import { DependencyError, InvalidArgumentError } from '../../../core/errors';
import { ServiceContainer } from '../../../core/ServiceContainer';
import { ServiceStatus, IServiceLifecycle } from '../../../core/types/services';

// Mock service implementations
class MockService {
    public value = 'test';
}

class MockLifecycleService implements IServiceLifecycle {
    public initializeCalled = false;
    public startCalled = false;
    public stopCalled = false;
    public disposeCalled = false;
    private status = ServiceStatus.NOT_INITIALIZED;

    async initialize(): Promise<void> {
        this.initializeCalled = true;
        this.status = ServiceStatus.INITIALIZED;
        await Promise.resolve();
    }

    async start(): Promise<void> {
        this.startCalled = true;
        this.status = ServiceStatus.RUNNING;
        await Promise.resolve();
    }

    async stop(): Promise<void> {
        this.stopCalled = true;
        this.status = ServiceStatus.STOPPED;
        await Promise.resolve();
    }

    async dispose(): Promise<void> {
        this.disposeCalled = true;
        this.status = ServiceStatus.DISPOSED;
        await Promise.resolve();
    }

    getStatus(): ServiceStatus {
        return this.status;
    }
}

suite('ServiceContainer Test Suite', () => {
    let container: ServiceContainer;

    setup(() => {
        container = new ServiceContainer();
    });

    teardown(async () => {
        await container.dispose();
    });

    test('Should register and retrieve a service', () => {
        const service = new MockService();
        container.register('test', service);

        const retrieved = container.get<MockService>('test');
        assert.strictEqual(retrieved, service);
        assert.strictEqual(retrieved.value, 'test');
    });

    test('Should throw error when registering duplicate service', () => {
        const service = new MockService();
        container.register('test', service);

        assert.throws(
            () => container.register('test', new MockService()),
            InvalidArgumentError,
            'Should throw InvalidArgumentError for duplicate registration'
        );
    });

    test('Should throw error when getting non-existent service', () => {
        assert.throws(
            () => container.get('nonexistent'),
            DependencyError,
            'Should throw DependencyError for non-existent service'
        );
    });

    test('Should check if service exists', () => {
        assert.strictEqual(container.has('test'), false);

        container.register('test', new MockService());
        assert.strictEqual(container.has('test'), true);
    });

    test('Should get all service keys', () => {
        container.register('service1', new MockService());
        container.register('service2', new MockService());

        const keys = container.getServiceKeys();
        assert.deepStrictEqual(keys, ['service1', 'service2']);
    });

    test('Should register service with factory', () => {
        let factoryCalled = false;
        const factory = (): MockService => {
            factoryCalled = true;
            return new MockService();
        };

        container.registerFactory('test', factory);
        assert.strictEqual(factoryCalled, true, 'Factory should be called immediately for singletons');

        const service = container.get<MockService>('test');
        assert.strictEqual(service.value, 'test');
    });

    test('Should handle circular dependencies', () => {
        const factory1 = (c: any): any => {
            return { service2: c.get('service2') };
        };
        const factory2 = (c: any): any => {
            return { service1: c.get('service1') };
        };

        container.registerFactory('service1', factory1, { singleton: false });
        container.registerFactory('service2', factory2, { singleton: false });

        assert.throws(() => container.get('service1'), DependencyError, 'Should detect circular dependency');
    });

    test('Should initialize lifecycle services', async () => {
        const service1 = new MockLifecycleService();
        const service2 = new MockLifecycleService();

        container.register('service1', service1);
        container.register('service2', service2);

        await container.initializeServices();

        assert.strictEqual(service1.initializeCalled, true);
        assert.strictEqual(service2.initializeCalled, true);
    });

    test('Should start lifecycle services', async () => {
        const service = new MockLifecycleService();
        container.register('service', service);

        await container.initializeServices();
        await container.startServices();

        assert.strictEqual(service.startCalled, true);
    });

    test('Should stop lifecycle services', async () => {
        const service = new MockLifecycleService();
        container.register('service', service);

        await container.initializeServices();
        await container.startServices();
        await container.stopServices();

        assert.strictEqual(service.stopCalled, true);
    });

    test('Should dispose all services', async () => {
        const service = new MockLifecycleService();
        container.register('service', service);

        await container.initializeServices();
        await container.dispose();

        assert.strictEqual(service.disposeCalled, true);
        assert.strictEqual(container.has('service'), false);
    });

    test('Should get service status', async () => {
        const service = new MockLifecycleService();
        container.register('service', service);

        await container.initializeServices();

        const status = container.getServiceStatus();
        assert.strictEqual(status.get('service'), ServiceStatus.INITIALIZED);
    });

    test('Should handle dependencies in correct order', async () => {
        const order: string[] = [];

        class Service1 implements IServiceLifecycle {
            async initialize(): Promise<void> {
                order.push('service1');
                await Promise.resolve();
            }
            async start(): Promise<void> {
                await Promise.resolve();
            }
            async stop(): Promise<void> {
                await Promise.resolve();
            }
            async dispose(): Promise<void> {
                await Promise.resolve();
            }
            getStatus(): ServiceStatus {
                return ServiceStatus.RUNNING;
            }
        }

        class Service2 implements IServiceLifecycle {
            async initialize(): Promise<void> {
                order.push('service2');
                await Promise.resolve();
            }
            async start(): Promise<void> {
                await Promise.resolve();
            }
            async stop(): Promise<void> {
                await Promise.resolve();
            }
            async dispose(): Promise<void> {
                await Promise.resolve();
            }
            getStatus(): ServiceStatus {
                return ServiceStatus.RUNNING;
            }
        }

        // Service2 depends on Service1, so Service1 should initialize first
        container.register('service1', new Service1(), { dependencies: [] });
        container.register('service2', new Service2(), { dependencies: ['service1'] });

        await container.initializeServices();

        assert.deepStrictEqual(order, ['service1', 'service2']);
    });

    test('Should validate service key', () => {
        assert.throws(
            () => container.register('', new MockService()),
            InvalidArgumentError,
            'Should reject empty service key'
        );

        assert.throws(
            () => container.register(null as any, new MockService()),
            InvalidArgumentError,
            'Should reject null service key'
        );
    });

    test('Should get registration information', () => {
        const service = new MockService();
        container.register('test', service);

        const registration = container.getRegistration('test');
        assert.strictEqual(registration?.instance, service);
        assert.strictEqual(registration?.key, 'test');
        assert.strictEqual(registration?.singleton, true);
    });

    test('Should handle non-singleton factories', () => {
        let callCount = 0;
        const factory = (): MockService => {
            callCount++;
            const service = new MockService();
            service.value = `test-${callCount}`;
            return service;
        };

        container.registerFactory('test', factory, { singleton: false });

        const service1 = container.get<MockService>('test');
        const service2 = container.get<MockService>('test');

        assert.strictEqual(service1.value, 'test-1');
        assert.strictEqual(service2.value, 'test-2');
        assert.notStrictEqual(service1, service2);
    });
});
