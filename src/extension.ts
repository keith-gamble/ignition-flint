/**
 * @module Extension
 * @description Main Flint extension entry point - Modern service-based architecture
 */

import * as vscode from 'vscode';

import { CommandRegistry } from '@/commands/base/CommandRegistry';
import { AddGatewayCommand } from '@/commands/config/AddGatewayCommand';
import { AddProjectPathsCommand } from '@/commands/config/AddProjectPathsCommand';
import { GetStartedCommand } from '@/commands/config/GetStartedCommand';
import { OpenConfigCommand } from '@/commands/config/OpenConfigCommand';
import { RemoveGatewayCommand } from '@/commands/config/RemoveGatewayCommand';
import {
    AcceptCurrentScriptCommand,
    AcceptIncomingScriptCommand,
    CompareConflictScriptsCommand
} from '@/commands/conflict';
import { ClearIgnitionStubsCacheCommand } from '@/commands/debug/ClearIgnitionStubsCacheCommand';
import { DebugConfigCommand } from '@/commands/debug/DebugConfigCommand';
import { DownloadIgnitionStubsCommand } from '@/commands/debug/DownloadIgnitionStubsCommand';
import { CompareDecodedCommand, EditScriptCommand, PasteAsJsonCommand } from '@/commands/decode';
import { SelectEnvironmentCommand } from '@/commands/environments/SelectEnvironmentCommand';
import { NavigateToGatewayCommand } from '@/commands/gateway/NavigateToGatewayCommand';
import { OpenDesignerCommand } from '@/commands/gateway/OpenDesignerCommand';
import { SelectGatewayCommand } from '@/commands/gateway/SelectGatewayCommand';
import { OpenProjectJsonCommand } from '@/commands/project/OpenProjectJsonCommand';
import { RefreshProjectsCommand } from '@/commands/project/RefreshProjectsCommand';
import { SelectProjectCommand } from '@/commands/project/SelectProjectCommand';
import { ValidateProjectCommand } from '@/commands/project/ValidateProjectCommand';
import { CopyQualifiedPathCommand } from '@/commands/python/CopyQualifiedPathCommand';
import { CopySymbolPathCommand } from '@/commands/python/CopySymbolPathCommand';
import { NavigateToScriptElementCommand } from '@/commands/python/NavigateToScriptElementCommand';
import { CreateAllMissingCommand } from '@/commands/resourceJson/CreateAllMissingCommand';
import { CreateResourceJsonCommand } from '@/commands/resourceJson/CreateResourceJsonCommand';
import { ValidateResourceJsonCommand } from '@/commands/resourceJson/ValidateResourceJsonCommand';
import { CopyPathCommand } from '@/commands/resources/CopyPathCommand';
import { CreateFolderCommand } from '@/commands/resources/CreateFolderCommand';
import { CreateResourceCommand } from '@/commands/resources/CreateResourceCommand';
import { DeleteResourceCommand } from '@/commands/resources/DeleteResourceCommand';
import { DuplicateResourceCommand } from '@/commands/resources/DuplicateResourceCommand';
import { OpenResourceCommand } from '@/commands/resources/OpenResourceCommand';
import { RenameResourceCommand } from '@/commands/resources/RenameResourceCommand';
import { ClearSearchHistoryCommand } from '@/commands/search/ClearSearchHistoryCommand';
import { FindInResourcesCommand } from '@/commands/search/FindInResourcesCommand';
import { SearchByTypeCommand } from '@/commands/search/SearchByTypeCommand';
import { SearchResourcesCommand } from '@/commands/search/SearchResourcesCommand';
import { OpenWithKindlingCommand } from '@/commands/tools/OpenWithKindlingCommand';
import { ResetToolSettingsCommand } from '@/commands/tools/ResetToolSettingsCommand';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ResourceOrigin } from '@/core/types/models';
import { TreeNode, TreeNodeType } from '@/core/types/tree';
import { PythonCompletionProvider } from '@/providers/completion/PythonCompletionProvider';
import { ConflictCodeActionProvider, ConflictCodeLensProvider } from '@/providers/conflict';
import { ScriptCodeActionProvider } from '@/providers/decode/ScriptCodeActionProvider';
import { PythonCompletionService } from '@/services/completion';
import { ConfigMigrationService } from '@/services/config/ConfigMigrationService';
import { ConfigValidationService } from '@/services/config/ConfigValidationService';
import { ProjectScannerService } from '@/services/config/ProjectScannerService';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';
import { ConflictDetectionService, ConflictScriptFileSystemService } from '@/services/conflict';
import { DecodedFileSystemService } from '@/services/decode/DecodedFileSystemService';
import { ScriptFileSystemService } from '@/services/decode/ScriptFileSystemService';
import { EnvironmentService } from '@/services/environments/EnvironmentService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';
import { GatewayScanService } from '@/services/gateways/GatewayScanService';
import { IgnitionStubsManagerService } from '@/services/python/IgnitionStubsManagerService';
import { PythonASTService } from '@/services/python/PythonASTService';
import { ScriptModuleIndexService } from '@/services/python/ScriptModuleIndexService';
import { ResourceEditorManagerService } from '@/services/resources/ResourceEditorManagerService';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';
import { ResourceValidationService } from '@/services/resources/ResourceValidationService';
import { SearchHistoryService } from '@/services/search/SearchHistoryService';
import { SearchProviderService } from '@/services/search/SearchProviderService';
import { DesignerLauncherHelper, KindlingHelper } from '@/utils';
import { ProjectTreeDataProvider } from '@/views/projectBrowser/ProjectTreeDataProvider';
import { TreeStateManager } from '@/views/projectBrowser/TreeStateManager';
import { EnvironmentStatusBarItem } from '@/views/statusBar/EnvironmentStatusBarItem';
import { GatewayStatusBarItem } from '@/views/statusBar/GatewayStatusBarItem';
import { SearchStatusBarItem } from '@/views/statusBar/SearchStatusBarItem';
import { ConflictMergeWebview } from '@/views/webview/ConflictMergeWebview';
import { SetupWizardWebview } from '@/views/webview/SetupWizardWebview';

