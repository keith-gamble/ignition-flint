/**
 * @module ConfigValidationService.test
 * @description Unit tests for ConfigValidationService
 */

import * as assert from 'assert';

import { ServiceContainer } from '../../../../core/ServiceContainer';
import { FlintConfig, GatewayConfig } from '../../../../core/types/configuration';
import { ServiceStatus } from '../../../../core/types/services';
import { ConfigValidationService } from '../../../../services/config/ConfigValidationService';

/**
 * Helper to create a FlintConfig from raw JSON-like data.
 * Config files don't have 'id' on gateways - the key IS the id.
 */
function createConfig(data: Record<string, unknown>): FlintConfig {
    return data as unknown as FlintConfig;
}

/**
 * Helper to create a GatewayConfig from raw JSON-like data.
 */
function createGateway(data: Record<string, unknown>): GatewayConfig {
    return data as unknown as GatewayConfig;
}

suite('ConfigValidationService Test Suite', () => {
    let service: ConfigValidationService;
    let container: ServiceContainer;

    setup(async () => {
        container = new ServiceContainer();
        service = new ConfigValidationService(container);
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
            const newService = new ConfigValidationService(container);
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);

            await newService.initialize();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
        });

        test('Should start after initialization', async () => {
            const newService = new ConfigValidationService(container);
            await newService.initialize();
            await newService.start();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);
            await newService.dispose();
        });

        test('Should reject start before initialization', async () => {
            const newService = new ConfigValidationService(container);
            try {
                await newService.start();
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('must be initialized'));
            }
        });

        test('Should dispose and clear validation rules', async () => {
            const newService = new ConfigValidationService(container);
            await newService.initialize();
            await newService.dispose();
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);
        });
    });

    // ============================================================================
    // CONFIGURATION VALIDATION TESTS
    // ============================================================================

    suite('validateConfiguration()', () => {
        test('Should validate valid configuration', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path/to/projects'],
                gateways: {
                    'test-gateway': { host: 'localhost', port: 8088 }
                }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('Should reject null configuration', async () => {
            const result = await service.validateConfiguration(null as unknown as FlintConfig);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('valid JSON object')));
        });

        test('Should reject non-object configuration', async () => {
            const result = await service.validateConfiguration('string' as unknown as FlintConfig);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('valid JSON object')));
        });

        test('Should detect missing required properties', async () => {
            const config = createConfig({
                schemaVersion: '0.2'
                // Missing 'project-paths' and 'gateways'
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes("'project-paths'")));
            assert.ok(result.errors.some(e => e.includes("'gateways'")));
        });

        test('Should validate schema version 0.1', async () => {
            const config = createConfig({
                schemaVersion: '0.1',
                'project-paths': ['/path'],
                gateways: { gw: { host: 'localhost' } }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, true);
        });

        test('Should validate schema version 0.2', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path'],
                gateways: { gw: { host: 'localhost' } }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, true);
        });

        test('Should reject unsupported schema version', async () => {
            const config = createConfig({
                schemaVersion: '9.9',
                'project-paths': ['/path'],
                gateways: {}
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('Unsupported schema version')));
        });

        test('Should validate settings when present', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path'],
                gateways: { gw: { host: 'localhost' } },
                settings: {
                    showInheritedResources: true,
                    groupResourcesByType: false,
                    autoRefreshProjects: true,
                    searchHistoryLimit: 10
                }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, true);
        });

        test('Should detect invalid settings', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path'],
                gateways: { gw: { host: 'localhost' } },
                settings: {
                    showInheritedResources: 'yes',
                    searchHistoryLimit: -5
                }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('showInheritedResources')));
            assert.ok(result.errors.some(e => e.includes('searchHistoryLimit')));
        });
    });

    // ============================================================================
    // GATEWAY VALIDATION TESTS
    // ============================================================================

    suite('validateGateway()', () => {
        test('Should validate legacy gateway format', async () => {
            const gateway = createGateway({
                host: 'gateway.example.com',
                port: 8088,
                ssl: false
            });

            const result = await service.validateGateway('test-gw', gateway);
            assert.strictEqual(result.isValid, true);
        });

        test('Should validate multi-environment gateway format', async () => {
            const gateway = createGateway({
                environments: {
                    dev: { host: 'dev.example.com', port: 8088 },
                    prod: { host: 'prod.example.com', port: 443, ssl: true }
                },
                defaultEnvironment: 'dev'
            });

            const result = await service.validateGateway('test-gw', gateway);
            assert.strictEqual(result.isValid, true);
        });

        test('Should reject gateway without host or environments', async () => {
            const gateway = createGateway({ port: 8088 });

            const result = await service.validateGateway('test-gw', gateway);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('host property') || e.includes('environments property')));
        });

        test('Should warn when both host and environments present', async () => {
            const gateway = createGateway({
                host: 'localhost',
                environments: { dev: { host: 'dev.example.com' } }
            });

            const result = await service.validateGateway('test-gw', gateway);
            assert.strictEqual(result.isValid, true);
            assert.ok(result.warnings.some(w => w.includes('both legacy')));
        });

        test('Should reject empty gateway ID', async () => {
            const gateway = createGateway({ host: 'localhost' });

            const result = await service.validateGateway('', gateway);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('Gateway ID')));
        });

        test('Should reject null gateway config', async () => {
            const result = await service.validateGateway('test', null as unknown as GatewayConfig);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('must be an object')));
        });

        test('Should validate port range', async () => {
            const invalidLow = createGateway({ host: 'localhost', port: 0 });
            const invalidHigh = createGateway({ host: 'localhost', port: 70000 });
            const valid = createGateway({ host: 'localhost', port: 8088 });

            const resultLow = await service.validateGateway('gw', invalidLow);
            const resultHigh = await service.validateGateway('gw', invalidHigh);
            const resultValid = await service.validateGateway('gw', valid);

            assert.strictEqual(resultLow.isValid, false);
            assert.strictEqual(resultHigh.isValid, false);
            assert.strictEqual(resultValid.isValid, true);
        });

        test('Should validate boolean properties', async () => {
            const gateway = createGateway({
                host: 'localhost',
                ssl: 'true',
                enabled: 1
            });

            const result = await service.validateGateway('test', gateway);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('SSL') && e.includes('boolean')));
            assert.ok(result.errors.some(e => e.includes('enabled') && e.includes('boolean')));
        });

        test('Should validate projects array', async () => {
            const gateway = createGateway({
                host: 'localhost',
                projects: ['project1', 123]
            });

            const result = await service.validateGateway('test', gateway);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('project at index')));
        });

        test('Should warn about localhost usage', async () => {
            const gateway = createGateway({ host: 'localhost' });

            const result = await service.validateGateway('test', gateway);
            assert.ok(result.warnings.some(w => w.includes('localhost')));
        });

        test('Should warn about missing SSL', async () => {
            const gateway = createGateway({ host: 'example.com', ssl: false });

            const result = await service.validateGateway('test', gateway);
            assert.ok(result.warnings.some(w => w.includes('SSL')));
        });
    });

    // ============================================================================
    // ENVIRONMENT VALIDATION TESTS
    // ============================================================================

    suite('Environment Validation', () => {
        test('Should validate environment with all properties', async () => {
            const gateway = createGateway({
                environments: {
                    prod: {
                        host: 'prod.example.com',
                        port: 443,
                        ssl: true,
                        username: 'admin',
                        ignoreSSLErrors: false
                    }
                },
                defaultEnvironment: 'prod'
            });

            const result = await service.validateGateway('test', gateway);
            assert.strictEqual(result.isValid, true);
        });

        test('Should reject empty environments object', async () => {
            const gateway = createGateway({ environments: {} });

            const result = await service.validateGateway('test', gateway);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('cannot be empty')));
        });

        test('Should reject environment without host', async () => {
            const gateway = createGateway({
                environments: { dev: { port: 8088 } }
            });

            const result = await service.validateGateway('test', gateway);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes("'dev'") && e.includes('host')));
        });

        test('Should validate defaultEnvironment exists', async () => {
            const gateway = createGateway({
                environments: { dev: { host: 'dev.example.com' } },
                defaultEnvironment: 'prod' // Does not exist
            });

            const result = await service.validateGateway('test', gateway);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('defaultEnvironment') && e.includes('does not exist')));
        });

        test('Should reject non-string defaultEnvironment', async () => {
            const gateway = createGateway({
                environments: { dev: { host: 'dev.example.com' } },
                defaultEnvironment: 123
            });

            const result = await service.validateGateway('test', gateway);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('defaultEnvironment') && e.includes('string')));
        });

        test('Should validate environment port ranges', async () => {
            const gateway = createGateway({
                environments: { dev: { host: 'dev.example.com', port: 99999 } }
            });

            const result = await service.validateGateway('test', gateway);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes("'dev'") && e.includes('port')));
        });

        test('Should reject non-object environment config', async () => {
            const gateway = createGateway({
                environments: { dev: 'invalid' }
            });

            const result = await service.validateGateway('test', gateway);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes("'dev'") && e.includes('must be an object')));
        });
    });

    // ============================================================================
    // PROJECT PATH VALIDATION TESTS
    // ============================================================================

    suite('validateProjectPath()', () => {
        test('Should validate valid path', () => {
            const result = service.validateProjectPath('/path/to/projects');
            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('Should validate relative path', () => {
            const result = service.validateProjectPath('./projects');
            assert.strictEqual(result.isValid, true);
        });

        test('Should reject empty path', () => {
            const result = service.validateProjectPath('');
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('empty')));
        });

        test('Should reject whitespace-only path', () => {
            const result = service.validateProjectPath('   ');
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('empty')));
        });

        test('Should reject non-string path', () => {
            const result = service.validateProjectPath(123 as unknown as string);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('must be a string')));
        });

        test('Should warn about backslashes on non-Windows', () => {
            // Only test on non-Windows
            if (process.platform !== 'win32') {
                const result = service.validateProjectPath('path\\to\\projects');
                assert.ok(result.warnings.some(w => w.includes('backslashes')));
            }
        });

        test('Should warn about trailing separator', () => {
            const resultSlash = service.validateProjectPath('/path/to/projects/');
            assert.ok(resultSlash.warnings.some(w => w.includes('trailing separator')));
        });
    });

    // ============================================================================
    // SCHEMA TESTS
    // ============================================================================

    suite('getConfigurationSchema()', () => {
        test('Should return valid JSON schema', () => {
            const schema = service.getConfigurationSchema() as Record<string, unknown>;

            assert.ok(schema.$schema);
            assert.strictEqual(schema.type, 'object');
            assert.ok(Array.isArray(schema.required));
            assert.ok(schema.properties);
        });

        test('Should include required properties in schema', () => {
            const schema = service.getConfigurationSchema() as Record<string, unknown>;
            const required = schema.required as string[];

            assert.ok(required.includes('schemaVersion'));
            assert.ok(required.includes('project-paths'));
            assert.ok(required.includes('gateways'));
        });

        test('Should define schema version enum', () => {
            const schema = service.getConfigurationSchema() as Record<string, unknown>;
            const properties = schema.properties as Record<string, unknown>;
            const schemaVersionProp = properties.schemaVersion as Record<string, unknown>;

            assert.ok(Array.isArray(schemaVersionProp.enum));
            assert.ok((schemaVersionProp.enum as string[]).includes('0.1'));
            assert.ok((schemaVersionProp.enum as string[]).includes('0.2'));
        });
    });

    // ============================================================================
    // SETTINGS VALIDATION TESTS
    // ============================================================================

    suite('Settings Validation', () => {
        test('Should accept valid boolean settings', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path'],
                gateways: { gw: { host: 'localhost' } },
                settings: {
                    showInheritedResources: true,
                    groupResourcesByType: false,
                    autoRefreshProjects: true
                }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, true);
        });

        test('Should reject non-boolean for boolean settings', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path'],
                gateways: { gw: { host: 'localhost' } },
                settings: { groupResourcesByType: 'true' }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('groupResourcesByType')));
        });

        test('Should validate searchHistoryLimit', async () => {
            const validConfig = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path'],
                gateways: { gw: { host: 'localhost' } },
                settings: { searchHistoryLimit: 50 }
            });

            const invalidConfig = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path'],
                gateways: { gw: { host: 'localhost' } },
                settings: { searchHistoryLimit: -1 }
            });

            const validResult = await service.validateConfiguration(validConfig);
            const invalidResult = await service.validateConfiguration(invalidConfig);

            assert.strictEqual(validResult.isValid, true);
            assert.strictEqual(invalidResult.isValid, false);
        });

        test('Should reject non-object settings', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path'],
                gateways: { gw: { host: 'localhost' } },
                settings: 'invalid'
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('Settings must be an object')));
        });
    });

    // ============================================================================
    // MULTIPLE GATEWAYS VALIDATION TESTS
    // ============================================================================

    suite('Multiple Gateways Validation', () => {
        test('Should validate multiple valid gateways', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path'],
                gateways: {
                    dev: { host: 'dev.example.com', port: 8088 },
                    staging: { host: 'staging.example.com', port: 8088 },
                    prod: {
                        environments: {
                            primary: { host: 'prod1.example.com', port: 443, ssl: true },
                            secondary: { host: 'prod2.example.com', port: 443, ssl: true }
                        },
                        defaultEnvironment: 'primary'
                    }
                }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, true);
        });

        test('Should report errors for each invalid gateway', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path'],
                gateways: {
                    gw1: { port: 8088 }, // Missing host
                    gw2: { host: 'example.com', port: 99999 } // Invalid port
                }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes("'gw1'")));
            assert.ok(result.errors.some(e => e.includes("'gw2'")));
        });

        test('Should reject non-object gateways', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path'],
                gateways: 'invalid'
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('Gateways must be an object')));
        });
    });

    // ============================================================================
    // PROJECT PATHS ARRAY VALIDATION TESTS
    // ============================================================================

    suite('Project Paths Array Validation', () => {
        test('Should validate array of valid paths', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/path1', '/path2', './relative'],
                gateways: { gw: { host: 'localhost' } }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, true);
        });

        test('Should reject non-array project-paths', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': '/single/path',
                gateways: { gw: { host: 'localhost' } }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('must be an array')));
        });

        test('Should report path index in error messages', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/valid', '', '/another'],
                gateways: { gw: { host: 'localhost' } }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('path 1') || e.includes('index 1')));
        });

        test('Should reject non-string path in array', async () => {
            const config = createConfig({
                schemaVersion: '0.2',
                'project-paths': ['/valid', 123],
                gateways: { gw: { host: 'localhost' } }
            });

            const result = await service.validateConfiguration(config);
            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('must be a string')));
        });
    });
});
