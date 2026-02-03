/**
 * @module GatewayQuickPick
 * @description Quick pick interface for gateway selection and management
 */

import * as vscode from 'vscode';

import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { GatewayConfig, GatewayStatus } from '@/core/types/models';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Gateway quick pick item
 */
interface GatewayQuickPickItem extends vscode.QuickPickItem {
    readonly gatewayId: string;
    readonly gatewayConfig: GatewayConfig;
    readonly status?: GatewayStatus;
    readonly isConnected: boolean;
    readonly projectCount: number;
}

/**
 * Gateway selection options
 */
interface GatewaySelectionOptions {
    readonly title?: string;
    readonly placeholder?: string;
    readonly showProjectCount?: boolean;
    readonly includeDisabledGateways?: boolean;
    readonly allowManagement?: boolean;
    readonly canPickMany?: boolean;
}

/**
 * Gateway selection result
 */
interface GatewaySelectionResult {
    readonly selectedGateways: readonly GatewayQuickPickItem[];
    readonly selectedGatewayId?: string;
    readonly cancelled: boolean;
    readonly action?: 'select' | 'add' | 'edit' | 'remove' | 'test';
}

/**
 * Gateway management actions
 */
interface GatewayAction extends vscode.QuickPickItem {
    readonly action: string;
    readonly icon: string;
}

/**
 * Quick pick provider for gateway selection and management
 */
export class GatewayQuickPick implements IServiceLifecycle {
    private quickPick?: vscode.QuickPick<GatewayQuickPickItem | GatewayAction>;
    private gatewayItems: GatewayQuickPickItem[] = [];
    private isInitialized = false;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {}

    async initialize(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        try {
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize gateway quick pick',
                'GATEWAY_QUICK_PICK_INIT_FAILED',
                'Gateway quick pick could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async stop(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        if (this.quickPick) {
            this.quickPick.dispose();
            this.quickPick = undefined;
        }
    }

