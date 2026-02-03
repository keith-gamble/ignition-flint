/**
 * @module WorkspaceConfigService.test
 * @description Unit tests for WorkspaceConfigService
 * These tests run in VS Code's test environment with access to test-fixtures
 */

import * as assert from 'assert';
import * as path from 'path';

import * as vscode from 'vscode';

import { ServiceContainer } from '../../../../core/ServiceContainer';
import { ServiceStatus } from '../../../../core/types/services';
import { ConfigMigrationService } from '../../../../services/config/ConfigMigrationService';
import { ConfigValidationService } from '../../../../services/config/ConfigValidationService';
import { WorkspaceConfigService } from '../../../../services/config/WorkspaceConfigService';

suite('WorkspaceConfigService Test Suite', () => {
    let container: ServiceContainer;
    let validationService: ConfigValidationService;
    let migrationService: ConfigMigrationService;

    setup(async () => {
        container = new ServiceContainer();
        validationService = new ConfigValidationService(container);
        migrationService = new ConfigMigrationService(container);
        await validationService.initialize();
        await migrationService.initialize();
    });

    teardown(async () => {
        await validationService.dispose();
        await migrationService.dispose();
    });

    // ============================================================================
    // SERVICE INITIALIZATION TESTS
    // ============================================================================

    suite('Service Initialization', () => {
        test('Should initialize with valid configuration', async () => {
            // This test requires a workspace with flint.config.json
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();

            assert.strictEqual(service.getStatus(), ServiceStatus.RUNNING);

            await service.dispose();
        });

        test('Should reject start before initialization', async () => {
            const service = new WorkspaceConfigService(container, validationService, migrationService);

            try {
                await service.start();
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('must be initialized'));
            }
        });

        test('Should start after initialization', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();
            await service.start();

            assert.strictEqual(service.getStatus(), ServiceStatus.RUNNING);

            await service.dispose();
        });

        test('Should dispose correctly', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();
            await service.dispose();

            assert.strictEqual(service.getStatus(), ServiceStatus.STOPPED);
        });

        test('Should return STOPPED status when not initialized', () => {
            const service = new WorkspaceConfigService(container, validationService, migrationService);
            // Don't initialize - just check status
            assert.strictEqual(service.getStatus(), ServiceStatus.STOPPED);
        });
    });

    // ============================================================================
    // CONFIGURATION LOADING TESTS
    // ============================================================================

    suite('Configuration Loading', () => {
        test('Should load configuration from test fixtures', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();

            const config = await service.getConfiguration();

            assert.ok(config);
            assert.ok(config.schemaVersion);
            assert.ok(config['project-paths']);
            assert.ok(config.gateways);

            await service.dispose();
        });

        test('Should return configuration path', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();

            const configPath = service.getConfigurationPath();

            assert.ok(configPath);
            assert.ok(configPath.endsWith('flint.config.json'));

            await service.dispose();
        });

        test('Should check if configuration exists', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();

            const exists = await service.configurationExists();

            assert.strictEqual(exists, true);

            await service.dispose();
        });
    });

    // ============================================================================
    // GATEWAY MANAGEMENT TESTS
    // ============================================================================

    suite('Gateway Management', () => {
        test('Should get configured gateways', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();

            const gateways = await service.getGateways();

            assert.ok(gateways);
            assert.ok(typeof gateways === 'object');

            await service.dispose();
        });
    });

    // ============================================================================
    // PROJECT PATH TESTS
    // ============================================================================

    suite('Project Paths', () => {
        test('Should get project paths', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();

            const paths = await service.getProjectPaths();

            assert.ok(Array.isArray(paths));

            await service.dispose();
        });

        test('Should get raw project paths', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();

            const rawPaths = await service.getRawProjectPaths();

            assert.ok(Array.isArray(rawPaths));

            await service.dispose();
        });

        test('Should resolve relative paths to absolute', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();

            const paths = await service.getProjectPaths();

            // If there are any paths, they should be absolute
            paths.forEach(p => {
                assert.ok(path.isAbsolute(p), `Path should be absolute: ${p}`);
            });

            await service.dispose();
        });
    });

    // ============================================================================
    // VALIDATION TESTS
    // ============================================================================

    suite('Validation', () => {
        test('Should validate current configuration', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();

            const validation = await service.validateCurrentConfiguration();

            assert.ok(typeof validation.isValid === 'boolean');
            assert.ok(Array.isArray(validation.errors));
            assert.ok(Array.isArray(validation.warnings));

            await service.dispose();
        });

        test('Should return valid for test fixtures config', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();

            const validation = await service.validateCurrentConfiguration();

            // Test fixtures should have valid configuration
            assert.strictEqual(validation.isValid, true, `Validation errors: ${validation.errors.join(', ')}`);

            await service.dispose();
        });
    });

    // ============================================================================
    // EVENT TESTS
    // ============================================================================

    suite('Events', () => {
        test('Should expose onConfigChanged event', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();

            assert.ok(service.onConfigChanged);
            assert.ok(typeof service.onConfigChanged === 'function');

            await service.dispose();
        });
    });

    // ============================================================================
    // MIGRATION TESTS
    // ============================================================================

    suite('Migration', () => {
        test('Should check for migration needs', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const service = new WorkspaceConfigService(container, validationService, migrationService);
            await service.initialize();

            // This should return false for current test fixtures
            // (they should already be at current version)
            const migrated = await service.migrateConfiguration();
            assert.ok(typeof migrated === 'boolean');

            await service.dispose();
        });
    });
});
