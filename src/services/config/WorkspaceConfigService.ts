/**
 * @module WorkspaceConfigService
 * @description Enhanced configuration management service with validation, migration, and hierarchical config support
 * Supports multiple config locations and local override files
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { CONFIG_SCHEMA_VERSIONS, CONFIG_LOCATIONS, LOCAL_CONFIG_PATTERNS, CONFIG_SETTING_KEYS } from '@/core/constants';
import {
    FlintError,
    ConfigurationNotFoundError,
    ConfigurationInvalidError,
    ConfigurationWriteError
} from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { FlintConfig, GatewayConfig, LoadedConfigInfo, ConfigResolutionResult } from '@/core/types/configuration';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ConfigMigrationService } from '@/services/config/ConfigMigrationService';
import { ConfigValidationService } from '@/services/config/ConfigValidationService';
import { mergeConfigurations, isValidLocalConfig } from '@/utils/config';

/**
 * Enhanced workspace configuration service with validation, migration, and monitoring
 * Supports hierarchical configuration with local overrides
 */
export class WorkspaceConfigService implements IServiceLifecycle {
    private static readonly CONFIG_SCHEMA_VERSION = CONFIG_SCHEMA_VERSIONS.CURRENT;

    private config: FlintConfig | null = null;
    private baseConfigInfo: LoadedConfigInfo | null = null;
    private localConfigInfo: LoadedConfigInfo | null = null;
    private fileWatchers: vscode.FileSystemWatcher[] = [];
    private settingsWatcher: vscode.Disposable | null = null;
    private isInitialized = false;