    async dispose(): Promise<void> {
        await this.stop();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Shows gateway selection quick pick
     */
    async showGatewaySelector(options: GatewaySelectionOptions = {}): Promise<GatewaySelectionResult> {
        try {
            // Load gateways and their status
            await this.loadGateways(options);

            // Create and configure quick pick
            this.quickPick = vscode.window.createQuickPick<GatewayQuickPickItem | GatewayAction>();
            this.configureQuickPick(this.quickPick as vscode.QuickPick<GatewayQuickPickItem>, options);

            // Set items
            this.updateQuickPickItems(options);

            // Handle interaction
            const result = await this.handleGatewaySelection(
                this.quickPick as vscode.QuickPick<GatewayQuickPickItem>,
                options
            );

            return result;
        } catch (error) {
            throw new FlintError(
                'Failed to show gateway selector',
                'GATEWAY_SELECTOR_FAILED',
                'Gateway selector could not be displayed',
                error instanceof Error ? error : undefined
            );
        } finally {
            if (this.quickPick) {
                this.quickPick.dispose();
                this.quickPick = undefined;
            }
        }
    }

    /**
     * Shows gateway management interface
     */
    async showGatewayManager(): Promise<GatewaySelectionResult> {
        return this.showGatewaySelector({
            title: 'Gateway Management',
            placeholder: 'Select a gateway to manage or add a new one...',
            showProjectCount: true,
            includeDisabledGateways: true,
            allowManagement: true
        });
    }

    /**
     * Shows project selection for a gateway
     */
    async showProjectSelector(gatewayId: string): Promise<string | undefined> {
        try {
            // Get actual projects from configuration and services
            const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
            const gatewayManagerService = this.serviceContainer.get<any>('GatewayManagerService');

            let projects: string[] = [];

            if (configService && gatewayManagerService) {
                // Get gateway configuration
                const gatewayConfigs = await configService.getGateways();
                const gatewayConfig = gatewayConfigs[gatewayId];

                if (gatewayConfig?.projects) {
                    projects = gatewayConfig.projects;
                } else {
                    // Fallback to scanning for projects
                    const projectPaths = await configService.getProjectPaths();
                    projects = projectPaths.map((path: string) => {
                        const segments = path.split('/');
                        return segments[segments.length - 1];
                    });
                }
            } else {
                throw new FlintError(
                    'Configuration service not available',
                    'SERVICE_UNAVAILABLE',
                    'Unable to load projects - configuration service is not initialized'
                );
            }

            interface ProjectItem extends vscode.QuickPickItem {
                projectName: string;
            }

            const selected = await vscode.window.showQuickPick<ProjectItem>(
                projects.map(project => ({
                    label: `$(folder) ${project}`,
                    description: 'Ignition Project',
                    projectName: project
                })),
                {
                    placeHolder: 'Choose a project to activate...'
                }
            );

            return selected?.projectName;
        } catch (error) {
            console.error('Failed to show project selector:', error);
            return undefined;
        }
    }

    /**
     * Shows gateway connection wizard
     */
    async showConnectionWizard(): Promise<GatewayConfig | undefined> {
        try {
            // Step 1: Gateway name
            const name = await vscode.window.showInputBox({
                prompt: 'Enter a name for this gateway',
                placeHolder: 'e.g., Development Gateway',
                validateInput: value => {
                    if (!value?.trim()) {
                        return 'Gateway name is required';
                    }
                    return undefined;
                }
            });

            if (!name) return undefined;

            // Step 2: Host
            const host = await vscode.window.showInputBox({
                prompt: 'Enter the gateway hostname or IP address',
                placeHolder: 'e.g., localhost, 192.168.1.100, gateway.company.com',
                validateInput: value => {
                    if (!value?.trim()) {
                        return 'Host address is required';
                    }
                    return undefined;
                }
            });

            if (!host) return undefined;

            // Step 3: Port (optional)
            const portString = await vscode.window.showInputBox({
                prompt: 'Enter the gateway port (optional)',
                placeHolder: '8088 (default)',
                validateInput: value => {
                    if (value?.trim()) {
                        const port = parseInt(value.trim());
                        if (isNaN(port) || port < 1 || port > 65535) {
                            return 'Port must be a number between 1 and 65535';
                        }
                    }
                    return undefined;
                }
            });

            if (portString === undefined) return undefined;

            // Step 4: SSL and other options
            interface SSLChoice extends vscode.QuickPickItem {
                ssl: boolean;
            }

            const sslChoice = await vscode.window.showQuickPick<SSLChoice>(
                [
                    { label: '$(shield) HTTPS (Recommended)', ssl: true },
                    { label: '$(globe) HTTP', ssl: false }
                ],
                {
                    placeHolder: 'Select connection type...'
                }
            );

            if (!sslChoice) return undefined;

            // Build gateway config
            const config: GatewayConfig = {
                connection: {
                    host: host.trim(),
                    port: portString?.trim() ? parseInt(portString.trim()) : 8088,
                    ssl: sslChoice.ssl,
                    ignoreSSLErrors: sslChoice.ssl // Ask user in future
                },
                projects: [],
                enabled: true
            };

            return config;
        } catch (error) {
            console.error('Gateway connection wizard failed:', error);
            return undefined;
        }
    }

    /**
     * Configures the quick pick instance
     */
    private configureQuickPick(
        quickPick: vscode.QuickPick<GatewayQuickPickItem>,
        options: GatewaySelectionOptions
    ): void {
        quickPick.title = options.title || 'Select Gateway';
        quickPick.placeholder = options.placeholder || 'Choose a gateway to connect to...';
        quickPick.canSelectMany = options.canPickMany || false;
        quickPick.ignoreFocusOut = true;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
    }

    /**
     * Loads gateways and their status
     */
    private async loadGateways(options: GatewaySelectionOptions): Promise<void> {
        try {
            this.gatewayItems = [];

            // Get gateways from actual configuration service
            const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
            const gatewayManagerService = this.serviceContainer.get<any>('GatewayManagerService');

            const gateways: Map<string, any> = new Map();

            if (configService) {
                const gatewayConfigs = await configService.getGateways();
                for (const [gatewayId, config] of Object.entries(gatewayConfigs)) {
                    gateways.set(gatewayId, config);
                }
            }

            // Error if no gateways configured
            if (gateways.size === 0) {
                throw new FlintError(
                    'No gateways configured',
                    'NO_GATEWAYS_CONFIGURED',
                    'No gateways found in configuration. Please add at least one gateway to flint.config.json'
                );
            }

            for (const [gatewayId, config] of gateways) {
                // Skip disabled gateways unless explicitly included
                if (!config.enabled && !options.includeDisabledGateways) {
                    continue;
                }

                // Get actual status from gateway manager service
                let status;
                if (gatewayManagerService?.getGatewayStatus) {
                    try {
                        status = await gatewayManagerService.getGatewayStatus(gatewayId);
                    } catch (error) {
                        console.warn(`Failed to get status for gateway ${gatewayId}:`, error);
                    }
                }

                // Use basic status if service unavailable
                if (!status) {
                    status = {
                        id: gatewayId,
                        name: gatewayId,
                        connected: false, // Configuration only
                        lastConnected: undefined
                    };
                }

                const item = this.createGatewayQuickPickItem(gatewayId, config, status, options);
                this.gatewayItems.push(item);
            }

            // Sort by enabled status and name
            this.gatewayItems.sort((a, b) => {
                // Connected gateways first
                if (a.isConnected && !b.isConnected) return -1;
                if (!a.isConnected && b.isConnected) return 1;

                // Then by name
                return a.label.localeCompare(b.label);
            });
        } catch (error) {
            console.error('Failed to load gateways:', error);
            this.gatewayItems = [];
        }
    }

    /**
     * Creates a gateway quick pick item
     */
    private createGatewayQuickPickItem(
        gatewayId: string,
        config: GatewayConfig,
        status?: GatewayStatus,
        options: GatewaySelectionOptions = {}
    ): GatewayQuickPickItem {
        const isConnected = status?.connected ?? false;

        // Build label with connection indicator
        const label = gatewayId;
        // Connection status display disabled
        // if (showConnectionStatus) {
        //     const icon = isConnected ? '$(check)' : '$(circle-slash)';
        //     label = `${icon} ${gatewayId}`;
        // }

        // Build description
        let description = `${config.connection.ssl ? 'https' : 'http'}://${config.connection.host}`;
        if (config.connection.port && config.connection.port !== 8088) {
            description += `:${config.connection.port}`;
        }

        // Build detail
        let detail = '';
        if (isConnected && status?.version) {
            detail = `Connected • Version ${status.version}`;
        } else if (status?.error) {
            detail = `Error: ${status.error}`;
        } else if (isConnected) {
            detail = 'Connected';
        } else {
            detail = 'Disconnected';
        }

        if (options.showProjectCount && config.projects.length > 0) {
            detail += ` • ${config.projects.length} project${config.projects.length !== 1 ? 's' : ''}`;
        }

        return {
            label,
            description,
            detail,
            gatewayId,
            gatewayConfig: config,
            status,
            isConnected,
            projectCount: config.projects.length
        };
    }

    /**
     * Updates quick pick items including management actions
     */
    private updateQuickPickItems(options: GatewaySelectionOptions): void {
        if (!this.quickPick) return;

        const items: (GatewayQuickPickItem | GatewayAction)[] = [];

        // Add gateway items
        items.push(...this.gatewayItems);

        // Add management actions if enabled
        if (options.allowManagement) {
            if (this.gatewayItems.length > 0) {
                items.push({
                    label: '',
                    kind: vscode.QuickPickItemKind.Separator
                } as GatewayAction);
            }

            items.push({
                label: '$(plus) Add New Gateway',
                description: 'Create a new gateway connection',
                action: 'add',
                icon: 'plus'
            } as GatewayAction);

            items.push({
                label: '$(settings-gear) Manage Gateways',
                description: 'Edit, remove, or configure gateways',
                action: 'manage',
                icon: 'settings-gear'
            } as GatewayAction);
        }

        this.quickPick.items = items;
    }

    /**
     * Handles gateway selection interaction
     */
    private async handleGatewaySelection(
        quickPick: vscode.QuickPick<GatewayQuickPickItem>,
        _options: GatewaySelectionOptions
    ): Promise<GatewaySelectionResult> {
        return new Promise<GatewaySelectionResult>(resolve => {
            quickPick.onDidAccept(async () => {
                const selected = quickPick.selectedItems[0];

                if (!selected) {
                    resolve({
                        selectedGateways: [],
                        cancelled: true
                    });
                    return;
                }

                // Handle action items
                if ('action' in selected) {
                    const actionResult = await this.handleGatewayAction(selected as unknown as GatewayAction);
                    resolve(actionResult);
                    return;
                }

                // Handle gateway selection
                resolve({
                    selectedGateways: [selected],
                    selectedGatewayId: selected.gatewayId,
                    cancelled: false,
                    action: 'select'
                });

                quickPick.hide();
            });

            quickPick.onDidHide(() => {
                if (!quickPick.selectedItems.length) {
                    resolve({
                        selectedGateways: [],
                        cancelled: true
                    });
                }
            });

            quickPick.show();
        });
    }

    /**
     * Handles management actions
     */
    private async handleGatewayAction(action: GatewayAction): Promise<GatewaySelectionResult> {
        switch (action.action) {
            case 'add': {
                const newConfig = await this.showConnectionWizard();
                if (newConfig) {
                    // Add gateway through configuration service
                    try {
                        const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
                        if (configService?.addGateway) {
                            // Generate a unique gateway ID
                            const gatewayId = `gateway_${Date.now()}`;
                            await configService.addGateway(gatewayId, newConfig);
                            vscode.window.showInformationMessage(`Gateway "${gatewayId}" added successfully!`);
                        } else {
                            // Fallback to command if service method not available
                            await vscode.commands.executeCommand(COMMANDS.ADD_GATEWAY, newConfig);
                        }
                    } catch (error) {
                        console.error('Failed to add gateway:', error);
                        vscode.window.showErrorMessage('Failed to add gateway. Please check the configuration.');
                    }
                }
                return { selectedGateways: [], cancelled: false, action: 'add' };
            }

            case 'manage':
                await vscode.commands.executeCommand(COMMANDS.OPEN_CONFIG);
                return { selectedGateways: [], cancelled: false, action: 'edit' };

            default:
                return { selectedGateways: [], cancelled: true };
        }
    }
}
