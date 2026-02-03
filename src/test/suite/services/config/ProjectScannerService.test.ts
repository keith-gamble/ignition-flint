/**
 * @module ProjectScannerService.test
 * @description Unit tests for ProjectScannerService
 * These tests run against the test-fixtures workspace
 */

import * as assert from 'assert';
import * as path from 'path';

import * as vscode from 'vscode';

import { ServiceContainer } from '../../../../core/ServiceContainer';
import { ServiceStatus } from '../../../../core/types/services';
import { ProjectScannerService } from '../../../../services/config/ProjectScannerService';
import { ResourceTypeProviderRegistry } from '../../../../services/resources/ResourceTypeProviderRegistry';

suite('ProjectScannerService Test Suite', () => {
    let container: ServiceContainer;
    let service: ProjectScannerService;
    let registry: ResourceTypeProviderRegistry;

    setup(async () => {
        container = new ServiceContainer();
        registry = new ResourceTypeProviderRegistry(container);
        container.register('ResourceTypeProviderRegistry', registry);
        await registry.initialize();
        service = new ProjectScannerService(container);
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
            const newService = new ProjectScannerService(container);
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);

            await newService.initialize();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);

            await newService.dispose();
        });

        test('Should start after initialization', async () => {
            const newService = new ProjectScannerService(container);
            await newService.initialize();
            await newService.start();
            assert.strictEqual(newService.getStatus(), ServiceStatus.RUNNING);
            await newService.dispose();
        });

        test('Should throw when starting before initialization', async () => {
            const newService = new ProjectScannerService(container);
            try {
                await newService.start();
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('must be initialized'));
            }
        });

        test('Should stop and clear watchers', async () => {
            const newService = new ProjectScannerService(container);
            await newService.initialize();
            await newService.start();
            await newService.stop();
            // Check cache is cleared
            const stats = newService.getCacheStats();
            assert.strictEqual(stats.entries, 0);
            await newService.dispose();
        });

        test('Should dispose correctly', async () => {
            const newService = new ProjectScannerService(container);
            await newService.initialize();
            await newService.dispose();
            assert.strictEqual(newService.getStatus(), ServiceStatus.STOPPED);
        });
    });

    // ============================================================================
    // PROJECT DETECTION TESTS
    // ============================================================================

    suite('isIgnitionProject()', () => {
        test('Should detect valid Ignition project with project.json', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            // test-fixtures contains projects with project.json
            const projectPath = path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81');
            const isProject = await service.isIgnitionProject(projectPath);

            assert.strictEqual(isProject, true);
        });

        test('Should return false for non-project directory', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            // Root of test-fixtures shouldn't be a project itself
            const isProject = await service.isIgnitionProject(workspaceFolder.uri.fsPath);

            assert.strictEqual(isProject, false);
        });

        test('Should return false for non-existent path', async () => {
            const isProject = await service.isIgnitionProject('/nonexistent/path');
            assert.strictEqual(isProject, false);
        });
    });

    // ============================================================================
    // PROJECT SCANNING TESTS
    // ============================================================================

    suite('scanProject()', () => {
        test('Should scan valid project', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const projectPath = path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81');
            const result = await service.scanProject(projectPath);

            assert.ok(result);
            assert.strictEqual(result.projectPath, projectPath);
            assert.ok(result.projectName);
            assert.ok(Array.isArray(result.resources));
            assert.ok(result.scanTime >= 0);
            assert.ok(result.lastScanned);
        });

        test('Should return project metadata', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const projectPath = path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81');
            const result = await service.scanProject(projectPath);

            assert.ok(result.metadata);
            // Metadata should have at least name or title
            assert.ok(result.metadata.title || result.metadata.name);
        });

        test('Should use cache on second scan', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const projectPath = path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81');

            // First scan
            await service.scanProject(projectPath);
            const statsAfterFirst = service.getCacheStats();

            // Second scan
            await service.scanProject(projectPath);
            const statsAfterSecond = service.getCacheStats();

            assert.ok(statsAfterSecond.cacheHits > statsAfterFirst.cacheHits);
        });

        test('Should bypass cache when requested', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const projectPath = path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81');

            // First scan
            await service.scanProject(projectPath);

            // Second scan without cache
            const result = await service.scanProject(projectPath, false);

            assert.ok(result);
            assert.strictEqual(result.projectPath, projectPath);
        });

        test('Should throw for non-existent project path', async () => {
            try {
                await service.scanProject('/nonexistent/project/path');
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok(e instanceof Error);
            }
        });
    });

    // ============================================================================
    // MULTIPLE PROJECT SCANNING TESTS
    // ============================================================================

    suite('scanProjects()', () => {
        test('Should scan multiple projects', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const projectPaths = [
                path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81'),
                path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart83')
            ];

            const results = await service.scanProjects(projectPaths);

            assert.ok(Array.isArray(results));
            // At least some projects should be scanned (might filter invalid ones)
            assert.ok(results.length > 0);
        });

        test('Should handle errors gracefully', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            // Mix valid and invalid paths
            const projectPaths = [
                path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81'),
                '/nonexistent/path'
            ];

            // Should not throw, but filter out invalid results
            const results = await service.scanProjects(projectPaths);

            assert.ok(Array.isArray(results));
            // Should have at least the valid project
            assert.ok(results.length >= 1);
        });

        test('Should build inheritance chains', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            // Include both child project and gateway-utilities (parent)
            const projectPaths = [
                path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81'),
                path.join(workspaceFolder.uri.fsPath, 'projects', 'gateway-utilities')
            ];

            const results = await service.scanProjects(projectPaths);

            // Find child project
            const childProject = results.find(r => r.projectPath.includes('samplequickstart81'));

            if (childProject) {
                // It should have inheritance chain or inherited resources
                assert.ok(
                    Array.isArray(childProject.inheritanceChain) || Array.isArray(childProject.inheritedResources),
                    'Project should have inheritance info'
                );
            }
        });
    });

    // ============================================================================
    // CACHE MANAGEMENT TESTS
    // ============================================================================

    suite('Cache Management', () => {
        test('Should return cache statistics', () => {
            const stats = service.getCacheStats();

            assert.ok(typeof stats.entries === 'number');
            assert.ok(typeof stats.totalSize === 'number');
            assert.ok(typeof stats.hitRate === 'number');
            assert.ok(typeof stats.cacheHits === 'number');
            assert.ok(typeof stats.cacheMisses === 'number');
        });

        test('Should invalidate specific cache entry', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const projectPath = path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81');

            // Scan to populate cache
            await service.scanProject(projectPath);
            const statsAfterScan = service.getCacheStats();

            // Invalidate
            service.invalidateCache(projectPath);
            const statsAfterInvalidate = service.getCacheStats();

            assert.ok(statsAfterInvalidate.entries < statsAfterScan.entries);
        });

        test('Should clear all cache entries', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const projectPath = path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81');

            // Scan to populate cache
            await service.scanProject(projectPath);

            // Clear cache
            service.clearCache();
            const statsAfterClear = service.getCacheStats();

            assert.strictEqual(statsAfterClear.entries, 0);
        });

        test('Should track cache hit rate', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            const projectPath = path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81');

            // Clear cache first
            service.clearCache();

            // First scan - cache miss
            await service.scanProject(projectPath);

            // Second scan - cache hit
            await service.scanProject(projectPath);

            const stats = service.getCacheStats();

            // Should have at least one hit
            assert.ok(stats.cacheHits >= 1, 'Should have at least one cache hit');
        });
    });

    // ============================================================================
    // EVENT TESTS
    // ============================================================================

    suite('Events', () => {
        test('Should expose onScanComplete event', () => {
            assert.ok(service.onScanComplete);
            assert.ok(typeof service.onScanComplete === 'function');
        });

        test('Should fire event when scan completes', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('Skipping test - no workspace folder');
                return;
            }

            let eventFired = false;
            const disposable = service.onScanComplete(() => {
                eventFired = true;
            });

            const projectPath = path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81');

            // Force fresh scan by bypassing cache
            await service.scanProject(projectPath, false);

            disposable.dispose();

            assert.strictEqual(eventFired, true, 'onScanComplete event should have fired');
        });
    });
});
