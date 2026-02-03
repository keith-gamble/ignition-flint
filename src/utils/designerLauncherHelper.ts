/**
 * @module DesignerLauncherHelper
 * @description Enhanced Designer Launcher utility with service lifecycle support
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Gateway manager interface for type safety
 */
interface IGatewayManager {
    getGatewayDesignerUrl(gatewayId: string): string | undefined;
    getGatewayWebpageUrl(gatewayId: string): string | undefined;
}

/**
 * Designer launch options
 */
export interface DesignerLaunchOptions {
    readonly useDesignerProtocol: boolean;
    readonly fallbackToWebGateway: boolean;
    readonly showConfirmation: boolean;
    readonly timeout: number;
}

/**
 * Workspace configuration interface
 */
interface IWorkspaceDesignerConfig {
    alwaysPrompt?: boolean;
    defaultLaunchOption?: 'ask' | 'designer' | 'web';
    rememberChoice?: boolean;
}

/**
 * Designer launcher configuration
 */
export interface DesignerLauncherConfig {
    hasDesignerLauncher: boolean | null;
    alwaysPrompt: boolean;
    defaultLaunchOption: 'designer' | 'web' | 'ask';
    rememberChoice: boolean;
}

/**
 * Enhanced Designer Launcher utility with service lifecycle support
 * Provides comprehensive Designer launching capabilities with fallback options
 */
export class DesignerLauncherHelper implements IServiceLifecycle {
    private static readonly SETTING_KEY = 'flint.has83DesignerLauncher';
    private static readonly CONFIG_KEY = 'flint.designerLauncher';
    private static readonly DESIGNER_LAUNCHER_CONFIRMATION_KEY = 'Confirm Installation';

    private static readonly DEFAULT_OPTIONS: DesignerLaunchOptions = {
        useDesignerProtocol: true,
        fallbackToWebGateway: true,
        showConfirmation: true,
        timeout: 5000
    };

    private isInitialized = false;
    private config: DesignerLauncherConfig = {
        hasDesignerLauncher: null,
        alwaysPrompt: false,
        defaultLaunchOption: 'ask',
        rememberChoice: true
    };

    constructor(private readonly serviceContainer?: ServiceContainer) {}

    async initialize(): Promise<void> {
        try {
            await Promise.resolve();
            this.loadConfiguration();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize designer launcher helper',
                'DESIGNER_LAUNCHER_INIT_FAILED',
                'Designer launcher helper could not start properly',
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
        // Nothing to stop
    }

    async dispose(): Promise<void> {
        // Nothing to dispose
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Checks if designer launcher is available, prompting user if not yet determined
     */
    async checkDesignerLauncherAvailability(): Promise<boolean> {
        if (!this.isInitialized) {
            throw new FlintError('Designer launcher helper not initialized', 'NOT_INITIALIZED');
        }
        const hasDesignerLauncher = this.config.hasDesignerLauncher;

        // If we already know the answer, return it
        if (hasDesignerLauncher === true) {
            return true;
        }

        // First time or user wants to be asked - prompt the user
        if (this.config.alwaysPrompt || hasDesignerLauncher === null) {
            return this.promptForDesignerLauncher();
        }

        return false;
    }

    /**
     * Prompts the user about designer launcher availability
     */
    private async promptForDesignerLauncher(): Promise<boolean> {
        const message =
            'Do you have the Designer Launcher for 8.3+ installed?\n\n' +
            'This enables opening Designer directly designer:// links.';

        const result = await vscode.window.showInformationMessage(
            message,
            {
                modal: true
            },
            DesignerLauncherHelper.DESIGNER_LAUNCHER_CONFIRMATION_KEY
        );

        if (result === DesignerLauncherHelper.DESIGNER_LAUNCHER_CONFIRMATION_KEY) {
            if (this.config.rememberChoice) {
                await this.setDesignerLauncherSetting(true);
            }
            return true;
        }
        if (this.config.rememberChoice) {
            await this.setDesignerLauncherSetting(false);
        }
        return false;
    }

    /**
     * Sets the designer launcher setting
     */
    private async setDesignerLauncherSetting(hasLauncher: boolean): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        await config.update(DesignerLauncherHelper.SETTING_KEY, hasLauncher, vscode.ConfigurationTarget.Global);
        this.config.hasDesignerLauncher = hasLauncher;
    }

    /**
     * Resets the designer launcher setting (for testing/reconfiguration)
     */
    async resetDesignerLauncherSetting(): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        await config.update(DesignerLauncherHelper.SETTING_KEY, null, vscode.ConfigurationTarget.Global);
        this.config.hasDesignerLauncher = null;

        vscode.window.showInformationMessage(
            'Designer Launcher setting has been reset. You will be prompted again next time you try to open Designer.'
        );
    }