// Extension state
interface ExtensionState {
    serviceContainer: ServiceContainer;
    commandRegistry: CommandRegistry;

    // Services
    configService: WorkspaceConfigService;
    projectScannerService: ProjectScannerService;
    gatewayManagerService: GatewayManagerService;
    gatewayScanService: GatewayScanService;
    resourceTypeProviderRegistry: ResourceTypeProviderRegistry;
    resourceEditorManagerService: ResourceEditorManagerService;
    searchProviderService: SearchProviderService;
    searchHistoryService: SearchHistoryService;
    treeStateManager: TreeStateManager;

    // UI components
    projectTreeProvider: ProjectTreeDataProvider;
    treeView?: vscode.TreeView<any>;
    statusBarItems: vscode.StatusBarItem[];
    watchers: vscode.Disposable[];
}

let extensionState: ExtensionState | undefined;

/**
 * Handles Python symbol node clicks - navigates to the symbol in the editor
 */
async function handlePythonSymbolClick(treeNode: TreeNode): Promise<void> {
    const metadata = treeNode.metadata as any;
    if (!metadata?.filePath || !metadata?.lineNumber) {
        return;
    }

    try {
        const document = await vscode.workspace.openTextDocument(metadata.filePath);
        const editor = await vscode.window.showTextDocument(document);

        if (metadata.lineNumber > 0) {
            const position = new vscode.Position(metadata.lineNumber - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
    } catch (error) {
        vscode.window.showErrorMessage(
            `Failed to open symbol: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Handles resource item node clicks - opens the resource or prompts to create
 */
async function handleResourceItemClick(treeNode: TreeNode): Promise<void> {
    const projectId =
        treeNode.origin === ResourceOrigin.INHERITED && (treeNode as any).sourceProject
            ? (treeNode as any).sourceProject
            : treeNode.projectId;
    const typeId = (treeNode as any).typeId;
    const resourcePath = (treeNode as any).originalResourcePath || treeNode.resourcePath;
    const categoryId = (treeNode as any).categoryId;

    // Check if this is an empty singleton resource (doesn't exist yet)
    if (treeNode.contextValue === 'emptySingletonResource' || !resourcePath) {
        const resourceLabel = treeNode.label;
        const choice = await vscode.window.showInformationMessage(
            `${resourceLabel} doesn't exist yet in this project. Would you like to create it?`,
            'Create',
            'Cancel'
        );

        if (choice === 'Create') {
            await vscode.commands.executeCommand(COMMANDS.CREATE_RESOURCE, treeNode);
        }
        return;
    }

    if (!projectId || !typeId) {
        console.error('Missing required parameters for resource opening:', {
            projectId,
            typeId,
            resourcePath,
            treeNode: treeNode.id
        });
        vscode.window.showErrorMessage(
            `Cannot open resource: Missing required parameters (projectId: ${projectId}, typeId: ${typeId})`
        );
        return;
    }

    await vscode.commands.executeCommand(COMMANDS.OPEN_RESOURCE, projectId, typeId, resourcePath, categoryId);
}

/**
 * Handles tree node clicks - dispatches to appropriate commands based on node type
 */
async function handleTreeNodeClick(treeNode: TreeNode, _commandContext: any): Promise<void> {
    if (!treeNode) {
        console.warn('No tree node provided to click handler');
        return;
    }

    try {
        switch (treeNode.id) {
            case 'gateway-selector':
                await vscode.commands.executeCommand(COMMANDS.SELECT_GATEWAY);
                break;
            case 'project-selector':
                await vscode.commands.executeCommand(COMMANDS.SELECT_PROJECT);
                break;
            default:
                if (treeNode.type === TreeNodeType.PYTHON_SYMBOL) {
                    await handlePythonSymbolClick(treeNode);
                    return;
                }
                if (treeNode.type === TreeNodeType.RESOURCE_ITEM || treeNode.type === TreeNodeType.SINGLETON_RESOURCE) {
                    await handleResourceItemClick(treeNode);
                }
                break;
        }
    } catch (error) {
        console.error(`Failed to handle tree node click for ${treeNode.id}:`, error);
        throw error;
    }
}

/**
 * Main extension activation function
 */
export async function activate(context: vscode.ExtensionContext): Promise<{
    serviceContainer: any;
    commandRegistry: any;
    getService: <T>(name: string) => T;
    getTreeView?: () => vscode.TreeView<any> | undefined;
} | void> {
    try {
        // console.log('Activating Flint extension...');

        // Initialize service container and command registry
        const serviceContainer = new ServiceContainer();

        // Register extension context in service container
        serviceContainer.register('extensionContext', context);

        // Create command context
        const commandContext = {
            extensionContext: context,
            services: serviceContainer
        };

        const commandRegistry = new CommandRegistry(commandContext);

        // Initialize services
        const services = await initializeServices(serviceContainer, context);

        // Initialize project tree provider
        const projectTreeProvider = new ProjectTreeDataProvider(serviceContainer, context);
        await projectTreeProvider.initialize();

        // Register the tree provider as a service so commands can access it
        serviceContainer.register('ProjectTreeDataProvider', projectTreeProvider);

        // Initialize extension state
        extensionState = {
            serviceContainer,
            commandRegistry,
            ...services,
            projectTreeProvider,
            statusBarItems: [],
            watchers: []
        };

        // Register all commands
        registerCommands(commandRegistry, commandContext);

        // Initialize UI components
        await initializeUI(context, extensionState);

        // Setup file watchers
        setupFileWatchers(context, extensionState);

        // Register subscriptions
        context.subscriptions.push(
            ...extensionState.statusBarItems,
            ...extensionState.watchers,
            ...(extensionState.treeView ? [extensionState.treeView] : [])
        );

        // Set extension context
        await vscode.commands.executeCommand('setContext', 'flint.activated', true);
        await vscode.commands.executeCommand('setContext', 'flint.projectBrowserVisible', true);

        // Set config context based on whether config file exists
        const hasConfig = await services.configService.configurationExists();
        await vscode.commands.executeCommand('setContext', 'flint:hasConfig', hasConfig);

        // Update config context when config changes
        services.configService.onConfigChanged(() => {
            void vscode.commands.executeCommand('setContext', 'flint:hasConfig', true);
        });

        // Return extension API for testing
        return {
            serviceContainer,
            commandRegistry,
            getService: <T>(name: string): T => serviceContainer.get<T>(name),
            getTreeView: () => extensionState?.treeView
        };
    } catch (error) {
        const flintError =
            error instanceof FlintError
                ? error
                : new FlintError(
                      'Extension activation failed',
                      'EXTENSION_ACTIVATION_FAILED',
                      'The Flint extension could not start properly',
                      error instanceof Error ? error : undefined
                  );

        console.error('Extension activation failed:', flintError);
        await vscode.window
            .showErrorMessage(`Flint extension failed to activate: ${flintError.message}`, 'Show Details')
            .then(choice => {
                if (choice === 'Show Details') {
                    vscode.window.showErrorMessage(flintError.message);
                }
            });

        throw flintError;
    }
}

/**
 * Extension deactivation function
 */
export async function deactivate(): Promise<void> {
    try {
        if (extensionState) {
            // Stop all services
            const serviceNames = [
                'WorkspaceConfigService',
                'ProjectScannerService',
                'GatewayManagerService',
                'GatewayScanService',
                'ResourceEditorManagerService',
                'ResourceValidationService',
                'SearchProviderService',
                'SearchHistoryService',
                'TreeStateManager',
                'PythonASTService',
                'ScriptModuleIndexService',
                'IgnitionStubsManagerService',
                'DecodedFileSystemService',
                'ScriptFileSystemService',
                'ConflictDetectionService',
                'ConflictScriptFileSystemService',
                'ConflictMergeWebview',
                'PythonCompletionService'
            ];

            for (const serviceName of serviceNames) {
                try {
                    const service = extensionState.serviceContainer.get<any>(serviceName);
                    if (service && typeof service.dispose === 'function') {
                        await service.dispose();
                    }
                } catch (error) {
                    console.warn(`Error stopping service ${serviceName}:`, error);
                }
            }

            extensionState = undefined;
        }

        // console.log('Flint extension deactivated');
    } catch (error) {
        console.error('Extension deactivation failed:', error);
    }
}

/**
 * Initialize all services
 */
async function initializeServices(
    serviceContainer: ServiceContainer,
    context: vscode.ExtensionContext
): Promise<{
    configService: WorkspaceConfigService;
    projectScannerService: ProjectScannerService;
    gatewayManagerService: GatewayManagerService;
    gatewayScanService: GatewayScanService;
    resourceTypeProviderRegistry: ResourceTypeProviderRegistry;
    resourceEditorManagerService: ResourceEditorManagerService;
    searchProviderService: SearchProviderService;
    searchHistoryService: SearchHistoryService;
    treeStateManager: TreeStateManager;
}> {
    // Initialize config validation and migration services first
    const configValidationService = new ConfigValidationService(serviceContainer);
    serviceContainer.register('ConfigValidationService', configValidationService);
    await configValidationService.initialize();
    await configValidationService.start();

    const configMigrationService = new ConfigMigrationService(serviceContainer);
    serviceContainer.register('ConfigMigrationService', configMigrationService);
    await configMigrationService.initialize();
    await configMigrationService.start();

    // Initialize config service with dependencies
    const configService = new WorkspaceConfigService(serviceContainer, configValidationService, configMigrationService);
    serviceContainer.register('WorkspaceConfigService', configService);
    await configService.initialize();
    await configService.start();

    // Initialize project scanner service
    const projectScannerService = new ProjectScannerService(serviceContainer);
    serviceContainer.register('ProjectScannerService', projectScannerService);
    await projectScannerService.initialize();
    await projectScannerService.start();

    // Initialize gateway manager service
    const gatewayManagerService = new GatewayManagerService(serviceContainer);
    serviceContainer.register('GatewayManagerService', gatewayManagerService);
    await gatewayManagerService.initialize();
    await gatewayManagerService.start();

    // Initialize environment service (manages environment selection for gateways)
    const environmentService = new EnvironmentService(serviceContainer, context);
    serviceContainer.register('EnvironmentService', environmentService);
    await environmentService.initialize();
    await environmentService.start();

    // Initialize gateway scan service
    const gatewayScanService = new GatewayScanService(serviceContainer);
    serviceContainer.register('GatewayScanService', gatewayScanService);
    await gatewayScanService.initialize();
    await gatewayScanService.start();

    // Initialize resource type provider registry (provides resource-specific behavior)
    const resourceTypeProviderRegistry = new ResourceTypeProviderRegistry(serviceContainer);
    serviceContainer.register('ResourceTypeProviderRegistry', resourceTypeProviderRegistry);
    await resourceTypeProviderRegistry.initialize();
    await resourceTypeProviderRegistry.start();

    // Initialize resource editor manager service
    const resourceEditorManagerService = new ResourceEditorManagerService(serviceContainer);
    serviceContainer.register('ResourceEditorManagerService', resourceEditorManagerService);
    await resourceEditorManagerService.initialize();
    await resourceEditorManagerService.start();

    // Initialize resource validation service
    const resourceValidationService = new ResourceValidationService(serviceContainer);
    serviceContainer.register('ResourceValidationService', resourceValidationService);
    await resourceValidationService.initialize();
    await resourceValidationService.start();

    // Initialize search provider service
    const searchProviderService = new SearchProviderService(serviceContainer);
    serviceContainer.register('SearchProviderService', searchProviderService);
    await searchProviderService.initialize();
    void searchProviderService.start();

    // Initialize search history service
    const searchHistoryService = new SearchHistoryService(serviceContainer);
    serviceContainer.register('SearchHistoryService', searchHistoryService);
    await searchHistoryService.initialize();
    await searchHistoryService.start();

    // Initialize tree state manager service
    const treeStateManager = new TreeStateManager(serviceContainer, context);
    serviceContainer.register('TreeStateManager', treeStateManager);
    await treeStateManager.initialize();
    await treeStateManager.start();

    // Initialize Python AST service
    const pythonASTService = new PythonASTService(serviceContainer);
    serviceContainer.register('PythonASTService', pythonASTService);
    await pythonASTService.initialize();
    await pythonASTService.start();

    // Initialize Ignition Stubs Manager service BEFORE Script Module Index service
    const ignitionStubsManagerService = new IgnitionStubsManagerService(serviceContainer);
    serviceContainer.register('IgnitionStubsManagerService', ignitionStubsManagerService);
    await ignitionStubsManagerService.initialize();
    await ignitionStubsManagerService.start();

    // Initialize Script Module Index service (depends on IgnitionStubsManagerService)
    const scriptModuleIndexService = new ScriptModuleIndexService(serviceContainer);
    serviceContainer.register('ScriptModuleIndexService', scriptModuleIndexService);
    await scriptModuleIndexService.initialize();
    await scriptModuleIndexService.start();

    // Initialize Setup Wizard webview service
    const setupWizardWebview = new SetupWizardWebview(serviceContainer, context);
    serviceContainer.register('SetupWizardWebview', setupWizardWebview);
    await setupWizardWebview.initialize();
    await setupWizardWebview.start();

    // Initialize Conflict Merge webview service (for resolving encoded script conflicts)
    const conflictMergeWebview = new ConflictMergeWebview(serviceContainer, context);
    serviceContainer.register('ConflictMergeWebview', conflictMergeWebview);
    await conflictMergeWebview.initialize();
    await conflictMergeWebview.start();

    // Initialize Decoded File System service (for viewing decoded Ignition JSON)
    const decodedFileSystemService = new DecodedFileSystemService(serviceContainer, context);
    serviceContainer.register('DecodedFileSystemService', decodedFileSystemService);
    await decodedFileSystemService.initialize();
    await decodedFileSystemService.start();

    // Register the decoded filesystem provider
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(DecodedFileSystemService.SCHEME, decodedFileSystemService, {
            isCaseSensitive: true,
            isReadonly: false
        })
    );

    // Initialize Script File System service (for editing individual embedded scripts)
    const scriptFileSystemService = new ScriptFileSystemService(serviceContainer);
    serviceContainer.register('ScriptFileSystemService', scriptFileSystemService);
    await scriptFileSystemService.initialize();
    await scriptFileSystemService.start();

    // Register the script filesystem provider
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(ScriptFileSystemService.SCHEME, scriptFileSystemService, {
            isCaseSensitive: true,
            isReadonly: false
        })
    );

    // Register Code Action Provider for script editing lightbulb
    const scriptCodeActionProvider = new ScriptCodeActionProvider(serviceContainer);
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider('json', scriptCodeActionProvider));

    // Initialize Conflict Detection service (for detecting merge conflicts with scripts)
    const conflictDetectionService = new ConflictDetectionService(serviceContainer);
    serviceContainer.register('ConflictDetectionService', conflictDetectionService);
    await conflictDetectionService.initialize();
    await conflictDetectionService.start();

    // Initialize Conflict Script File System service (for editing conflict scripts)
    const conflictScriptFileSystemService = new ConflictScriptFileSystemService(serviceContainer);
    serviceContainer.register('ConflictScriptFileSystemService', conflictScriptFileSystemService);
    await conflictScriptFileSystemService.initialize();
    await conflictScriptFileSystemService.start();

    // Register the conflict script filesystem provider
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(
            ConflictScriptFileSystemService.SCHEME,
            conflictScriptFileSystemService,
            { isCaseSensitive: true, isReadonly: false }
        )
    );

    // Register Conflict Code Lens Provider (shows actions above script conflicts)
    const conflictCodeLensProvider = new ConflictCodeLensProvider(serviceContainer);
    context.subscriptions.push(vscode.languages.registerCodeLensProvider('json', conflictCodeLensProvider));

    // Register Conflict Code Action Provider (lightbulb for script conflicts)
    const conflictCodeActionProvider = new ConflictCodeActionProvider(serviceContainer);
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider('json', conflictCodeActionProvider));

    // Initialize Python Completion service (unified completion logic for .py files)
    const pythonCompletionService = new PythonCompletionService(serviceContainer);
    serviceContainer.register('PythonCompletionService', pythonCompletionService);
    await pythonCompletionService.initialize();
    await pythonCompletionService.start();

    return {
        configService,
        projectScannerService,
        gatewayManagerService,
        gatewayScanService,
        resourceTypeProviderRegistry,
        resourceEditorManagerService,
        searchProviderService,
        searchHistoryService,
        treeStateManager
    };
}

