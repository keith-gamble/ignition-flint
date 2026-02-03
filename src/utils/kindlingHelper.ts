/**
 * @module KindlingHelper
 * @description Enhanced Kindling integration utility with service lifecycle support
 */

import { exec } from 'child_process';
import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Workspace configuration interface for Kindling
 */
interface IWorkspaceKindlingConfig {
    alwaysPrompt?: boolean;
    rememberChoice?: boolean;
}

/**
 * Kindling launch options
 */
export interface KindlingLaunchOptions {
    showConfirmation: boolean;
    timeout: number;
    customPath?: string;
}

/**
 * Kindling execution result
 */
export interface KindlingExecutionResult {
    success: boolean;
    filePath: string;
    command: string;
    error?: Error;
    timestamp: Date;
}

/**
 * Kindling configuration
 */
export interface KindlingConfig {
    hasKindling: boolean | null;
    customPath?: string;
    alwaysPrompt: boolean;
    rememberChoice: boolean;
}

/**
 * Enhanced Kindling integration utility with service lifecycle support
 * Provides comprehensive Kindling launching capabilities with error handling
 */
export class KindlingHelper implements IServiceLifecycle {
    private static readonly SETTING_KEY = 'flint.hasKindlingInstalled';
    private static readonly CUSTOM_PATH_KEY = 'flint.kindlingExecutablePath';
    private static readonly CONFIG_KEY = 'flint.kindling';
    private static readonly KINDLING_DOWNLOAD_URL = 'https://inductiveautomation.github.io/kindling/download.html';
    private static readonly CONFIRM_INSTALLATION = 'Confirm Installation';
    private static readonly DOWNLOAD_KINDLING = 'Download Kindling';
    private static readonly BROWSE_FOR_KINDLING = 'Browse for Kindling';
    private static readonly OPEN_SETTINGS = 'Open Settings';

    private static readonly DEFAULT_OPTIONS: KindlingLaunchOptions = {
        showConfirmation: true,
        timeout: 5000
    };

    private isInitialized = false;
    private config: KindlingConfig = {
        hasKindling: null,
        alwaysPrompt: false,
        rememberChoice: true
    };
    private executionHistory: KindlingExecutionResult[] = [];

    constructor(private readonly serviceContainer?: ServiceContainer) {}