    /**
     * Attempts to open Designer, falling back to web gateway if launcher not available
     */
    async openDesigner(
        gatewayId: string,
        gatewayManager: IGatewayManager,
        options?: Partial<DesignerLaunchOptions>
    ): Promise<void> {
        const opts = { ...DesignerLauncherHelper.DEFAULT_OPTIONS, ...options };

        if (!this.isInitialized) {
            throw new FlintError('Designer launcher helper not initialized', 'NOT_INITIALIZED');
        }
        const hasLauncher = opts.useDesignerProtocol && (await this.checkDesignerLauncherAvailability());

        if (hasLauncher) {
            // Try to open with designer:// protocol
            const designerUrl = gatewayManager.getGatewayDesignerUrl(gatewayId);
            if (designerUrl !== undefined && designerUrl.length > 0) {
                try {
                    await vscode.env.openExternal(vscode.Uri.parse(designerUrl));
                    return;
                } catch {
                    // If designer:// fails, show error and offer fallback
                    const result = await vscode.window.showErrorMessage(
                        'Failed to open Designer Launcher. This might mean Designer Launcher is not installed or the designer:// protocol is not registered.',
                        'Open Gateway Web Interface Instead',
                        'Update Setting'
                    );

                    await this.handleDesignerLaunchFailure(
                        result,
                        gatewayId,
                        gatewayManager,
                        opts.fallbackToWebGateway
                    );
                    return;
                }
            }
        }
    }

    /**
     * Handles designer launch failure by processing user's choice
     */
    private async handleDesignerLaunchFailure(
        result: string | undefined,
        gatewayId: string,
        gatewayManager: IGatewayManager,
        fallbackToWebGateway: boolean
    ): Promise<void> {
        if (result === 'Open Gateway Web Interface Instead' && fallbackToWebGateway) {
            await this.fallbackToWebGateway(gatewayId, gatewayManager);
        } else if (result === 'Update Setting') {
            await this.resetDesignerLauncherSetting();
        }
    }

    /**
     * Opens the gateway web interface as a fallback
     */
    private async fallbackToWebGateway(gatewayId: string, gatewayManager: IGatewayManager): Promise<void> {
        const webUrl = gatewayManager.getGatewayWebpageUrl(gatewayId);
        if (webUrl !== undefined && webUrl.length > 0) {
            await vscode.env.openExternal(vscode.Uri.parse(webUrl));
        } else {
            vscode.window.showErrorMessage(`Gateway not found: ${gatewayId}`);
        }
    }

    /**
     * Gets current designer launcher setting for display purposes
     */
    getCurrentSetting(): DesignerLauncherConfig {
        return { ...this.config };
    }

    /**
     * Updates configuration
     */
    updateConfiguration(newConfig: Partial<DesignerLauncherConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Loads configuration from workspace settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration();
        const workspaceConfig = config.get<IWorkspaceDesignerConfig>(DesignerLauncherHelper.CONFIG_KEY, {});

        this.config = {
            hasDesignerLauncher: config.get<boolean | null>(DesignerLauncherHelper.SETTING_KEY) ?? null,
            alwaysPrompt: workspaceConfig.alwaysPrompt ?? false,
            defaultLaunchOption: workspaceConfig.defaultLaunchOption ?? 'ask',
            rememberChoice: workspaceConfig.rememberChoice ?? true
        };
    }

    /**
     * String representation for debugging
     */
    toString(): string {
        return `DesignerLauncherHelper(hasLauncher: ${this.config.hasDesignerLauncher}, status: ${this.getStatus()})`;
    }

    // ============================================================================
    // STATIC METHODS (for backward compatibility)
    // ============================================================================

    private static instance?: DesignerLauncherHelper;

    private static async getInstance(): Promise<DesignerLauncherHelper> {
        if (!this.instance) {
            this.instance = new DesignerLauncherHelper();
            await this.instance.start();
        }
        return this.instance;
    }

    static async checkDesignerLauncherAvailability(): Promise<boolean> {
        const instance = await this.getInstance();
        return instance.checkDesignerLauncherAvailability();
    }

    static async resetDesignerLauncherSetting(): Promise<void> {
        const instance = await this.getInstance();
        return instance.resetDesignerLauncherSetting();
    }

    static async openDesigner(gatewayId: string, gatewayManager: IGatewayManager): Promise<void> {
        const instance = await this.getInstance();
        return instance.openDesigner(gatewayId, gatewayManager);
    }

    static getCurrentSetting(): boolean | null {
        const config = vscode.workspace.getConfiguration();
        return config.get<boolean>(this.SETTING_KEY) ?? false;
    }
}