/**
 * Register all commands
 */
function registerCommands(commandRegistry: CommandRegistry, commandContext: any): void {
    try {
        // Configuration commands
        commandRegistry.register(new GetStartedCommand(commandContext));
        commandRegistry.register(new OpenConfigCommand(commandContext));
        commandRegistry.register(new AddGatewayCommand(commandContext));
        commandRegistry.register(new RemoveGatewayCommand(commandContext));
        commandRegistry.register(new AddProjectPathsCommand(commandContext));

        // Gateway commands
        commandRegistry.register(new SelectGatewayCommand(commandContext));
        commandRegistry.register(new NavigateToGatewayCommand(commandContext));
        commandRegistry.register(new OpenDesignerCommand(commandContext));

        // Environment commands
        commandRegistry.register(new SelectEnvironmentCommand(commandContext));

        // Project commands
        commandRegistry.register(new SelectProjectCommand(commandContext));
        commandRegistry.register(new RefreshProjectsCommand(commandContext));
        commandRegistry.register(new ValidateProjectCommand(commandContext));
        commandRegistry.register(new OpenProjectJsonCommand(commandContext));

        // Resource commands
        commandRegistry.register(new CreateResourceCommand(commandContext));
        commandRegistry.register(new CreateFolderCommand(commandContext));
        commandRegistry.register(new DeleteResourceCommand(commandContext));
        commandRegistry.register(new RenameResourceCommand(commandContext));
        commandRegistry.register(new DuplicateResourceCommand(commandContext));
        commandRegistry.register(new CopyPathCommand(commandContext));
        commandRegistry.register(new OpenResourceCommand(commandContext));

        // Resource JSON commands
        commandRegistry.register(new CreateResourceJsonCommand(commandContext));
        commandRegistry.register(new CreateAllMissingCommand(commandContext));
        commandRegistry.register(new ValidateResourceJsonCommand(commandContext));

        // Search commands
        commandRegistry.register(new SearchResourcesCommand(commandContext));
        commandRegistry.register(new FindInResourcesCommand(commandContext));
        commandRegistry.register(new SearchByTypeCommand(commandContext));
        commandRegistry.register(new ClearSearchHistoryCommand(commandContext));

        // Tool commands
        commandRegistry.register(new OpenWithKindlingCommand(commandContext));
        commandRegistry.register(new ResetToolSettingsCommand(commandContext));

        // Debug commands
        commandRegistry.register(new DebugConfigCommand(commandContext));
        commandRegistry.register(new ClearIgnitionStubsCacheCommand(commandContext));
        commandRegistry.register(new DownloadIgnitionStubsCommand(commandContext));

        // Python commands
        commandRegistry.register(new NavigateToScriptElementCommand(commandContext));
        commandRegistry.register(new CopyQualifiedPathCommand(commandContext));
        commandRegistry.register(new CopySymbolPathCommand(commandContext));

        // Decode commands (for viewing decoded Ignition JSON)
        commandRegistry.register(new CompareDecodedCommand(commandContext));
        commandRegistry.register(new EditScriptCommand(commandContext));
        commandRegistry.register(new PasteAsJsonCommand(commandContext));

        // Conflict resolution commands (for merge conflicts with encoded scripts)
        commandRegistry.register(new CompareConflictScriptsCommand(commandContext));
        commandRegistry.register(new AcceptCurrentScriptCommand(commandContext));
        commandRegistry.register(new AcceptIncomingScriptCommand(commandContext));

        // Tool utility commands - these are simple utility commands that don't need full command classes
        const utilityCommands = [
            vscode.commands.registerCommand('flint.resetDesignerLauncherSetting', () =>
                DesignerLauncherHelper.resetDesignerLauncherSetting()
            ),
            vscode.commands.registerCommand('flint.resetKindlingSetting', () => KindlingHelper.resetKindlingSetting()),
            vscode.commands.registerCommand('flint.configureKindlingPath', () =>
                KindlingHelper.openKindlingConfiguration()
            ),
            vscode.commands.registerCommand('flint.navigateToGatewayFromNode', async () => {
                // Open gateway directly without confirmation (tree node context)
                const gatewayManager = commandContext.services.get('GatewayManagerService') as GatewayManagerService;
                const configService = commandContext.services.get('WorkspaceConfigService');
                const environmentService = commandContext.services.get('EnvironmentService');

                const activeGatewayId = gatewayManager?.getActiveGatewayId();
                if (!activeGatewayId) {
                    vscode.window.showErrorMessage('No gateway selected');
                    return;
                }

                try {
                    // Get gateway configuration
                    const gateways = await configService.getGateways();
                    const gatewayConfig = gateways[activeGatewayId];

                    if (!gatewayConfig) {
                        vscode.window.showErrorMessage(`Gateway '${activeGatewayId}' not found`);
                        return;
                    }

                    if (!environmentService) {
                        vscode.window.showErrorMessage('Environment service not available');
                        return;
                    }

                    // Build URL using environment-specific configuration
                    const gatewayUrl = environmentService.buildGatewayUrl(gatewayConfig, '');
                    const uri = vscode.Uri.parse(gatewayUrl);
                    await vscode.env.openExternal(uri);
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to open gateway: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }),
            vscode.commands.registerCommand('flint.navigateToDesignerFromNode', async () => {
                // Open designer directly without confirmation (tree node context)
                const gatewayManager = commandContext.services.get('GatewayManagerService') as GatewayManagerService;
                const configService = commandContext.services.get('WorkspaceConfigService');
                const environmentService = commandContext.services.get('EnvironmentService');

                const activeGatewayId = gatewayManager?.getActiveGatewayId();
                if (!activeGatewayId) {
                    vscode.window.showErrorMessage('No gateway selected');
                    return;
                }

                try {
                    // Get gateway configuration
                    const gateways = await configService.getGateways();
                    const gatewayConfig = gateways[activeGatewayId];

                    if (!gatewayConfig) {
                        vscode.window.showErrorMessage(`Gateway '${activeGatewayId}' not found`);
                        return;
                    }

                    if (!environmentService) {
                        vscode.window.showErrorMessage('Environment service not available');
                        return;
                    }

                    // Build designer URL using environment-specific configuration
                    const envConfig = environmentService.getActiveEnvironmentConfig(gatewayConfig);
                    const port = envConfig.port !== (envConfig.ssl ? 443 : 80) ? `:${envConfig.port}` : '';
                    const designerUrl = `designer://${envConfig.host}${port}`;

                    const uri = vscode.Uri.parse(designerUrl);
                    await vscode.env.openExternal(uri);
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to launch designer: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }),
            vscode.commands.registerCommand('flint.handleNodeClick', async (treeNode: any) => {
                try {
                    await handleTreeNodeClick(treeNode, commandContext);
                } catch (error) {
                    console.error('Tree node click handler failed:', error);
                    vscode.window.showErrorMessage(
                        `Failed to handle node click: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            })
        ];

        // Register utility commands
        commandContext.extensionContext.subscriptions.push(...utilityCommands);

        // console.log('All commands registered successfully');
    } catch (error) {
        throw new FlintError(
            'Command registration failed',
            'COMMAND_REGISTRATION_FAILED',
            'Failed to register extension commands',
            error instanceof Error ? error : undefined
        );
    }
}

/**
 * Initialize UI components
 */
async function initializeUI(context: vscode.ExtensionContext, state: ExtensionState): Promise<void> {
    try {
        // Create tree view
        const treeView = vscode.window.createTreeView('flintProjectBrowser', {
            treeDataProvider: state.projectTreeProvider,
            showCollapseAll: true,
            canSelectMany: false
        });

        treeView.onDidExpandElement(async e => {
            await state.projectTreeProvider.onDidExpandElement(e.element);
        });

        treeView.onDidCollapseElement(e => {
            state.projectTreeProvider.onDidCollapseElement(e.element);
        });

        state.treeView = treeView;

        // Store tree view reference in the tree provider for auto-reveal
        (state.projectTreeProvider as any).setTreeView(treeView);

        // Register reveal command that other commands can use
        context.subscriptions.push(
            vscode.commands.registerCommand('flint.revealResourceInTree', async (uri: vscode.Uri) => {
                await state.projectTreeProvider.revealResource(uri);
            })
        );

        // Create status bar items
        const searchStatusBarItem = new SearchStatusBarItem(state.serviceContainer, context);
        void searchStatusBarItem.start();
        state.statusBarItems.push(searchStatusBarItem as any);

        const gatewayStatusBarItem = new GatewayStatusBarItem(state.serviceContainer, context);
        void gatewayStatusBarItem.start();
        state.statusBarItems.push(gatewayStatusBarItem as any);

        const environmentStatusBarItem = new EnvironmentStatusBarItem(state.serviceContainer, context);
        await environmentStatusBarItem.start();
        state.statusBarItems.push(environmentStatusBarItem as any);

        // Register Python completion provider for both regular files and virtual script files
        const pythonCompletionProvider = new PythonCompletionProvider(state.serviceContainer);
        const pythonSelector: vscode.DocumentSelector = [
            { language: 'python', scheme: 'file' },
            { language: 'python', scheme: ScriptFileSystemService.SCHEME }
        ];

        const pythonCompletionDisposable = vscode.languages.registerCompletionItemProvider(
            pythonSelector,
            pythonCompletionProvider,
            '.' // Trigger on dot for module navigation
        );

        context.subscriptions.push(pythonCompletionDisposable);
    } catch (error) {
        throw new FlintError(
            'UI initialization failed',
            'UI_INIT_FAILED',
            'Failed to initialize user interface components',
            error instanceof Error ? error : undefined
        );
    }
}

/**
 * Setup file system watchers
 */
function setupFileWatchers(context: vscode.ExtensionContext, state: ExtensionState): void {
    // Config changes are handled by the WorkspaceConfigService itself
    // The service watches all config locations (flint.config.json, .flint/config.json, etc.)
    // and local override files (flint.local.json, .flint/config.local.json)
    // Just listen to the config change events and refresh the tree
    const configChangeSubscription = state.configService.onConfigChanged(() => {
        state.projectTreeProvider.refresh();
    });

    // Store the subscription for disposal (treated as a watcher for cleanup)
    state.watchers.push({
        dispose: (): void => {
            configChangeSubscription.dispose();
        }
    });

    // Project file watcher
    const projectWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);

    let refreshTimeout: NodeJS.Timeout | undefined;
    const debouncedRefresh = (): void => {
        if (refreshTimeout) {
            clearTimeout(refreshTimeout);
        }
        refreshTimeout = setTimeout(async () => {
            // Get actual project directories and scan them
            try {
                const projectPaths = await state.configService.getProjectPaths();
                if (projectPaths.length > 0) {
                    // Discover actual project directories (same logic as RefreshProjectsCommand)
                    const projectDirectories: string[] = [];
                    const fs = await import('fs/promises');
                    const path = await import('path');

                    for (const basePath of projectPaths) {
                        try {
                            const entries = await fs.readdir(basePath, { withFileTypes: true });
                            for (const entry of entries) {
                                if (entry.isDirectory()) {
                                    const projectPath = path.join(basePath, entry.name);
                                    const projectJsonPath = path.join(projectPath, 'project.json');

                                    try {
                                        await fs.access(projectJsonPath);
                                        projectDirectories.push(projectPath);
                                    } catch {
                                        // Not a project directory
                                    }
                                }
                            }
                        } catch (error) {
                            console.warn(`File watcher: Failed to scan base path ${basePath}:`, error);
                        }
                    }

                    if (projectDirectories.length > 0) {
                        console.log(`File watcher: Scanning ${projectDirectories.length} project directories`);
                        await state.projectScannerService.scanProjects(projectDirectories);
                        state.projectTreeProvider.refresh(undefined, { clearCache: true, force: true });
                    }
                }
            } catch (error) {
                console.error('Error in file watcher refresh:', error);
            }
        }, 1000);
    };

    projectWatcher.onDidCreate(debouncedRefresh);
    projectWatcher.onDidChange(debouncedRefresh);
    projectWatcher.onDidDelete(debouncedRefresh);

    // File save handler for project resources
    // Triggers gateway scan when files within project paths are saved
    const fileSaveSubscription = vscode.workspace.onDidSaveTextDocument(async document => {
        const filePath = document.uri.fsPath;

        // Get project paths to check if file is within a project
        let isInProjectPath = false;
        try {
            const projectPaths = await state.configService.getProjectPaths();
            isInProjectPath = projectPaths.some(projectPath => filePath.startsWith(projectPath));
        } catch {
            // Failed to get project paths
        }

        // Skip if not a project resource
        if (!isInProjectPath) {
            return;
        }

        try {
            const gatewayScanService = state.serviceContainer.get<GatewayScanService>('GatewayScanService');

            if (gatewayScanService?.scanProject !== undefined) {
                await gatewayScanService.scanProject();
            }
        } catch {
            // Silently fail - scan services handle user notifications
        }
    });

    // Add subscription to watchers for cleanup
    state.watchers.push({
        dispose: (): void => {
            fileSaveSubscription.dispose();
        }
    });

    state.watchers.push(projectWatcher);
}