    async initialize(): Promise<void> {
        try {
            await Promise.resolve();
            this.loadConfiguration();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize kindling helper',
                'KINDLING_INIT_FAILED',
                'Kindling helper could not start properly',
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
        await Promise.resolve();
        this.executionHistory = [];
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Opens a file with Kindling, checking installation status first
     */
    async openWithKindling(uri: vscode.Uri, options?: Partial<KindlingLaunchOptions>): Promise<void> {
        const _opts = { ...KindlingHelper.DEFAULT_OPTIONS, ...options };

        if (!this.isInitialized) {
            throw new FlintError('Kindling helper not initialized', 'NOT_INITIALIZED');
        }
        if (!uri.fsPath) {
            vscode.window.showWarningMessage('No file selected.');
            return;
        }

        const hasKindling = await this.checkKindlingAvailability();
        if (!hasKindling) {
            return; // User cancelled or chose to download
        }

        const filePath = uri.fsPath;
        const command = this.getKindlingCommand(filePath);

        if (command === null || command.length === 0) {
            await this.handleKindlingNotFound(filePath);
            return;
        }

        exec(command, error => {
            const result: KindlingExecutionResult = {
                success: !error,
                filePath,
                command,
                error: error ?? undefined,
                timestamp: new Date()
            };
            this.executionHistory.push(result);

            if (error) {
                void this.handleKindlingError(error, filePath);
            }
        });
    }

    /**
     * Checks if Kindling is available, prompting user if not yet determined
     */
    async checkKindlingAvailability(): Promise<boolean> {
        if (!this.isInitialized) {
            throw new FlintError('Kindling helper not initialized', 'NOT_INITIALIZED');
        }
        const hasKindling = this.config.hasKindling;

        // If we already know the answer, return it
        if (hasKindling === true) {
            return true;
        }

        // First time or user wants to be asked - prompt the user
        if (this.config.alwaysPrompt || hasKindling === null) {
            return this.promptForKindlingInstallation();
        }

        return false;
    }

    /**
     * Prompts the user about Kindling installation with download option
     */
    private async promptForKindlingInstallation(): Promise<boolean> {
        const message =
            'Do you have Kindling installed?\n\n' +
            'Kindling is a tool for viewing Ignition backup files, log files, and other resources.';

        const result = await vscode.window.showInformationMessage(
            message,
            {
                modal: true
            },
            KindlingHelper.CONFIRM_INSTALLATION,
            KindlingHelper.BROWSE_FOR_KINDLING,
            KindlingHelper.DOWNLOAD_KINDLING
        );

        if (result === KindlingHelper.CONFIRM_INSTALLATION) {
            if (this.config.rememberChoice) {
                await this.setKindlingSetting(true);
            }
            return true;
        } else if (result === KindlingHelper.BROWSE_FOR_KINDLING) {
            const customPath = await this.browseForKindlingExecutable();
            if (customPath !== undefined && customPath.length > 0) {
                await this.setCustomKindlingPath(customPath);
                if (this.config.rememberChoice) {
                    await this.setKindlingSetting(true);
                }
                return true;
            }
            return false;
        } else if (result === KindlingHelper.DOWNLOAD_KINDLING) {
            await this.openKindlingDownloadPage();
            return false; // Don't try to open with Kindling since they need to download it
        }
        // User cancelled - don't save setting if user doesn't want to remember
        if (this.config.rememberChoice) {
            await this.setKindlingSetting(false);
        }
        return false;
    }

    /**
     * Opens the Kindling download page
     */
    private async openKindlingDownloadPage(): Promise<void> {
        try {
            await vscode.env.openExternal(vscode.Uri.parse(KindlingHelper.KINDLING_DOWNLOAD_URL));

            vscode.window
                .showInformationMessage(
                    'Kindling download page opened. After installing Kindling, you can try opening the file again.',
                    'Reset Setting After Install'
                )
                .then((choice: string | undefined) => {
                    if (choice === 'Reset Setting After Install') {
                        this.resetKindlingSetting().catch(console.error);
                    }
                });
        } catch {
            vscode.window.showErrorMessage(
                `Failed to open Kindling download page. Please visit: ${KindlingHelper.KINDLING_DOWNLOAD_URL}`
            );
        }
    }

    /**
     * Sets the Kindling installation setting
     */
    private async setKindlingSetting(hasKindling: boolean): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        await config.update(KindlingHelper.SETTING_KEY, hasKindling, vscode.ConfigurationTarget.Global);
        this.config.hasKindling = hasKindling;
    }

    /**
     * Resets the Kindling installation setting (for after installation)
     */
    async resetKindlingSetting(): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        await config.update(KindlingHelper.SETTING_KEY, null, vscode.ConfigurationTarget.Global);
        await config.update(KindlingHelper.CUSTOM_PATH_KEY, undefined, vscode.ConfigurationTarget.Global);
        this.config.hasKindling = null;
        this.config.customPath = undefined;

        vscode.window.showInformationMessage(
            'Kindling settings have been reset. You will be prompted again next time you try to open a file with Kindling.'
        );
    }

    /**
     * Handles when Kindling is not found in the system PATH
     */
    private async handleKindlingNotFound(filePath: string): Promise<void> {
        const fileName = path.basename(filePath);
        const isWSL = process.platform === 'linux' && Boolean(process.env.WSL_DISTRO_NAME);

        let message = `Kindling executable not found when trying to open "${fileName}".`;

        if (isWSL) {
            message += '\n\nOn WSL, you may need to specify the Windows path to Kindling.exe.';
        }

        const result = await vscode.window.showErrorMessage(
            message,
            KindlingHelper.BROWSE_FOR_KINDLING,
            KindlingHelper.OPEN_SETTINGS,
            KindlingHelper.DOWNLOAD_KINDLING
        );

        if (result === KindlingHelper.BROWSE_FOR_KINDLING) {
            const customPath = await this.browseForKindlingExecutable();
            if (customPath !== undefined && customPath.length > 0) {
                await this.setCustomKindlingPath(customPath);
                await this.setKindlingSetting(true);
                // Retry opening the file
                await this.openWithKindling(vscode.Uri.file(filePath));
            }
        } else if (result === KindlingHelper.OPEN_SETTINGS) {
            await this.openKindlingSettings();
        } else if (result === KindlingHelper.DOWNLOAD_KINDLING) {
            await this.openKindlingDownloadPage();
        }
    }

