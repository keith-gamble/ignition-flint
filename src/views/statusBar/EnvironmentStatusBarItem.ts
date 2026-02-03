/**
 * @module EnvironmentStatusBarItem
 * @description Status bar item for displaying selected environment and quick access
 */

import * as vscode from 'vscode';

import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';
import { EnvironmentService } from '@/services/environments/EnvironmentService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';

/**
 * Environment display state
 */
enum EnvironmentDisplayState {
    NO_GATEWAY = 'no_gateway',
    NO_ENVIRONMENT = 'no_environment',
    SELECTED = 'selected',
    ERROR = 'error'
}

/**
 * Environment status bar configuration
 */
interface EnvironmentStatusBarConfig {
    readonly enableQuickSwitch: boolean;
    readonly position: vscode.StatusBarAlignment;
    readonly priority: number;
}

/**
 * Environment display info
 */
interface EnvironmentDisplayInfo {
    readonly gatewayId?: string;
    readonly environmentName?: string;
    readonly host?: string;
    readonly port?: number;
    readonly ssl?: boolean;
    readonly displayState: EnvironmentDisplayState;
    readonly error?: string;
}

/**
 * Status bar item that displays selected environment and provides quick environment switching
 */
export class EnvironmentStatusBarItem implements IServiceLifecycle {
    private statusBarItem?: vscode.StatusBarItem;
    private currentInfo: EnvironmentDisplayInfo = {
        displayState: EnvironmentDisplayState.NO_GATEWAY
    };

    private config: EnvironmentStatusBarConfig = {
        enableQuickSwitch: true,
        position: vscode.StatusBarAlignment.Left,
        priority: 190 // Just before gateway status bar
    };

