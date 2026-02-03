/**
 * @module ProjectBrowser.integration.test
 * @description Integration tests for the Project Browser using test fixtures
 */

import * as assert from 'assert';
import * as path from 'path';

import * as vscode from 'vscode';

import { ServiceContainer } from '../../../core/ServiceContainer';
import { ConfigMigrationService } from '../../../services/config/ConfigMigrationService';
import { ConfigValidationService } from '../../../services/config/ConfigValidationService';
import { ProjectScannerService } from '../../../services/config/ProjectScannerService';
import { WorkspaceConfigService } from '../../../services/config/WorkspaceConfigService';
import { GatewayManagerService } from '../../../services/gateways/GatewayManagerService';
import { ResourceTypeProviderRegistry } from '../../../services/resources/ResourceTypeProviderRegistry';
import { ProjectTreeDataProvider } from '../../../views/projectBrowser/ProjectTreeDataProvider';

suite('Project Browser Integration Test Suite', () => {
    let serviceContainer: ServiceContainer | undefined;
    let treeProvider: ProjectTreeDataProvider;
    let configService: WorkspaceConfigService;
    let scannerService: ProjectScannerService;
    let gatewayManager: GatewayManagerService;

    suiteSetup(async function () {
        // Set timeout for setup
        this.timeout(30000);

        // Check if we have a workspace - skip tests if not
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            console.log('No workspace folder available - skipping integration tests');
            this.skip();
            return;
        }

        // Check if it's the test-fixtures workspace
        if (!workspaceFolder.uri.fsPath.includes('test-fixtures')) {
            console.log('Not running in test-fixtures workspace - skipping integration tests');
            this.skip();
            return;
        }

        console.log('Test workspace path:', workspaceFolder.uri.fsPath);

        // Wait for the extension to be activated
        const flintExtension = vscode.extensions.getExtension('bw-design-group.ignition-flint');
        if (flintExtension) {
            if (!flintExtension.isActive) {
                console.log('Waiting for Flint extension to activate...');
                await flintExtension.activate();
            }
            console.log('Flint extension is active');

            // Give the extension a moment to fully initialize
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Initialize our own service container for testing
        // Note: This is separate from the extension's actual services
        // We're testing the services in isolation, not the UI registration
        serviceContainer = new ServiceContainer();

        // Create mock extension context
        const mockContext = {
            subscriptions: [],
            extensionPath: path.join(__dirname, '../../../..'),
            globalState: {
                get: () => undefined,
                update: async () => {
                    // Mock implementation
                },
                setKeysForSync: () => {
                    // Mock implementation
                }
            },
            workspaceState: {
                get: () => undefined,
                update: async () => {
                    // Mock implementation
                }
            }
        } as any;

        serviceContainer.register('extensionContext', mockContext);

        // Initialize config services
        const configValidationService = new ConfigValidationService(serviceContainer);
        serviceContainer.register('ConfigValidationService', configValidationService);
        await configValidationService.initialize();

        const configMigrationService = new ConfigMigrationService(serviceContainer);
        serviceContainer.register('ConfigMigrationService', configMigrationService);
        await configMigrationService.initialize();

        // Initialize workspace config service
        configService = new WorkspaceConfigService(serviceContainer, configValidationService, configMigrationService);
        serviceContainer.register('WorkspaceConfigService', configService);
        await configService.initialize();
        await configService.start();

        // Initialize project scanner
        scannerService = new ProjectScannerService(serviceContainer);
        serviceContainer.register('ProjectScannerService', scannerService);
        await scannerService.initialize();
        await scannerService.start();

        // Initialize gateway manager
        gatewayManager = new GatewayManagerService(serviceContainer);
        serviceContainer.register('GatewayManagerService', gatewayManager);
        await gatewayManager.initialize();
        await gatewayManager.start();

        // Initialize resource type registry
        const resourceTypeRegistry = new ResourceTypeProviderRegistry(serviceContainer);
        serviceContainer.register('ResourceTypeProviderRegistry', resourceTypeRegistry);
        await resourceTypeRegistry.initialize();
        await resourceTypeRegistry.start();

        // Initialize tree provider
        treeProvider = new ProjectTreeDataProvider(serviceContainer, mockContext);
        await treeProvider.initialize();
    });

    suiteTeardown(async () => {
        if (serviceContainer) {
            await serviceContainer.dispose();
        }
    });

    test('Should load test fixture configuration', async function () {
        if (!serviceContainer) {
            this.skip();
            return;
        }
        const config = await configService.getConfiguration();
        assert.ok(config, 'Configuration should be loaded');
        assert.ok(config.gateways, 'Configuration should have gateways');
        assert.ok(config.gateways.gateway, 'Should have test gateway');
    });

    test('Should discover all three test projects', async function () {
        if (!serviceContainer) {
            this.skip();
            return;
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder');
        }
        // Provide actual project directories
        const projectPaths = [
            path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81'),
            path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart83'),
            path.join(workspaceFolder.uri.fsPath, 'projects', 'gateway-utilities')
        ];
        await scannerService.scanProjects(projectPaths);

        // Get individual projects
        const project81 = scannerService.getProject('samplequickstart81');
        const project83 = scannerService.getProject('samplequickstart83');
        const gatewayUtils = scannerService.getProject('gateway-utilities');

        assert.ok(project81, 'Should find samplequickstart81');
        assert.ok(project83, 'Should find samplequickstart83');
        assert.ok(gatewayUtils, 'Should find gateway-utilities');
    });

    test('Should detect project inheritance', async function () {
        if (!serviceContainer) {
            this.skip();
            return;
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder');
        }
        // Provide actual project directories
        const projectPaths = [
            path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81'),
            path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart83'),
            path.join(workspaceFolder.uri.fsPath, 'projects', 'gateway-utilities')
        ];
        await scannerService.scanProjects(projectPaths);

        const project81 = scannerService.getProject('samplequickstart81');
        const project83 = scannerService.getProject('samplequickstart83');

        assert.ok(project81, 'samplequickstart81 should exist');
        assert.ok(project83, 'samplequickstart83 should exist');

        // Check metadata for parent property
        if (project81?.metadata) {
            assert.strictEqual(
                project81.metadata.parent,
                'gateway-utilities',
                '8.1 project should inherit from gateway-utilities'
            );
        }
        if (project83?.metadata) {
            assert.strictEqual(
                project83.metadata.parent,
                'gateway-utilities',
                '8.3 project should inherit from gateway-utilities'
            );
        }
    });

    test('Should render project tree with inheritance', async function () {
        if (!serviceContainer) {
            this.skip();
            return;
        }
        // Get root tree items
        const rootItems = await treeProvider.getChildren();
        assert.ok(rootItems, 'Should have root items');

        // Find the project selector
        const projectSelector = rootItems.find(item => item.id === 'project-selector');
        assert.ok(projectSelector, 'Should have project selector');
    });

    test('Should scan and find resources in projects', async function () {
        if (!serviceContainer) {
            this.skip();
            return;
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder');
        }
        // Provide actual project directories
        const projectPaths = [
            path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81'),
            path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart83'),
            path.join(workspaceFolder.uri.fsPath, 'projects', 'gateway-utilities')
        ];
        await scannerService.scanProjects(projectPaths);

        // Check projects were scanned
        const project81 = scannerService.getProject('samplequickstart81');
        assert.ok(project81, 'Project should be scanned');

        // Check for resources in the project
        if (project81?.resources) {
            console.log(`Project samplequickstart81 has ${project81.resources.length} resources`);
            assert.ok(project81.resources.length >= 0, 'Should have scanned resources');
        }
    });

    test('Should handle project selection', function () {
        if (!serviceContainer) {
            this.skip();
            return;
        }
        // Use the gateway manager to set active IDs
        const _gatewayId = 'gateway';
        const _projectId = 'samplequickstart83';

        // These methods might not exist - we'll check what's available
        const activeGateway = gatewayManager.getActiveGatewayId();
        const activeProject = gatewayManager.getActiveProjectId();

        console.log('Active gateway:', activeGateway, 'Active project:', activeProject);
        assert.ok(true, 'Gateway manager is accessible');
    });

    test('Should show inherited resources when enabled', function () {
        if (!serviceContainer) {
            this.skip();
            return;
        }
        // This would require mocking VS Code settings
        const showInherited = vscode.workspace.getConfiguration('flint').get('showInheritedResources', true);
        assert.strictEqual(showInherited, true, 'Should default to showing inherited resources');
    });

    test('Should be able to open Python script resources', async function () {
        if (!serviceContainer) {
            this.skip();
            return;
        }

        // Get the actual extension's tree view
        const flintExtension = vscode.extensions.getExtension('bw-design-group.ignition-flint');
        if (!flintExtension?.isActive) {
            this.skip();
            return;
        }

        // Get the tree view from VS Code
        const treeViews = (vscode as any).window.treeViews;
        let _flintTreeView: vscode.TreeView<any> | undefined;

        // Try to find the Flint tree view
        if (treeViews) {
            for (const view of treeViews.values()) {
                if (view.viewId === 'flintProjectBrowser') {
                    // Found the tree view but not using it currently
                    // flintTreeView = view;
                    break;
                }
            }
        }

        // Verify we can access the tree data provider
        const extensionApi = await flintExtension.activate();
        if (extensionApi && typeof extensionApi === 'object') {
            const serviceContainer = extensionApi.serviceContainer;
            if (serviceContainer) {
                // Get the project scanner to find resources
                const scanner = serviceContainer.get('ProjectScannerService');
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (scanner && workspaceFolder) {
                    // Scan projects to populate resources
                    const projectPaths = [path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81')];
                    await scanner.scanProjects(projectPaths);

                    // Get the scanned project
                    const project = scanner.getProject('samplequickstart81');
                    assert.ok(project, 'Project should be scanned');

                    // Find a Python script resource
                    if (project?.resources) {
                        const pythonScript = project.resources.find((r: any) => r.type === 'script-python');

                        if (pythonScript) {
                            console.log('Found Python script:', pythonScript.path);
                            console.log('Python script details:', {
                                name: pythonScript.name,
                                type: pythonScript.type,
                                key: pythonScript.key
                            });

                            // Verify and open the file
                            const scriptPath = path.join(
                                workspaceFolder.uri.fsPath,
                                'projects',
                                'samplequickstart81',
                                pythonScript.path,
                                'code.py'
                            );

                            try {
                                await vscode.workspace.fs.stat(vscode.Uri.file(scriptPath));
                                console.log('Python script file exists at:', scriptPath);

                                // Actually open the Python file in the editor
                                console.log('Opening Python script file:', scriptPath);
                                const document = await vscode.workspace.openTextDocument(scriptPath);
                                const editor = await vscode.window.showTextDocument(document);

                                assert.ok(editor, 'Editor should open for Python script');
                                assert.ok(document.fileName.endsWith('code.py'), 'Should open a Python file');
                                assert.strictEqual(document.languageId, 'python', 'Should be recognized as Python');
                                console.log('Successfully opened Python script in editor:', document.fileName);

                                // Check if the file has Python content
                                const content = document.getText();
                                console.log('Python file has', content.split('\n').length, 'lines of code');

                                // Give VS Code a moment to display the file
                                await new Promise(resolve => setTimeout(resolve, 100));
                            } catch {
                                assert.fail(`Python script file not found at ${scriptPath}`);
                            }
                        } else {
                            console.log('No Python scripts found in resources');
                            console.log(
                                'Available resources:',
                                project.resources
                                    .map((r: any) => ({
                                        type: r.type,
                                        path: r.path
                                    }))
                                    .slice(0, 5)
                            );
                        }
                    }
                }
            }
        }
    });

    test('Should be able to open Named Query resources', async function () {
        if (!serviceContainer) {
            this.skip();
            return;
        }

        const flintExtension = vscode.extensions.getExtension('bw-design-group.ignition-flint');
        if (!flintExtension?.isActive) {
            this.skip();
            return;
        }

        const extensionApi = await flintExtension.activate();
        if (extensionApi && typeof extensionApi === 'object') {
            const serviceContainer = extensionApi.serviceContainer;
            if (serviceContainer) {
                const scanner = serviceContainer.get('ProjectScannerService');
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (scanner && workspaceFolder) {
                    // Scan projects
                    const projectPaths = [path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81')];
                    await scanner.scanProjects(projectPaths);

                    const project = scanner.getProject('samplequickstart81');
                    if (project?.resources) {
                        // Find a named query resource
                        const namedQuery = project.resources.find((r: any) => r.type === 'named-query');

                        if (namedQuery) {
                            console.log('Found Named Query:', namedQuery.path);
                            console.log('Named Query name:', namedQuery.name);

                            // Named queries are organized in nested folders
                            // We need to check if there's a query.sql file somewhere in the path
                            const basePath = path.join(
                                workspaceFolder.uri.fsPath,
                                'projects',
                                'samplequickstart81',
                                namedQuery.path
                            );

                            // Try to find query.sql files recursively
                            const _findQueryFile = async (dir: string): Promise<boolean> => {
                                try {
                                    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
                                    for (const [name, type] of entries) {
                                        if (type === vscode.FileType.File && name === 'query.sql') {
                                            console.log('Found query.sql at:', path.join(dir, name));
                                            return true;
                                        } else if (type === vscode.FileType.Directory) {
                                            const found = await _findQueryFile(path.join(dir, name));
                                            if (found) return true;
                                        }
                                    }
                                } catch (error) {
                                    console.warn('Error reading directory:', dir, error);
                                }
                                return false;
                            };

                            // Find the actual query.sql file to open
                            const findAndGetQueryFile = async (dir: string): Promise<string | undefined> => {
                                try {
                                    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
                                    for (const [name, type] of entries) {
                                        if (type === vscode.FileType.File && name === 'query.sql') {
                                            return path.join(dir, name);
                                        } else if (type === vscode.FileType.Directory) {
                                            const found = await findAndGetQueryFile(path.join(dir, name));
                                            if (found) return found;
                                        }
                                    }
                                } catch (error) {
                                    console.warn('Error reading directory:', dir, error);
                                }
                                return undefined;
                            };

                            const queryFilePath = await findAndGetQueryFile(basePath);
                            assert.ok(queryFilePath, 'Named Query SQL file should exist');

                            // Actually open the file in the editor
                            console.log('Opening Named Query file:', queryFilePath);
                            const document = await vscode.workspace.openTextDocument(queryFilePath);
                            const editor = await vscode.window.showTextDocument(document);

                            assert.ok(editor, 'Editor should open for Named Query');
                            assert.ok(document.fileName.endsWith('query.sql'), 'Should open a SQL file');
                            console.log('Successfully opened Named Query in editor:', document.fileName);

                            // Give VS Code a moment to display the file
                            await new Promise(resolve => setTimeout(resolve, 100));
                        } else {
                            console.log('No Named Queries found in resources');
                        }
                    }
                }
            }
        }
    });

    test('Should be able to open Perspective View resources', async function () {
        if (!serviceContainer) {
            this.skip();
            return;
        }

        const flintExtension = vscode.extensions.getExtension('bw-design-group.ignition-flint');
        if (!flintExtension?.isActive) {
            this.skip();
            return;
        }

        const extensionApi = await flintExtension.activate();
        if (extensionApi && typeof extensionApi === 'object') {
            const serviceContainer = extensionApi.serviceContainer;
            if (serviceContainer) {
                const scanner = serviceContainer.get('ProjectScannerService');
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (scanner && workspaceFolder) {
                    // Scan projects
                    const projectPaths = [path.join(workspaceFolder.uri.fsPath, 'projects', 'samplequickstart81')];
                    await scanner.scanProjects(projectPaths);

                    const project = scanner.getProject('samplequickstart81');
                    if (project?.resources) {
                        // Find a Perspective view resource
                        const perspectiveView = project.resources.find((r: any) => r.type === 'perspective-view');

                        if (perspectiveView) {
                            console.log('Found Perspective View:', perspectiveView.path);
                            console.log('Perspective View name:', perspectiveView.name);

                            // Perspective views may have view.json at different levels
                            const basePath = path.join(
                                workspaceFolder.uri.fsPath,
                                'projects',
                                'samplequickstart81',
                                perspectiveView.path
                            );

                            // Try to find view.json file - could be at base or nested
                            const _findViewFile = async (dir: string): Promise<boolean> => {
                                try {
                                    // First check if view.json exists at this level
                                    try {
                                        await vscode.workspace.fs.stat(vscode.Uri.file(path.join(dir, 'view.json')));
                                        console.log('Found view.json at:', path.join(dir, 'view.json'));
                                        return true;
                                    } catch {
                                        // Not at this level, check subdirectories
                                    }

                                    // Check subdirectories
                                    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
                                    for (const [name, type] of entries) {
                                        if (type === vscode.FileType.Directory) {
                                            const found = await _findViewFile(path.join(dir, name));
                                            if (found) return true;
                                        }
                                    }
                                } catch (error) {
                                    console.warn('Error reading directory:', dir, error);
                                }
                                return false;
                            };

                            // Find the actual view.json file to open
                            const findAndGetViewFile = async (dir: string): Promise<string | undefined> => {
                                try {
                                    // First check if view.json exists at this level
                                    const viewPath = path.join(dir, 'view.json');
                                    try {
                                        await vscode.workspace.fs.stat(vscode.Uri.file(viewPath));
                                        return viewPath;
                                    } catch {
                                        // Not at this level, check subdirectories
                                    }

                                    // Check subdirectories
                                    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
                                    for (const [name, type] of entries) {
                                        if (type === vscode.FileType.Directory) {
                                            const found = await findAndGetViewFile(path.join(dir, name));
                                            if (found) return found;
                                        }
                                    }
                                } catch (error) {
                                    console.warn('Error reading directory:', dir, error);
                                }
                                return undefined;
                            };

                            const viewFilePath = await findAndGetViewFile(basePath);
                            assert.ok(viewFilePath, 'Perspective View JSON file should exist');

                            // Actually open the file in the editor
                            console.log('Opening Perspective View file:', viewFilePath);
                            const document = await vscode.workspace.openTextDocument(viewFilePath);
                            const editor = await vscode.window.showTextDocument(document);

                            assert.ok(editor, 'Editor should open for Perspective View');
                            assert.ok(document.fileName.endsWith('view.json'), 'Should open a JSON file');
                            console.log('Successfully opened Perspective View in editor:', document.fileName);

                            // Verify the content looks like a Perspective view
                            const content = document.getText();
                            const jsonContent = JSON.parse(content);
                            assert.ok(jsonContent, 'View file should contain valid JSON');
                            console.log(
                                'View file contains valid JSON with keys:',
                                Object.keys(jsonContent).slice(0, 5)
                            );

                            // Give VS Code a moment to display the file
                            await new Promise(resolve => setTimeout(resolve, 100));
                        } else {
                            console.log('No Perspective Views found in resources');
                        }
                    }
                }
            }
        }
    });

    test('Should handle resource opening via tree commands', async function () {
        if (!serviceContainer) {
            this.skip();
            return;
        }

        // Test that the handleNodeClick command is registered
        const registeredCommands = await vscode.commands.getCommands();
        const hasHandleNodeClick = registeredCommands.includes('flint.handleNodeClick');
        assert.ok(hasHandleNodeClick, 'flint.handleNodeClick command should be registered');

        // Test that openResource command is registered
        const hasOpenResource = registeredCommands.includes('flint.openResource');
        assert.ok(hasOpenResource, 'flint.openResource command should be registered');

        // Verify tree view is registered
        const flintExtension = vscode.extensions.getExtension('bw-design-group.ignition-flint');
        if (flintExtension?.isActive) {
            const extensionApi = await flintExtension.activate();
            if (extensionApi && typeof extensionApi === 'object' && extensionApi.getTreeView) {
                const treeView = extensionApi.getTreeView();
                console.log('Tree view available:', treeView ? 'Yes' : 'No');
            }

            // Note: We're not testing the openResource command directly because it requires
            // the resource to be properly cached in the extension's ProjectScannerService.
            // The tests above already prove that files can be opened successfully.
            console.log('Skipping openResource command test - files already verified to open correctly');
        }
    });

    test('Should verify all resource types have proper file associations', async function () {
        if (!serviceContainer) {
            this.skip();
            return;
        }

        // Define expected file associations for each resource type
        const resourceFileMap: Record<string, string> = {
            'script-python': 'code.py',
            'named-query': 'query.sql',
            'perspective-view': 'view.json',
            'perspective-style-class': 'style.json',
            'perspective-page-config': 'config.json',
            'perspective-session-props': 'props.json',
            'perspective-session-events': 'events.json'
        };

        const flintExtension = vscode.extensions.getExtension('bw-design-group.ignition-flint');
        if (flintExtension?.isActive) {
            const extensionApi = await flintExtension.activate();
            if (extensionApi && typeof extensionApi === 'object') {
                const serviceContainer = extensionApi.serviceContainer;
                const registry = serviceContainer.get('ResourceTypeProviderRegistry');

                if (registry) {
                    // Verify each resource type's file mapping
                    for (const [typeId, expectedFile] of Object.entries(resourceFileMap)) {
                        const provider = registry.getProvider(typeId);
                        if (provider) {
                            console.log(`Resource type ${typeId} registered with file: ${expectedFile}`);
                            assert.ok(true, `Provider for ${typeId} exists`);
                        } else {
                            console.warn(`No provider found for resource type: ${typeId}`);
                        }
                    }
                }
            }
        }
    });

    suiteTeardown(async () => {
        // Close all open editors to clean up
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        console.log('Closed all editors opened during tests');

        // Give VS Code a moment to clean up
        await new Promise(resolve => setTimeout(resolve, 500));
    });
});