    private readonly configChangeEmitter = new vscode.EventEmitter<FlintConfig>();
    public readonly onConfigChanged = this.configChangeEmitter.event;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly validationService: ConfigValidationService,
        private readonly migrationService: ConfigMigrationService
    ) {}

    async initialize(): Promise<void> {
        try {
            if (!vscode.workspace.workspaceFolders?.[0]) {
                this.isInitialized = true;
                return;
            }

            await this.loadConfiguration();
            this.setupFileWatchers();
            this.setupSettingsWatcher();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize workspace configuration service',
                'SERVICE_INITIALIZATION_FAILED',
                'Configuration service could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            return Promise.reject(
                new FlintError('WorkspaceConfigService must be initialized before starting', 'SERVICE_NOT_INITIALIZED')
            );
        }
        return Promise.resolve();
    }

    stop(): Promise<void> {
        this.config = null;
        this.baseConfigInfo = null;
        this.localConfigInfo = null;
        this.isInitialized = false;
        return Promise.resolve();
    }

    async dispose(): Promise<void> {
        for (const watcher of this.fileWatchers) {
            watcher.dispose();
        }
        this.fileWatchers = [];

        if (this.settingsWatcher) {
            this.settingsWatcher.dispose();
            this.settingsWatcher = null;
        }

        if (typeof this.configChangeEmitter.dispose === 'function') {
            this.configChangeEmitter.dispose();
        }
        await this.stop();
    }

    getStatus(): ServiceStatus {
        if (!this.isInitialized) return ServiceStatus.STOPPED;
        if (this.config) return ServiceStatus.RUNNING;
        return ServiceStatus.FAILED;
    }

    /**
     * Gets the current configuration, loading it if not already loaded
     */
    async getConfiguration(): Promise<FlintConfig> {
        if (!this.config) {
            await this.loadConfiguration();
        }

        if (!this.config) {
            throw new ConfigurationNotFoundError(this.baseConfigInfo?.path ?? 'unknown');
        }

        return this.config;
    }

    /**
     * Updates the configuration with validation
     * Updates are always written to the base config file
     */
    async updateConfiguration(updates: Partial<FlintConfig>): Promise<void> {
        const currentConfig = await this.getConfiguration();
        const newConfig: FlintConfig = {
            ...currentConfig,
            ...updates,
            schemaVersion: WorkspaceConfigService.CONFIG_SCHEMA_VERSION
        };

        const validation = await this.validationService.validateConfiguration(newConfig);
        if (!validation.isValid) {
            throw new ConfigurationInvalidError(this.baseConfigInfo?.path ?? 'unknown', [...validation.errors]);
        }

        await this.saveConfiguration(newConfig);
    }

    /**
     * Creates a default configuration file
     */
    async createDefaultConfiguration(): Promise<void> {
        if (!vscode.workspace.workspaceFolders?.[0]) {
            throw new FlintError(
                'Cannot create configuration without an open workspace',
                'NO_WORKSPACE',
                'Please open a folder in VS Code first'
            );
        }

        const defaultConfig: FlintConfig = {
            schemaVersion: WorkspaceConfigService.CONFIG_SCHEMA_VERSION,
            'project-paths': [],
            gateways: {},
            settings: {
                showInheritedResources: true,
                groupResourcesByType: true,
                autoRefreshProjects: true,
                searchHistoryLimit: 50
            }
        };

        const configPath = this.getDefaultConfigPath();
        await this.saveConfigurationToFile(configPath, defaultConfig);
        this.config = defaultConfig;
        this.baseConfigInfo = {
            path: configPath,
            config: defaultConfig,
            isLocalOverride: false,
            loadedAt: new Date()
        };

        if (typeof this.configChangeEmitter.fire === 'function') {
            this.configChangeEmitter.fire(defaultConfig);
        }
    }

    /**
     * Validates the current configuration
     */
    async validateCurrentConfiguration(): Promise<{
        isValid: boolean;
        errors: string[];
        warnings: string[];
    }> {
        const config = await this.getConfiguration();
        const result = await this.validationService.validateConfiguration(config);
        return {
            isValid: result.isValid,
            errors: [...result.errors],
            warnings: [...result.warnings]
        };
    }

    /**
     * Gets all configured gateways
     */
    async getGateways(): Promise<Record<string, GatewayConfig>> {
        const config = await this.getConfiguration();
        return config.gateways ?? {};
    }

    /**
     * Adds or updates a gateway configuration
     */
    async setGateway(id: string, gatewayConfig: Omit<GatewayConfig, 'id'>): Promise<void> {
        const config = await this.getConfiguration();
        const updatedGateways = {
            ...config.gateways,
            [id]: { ...gatewayConfig, id }
        };

        await this.updateConfiguration({ gateways: updatedGateways });
    }

    /**
     * Removes a gateway configuration
     */
    async removeGateway(id: string): Promise<void> {
        const config = await this.getConfiguration();
        const updatedGateways = { ...config.gateways };
        delete updatedGateways[id];

        await this.updateConfiguration({ gateways: updatedGateways });
    }

    /**
     * Gets all configured project paths (resolved to absolute paths)
     */
    async getProjectPaths(): Promise<string[]> {
        const config = await this.getConfiguration();
        const rawPaths = config['project-paths'] ?? [];
        return this.resolveProjectPaths([...rawPaths]);
    }

    /**
     * Gets raw project paths as configured (may be relative)
     */
    async getRawProjectPaths(): Promise<string[]> {
        const config = await this.getConfiguration();
        return [...(config['project-paths'] ?? [])];
    }

    /**
     * Adds project paths
     */
    async addProjectPaths(paths: string[]): Promise<void> {
        const config = await this.getConfiguration();
        const existingPaths = config['project-paths'] ?? [];
        const newPaths = [...new Set([...existingPaths, ...paths])];

        await this.updateConfiguration({ 'project-paths': newPaths });
    }

    /**
     * Removes project paths
     */
    async removeProjectPaths(pathsToRemove: string[]): Promise<void> {
        const config = await this.getConfiguration();
        const existingPaths = config['project-paths'] ?? [];
        const newPaths = existingPaths.filter(p => !pathsToRemove.includes(p));

        await this.updateConfiguration({ 'project-paths': newPaths });
    }

    /**
     * Gets configuration file path (base config)
     */
    getConfigurationPath(): string | null {
        return this.baseConfigInfo?.path ?? null;
    }

    /**
     * Gets all loaded configuration paths (base and local)
     */
    getConfigurationPaths(): { base: string | null; local: string | null } {
        return {
            base: this.baseConfigInfo?.path ?? null,
            local: this.localConfigInfo?.path ?? null
        };
    }

    /**
     * Checks if a local config override is active
     */
    hasLocalConfigOverride(): boolean {
        return this.localConfigInfo !== null;
    }

    /**
     * Checks if configuration file exists
     */
    async configurationExists(): Promise<boolean> {
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return false;
        }

        const resolution = await this.resolveConfigPaths();
        return resolution.baseConfig !== null;
    }

    /**
     * Migrates legacy configuration if needed
     */
    async migrateConfiguration(): Promise<boolean> {
        if (!(await this.configurationExists())) {
            return false;
        }

        if (!this.baseConfigInfo) {
            return false;
        }

        const rawConfig = await this.loadRawConfiguration(this.baseConfigInfo.path);

        if (this.migrationService.needsMigration(rawConfig)) {
            const migratedConfig = await this.migrationService.migrateConfiguration(rawConfig);
            await this.saveConfigurationToFile(this.baseConfigInfo.path, migratedConfig);

            // Reload configuration after migration
            await this.loadConfiguration();

            if (this.config && typeof this.configChangeEmitter.fire === 'function') {
                this.configChangeEmitter.fire(this.config);
            }
            return true;
        }

        return false;
    }

    /**
     * Resolves configuration file paths based on VS Code settings and default locations
     */
    private async resolveConfigPaths(): Promise<ConfigResolutionResult> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return {
                baseConfig: null,
                localConfig: null,
                mergedConfig: null,
                searchedPaths: [],
                warnings: []
            };
        }

        const workspaceRoot = workspaceFolder.uri.fsPath;
        const searchedPaths: string[] = [];
        const warnings: string[] = [];

        // Find and load base config
        const baseResult = await this.findAndLoadBaseConfig(workspaceRoot, searchedPaths, warnings);
        const { configPath: baseConfigPath, config: baseConfig, info: baseConfigInfo } = baseResult;

        // Find and load local config
        const { config: localConfig, info: localConfigInfo } = await this.findAndLoadLocalConfig(
            workspaceRoot,
            baseConfigPath,
            searchedPaths,
            warnings
        );

        // Merge configurations
        const mergedConfig = this.createMergedConfig(baseConfig, localConfig);

        return {
            baseConfig: baseConfigInfo,
            localConfig: localConfigInfo,
            mergedConfig,
            searchedPaths,
            warnings
        };
    }

    /**
     * Finds and loads the base configuration file
     */
    private async findAndLoadBaseConfig(
        workspaceRoot: string,
        searchedPaths: string[],
        warnings: string[]
    ): Promise<{ configPath: string | null; config: FlintConfig | null; info: LoadedConfigInfo | null }> {
        const vsCodeConfig = vscode.workspace.getConfiguration();
        let configPath: string | null = null;

        // Check VS Code setting first
        const customConfigPath = vsCodeConfig.get<string>(CONFIG_SETTING_KEYS.CONFIG_PATH);
        if (customConfigPath) {
            const resolvedPath = path.isAbsolute(customConfigPath)
                ? customConfigPath
                : path.join(workspaceRoot, customConfigPath);
            searchedPaths.push(resolvedPath);

            if (await this.fileExists(resolvedPath)) {
                configPath = resolvedPath;
            } else {
                warnings.push(`Custom config path '${customConfigPath}' not found, searching default locations`);
            }
        }

        // Search default locations if custom path not found
        if (!configPath) {
            configPath = await this.searchConfigLocations(workspaceRoot, CONFIG_LOCATIONS, searchedPaths);
        }

        // Load config if path found
        if (!configPath) {
            return { configPath: null, config: null, info: null };
        }

        try {
            const config = await this.loadRawConfiguration(configPath);
            const info: LoadedConfigInfo = {
                path: configPath,
                config,
                isLocalOverride: false,
                loadedAt: new Date()
            };
            return { configPath, config, info };
        } catch (error) {
            warnings.push(`Failed to load base config: ${error instanceof Error ? error.message : String(error)}`);
            return { configPath, config: null, info: null };
        }
    }

    /**
     * Finds and loads the local override configuration file
     */
    private async findAndLoadLocalConfig(
        workspaceRoot: string,
        baseConfigPath: string | null,
        searchedPaths: string[],
        warnings: string[]
    ): Promise<{ config: Partial<FlintConfig> | null; info: LoadedConfigInfo | null }> {
        const vsCodeConfig = vscode.workspace.getConfiguration();
        let localConfigPath: string | null = null;

        // Check VS Code setting first
        const customLocalPath = vsCodeConfig.get<string>(CONFIG_SETTING_KEYS.LOCAL_CONFIG_PATH);
        if (customLocalPath) {
            const resolvedPath = path.isAbsolute(customLocalPath)
                ? customLocalPath
                : path.join(workspaceRoot, customLocalPath);
            searchedPaths.push(resolvedPath);

            if (await this.fileExists(resolvedPath)) {
                localConfigPath = resolvedPath;
            }
        }

        // Search default local config locations
        if (!localConfigPath && baseConfigPath) {
            localConfigPath = await this.searchLocalConfigLocations(workspaceRoot, baseConfigPath, searchedPaths);
        }

        // Load local config if path found
        if (!localConfigPath) {
            return { config: null, info: null };
        }

        try {
            const rawConfig = await this.loadRawConfiguration(localConfigPath);
            if (isValidLocalConfig(rawConfig)) {
                const info: LoadedConfigInfo = {
                    path: localConfigPath,
                    config: rawConfig,
                    isLocalOverride: true,
                    loadedAt: new Date()
                };
                return { config: rawConfig, info };
            }
            warnings.push(`Local config '${localConfigPath}' has invalid structure`);
            return { config: null, info: null };
        } catch (error) {
            warnings.push(`Failed to load local config: ${error instanceof Error ? error.message : String(error)}`);
            return { config: null, info: null };
        }
    }

    /**
     * Searches for config in the given locations
     */
    private async searchConfigLocations(
        workspaceRoot: string,
        locations: readonly string[],
        searchedPaths: string[]
    ): Promise<string | null> {
        for (const location of locations) {
            const configPath = path.join(workspaceRoot, location);
            searchedPaths.push(configPath);

            if (await this.fileExists(configPath)) {
                return configPath;
            }
        }
        return null;
    }

    /**
     * Searches for local config in default locations
     */
    private async searchLocalConfigLocations(
        workspaceRoot: string,
        baseConfigPath: string,
        searchedPaths: string[]
    ): Promise<string | null> {
        const baseConfigDir = path.dirname(baseConfigPath);

        for (const pattern of LOCAL_CONFIG_PATTERNS) {
            // Try sibling to base config
            const siblingPath = path.join(baseConfigDir, path.basename(pattern));
            searchedPaths.push(siblingPath);

            if (await this.fileExists(siblingPath)) {
                return siblingPath;
            }

            // Try workspace root
            const workspacePath = path.join(workspaceRoot, pattern);
            if (workspacePath !== siblingPath) {
                searchedPaths.push(workspacePath);

                if (await this.fileExists(workspacePath)) {
                    return workspacePath;
                }
            }
        }
        return null;
    }

    /**
     * Creates merged config from base and local configs
     */
    private createMergedConfig(
        baseConfig: FlintConfig | null,
        localConfig: Partial<FlintConfig> | null
    ): FlintConfig | null {
        if (!baseConfig) {
            return null;
        }
        if (localConfig) {
            return mergeConfigurations(baseConfig, localConfig);
        }
        return baseConfig;
    }

    /**
     * Loads configuration from file system
     */
    private async loadConfiguration(): Promise<void> {
        const resolution = await this.resolveConfigPaths();

        this.baseConfigInfo = resolution.baseConfig;
        this.localConfigInfo = resolution.localConfig;

        if (!resolution.baseConfig) {
            this.config = null;
            return;
        }

        try {
            let finalConfig = resolution.mergedConfig;

            // Check if migration is needed for base config
            if (
                this.baseConfigInfo &&
                this.migrationService.needsMigration(this.baseConfigInfo.config as FlintConfig)
            ) {
                const migratedConfig = await this.migrationService.migrateConfiguration(
                    this.baseConfigInfo.config as FlintConfig
                );
                await this.saveConfigurationToFile(this.baseConfigInfo.path, migratedConfig);

                // Re-merge with local config after migration
                if (this.localConfigInfo) {
                    finalConfig = mergeConfigurations(
                        migratedConfig,
                        this.localConfigInfo.config as Partial<FlintConfig>
                    );
                } else {
                    finalConfig = migratedConfig;
                }

                this.baseConfigInfo = {
                    ...this.baseConfigInfo,
                    config: migratedConfig,
                    loadedAt: new Date()
                };
            }

            if (!finalConfig) {
                throw new FlintError('Configuration could not be loaded', 'CONFIG_LOAD_ERROR');
            }

            // Validate final configuration
            const validation = await this.validationService.validateConfiguration(finalConfig);
            if (!validation.isValid) {
                throw new ConfigurationInvalidError(this.baseConfigInfo?.path ?? 'unknown', [...validation.errors]);
            }

            this.config = finalConfig;

            // Log warnings from resolution
            for (const warning of resolution.warnings) {
                console.warn(`Config resolution warning: ${warning}`);
            }
        } catch (error) {
            if (error instanceof ConfigurationInvalidError) {
                throw error;
            }
            throw new ConfigurationWriteError(
                this.baseConfigInfo?.path ?? 'unknown',
                'Failed to load configuration',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Loads raw configuration data from file
     */
    private async loadRawConfiguration(configPath: string): Promise<FlintConfig> {
        try {
            const content = await fs.readFile(configPath, 'utf8');
            return JSON.parse(content) as FlintConfig;
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new ConfigurationInvalidError(configPath, ['Invalid JSON format in configuration file']);
            }
            throw error;
        }
    }

    /**
     * Saves configuration to file (always saves to base config)
     */
    private async saveConfiguration(config: FlintConfig): Promise<void> {
        const configPath = this.baseConfigInfo?.path ?? this.getDefaultConfigPath();
        await this.saveConfigurationToFile(configPath, config);

        // Update stored config info
        this.baseConfigInfo = {
            path: configPath,
            config,
            isLocalOverride: false,
            loadedAt: new Date()
        };

        // Re-merge with local if present
        if (this.localConfigInfo) {
            this.config = mergeConfigurations(config, this.localConfigInfo.config as Partial<FlintConfig>);
        } else {
            this.config = config;
        }

        if (typeof this.configChangeEmitter.fire === 'function') {
            this.configChangeEmitter.fire(this.config);
        }
    }

    /**
     * Saves configuration to specified file path
     */
    private async saveConfigurationToFile(filePath: string, config: FlintConfig): Promise<void> {
        try {
            const configDir = path.dirname(filePath);
            await fs.mkdir(configDir, { recursive: true });

            const content = JSON.stringify(config, null, 2);
            await fs.writeFile(filePath, content, 'utf8');
        } catch (error) {
            throw new ConfigurationWriteError(
                filePath,
                `Failed to save configuration to ${filePath}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Gets the default configuration file path for the current workspace
     */
    private getDefaultConfigPath(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new FlintError(
                'No workspace folder available for configuration',
                'NO_WORKSPACE',
                'Please open a folder in VS Code'
            );
        }

        // Default to flint.config.json in workspace root (last item in CONFIG_LOCATIONS, highest priority)
        return path.join(workspaceFolder.uri.fsPath, CONFIG_LOCATIONS[CONFIG_LOCATIONS.length - 1]);
    }

    /**
     * Checks if a file exists
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Sets up file system watchers for configuration changes
     */
    private setupFileWatchers(): void {
        // Dispose existing watchers
        for (const watcher of this.fileWatchers) {
            watcher.dispose();
        }
        this.fileWatchers = [];

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Watch all possible config locations
        const patterns = [
            ...CONFIG_LOCATIONS.map(loc => `**/${loc}`),
            ...LOCAL_CONFIG_PATTERNS.map(loc => `**/${loc}`)
        ];

        for (const pattern of patterns) {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(workspaceFolder, pattern)
            );

            watcher.onDidChange(() => this.handleConfigFileChange());
            watcher.onDidCreate(() => this.handleConfigFileChange());
            watcher.onDidDelete(() => this.handleConfigFileChange());

            this.fileWatchers.push(watcher);
        }
    }

    /**
     * Sets up watcher for VS Code settings changes
     */
    private setupSettingsWatcher(): void {
        this.settingsWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (
                e.affectsConfiguration(CONFIG_SETTING_KEYS.CONFIG_PATH) ||
                e.affectsConfiguration(CONFIG_SETTING_KEYS.LOCAL_CONFIG_PATH)
            ) {
                void this.handleConfigFileChange();
            }
        });
    }

    /**
     * Handles configuration file changes
     */
    private async handleConfigFileChange(): Promise<void> {
        try {
            await this.loadConfiguration();
            if (this.config && typeof this.configChangeEmitter.fire === 'function') {
                this.configChangeEmitter.fire(this.config);
            }
        } catch (error) {
            console.error('Failed to reload configuration:', error);
        }
    }

    /**
     * Resolves project paths to absolute paths relative to config file
     */
    private resolveProjectPaths(projectPaths: string[]): string[] {
        const configPath = this.baseConfigInfo?.path;
        if (!configPath) {
            return [...projectPaths];
        }

        const configDir = path.dirname(configPath);
        return projectPaths.map(projectPath => {
            if (path.isAbsolute(projectPath)) {
                return projectPath;
            }
            return path.resolve(configDir, projectPath);
        });
    }
}
