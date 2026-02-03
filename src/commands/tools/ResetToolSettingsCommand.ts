/**
 * @module ResetToolSettingsCommand
 * @description Command to reset tool configurations and settings
 */

import * as fs from 'fs/promises';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';

/**
 * Tool setting category
 */
interface ToolSettingCategory {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly settings: readonly string[];
    readonly dangerous: boolean;
}

/**
 * Command to reset various tool configurations and settings
 * Provides options to reset specific categories or all settings
 */
export class ResetToolSettingsCommand extends Command {
    private readonly settingCategories: readonly ToolSettingCategory[] = [
        {
            id: 'external-tools',
            name: 'External Tool Paths',
            description: 'Reset paths to external tools (Kindling, Designer launcher, etc.)',
            settings: ['flint.tools.kindlingPath', 'flint.tools.designerLauncherPath', 'flint.tools.customToolPaths'],
            dangerous: false
        },
        {
            id: 'search-settings',
            name: 'Search Configuration',
            description: 'Reset search behavior, indexing, and performance settings',
            settings: [
                'flint.search.maxResults',
                'flint.search.indexingEnabled',
                'flint.search.caseSensitiveDefault',
                'flint.search.excludePatterns'
            ],
            dangerous: false
        },
        {
            id: 'ui-preferences',
            name: 'UI Preferences',
            description: 'Reset tree view, editor, and interface preferences',
            settings: [
                'flint.ui.treeView.showResourceCounts',
                'flint.ui.treeView.groupByType',
                'flint.ui.editor.defaultEditor',
                'flint.ui.statusBar.showGateway'
            ],
            dangerous: false
        },
        {
            id: 'workspace-config',
            name: 'Workspace Configuration',
            description: 'Reset current workspace flint.config.json (DANGEROUS)',
            settings: [],
            dangerous: true
        },
        {
            id: 'all-settings',
            name: 'All Flint Settings',
            description: 'Reset ALL Flint extension settings to defaults (VERY DANGEROUS)',
            settings: [],
            dangerous: true
        }
    ];

    constructor(context: CommandContext) {
        super(COMMANDS.RESET_TOOL_SETTINGS, context);
    }

    protected validateArguments(category?: string): CommandValidationResult {
        const warnings: string[] = [];

        if (category) {
            const validCategory = this.settingCategories.find(cat => cat.id === category);
            if (!validCategory) {
                return {
                    isValid: false,
                    errors: [`Unknown settings category: ${category}`],
                    warnings: []
                };
            }

            if (validCategory.dangerous) {
                warnings.push('This operation will reset critical settings and may require reconfiguration');
            }
        } else {
            warnings.push('Settings category will be prompted from user');
        }

        return {
            isValid: true,
            errors: [],
            warnings
        };
    }