    private isInitialized = false;
    private isVisible = false;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly _context: vscode.ExtensionContext
    ) {}

    async initialize(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        try {
            this.loadConfiguration();
            this.createStatusBarItem();
            this.setupEventHandlers();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize environment status bar item',
                'ENVIRONMENT_STATUS_BAR_INIT_FAILED',
                'Environment status bar item could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
        await this.refreshEnvironmentStatus();
        this.show();
    }

    async stop(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        this.hide();
    }

    async dispose(): Promise<void> {
        await this.stop();
        if (this.statusBarItem) {
            this.statusBarItem.dispose();
            this.statusBarItem = undefined;
        }
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Shows the status bar item
     */
    show(): void {
        if (this.statusBarItem && !this.isVisible) {
            this.statusBarItem.show();
            this.isVisible = true;
        }
    }

    /**
     * Hides the status bar item
     */
    hide(): void {
        if (this.statusBarItem && this.isVisible) {
            this.statusBarItem.hide();
            this.isVisible = false;
        }
    }

    /**
     * Updates environment display info
     */
    updateEnvironmentInfo(info: Partial<EnvironmentDisplayInfo>): void {
        this.currentInfo = { ...this.currentInfo, ...info };
        this.updateDisplay();
    }

    /**
     * Sets environment selected
     */
    setEnvironmentSelected(gatewayId: string, environmentName: string, host: string, port: number, ssl: boolean): void {
        this.updateEnvironmentInfo({
            gatewayId,
            environmentName,
            host,
            port,
            ssl,
            displayState: EnvironmentDisplayState.SELECTED,
            error: undefined
        });
    }

    /**
     * Sets no gateway selected
     */
    setNoGateway(): void {
        this.updateEnvironmentInfo({
            displayState: EnvironmentDisplayState.NO_GATEWAY,
            gatewayId: undefined,
            environmentName: undefined,
            host: undefined,
            port: undefined,
            ssl: undefined,
            error: undefined
        });
    }

    /**
     * Sets no environment selected for gateway
     */
    setNoEnvironment(): void {
        this.updateEnvironmentInfo({
            displayState: EnvironmentDisplayState.NO_ENVIRONMENT,
            environmentName: undefined,
            host: undefined,
            port: undefined,
            ssl: undefined,
            error: undefined
        });
    }

    /**
     * Sets environment configuration error
     */
    setEnvironmentError(error: string): void {
        this.updateEnvironmentInfo({
            displayState: EnvironmentDisplayState.ERROR,
            error
        });
    }

    /**
     * Refreshes environment status from services
     */
    private async refreshEnvironmentStatus(): Promise<void> {
        try {
            const gatewayManager = this.serviceContainer.get<GatewayManagerService>('GatewayManagerService');
            const environmentService = this.serviceContainer.get<EnvironmentService>('EnvironmentService');
            const configService = this.serviceContainer.get<WorkspaceConfigService>('WorkspaceConfigService');

            if (!gatewayManager || !environmentService || !configService) {
                this.setEnvironmentError('Services not available');
                return;
            }

            // Check if config exists before trying to load it
            if (!(await configService.configurationExists())) {
                this.setNoGateway();
                return;
            }

            const activeGateway = gatewayManager.getSelectedGateway();
            if (!activeGateway) {
                this.setNoGateway();
                return;
            }

            // Get gateway configuration
            const gateways = await configService.getGateways();
            const gatewayConfig = gateways[activeGateway];
            if (!gatewayConfig) {
                this.setEnvironmentError(`Gateway '${activeGateway}' not found`);
                return;
            }

            // Get active environment configuration
            try {
                const envConfig = environmentService.getActiveEnvironmentConfig(gatewayConfig);
                this.setEnvironmentSelected(
                    activeGateway,
                    envConfig.environment,
                    envConfig.host,
                    envConfig.port,
                    envConfig.ssl
                );
            } catch (error) {
                this.setEnvironmentError(`Environment error: ${String(error)}`);
            }
        } catch (error) {
            console.error('Failed to refresh environment status:', error);
            this.setEnvironmentError('Failed to get environment status');
        }
    }

    /**
     * Loads configuration from VS Code settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.ui.statusBar');

        this.config = {
            enableQuickSwitch: config.get<boolean>('enableEnvironmentQuickSwitch') ?? true,
            position: vscode.StatusBarAlignment.Left,
            priority: 190
        };
    }

    /**
     * Creates the status bar item
     */
    private createStatusBarItem(): void {
        this.statusBarItem = vscode.window.createStatusBarItem(
            'flint.environment',
            this.config.position,
            this.config.priority
        );

        this.statusBarItem.name = 'Flint Environment';

        if (this.config.enableQuickSwitch) {
            this.statusBarItem.command = COMMANDS.SELECT_ENVIRONMENT;
        }
    }

    /**
     * Sets up event handlers
     */
    private setupEventHandlers(): void {
        // Listen for environment changes from the environment service
        try {
            const environmentService = this.serviceContainer.get<EnvironmentService>('EnvironmentService');
            if (environmentService) {
                environmentService.onEnvironmentChanged(event => {
                    console.log('Environment status bar: Environment changed event received', event);
                    this.setEnvironmentSelected(
                        event.gatewayId,
                        event.environment,
                        event.config.host,
                        event.config.port,
                        event.config.ssl
                    );
                });
            }
        } catch (error) {
            console.warn('Failed to setup environment change listener:', error);
        }
    }

    /**
     * Updates the display based on current state
     */
    private updateDisplay(): void {
        if (!this.statusBarItem) return;

        switch (this.currentInfo.displayState) {
            case EnvironmentDisplayState.NO_GATEWAY:
                this.statusBarItem.text = '$(globe) No Gateway';
                this.statusBarItem.tooltip = 'No gateway selected';
                this.statusBarItem.color = undefined;
                break;

            case EnvironmentDisplayState.NO_ENVIRONMENT:
                this.statusBarItem.text = '$(globe) No Environment';
                this.statusBarItem.tooltip = 'No environment configured for gateway';
                this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
                break;

            case EnvironmentDisplayState.SELECTED: {
                const protocol = this.currentInfo.ssl ? 'https' : 'http';
                const displayPort =
                    this.currentInfo.port !== (this.currentInfo.ssl ? 443 : 80) ? `:${this.currentInfo.port}` : '';

                this.statusBarItem.text = `$(globe) ${this.currentInfo.environmentName}`;
                this.statusBarItem.tooltip = `Environment: ${this.currentInfo.environmentName}\n${protocol}://${this.currentInfo.host}${displayPort}\nClick to change environment`;
                this.statusBarItem.color = undefined;
                break;
            }

            case EnvironmentDisplayState.ERROR:
                this.statusBarItem.text = '$(globe) Environment Error';
                this.statusBarItem.tooltip = `Environment Error: ${this.currentInfo.error}`;
                this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
                break;

            default:
                this.statusBarItem.text = '$(globe) Unknown';
                this.statusBarItem.tooltip = 'Unknown environment state';
                this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
                break;
        }
    }

    /**
     * Public method to trigger refresh (can be called when gateway/environment changes)
     */
    async refresh(): Promise<void> {
        await this.refreshEnvironmentStatus();
    }
}