    /**
     * Opens VS Code settings to the Kindling configuration section
     */
    private async openKindlingSettings(): Promise<void> {
        await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:bw-design-group.ignition-flint kindling'
        );
    }

    /**
     * Opens file browser to select Kindling executable
     */
    private async browseForKindlingExecutable(): Promise<string | undefined> {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            title: 'Select Kindling Executable',
            filters: {}
        };

        // Set appropriate file filters based on platform
        if (process.platform === 'win32' || (process.platform === 'linux' && Boolean(process.env.WSL_DISTRO_NAME))) {
            // Windows or WSL - look for .exe files
            options.filters = {
                'Executable Files': ['exe'],
                'All Files': ['*']
            };
        } else if (process.platform === 'darwin') {
            // macOS - look for .app bundles or executables
            options.filters = {
                Applications: ['app'],
                'Executable Files': ['*'],
                'All Files': ['*']
            };
        } else {
            // Linux - any executable
            options.filters = {
                'All Files': ['*']
            };
        }

        const fileUri = await vscode.window.showOpenDialog(options);
        return fileUri?.[0]?.fsPath;
    }

    /**
     * Sets the custom Kindling executable path
     */
    private async setCustomKindlingPath(executablePath: string): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        await config.update(KindlingHelper.CUSTOM_PATH_KEY, executablePath, vscode.ConfigurationTarget.Global);
        this.config.customPath = executablePath;

        vscode.window.showInformationMessage(`Kindling path set to: ${executablePath}`);
    }

    /**
     * Gets the custom Kindling executable path
     */
    private getCustomKindlingPath(): string | undefined {
        return this.config.customPath;
    }
    private async handleKindlingError(error: Error, filePath: string): Promise<void> {
        const fileName = path.basename(filePath);

        const result = await vscode.window.showErrorMessage(
            `Failed to open "${fileName}" with Kindling: ${error.message}\n\n` +
                'This might mean Kindling is not installed or not in your system PATH.',
            'Download Kindling',
            'Update Setting',
            'Show File Location'
        );

        if (result === 'Download Kindling') {
            await this.openKindlingDownloadPage();
        } else if (result === 'Update Setting') {
            await this.resetKindlingSetting();
        } else if (result === 'Show File Location') {
            await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(filePath));
        }
    }

    /**
     * Gets the platform-specific command to launch Kindling
     */
    private getKindlingCommand(filePath: string): string | null {
        const customPath = this.getCustomKindlingPath();

        if (customPath !== undefined && customPath.length > 0) {
            // Use custom path if specified
            return this.buildCustomKindlingCommand(customPath, filePath);
        }

        // Use platform default paths
        return KindlingHelper.getDefaultKindlingCommand(filePath);
    }

    /**
     * Builds command using custom Kindling path
     */
    private buildCustomKindlingCommand(kindlingPath: string, filePath: string): string {
        // Handle spaces in paths by quoting
        const quotedKindlingPath = kindlingPath.includes(' ') ? `"${kindlingPath}"` : kindlingPath;
        const quotedFilePath = filePath.includes(' ') ? `"${filePath}"` : filePath;

        if (process.platform === 'win32' || (process.platform === 'linux' && Boolean(process.env.WSL_DISTRO_NAME))) {
            // Windows or WSL
            return `${quotedKindlingPath} ${quotedFilePath}`;
        } else if (process.platform === 'darwin') {
            // macOS - handle .app bundles
            if (kindlingPath.endsWith('.app')) {
                return `open -a ${quotedKindlingPath} ${quotedFilePath}`;
            }
            return `${quotedKindlingPath} ${quotedFilePath}`;
        }
        // Linux
        return `${quotedKindlingPath} ${quotedFilePath}`;
    }

    /**
     * Gets the default platform-specific command to launch Kindling
     */
    private static getDefaultKindlingCommand(filePath: string): string | null {
        const quotedFilePath = filePath.includes(' ') ? `"${filePath}"` : filePath;

        switch (process.platform) {
            case 'win32':
                return `start "" "Kindling" ${quotedFilePath}`;
            case 'darwin':
                return `open -a Kindling ${quotedFilePath}`;
            case 'linux':
                // Check if we're in WSL
                if (process.env.WSL_DISTRO_NAME !== undefined) {
                    // In WSL, can't use default Linux command, need custom path
                    return null;
                }
                return `kindling ${quotedFilePath}`;
            default:
                return `kindling ${quotedFilePath}`;
        }
    }

    /**
     * Gets current Kindling configuration for display purposes
     */
    getCurrentConfiguration(): KindlingConfig {
        return { ...this.config };
    }

    /**
     * Updates configuration
     */
    updateConfiguration(newConfig: Partial<KindlingConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Gets execution history
     */
    getExecutionHistory(): readonly KindlingExecutionResult[] {
        return [...this.executionHistory];
    }

    /**
     * Clears execution history
     */
    clearExecutionHistory(): void {
        this.executionHistory = [];
    }

    /**
     * Loads configuration from workspace settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration();
        const workspaceConfig = config.get<IWorkspaceKindlingConfig>(KindlingHelper.CONFIG_KEY, {});

        this.config = {
            hasKindling: config.get<boolean | null>(KindlingHelper.SETTING_KEY) ?? null,
            customPath: config.get<string>(KindlingHelper.CUSTOM_PATH_KEY),
            alwaysPrompt: workspaceConfig.alwaysPrompt ?? false,
            rememberChoice: workspaceConfig.rememberChoice ?? true
        };
    }

    /**
     * String representation for debugging
     */
    toString(): string {
        return `KindlingHelper(hasKindling: ${this.config.hasKindling}, status: ${this.getStatus()})`;
    }

    /**
     * Manually sets Kindling as installed (for programmatic use)
     */
    async setKindlingInstalled(customPath?: string): Promise<void> {
        await this.setKindlingSetting(true);
        if (customPath !== undefined && customPath.length > 0) {
            await this.setCustomKindlingPath(customPath);
        }
        vscode.window.showInformationMessage('Kindling has been marked as installed.');
    }

    /**
     * Opens the Kindling configuration in VS Code settings
     */
    async openKindlingConfiguration(): Promise<void> {
        await this.openKindlingSettings();
    }

    /**
     * Checks if specific file types are supported by Kindling
     */
    static isSupportedFileType(filePath: string): boolean {
        const supportedExtensions = ['.gwbk', '.modl', '.idb', '.log'];
        const ext = path.extname(filePath).toLowerCase();
        return supportedExtensions.includes(ext);
    }

    // ============================================================================
    // STATIC METHODS (for backward compatibility)
    // ============================================================================

    private static instance?: KindlingHelper;

    private static async getInstance(): Promise<KindlingHelper> {
        if (!this.instance) {
            this.instance = new KindlingHelper();
            await this.instance.start();
        }
        return this.instance;
    }

    static async openWithKindling(uri: vscode.Uri): Promise<void> {
        const instance = await this.getInstance();
        return instance.openWithKindling(uri);
    }

    static async resetKindlingSetting(): Promise<void> {
        const instance = await this.getInstance();
        return instance.resetKindlingSetting();
    }

    static async setKindlingInstalled(customPath?: string): Promise<void> {
        const instance = await this.getInstance();
        return instance.setKindlingInstalled(customPath);
    }

    static async openKindlingConfiguration(): Promise<void> {
        const instance = await this.getInstance();
        return instance.openKindlingConfiguration();
    }

    static getCurrentSetting(): { hasKindling: boolean | null; customPath: string | undefined } {
        const config = vscode.workspace.getConfiguration();
        return {
            hasKindling: config.get<boolean>(this.SETTING_KEY) ?? false,
            customPath: config.get<string>(this.CUSTOM_PATH_KEY)
        };
    }
}

// Standalone function for convenience
export function openWithKindling(uri: vscode.Uri): Promise<void> {
    return KindlingHelper.openWithKindling(uri);
}