    protected async executeImpl(category?: string): Promise<void> {
        try {
            // Select category if not provided
            let selectedCategory = category;
            if (!selectedCategory) {
                selectedCategory = await this.selectSettingsCategory();
                if (!selectedCategory) return;
            }

            const categoryConfig = this.settingCategories.find(cat => cat.id === selectedCategory);
            if (!categoryConfig) {
                throw new FlintError(`Unknown settings category: ${selectedCategory}`, 'INVALID_CATEGORY');
            }

            // Confirm dangerous operations
            if (categoryConfig.dangerous) {
                const confirmed = await this.confirmDangerousOperation(categoryConfig);
                if (!confirmed) return;
            }

            // Reset settings with progress indication
            await this.executeWithProgress(
                async progress => {
                    progress?.(25, 'Preparing settings reset...');

                    await this.resetSettingsCategory(categoryConfig, progress);

                    progress?.(100, 'Settings reset completed');
                },
                {
                    showProgress: true,
                    progressTitle: `Resetting ${categoryConfig.name}...`
                }
            );

            // Show completion message
            await this.showResetCompletionMessage(categoryConfig);
        } catch (error) {
            throw new FlintError(
                'Failed to reset settings',
                'SETTINGS_RESET_FAILED',
                'Unable to reset the selected settings',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Prompts user to select settings category
     */
    private async selectSettingsCategory(): Promise<string | undefined> {
        const quickPickItems = this.settingCategories.map(category => ({
            label: category.dangerous ? `$(warning) ${category.name}` : `$(gear) ${category.name}`,
            description: category.dangerous ? 'DANGEROUS OPERATION' : '',
            detail: category.description,
            categoryId: category.id,
            dangerous: category.dangerous
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select settings category to reset',
            title: 'Reset Tool Settings',
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected?.categoryId;
    }

    /**
     * Confirms dangerous reset operations
     */
    private async confirmDangerousOperation(category: ToolSettingCategory): Promise<boolean> {
        const warningMessage =
            category.id === 'all-settings'
                ? 'This will reset ALL Flint extension settings to their default values. You will need to reconfigure gateways, project paths, and all preferences.'
                : category.id === 'workspace-config'
                  ? 'This will reset your workspace flint.config.json file. All configured gateways and project paths will be lost.'
                  : `This will reset ${category.name.toLowerCase()} which may require reconfiguration.`;

        const choice = await vscode.window.showWarningMessage(
            `Reset ${category.name}?`,
            {
                modal: true,
                detail: `${warningMessage}\n\nThis action cannot be undone.`
            },
            'Reset',
            'Backup First'
        );

        if (choice === 'Backup First') {
            await this.offerBackupOptions(category);

            // Ask again after backup
            const confirmed = await vscode.window.showWarningMessage(
                `Proceed with resetting ${category.name}?`,
                { modal: true },
                'Reset'
            );

            return confirmed === 'Reset';
        }

        return choice === 'Reset';
    }

    /**
     * Offers backup options before dangerous operations
     */
    private async offerBackupOptions(category: ToolSettingCategory): Promise<void> {
        const backupChoice = await vscode.window.showInformationMessage(
            'Backup Options',
            'Export Settings',
            'Copy to Clipboard',
            'Skip Backup'
        );

        switch (backupChoice) {
            case 'Export Settings':
                await this.exportSettingsToFile(category);
                break;
            case 'Copy to Clipboard':
                await this.copySettingsToClipboard(category);
                break;
            case 'Skip Backup':
                break;
            default:
                // No backup requested
                break;
        }
    }

    /**
     * Exports settings to a file
     */
    private async exportSettingsToFile(category: ToolSettingCategory): Promise<void> {
        try {
            // Get current settings for the category
            const currentSettings = this.getCurrentSettings(category);
            const settingsJson = JSON.stringify(currentSettings, null, 2);

            // Prompt for save location
            const saveUri = await vscode.window.showSaveDialog({
                filters: {
                    JSON: ['json'],
                    'All Files': ['*']
                },
                defaultUri: vscode.Uri.file(`flint-settings-${category.id}-backup.json`)
            });

            if (saveUri) {
                await fs.writeFile(saveUri.fsPath, settingsJson, 'utf8');
                await vscode.window
                    .showInformationMessage(`Settings exported to: ${saveUri.fsPath}`, 'Open File')
                    .then(choice => {
                        if (choice === 'Open File') {
                            vscode.commands.executeCommand('vscode.open', saveUri);
                        }
                    });
            }
        } catch (error) {
            console.warn('Failed to export settings to file:', error);
            await vscode.window.showWarningMessage('Failed to export settings to file');
        }
    }

    /**
     * Copies current settings to clipboard
     */
    private async copySettingsToClipboard(category: ToolSettingCategory): Promise<void> {
        try {
            const currentSettings = this.getCurrentSettings(category);
            const settingsJson = JSON.stringify(currentSettings, null, 2);
            await vscode.env.clipboard.writeText(settingsJson);
            // Show success message in status bar (auto-dismiss after 3 seconds)
            vscode.window.setStatusBarMessage('✅ Current settings copied to clipboard', 3000);
        } catch (error) {
            console.warn('Failed to copy settings to clipboard:', error);
        }
    }

    /**
     * Gets current settings for a category
     */
    private getCurrentSettings(category: ToolSettingCategory): Record<string, unknown> {
        const settings: Record<string, unknown> = {};

        for (const setting of category.settings) {
            const config = vscode.workspace.getConfiguration();
            const value = config.get(setting);
            if (value !== undefined) {
                settings[setting] = value;
            }
        }

        return settings;
    }

    /**
     * Resets settings for a specific category
     */
    private async resetSettingsCategory(
        category: ToolSettingCategory,
        progress?: (increment: number, message?: string) => void
    ): Promise<void> {
        switch (category.id) {
            case 'workspace-config':
                progress?.(50, 'Resetting workspace configuration...');
                await this.resetWorkspaceConfig();
                break;

            case 'all-settings':
                progress?.(50, 'Resetting all Flint settings...');
                await this.resetAllFlintSettings();
                break;

            default:
                await this.resetCategorySettings(category, progress);
                break;
        }
    }

    /**
     * Resets individual settings in a category
     */
    private async resetCategorySettings(
        category: ToolSettingCategory,
        progress?: (increment: number, message?: string) => void
    ): Promise<void> {
        const totalSettings = category.settings.length;

        for (let i = 0; i < category.settings.length; i++) {
            const setting = category.settings[i];
            const progressPercent = Math.floor(((i + 1) / totalSettings) * 50) + 25; // 25-75% range

            progress?.(progressPercent, `Resetting ${setting}...`);

            try {
                const config = vscode.workspace.getConfiguration();
                await config.update(setting, undefined, vscode.ConfigurationTarget.Global);
                await config.update(setting, undefined, vscode.ConfigurationTarget.Workspace);
            } catch (error) {
                console.warn(`Failed to reset setting ${setting}:`, error);
            }
        }
    }

    /**
     * Resets workspace flint.config.json
     */
    private async resetWorkspaceConfig(): Promise<void> {
        try {
            const workspaceConfigService = this.getService<any>('WorkspaceConfigService');

            // Backup current config first
            const currentPath = workspaceConfigService.getConfigurationPath();
            if (currentPath) {
                const backupPath = currentPath.replace('.json', `-backup-${Date.now()}.json`);

                try {
                    const configContent = await fs.readFile(currentPath, 'utf8');
                    await fs.writeFile(backupPath, configContent, 'utf8');
                    console.log(`Config backed up to: ${backupPath}`);
                } catch (error) {
                    console.warn('Failed to backup current config:', error);
                }
            }

            // Create new default configuration
            await workspaceConfigService.createDefaultConfiguration();

            // Refresh any dependent services
            try {
                const projectScanner = this.getService<any>('ProjectScannerService');
                if (projectScanner?.rescanAllProjects) {
                    await projectScanner.rescanAllProjects();
                }
            } catch (error) {
                console.warn('Failed to refresh project scanner:', error);
            }
        } catch (error) {
            throw new FlintError(
                'Failed to reset workspace configuration',
                'WORKSPACE_CONFIG_RESET_FAILED',
                'Unable to reset workspace flint.config.json',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Resets all Flint extension settings
     */
    private async resetAllFlintSettings(): Promise<void> {
        try {
            // Reset all flint.* configuration keys
            const config = vscode.workspace.getConfiguration('flint');
            const allKeys = Object.keys(config);

            for (const key of allKeys) {
                await config.update(key, undefined, vscode.ConfigurationTarget.Global);
                await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
            }
        } catch (error) {
            throw new FlintError(
                'Failed to reset all settings',
                'ALL_SETTINGS_RESET_FAILED',
                'Unable to reset all Flint extension settings',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Shows completion message with next steps
     */
    private async showResetCompletionMessage(category: ToolSettingCategory): Promise<void> {
        const nextSteps = this.getNextStepsForCategory(category);

        const choice = await vscode.window.showInformationMessage(
            `Reset ${category.name}`,
            { detail: nextSteps },
            'Reload Extension',
            'Configure Now'
        );

        switch (choice) {
            case 'Reload Extension':
                await vscode.commands.executeCommand('workbench.action.reloadWindow');
                break;
            case 'Configure Now':
                await this.offerConfiguration(category);
                break;
            default:
                // No action requested
                break;
        }
    }

    /**
     * Gets next steps message for a category
     */
    private getNextStepsForCategory(category: ToolSettingCategory): string {
        switch (category.id) {
            case 'external-tools':
                return 'You may need to reconfigure paths to external tools like Kindling.';
            case 'workspace-config':
                return 'You will need to reconfigure gateways and project paths.';
            case 'all-settings':
                return 'Extension settings have been reset to defaults. You may need to reconfigure everything.';
            default:
                return `${category.name} have been reset to default values.`;
        }
    }

    /**
     * Offers configuration assistance after reset
     */
    private async offerConfiguration(category: ToolSettingCategory): Promise<void> {
        switch (category.id) {
            case 'external-tools':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'flint.tools');
                break;
            case 'workspace-config':
                await vscode.commands.executeCommand(COMMANDS.GET_STARTED);
                break;
            default:
                await vscode.commands.executeCommand('workbench.action.openSettings', 'flint');
                break;
        }
    }
}
