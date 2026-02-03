/**
 * @module GatewayStatusBarItem
 * @description Status bar item for displaying gateway selection and quick access
 */

import * as vscode from 'vscode';

import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Gateway display state
 */
enum GatewayDisplayState {
    NO_GATEWAY = 'no_gateway',
    SELECTED = 'selected',
    ERROR = 'error'
}

/**
 * Gateway status bar configuration
 */
interface GatewayStatusBarConfig {
    readonly showProjectName: boolean;
    readonly enableQuickSwitch: boolean;
    readonly position: vscode.StatusBarAlignment;
    readonly priority: number;
}

/**
 * Gateway display info
 */
interface GatewayDisplayInfo {
    readonly gatewayId?: string;
    readonly gatewayName?: string;
    readonly projectName?: string;
    readonly displayState: GatewayDisplayState;
    readonly error?: string;
}

/**
 * Status bar item that displays gateway selection and provides quick gateway switching
 */
export class GatewayStatusBarItem implements IServiceLifecycle {
    private statusBarItem?: vscode.StatusBarItem;
    private currentInfo: GatewayDisplayInfo = {
        displayState: GatewayDisplayState.NO_GATEWAY
    };

    private config: GatewayStatusBarConfig = {
        showProjectName: true,
        enableQuickSwitch: true,
        position: vscode.StatusBarAlignment.Left,
        priority: 200
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
                'Failed to initialize gateway status bar item',
                'GATEWAY_STATUS_BAR_INIT_FAILED',
                'Gateway status bar item could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
        this.refreshGatewayStatus();
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
     * Updates gateway display info
     */
    updateGatewayInfo(info: Partial<GatewayDisplayInfo>): void {
        this.currentInfo = { ...this.currentInfo, ...info };
        this.updateDisplay();
    }

    /**
     * Sets gateway selected
     */
    setGatewaySelected(gatewayId: string, gatewayName: string, projectName?: string): void {
        this.updateGatewayInfo({
            gatewayId,
            gatewayName,
            projectName,
            displayState: GatewayDisplayState.SELECTED,
            error: undefined
        });
    }

    /**
     * Sets no gateway selected
     */
    setNoGateway(): void {
        this.updateGatewayInfo({
            displayState: GatewayDisplayState.NO_GATEWAY,
            gatewayId: undefined,
            gatewayName: undefined,
            projectName: undefined,
            error: undefined
        });
    }

    /**
     * Sets gateway configuration error
     */
    setGatewayError(error: string): void {
        this.updateGatewayInfo({
            displayState: GatewayDisplayState.ERROR,
            error
        });
    }

    /**
     * Updates selected project
     */
    updateSelectedProject(projectName: string): void {
        this.updateGatewayInfo({ projectName });
    }

    /**
     * Gets current gateway info
     */
    getCurrentInfo(): Readonly<GatewayDisplayInfo> {
        return Object.freeze({ ...this.currentInfo });
    }

    /**
     * Updates configuration
     */
    updateConfiguration(newConfig: Partial<GatewayStatusBarConfig>): void {
        this.config = { ...this.config, ...newConfig };

        // Recreate status bar item if position or priority changed
        if (this.statusBarItem && (newConfig.position !== undefined || newConfig.priority !== undefined)) {
            this.statusBarItem.dispose();
            this.createStatusBarItem();
            if (this.isVisible) {
                this.statusBarItem.show();
            }
        }

        this.updateDisplay();
    }

    /**
     * Gets current configuration
     */
    getConfiguration(): Readonly<GatewayStatusBarConfig> {
        return Object.freeze({ ...this.config });
    }

    /**
     * Creates the VS Code status bar item
     */
    private createStatusBarItem(): void {
        this.statusBarItem = vscode.window.createStatusBarItem(this.config.position, this.config.priority);

        this.statusBarItem.command = this.config.enableQuickSwitch ? COMMANDS.SELECT_GATEWAY : undefined;

        this.updateDisplay();
    }

    /**
     * Updates the status bar item display
     */
    private updateDisplay(): void {
        if (!this.statusBarItem) return;

        const { gatewayName, projectName, displayState, error } = this.currentInfo;

        // Build display text
        let text = this.getStateIcon(displayState);
        let tooltip = 'Flint Gateway Status';

        if (gatewayName && displayState === GatewayDisplayState.SELECTED) {
            text = `$(server) ${gatewayName}`;
            tooltip = `Gateway: ${gatewayName}`;

            if (this.config.showProjectName && projectName) {
                text += ` • ${projectName}`;
                tooltip += `\nProject: ${projectName}`;
            }
        } else if (displayState === GatewayDisplayState.ERROR) {
            text = '$(error) Gateway Error';
            tooltip = 'Gateway configuration error';
            if (error) {
                tooltip += `\nError: ${error}`;
            }
        } else {
            text = '$(server) No Gateway';
            tooltip = 'No gateway selected';
        }

        // Add click instruction if quick switch is enabled
        if (this.config.enableQuickSwitch) {
            tooltip += '\n\nClick to select gateway';
        }

        this.statusBarItem.text = text;
        this.statusBarItem.tooltip = tooltip;

        // Set background color for error state only
        if (displayState === GatewayDisplayState.ERROR) {
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else {
            this.statusBarItem.backgroundColor = undefined;
        }
    }

    /**
     * Gets icon for display state
     */
    private getStateIcon(state: GatewayDisplayState): string {
        switch (state) {
            case GatewayDisplayState.SELECTED:
            case GatewayDisplayState.NO_GATEWAY:
                return '$(server)';
            case GatewayDisplayState.ERROR:
                return '$(error)';
            default:
                return '$(server)';
        }
    }

    /**
     * Refreshes gateway selection information from GatewayManagerService
     */
    private refreshGatewayStatus(): void {
        try {
            const gatewayManager = this.serviceContainer.get<any>('GatewayManagerService');
            if (gatewayManager) {
                const selectedGateway = gatewayManager.getSelectedGateway();
                const selectedProject = gatewayManager.getSelectedProject();

                if (selectedGateway && selectedProject) {
                    // Show selected gateway and project
                    this.setGatewaySelected(selectedGateway, selectedGateway, selectedProject);
                } else if (selectedGateway) {
                    // Gateway selected but no project
                    this.setGatewaySelected(selectedGateway, selectedGateway);
                } else {
                    // No gateway selected
                    this.setNoGateway();
                }
            }
        } catch (error) {
            console.warn('Failed to refresh gateway selection:', error);
        }
    }

    /**
     * Sets up event handlers for gateway events
     */
    private setupEventHandlers(): void {
        // Listen to gateway manager events
        try {
            const gatewayManager = this.serviceContainer.get<any>('GatewayManagerService');
            if (gatewayManager) {
                // Listen for gateway selection changes
                if (gatewayManager.onGatewaySelected) {
                    gatewayManager.onGatewaySelected((gatewayId: string | null) => {
                        console.log(`Gateway status bar: Gateway selection changed to ${gatewayId}`);
                        this.refreshGatewayStatus();
                    });
                }

                // Listen for project selection changes
                if (gatewayManager.onProjectSelected) {
                    gatewayManager.onProjectSelected((projectId: string | null) => {
                        console.log(`Gateway status bar: Project selection changed to ${projectId}`);
                        this.refreshGatewayStatus();
                    });
                }
            }
        } catch (error) {
            console.warn('Failed to setup gateway manager event listeners:', error);
        }

        // Configuration change listener
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('flint.ui.statusBar.gateway')) {
                this.loadConfiguration();
            }
        });

        // No periodic refresh needed since we're not actually connecting to gateways
    }

    /**
     * Loads configuration from VS Code settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.ui.statusBar.gateway');

        this.config = {
            showProjectName: config.get<boolean>('showProjectName') ?? true,
            enableQuickSwitch: config.get<boolean>('enableQuickSwitch') ?? true,
            position: config.get<vscode.StatusBarAlignment>('position') ?? vscode.StatusBarAlignment.Left,
            priority: config.get<number>('priority') ?? 200
        };
    }
}
