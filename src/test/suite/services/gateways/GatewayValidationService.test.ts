/**
 * @module GatewayValidationService.test
 * @description Unit tests for GatewayValidationService
 */

import * as assert from 'assert';

import { ServiceContainer } from '../../../../core/ServiceContainer';
import { GatewayConfig } from '../../../../core/types/configuration';
import { ServiceStatus } from '../../../../core/types/services';
import { GatewayValidationService } from '../../../../services/gateways/GatewayValidationService';

/**
 * Helper to create a GatewayConfig from raw data
 */
function createGateway(data: Record<string, unknown>): GatewayConfig {
    return data as unknown as GatewayConfig;
}

suite('GatewayValidationService Test Suite', () => {
    let service: GatewayValidationService;
    let container: ServiceContainer;

    setup(async () => {
        container = new ServiceContainer();
        service = new GatewayValidationService(container);
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
            const newService = new GatewayValidationService(container);
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);

            await newService.initialize();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
        });

        test('Should start after initialization', async () => {
            const newService = new GatewayValidationService(container);
            await newService.initialize();
            await newService.start();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);
            await newService.dispose();
        });

        test('Should throw when starting before initialization', async () => {
            const newService = new GatewayValidationService(container);
            try {
                await newService.start();
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('must be initialized'));
            }
        });

        test('Should dispose correctly', async () => {
            const newService = new GatewayValidationService(container);
            await newService.initialize();
            await newService.dispose();
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);
        });
    });

    // ============================================================================
    // GATEWAY VALIDATION TESTS
    // ============================================================================

    suite('validateGateway()', () => {
        test('Should validate valid gateway', async () => {
            const gateway = createGateway({
                host: 'localhost',
                port: 8088
            });

            const result = await service.validateGateway('test-gateway', gateway);

            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('Should validate gateway with all optional fields', async () => {
            const gateway = createGateway({
                host: 'example.com',
                port: 443,
                ssl: true,
                projects: ['project1', 'project2']
            });

            const result = await service.validateGateway('test-gateway', gateway);

            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('Should reject empty gateway ID', async () => {
            const gateway = createGateway({ host: 'localhost' });

            const result = await service.validateGateway('', gateway);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('Gateway ID')));
        });

        test('Should reject null gateway ID', async () => {
            const gateway = createGateway({ host: 'localhost' });

            const result = await service.validateGateway(null as unknown as string, gateway);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('Gateway ID')));
        });

        test('Should reject null gateway config', async () => {
            const result = await service.validateGateway('test', null as unknown as GatewayConfig);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('required')));
        });
    });

    // ============================================================================
    // HOST VALIDATION TESTS
    // ============================================================================

    suite('Host Validation', () => {
        test('Should reject missing host', async () => {
            const gateway = createGateway({ port: 8088 });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('host')));
        });

        test('Should reject empty host', async () => {
            const gateway = createGateway({ host: '', port: 8088 });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('host')));
        });

        test('Should reject whitespace-only host', async () => {
            const gateway = createGateway({ host: '   ', port: 8088 });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('host')));
        });

        test('Should accept valid hostname', async () => {
            const gateway = createGateway({ host: 'gateway.example.com' });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, true);
        });

        test('Should accept IP address', async () => {
            const gateway = createGateway({ host: '192.168.1.100' });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, true);
        });
    });

    // ============================================================================
    // PORT VALIDATION TESTS
    // ============================================================================

    suite('Port Validation', () => {
        test('Should accept valid port', async () => {
            const gateway = createGateway({ host: 'localhost', port: 8088 });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, true);
        });

        test('Should accept missing port (optional)', async () => {
            const gateway = createGateway({ host: 'localhost' });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, true);
        });

        test('Should reject port below 1', async () => {
            const gateway = createGateway({ host: 'localhost', port: 0 });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('port')));
        });

        test('Should reject port above 65535', async () => {
            const gateway = createGateway({ host: 'localhost', port: 70000 });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('port')));
        });

        test('Should reject non-integer port', async () => {
            const gateway = createGateway({ host: 'localhost', port: 8088.5 });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('port')));
        });
    });

    // ============================================================================
    // SSL VALIDATION TESTS
    // ============================================================================

    suite('SSL Validation', () => {
        test('Should accept true SSL', async () => {
            const gateway = createGateway({ host: 'localhost', ssl: true });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, true);
        });

        test('Should accept false SSL', async () => {
            const gateway = createGateway({ host: 'localhost', ssl: false });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, true);
        });

        test('Should accept missing SSL (optional)', async () => {
            const gateway = createGateway({ host: 'localhost' });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, true);
        });

        test('Should reject non-boolean SSL', async () => {
            const gateway = createGateway({ host: 'localhost', ssl: 'true' });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('SSL') && e.includes('boolean')));
        });
    });

    // ============================================================================
    // PROJECTS VALIDATION TESTS
    // ============================================================================

    suite('Projects Validation', () => {
        test('Should accept valid projects array', async () => {
            const gateway = createGateway({
                host: 'localhost',
                projects: ['project1', 'project2']
            });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, true);
        });

        test('Should accept empty projects array', async () => {
            const gateway = createGateway({
                host: 'localhost',
                projects: []
            });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, true);
        });

        test('Should accept missing projects (optional)', async () => {
            const gateway = createGateway({ host: 'localhost' });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, true);
        });

        test('Should reject non-array projects', async () => {
            const gateway = createGateway({
                host: 'localhost',
                projects: 'project1'
            });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('projects') && e.includes('array')));
        });

        test('Should reject non-string project in array', async () => {
            const gateway = createGateway({
                host: 'localhost',
                projects: ['project1', 123]
            });

            const result = await service.validateGateway('test', gateway);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('project') && e.includes('index')));
        });
    });

    // ============================================================================
    // RESULT IMMUTABILITY TESTS
    // ============================================================================

    suite('Result Immutability', () => {
        test('Should return frozen errors array', async () => {
            const gateway = createGateway({ port: 8088 }); // Missing host

            const result = await service.validateGateway('test', gateway);

            assert.ok(Object.isFrozen(result.errors));
        });

        test('Should return frozen warnings array', async () => {
            const gateway = createGateway({ host: 'localhost' });

            const result = await service.validateGateway('test', gateway);

            assert.ok(Object.isFrozen(result.warnings));
        });
    });
});
