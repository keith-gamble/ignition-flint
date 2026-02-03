/**
 * @module ResourceValidationService.test
 * @description Unit tests for ResourceValidationService
 */

import * as assert from 'assert';
import * as path from 'path';

import * as vscode from 'vscode';

import { ServiceContainer } from '../../../../core/ServiceContainer';
import { ResourceFileInfo } from '../../../../core/types/resources';
import { ServiceStatus } from '../../../../core/types/services';
import { ResourceValidationService } from '../../../../services/resources/ResourceValidationService';

suite('ResourceValidationService Test Suite', () => {
    let service: ResourceValidationService;
    let container: ServiceContainer;

    setup(async () => {
        container = new ServiceContainer();
        // Don't register ResourceTypeProviderRegistry to keep tests simple
        service = new ResourceValidationService(container);
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
            const newService = new ResourceValidationService(container);
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);

            await newService.initialize();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
        });

        test('Should start after initialization', async () => {
            const newService = new ResourceValidationService(container);
            await newService.initialize();
            await newService.start();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);
            await newService.dispose();
        });

        test('Should throw when starting before initialization', async () => {
            const newService = new ResourceValidationService(container);
            try {
                await newService.start();
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('must be initialized'));
            }
        });

        test('Should stop correctly', async () => {
            const newService = new ResourceValidationService(container);
            await newService.initialize();
            await newService.start();
            await newService.stop();
            // Status remains RUNNING until dispose
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);
            await newService.dispose();
        });

        test('Should dispose and clear rules', async () => {
            const newService = new ResourceValidationService(container);
            await newService.initialize();
            await newService.dispose();
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);

            // Stats should show cleared rules
            const stats = newService.getValidationStats();
            assert.strictEqual(stats.totalRules, 0);
            assert.strictEqual(stats.globalRules, 0);
        });
    });

    // ============================================================================
    // VALIDATION RULE REGISTRATION TESTS
    // ============================================================================

    suite('Validation Rule Registration', () => {
        test('Should register a validation rule for resource type', () => {
            service.registerValidationRule('test-type', {
                id: 'test-rule',
                name: 'Test Rule',
                description: 'Test validation rule',
                severity: 'error',
                validator: () => Promise.resolve([])
            });

            const stats = service.getValidationStats();
            assert.ok(stats.rulesByType['test-type'] !== undefined);
            assert.ok(stats.rulesByType['test-type'] >= 1);
        });

        test('Should register multiple rules for same type', () => {
            service.registerValidationRule('multi-rule-type', {
                id: 'rule-1',
                name: 'Rule 1',
                description: 'First rule',
                severity: 'error',
                validator: () => Promise.resolve([])
            });

            service.registerValidationRule('multi-rule-type', {
                id: 'rule-2',
                name: 'Rule 2',
                description: 'Second rule',
                severity: 'warning',
                validator: () => Promise.resolve([])
            });

            const stats = service.getValidationStats();
            assert.ok(stats.rulesByType['multi-rule-type'] >= 2);
        });

        test('Should register global validation rule', () => {
            const initialStats = service.getValidationStats();
            const initialGlobalRules = initialStats.globalRules;

            service.registerGlobalValidationRule({
                id: 'global-rule',
                name: 'Global Rule',
                description: 'A global validation rule',
                severity: 'warning',
                validator: () => Promise.resolve([])
            });

            const newStats = service.getValidationStats();
            assert.strictEqual(newStats.globalRules, initialGlobalRules + 1);
        });

        test('Should unregister a validation rule', () => {
            service.registerValidationRule('unregister-test', {
                id: 'removable-rule',
                name: 'Removable Rule',
                description: 'A rule that will be removed',
                severity: 'error',
                validator: () => Promise.resolve([])
            });

            const result = service.unregisterValidationRule('unregister-test', 'removable-rule');
            assert.strictEqual(result, true);
        });

        test('Should return false when unregistering non-existent rule', () => {
            const result = service.unregisterValidationRule('non-existent', 'non-existent');
            assert.strictEqual(result, false);
        });

        test('Should remove type entry when last rule is unregistered', () => {
            service.registerValidationRule('cleanup-test', {
                id: 'only-rule',
                name: 'Only Rule',
                description: 'The only rule',
                severity: 'error',
                validator: () => Promise.resolve([])
            });

            service.unregisterValidationRule('cleanup-test', 'only-rule');

            const stats = service.getValidationStats();
            assert.strictEqual(stats.rulesByType['cleanup-test'], undefined);
        });
    });

    // ============================================================================
    // SINGLE RESOURCE VALIDATION TESTS
    // ============================================================================

    suite('validateResource()', () => {
        test('Should return valid result for empty files', async () => {
            const result = await service.validateResource('/test/resource', 'test-type', '/test/project', []);

            assert.ok(typeof result.isValid === 'boolean');
            assert.ok(Array.isArray(result.errors));
            assert.ok(Array.isArray(result.warnings));
        });

        test('Should validate resource with existing files', async () => {
            // Use a file that actually exists in the workspace
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const testFilePath = path.join(workspaceFolder.uri.fsPath, 'package.json');
            const files: ResourceFileInfo[] = [{ name: 'package.json', path: testFilePath }];

            const result = await service.validateResource(
                '/test/resource',
                'test-type',
                workspaceFolder.uri.fsPath,
                files
            );

            assert.ok(typeof result.isValid === 'boolean');
        });

        test('Should detect missing files', async () => {
            const files: ResourceFileInfo[] = [{ name: 'missing.txt', path: '/non/existent/path/missing.txt' }];

            const result = await service.validateResource('/test/resource', 'test-type', '/test/project', files);

            // Should have errors for missing files
            assert.ok(result.errors.length > 0);
            assert.strictEqual(result.isValid, false);
        });

        test('Should include metadata in result', async () => {
            const result = await service.validateResource('/test/resource', 'test-type', '/test/project', [], {
                customField: 'value'
            });

            assert.ok(result.metadata !== undefined);
        });

        test('Should fire validation complete event', async () => {
            let eventFired = false;
            let eventResourcePath: string | undefined;

            const disposable = service.onValidationComplete(data => {
                eventFired = true;
                eventResourcePath = data.resourcePath;
            });

            await service.validateResource('/test/event-resource', 'test-type', '/test/project', []);

            disposable.dispose();

            assert.strictEqual(eventFired, true);
            assert.strictEqual(eventResourcePath, '/test/event-resource');
        });

        test('Should execute custom validation rules', async () => {
            let ruleExecuted = false;

            service.registerValidationRule('custom-type', {
                id: 'custom-rule',
                name: 'Custom Rule',
                description: 'A custom validation rule',
                severity: 'error',
                validator: () => {
                    ruleExecuted = true;
                    return Promise.resolve([]);
                }
            });

            await service.validateResource('/test/resource', 'custom-type', '/test/project', []);

            assert.strictEqual(ruleExecuted, true);
        });

        test('Should return issues from custom rules', async () => {
            service.registerValidationRule('issue-type', {
                id: 'issue-rule',
                name: 'Issue Rule',
                description: 'A rule that returns issues',
                severity: 'error',
                validator: () =>
                    Promise.resolve([
                        {
                            ruleId: 'issue-rule',
                            severity: 'error' as const,
                            message: 'Test error'
                        },
                        {
                            ruleId: 'issue-rule',
                            severity: 'warning' as const,
                            message: 'Test warning'
                        }
                    ])
            });

            const result = await service.validateResource('/test/resource', 'issue-type', '/test/project', []);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('Test error')));
            assert.ok(result.warnings.some(w => w.includes('Test warning')));
        });
    });

    // ============================================================================
    // BATCH VALIDATION TESTS
    // ============================================================================

    suite('validateResources()', () => {
        test('Should validate multiple resources', async () => {
            const resources = [
                {
                    resourcePath: '/test/resource1',
                    resourceType: 'test-type',
                    projectPath: '/test/project',
                    files: []
                },
                {
                    resourcePath: '/test/resource2',
                    resourceType: 'test-type',
                    projectPath: '/test/project',
                    files: []
                }
            ];

            const results = await service.validateResources(resources);

            assert.strictEqual(results.length, 2);
            assert.ok(Array.isArray(results[0].errors));
            assert.ok(Array.isArray(results[1].errors));
        });

        test('Should handle mixed valid and invalid resources', async () => {
            const resources = [
                {
                    resourcePath: '/test/valid',
                    resourceType: 'test-type',
                    projectPath: '/test/project',
                    files: []
                },
                {
                    resourcePath: '/test/invalid',
                    resourceType: 'test-type',
                    projectPath: '/test/project',
                    files: [{ name: 'missing.txt', path: '/non/existent/missing.txt' }]
                }
            ];

            const results = await service.validateResources(resources);

            assert.strictEqual(results.length, 2);
            // Second resource should have errors
            assert.ok(results[1].errors.length > 0);
        });

        test('Should continue validation even if one fails', async () => {
            // Register a rule that throws
            service.registerValidationRule('error-type', {
                id: 'error-rule',
                name: 'Error Rule',
                description: 'A rule that throws',
                severity: 'error',
                validator: () => Promise.reject(new Error('Intentional error'))
            });

            const resources = [
                {
                    resourcePath: '/test/resource1',
                    resourceType: 'error-type',
                    projectPath: '/test/project',
                    files: []
                },
                {
                    resourcePath: '/test/resource2',
                    resourceType: 'test-type',
                    projectPath: '/test/project',
                    files: []
                }
            ];

            const results = await service.validateResources(resources);

            // Both should have results
            assert.strictEqual(results.length, 2);
        });
    });

    // ============================================================================
    // VALIDATION STATS TESTS
    // ============================================================================

    suite('getValidationStats()', () => {
        test('Should return validation statistics', () => {
            const stats = service.getValidationStats();

            assert.ok(typeof stats.totalRules === 'number');
            assert.ok(typeof stats.rulesByType === 'object');
            assert.ok(typeof stats.globalRules === 'number');
        });

        test('Should return frozen stats objects', () => {
            const stats = service.getValidationStats();

            assert.ok(Object.isFrozen(stats));
            assert.ok(Object.isFrozen(stats.rulesByType));
        });

        test('Should include built-in rules in count', () => {
            const stats = service.getValidationStats();

            // Should have built-in global rules
            assert.ok(stats.globalRules > 0, 'Should have built-in global rules');
        });
    });

    // ============================================================================
    // BUILT-IN RULES TESTS
    // ============================================================================

    suite('Built-in Rules', () => {
        test('Should have file-exists rule', async () => {
            // Validate with non-existent file to trigger file-exists rule
            const files: ResourceFileInfo[] = [{ name: 'missing.txt', path: '/does/not/exist/missing.txt' }];

            const result = await service.validateResource('/test/resource', 'test-type', '/test/project', files);

            assert.ok(result.errors.some(e => e.includes('does not exist')));
        });

        test('Should have resource-json rule', async () => {
            // Validate without resource.json to trigger warning
            const result = await service.validateResource('/test/resource', 'test-type', '/test/project', []);

            // Should have warning about missing resource.json
            assert.ok(result.warnings.some(w => w.includes('resource.json')));
        });
    });

    // ============================================================================
    // EVENT TESTS
    // ============================================================================

    suite('Events', () => {
        test('Should expose onValidationComplete event', () => {
            assert.ok(service.onValidationComplete);
            assert.ok(typeof service.onValidationComplete === 'function');
        });

        test('Should include duration in event', async () => {
            let eventDuration: number | undefined;

            const disposable = service.onValidationComplete(data => {
                eventDuration = data.duration;
            });

            await service.validateResource('/test/resource', 'test-type', '/test/project', []);

            disposable.dispose();

            assert.ok(eventDuration !== undefined);
            assert.ok(eventDuration >= 0);
        });
    });
});
