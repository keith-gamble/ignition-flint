/**
 * @module ConfigMigrationService.test
 * @description Unit tests for ConfigMigrationService
 */

import * as assert from 'assert';

import { ServiceContainer } from '../../../../core/ServiceContainer';
import { ServiceStatus } from '../../../../core/types/services';
import { ConfigMigrationService } from '../../../../services/config/ConfigMigrationService';

suite('ConfigMigrationService Test Suite', () => {
    let service: ConfigMigrationService;
    let container: ServiceContainer;

    setup(async () => {
        container = new ServiceContainer();
        service = new ConfigMigrationService(container);
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
            const newService = new ConfigMigrationService(container);
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);

            await newService.initialize();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
        });

        test('Should start after initialization', async () => {
            const newService = new ConfigMigrationService(container);
            await newService.initialize();
            await newService.start();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);
            await newService.dispose();
        });

        test('Should reject start before initialization', async () => {
            const newService = new ConfigMigrationService(container);
            try {
                await newService.start();
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('must be initialized'));
            }
        });

        test('Should dispose correctly', async () => {
            const newService = new ConfigMigrationService(container);
            await newService.initialize();
            await newService.dispose();
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);
        });

        test('Should stop correctly', async () => {
            const newService = new ConfigMigrationService(container);
            await newService.initialize();
            await newService.start();
            await newService.stop();
            // Service status doesn't change on stop in this implementation
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);
            await newService.dispose();
        });
    });

    // ============================================================================
    // NEEDS MIGRATION TESTS
    // ============================================================================

    suite('needsMigration()', () => {
        test('Should return true for missing schemaVersion', () => {
            const config = {
                'project-paths': ['/path'],
                gateways: {}
            };

            assert.strictEqual(service.needsMigration(config), true);
        });

        test('Should return true for outdated schemaVersion', () => {
            const config = {
                schemaVersion: '0.1',
                'project-paths': ['/path'],
                gateways: {}
            };

            assert.strictEqual(service.needsMigration(config), true);
        });

        test('Should return false for current schemaVersion', () => {
            const config = {
                schemaVersion: '0.2',
                'project-paths': ['/path'],
                gateways: {}
            };

            assert.strictEqual(service.needsMigration(config), false);
        });

        test('Should return false for null config', () => {
            assert.strictEqual(service.needsMigration(null), false);
        });

        test('Should return false for undefined config', () => {
            assert.strictEqual(service.needsMigration(undefined), false);
        });

        test('Should return false for non-object config', () => {
            assert.strictEqual(service.needsMigration('string'), false);
            assert.strictEqual(service.needsMigration(123), false);
        });
    });

    // ============================================================================
    // MIGRATE CONFIGURATION TESTS
    // ============================================================================

    suite('migrateConfiguration()', () => {
        test('Should migrate from 0.1 to current version', async () => {
            const config = {
                schemaVersion: '0.1',
                'project-paths': ['/path'],
                gateways: {
                    'test-gw': { host: 'localhost' }
                }
            };

            const migrated = await service.migrateConfiguration(config);
            assert.strictEqual(migrated.schemaVersion, '0.2');
        });

        test('Should auto-detect Ignition 8.1 version from gateway ID', async () => {
            const config = {
                schemaVersion: '0.1',
                'project-paths': ['/path'],
                gateways: {
                    gateway81: { host: 'localhost' },
                    'my-8.1-gateway': { host: 'localhost' }
                }
            };

            const migrated = await service.migrateConfiguration(config);
            const gw81 = migrated.gateways?.['gateway81'] as unknown as Record<string, unknown>;
            const gw81Dash = migrated.gateways?.['my-8.1-gateway'] as unknown as Record<string, unknown>;

            assert.strictEqual(gw81?.ignitionVersion, '8.1');
            assert.strictEqual(gw81Dash?.ignitionVersion, '8.1');
        });

        test('Should auto-detect Ignition 8.3 version from gateway ID', async () => {
            const config = {
                schemaVersion: '0.1',
                'project-paths': ['/path'],
                gateways: {
                    gateway83: { host: 'localhost' },
                    'my-8.3-gateway': { host: 'localhost' }
                }
            };

            const migrated = await service.migrateConfiguration(config);
            const gw83 = migrated.gateways?.['gateway83'] as unknown as Record<string, unknown>;
            const gw83Dash = migrated.gateways?.['my-8.3-gateway'] as unknown as Record<string, unknown>;

            assert.strictEqual(gw83?.ignitionVersion, '8.3');
            assert.strictEqual(gw83Dash?.ignitionVersion, '8.3');
        });

        test('Should not overwrite existing ignitionVersion', async () => {
            const config = {
                schemaVersion: '0.1',
                'project-paths': ['/path'],
                gateways: {
                    gateway81: { host: 'localhost', ignitionVersion: '8.2' }
                }
            };

            const migrated = await service.migrateConfiguration(config);
            const gw = migrated.gateways?.['gateway81'] as unknown as Record<string, unknown>;

            assert.strictEqual(gw?.ignitionVersion, '8.2');
        });

        test('Should not set version when cannot auto-detect', async () => {
            const config = {
                schemaVersion: '0.1',
                'project-paths': ['/path'],
                gateways: {
                    production: { host: 'localhost' }
                }
            };

            const migrated = await service.migrateConfiguration(config);
            const gw = migrated.gateways?.['production'] as unknown as Record<string, unknown>;

            assert.strictEqual(gw?.ignitionVersion, undefined);
        });

        test('Should handle config without gateways', async () => {
            const config = {
                schemaVersion: '0.1',
                'project-paths': ['/path']
            };

            const migrated = await service.migrateConfiguration(config);
            assert.strictEqual(migrated.schemaVersion, '0.2');
        });

        test('Should handle config with null gateways', async () => {
            const config = {
                schemaVersion: '0.1',
                'project-paths': ['/path'],
                gateways: null
            };

            const migrated = await service.migrateConfiguration(config);
            assert.strictEqual(migrated.schemaVersion, '0.2');
        });

        test('Should handle missing schemaVersion', async () => {
            const config = {
                'project-paths': ['/path'],
                gateways: { gw: { host: 'localhost' } }
            };

            const migrated = await service.migrateConfiguration(config);
            assert.strictEqual(migrated.schemaVersion, '0.2');
        });

        test('Should return null/undefined as-is', async () => {
            const nullResult = await service.migrateConfiguration(null);
            const undefinedResult = await service.migrateConfiguration(undefined);

            assert.strictEqual(nullResult, null);
            assert.strictEqual(undefinedResult, undefined);
        });

        test('Should return non-object as-is', async () => {
            const stringResult = await service.migrateConfiguration('string');
            assert.strictEqual(stringResult, 'string');
        });

        test('Should keep existing config properties', async () => {
            const config = {
                schemaVersion: '0.1',
                'project-paths': ['/path/to/projects'],
                gateways: {
                    'test-gw': { host: 'localhost', port: 8088 }
                },
                settings: { showInheritedResources: true }
            };

            const migrated = await service.migrateConfiguration(config);
            assert.deepStrictEqual(migrated['project-paths'], ['/path/to/projects']);
            assert.strictEqual((migrated.settings as unknown as Record<string, unknown>)?.showInheritedResources, true);
        });
    });

    // ============================================================================
    // VERSION INFO TESTS
    // ============================================================================

    suite('getSupportedVersions()', () => {
        test('Should return supported versions', () => {
            const versions = service.getSupportedVersions();

            assert.ok(Array.isArray(versions));
            assert.ok(versions.includes('0.1'));
            assert.ok(versions.includes('0.2'));
        });

        test('Should return frozen array', () => {
            const versions = service.getSupportedVersions();

            assert.ok(Object.isFrozen(versions));
        });
    });

    suite('getCurrentSchemaVersion()', () => {
        test('Should return current version', () => {
            const version = service.getCurrentSchemaVersion();

            assert.strictEqual(version, '0.2');
        });
    });

    // ============================================================================
    // MIGRATION INFO TESTS
    // ============================================================================

    suite('getMigrationInfo()', () => {
        test('Should return no migration needed for current version', () => {
            const info = service.getMigrationInfo('0.2');

            assert.strictEqual(info.canMigrate, false);
            assert.strictEqual(info.steps.length, 0);
            assert.strictEqual(info.warnings.length, 0);
        });

        test('Should return migration steps from 0.1', () => {
            const info = service.getMigrationInfo('0.1');

            assert.strictEqual(info.canMigrate, true);
            assert.ok(info.steps.length > 0);
            assert.ok(info.steps.some(s => s.includes('ignitionVersion')));
        });

        test('Should return migration steps for missing version', () => {
            const info = service.getMigrationInfo('');

            assert.strictEqual(info.canMigrate, true);
            assert.ok(info.steps.length > 0);
        });

        test('Should include warnings about auto-detection', () => {
            const info = service.getMigrationInfo('0.1');

            assert.ok(info.warnings.some(w => w.includes('auto-detected')));
        });

        test('Should return frozen arrays', () => {
            const info = service.getMigrationInfo('0.1');

            assert.ok(Object.isFrozen(info.steps));
            assert.ok(Object.isFrozen(info.warnings));
        });
    });
});
