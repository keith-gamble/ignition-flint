/**
 * @module EnvironmentService
 * @description Service for managing environment selection and persistence
 * Stores environment selections locally (not in workspace config) for per-machine preferences
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { GatewayConfig, GatewayEnvironmentConfig } from '@/core/types/configuration';
import { ResolvedModules } from '@/core/types/modules';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Environment selection data stored locally
 */
interface EnvironmentSelection {
    /** Map of gatewayId to selected environment name */
    selectedEnvironments: Record<string, string>;
    /** Last updated timestamp */
    lastUpdated: string;
}

/**
 * Resolved environment configuration with merged settings
 */
export interface ResolvedEnvironmentConfig {
    /** Environment name */
    environment: string;
    /** Gateway hostname or IP address */
    host: string;
    /** Gateway port number */
    port: number;
    /** Whether to use SSL/HTTPS */
    ssl: boolean;
    /** Username for authentication */
    username?: string;
    /** Whether to ignore SSL certificate errors */
    ignoreSSLErrors: boolean;
    /** Connection timeout in milliseconds */
    timeoutMs: number;
    /** Ignition version for this environment */
    ignitionVersion?: string;
    /** Module configurations for this environment (merged from gateway and environment) */
    modules?: ResolvedModules;
}

/**
 * Service for managing gateway environment selection
 * Handles both legacy single-environment and new multi-environment configurations
 */
export class EnvironmentService implements IServiceLifecycle {
    private static readonly STORAGE_KEY = 'flint.selectedEnvironments';
    private static readonly DEFAULT_ENVIRONMENT = 'default';

    private serviceContainer: ServiceContainer;
    private context: vscode.ExtensionContext;
    private isInitialized = false;
    private _onEnvironmentChanged = new vscode.EventEmitter<{
        gatewayId: string;
        environment: string;
        config: ResolvedEnvironmentConfig;
    }>();
    readonly onEnvironmentChanged = this._onEnvironmentChanged.event;

    constructor(serviceContainer: ServiceContainer, context: vscode.ExtensionContext) {
        this.serviceContainer = serviceContainer;
        this.context = context;
    }

    async initialize(): Promise<void> {
        try {
            // Initialize storage if it doesn't exist
            const stored = this.context.globalState.get<EnvironmentSelection>(EnvironmentService.STORAGE_KEY);
            if (!stored) {
                await this.context.globalState.update(EnvironmentService.STORAGE_KEY, {
                    selectedEnvironments: {},
                    lastUpdated: new Date().toISOString()
                });
            }

            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize environment service',
                'ENVIRONMENT_SERVICE_INIT_FAILED',
                'Environment service could not start properly',
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

    dispose(): Promise<void> {
        this._onEnvironmentChanged.dispose();
        return Promise.resolve();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Gets the selected environment for a gateway
     */
    getSelectedEnvironment(gatewayId: string): string | undefined {
        const stored = this.context.globalState.get<EnvironmentSelection>(EnvironmentService.STORAGE_KEY);
        return stored?.selectedEnvironments[gatewayId];
    }

    /**
     * Sets the selected environment for a gateway
     */
    async setSelectedEnvironment(gatewayId: string, environment: string): Promise<void> {
        const stored = this.context.globalState.get<EnvironmentSelection>(EnvironmentService.STORAGE_KEY) ?? {
            selectedEnvironments: {},
            lastUpdated: new Date().toISOString()
        };

        const updated: EnvironmentSelection = {
            selectedEnvironments: {
                ...stored.selectedEnvironments,
                [gatewayId]: environment
            },
            lastUpdated: new Date().toISOString()
        };

        await this.context.globalState.update(EnvironmentService.STORAGE_KEY, updated);
        console.log(`Environment service: Selected environment '${environment}' for gateway '${gatewayId}'`);

        // Emit environment changed event
        try {
            const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
            if (configService) {
                const gateways = await configService.getGateways();
                const gatewayConfig = gateways[gatewayId];
                if (gatewayConfig) {
                    const envConfig = this.resolveEnvironmentConfig(gatewayConfig, environment);
                    this._onEnvironmentChanged.fire({ gatewayId, environment, config: envConfig });
                }
            }
        } catch (error) {
            console.warn('Failed to emit environment changed event:', error);
        }
    }

    /**
     * Gets all selected environments
     */
    getAllSelectedEnvironments(): Record<string, string> {
        const stored = this.context.globalState.get<EnvironmentSelection>(EnvironmentService.STORAGE_KEY);
        return stored?.selectedEnvironments ?? {};
    }

    /**
     * Clears the selected environment for a gateway
     */
    async clearSelectedEnvironment(gatewayId: string): Promise<void> {
        const stored = this.context.globalState.get<EnvironmentSelection>(EnvironmentService.STORAGE_KEY);
        if (!stored) return;

        const updated: EnvironmentSelection = {
            selectedEnvironments: { ...stored.selectedEnvironments },
            lastUpdated: new Date().toISOString()
        };

        delete updated.selectedEnvironments[gatewayId];

        await this.context.globalState.update(EnvironmentService.STORAGE_KEY, updated);
        console.log(`Environment service: Cleared selected environment for gateway '${gatewayId}'`);
    }

    /**
     * Gets available environments for a gateway
     */
    getAvailableEnvironments(gatewayConfig: GatewayConfig): string[] {
        if (gatewayConfig.environments) {
            return Object.keys(gatewayConfig.environments);
        }

        // Legacy single-environment format
        return [EnvironmentService.DEFAULT_ENVIRONMENT];
    }

    /**
     * Resolves the actual environment configuration for a gateway
     * Handles both legacy and multi-environment formats
     */
    resolveEnvironmentConfig(gatewayConfig: GatewayConfig, environmentName?: string): ResolvedEnvironmentConfig {
        if (gatewayConfig.environments) {
            return this.resolveMultiEnvironmentConfig(gatewayConfig, environmentName);
        }
        return this.resolveLegacyConfig(gatewayConfig);
    }

    /**
     * Resolves configuration for multi-environment format
     */
    private resolveMultiEnvironmentConfig(
        gatewayConfig: GatewayConfig,
        environmentName?: string
    ): ResolvedEnvironmentConfig {
        const envName =
            environmentName ?? gatewayConfig.defaultEnvironment ?? Object.keys(gatewayConfig.environments!)[0];
        const envConfig = gatewayConfig.environments![envName];

        if (!envConfig) {
            throw new FlintError(
                `Environment '${envName}' not found for gateway '${gatewayConfig.id}'`,
                'ENVIRONMENT_NOT_FOUND'
            );
        }

        return {
            environment: envName,
            host: envConfig.host,
            port: envConfig.port ?? 8088,
            ssl: envConfig.ssl ?? true,
            username: envConfig.username ?? gatewayConfig.username,
            ignoreSSLErrors: envConfig.ignoreSSLErrors ?? gatewayConfig.ignoreSSLErrors ?? false,
            timeoutMs: envConfig.timeoutMs ?? gatewayConfig.timeoutMs ?? 10000,
            ignitionVersion: envConfig.ignitionVersion ?? gatewayConfig.ignitionVersion,
            modules: this.buildResolvedModules(gatewayConfig, envConfig)
        };
    }

    /**
     * Resolves configuration for legacy single-environment format
     */
    private resolveLegacyConfig(gatewayConfig: GatewayConfig): ResolvedEnvironmentConfig {
        if (!gatewayConfig.host) {
            throw new FlintError(`No host configured for gateway '${gatewayConfig.id}'`, 'GATEWAY_HOST_NOT_CONFIGURED');
        }

        return {
            environment: EnvironmentService.DEFAULT_ENVIRONMENT,
            host: gatewayConfig.host,
            port: gatewayConfig.port ?? 8088,
            ssl: gatewayConfig.ssl ?? true,
            username: gatewayConfig.username,
            ignoreSSLErrors: gatewayConfig.ignoreSSLErrors ?? false,
            timeoutMs: gatewayConfig.timeoutMs ?? 10000,
            ignitionVersion: gatewayConfig.ignitionVersion,
            modules: this.buildResolvedModules(gatewayConfig)
        };
    }

    /**
     * Builds resolved modules by merging gateway and environment configurations
     * Note: Module names are defined in the type system (see modules.ts)
     * To add new modules, update modules.ts types and extend this method
     */
    private buildResolvedModules(gatewayConfig: GatewayConfig, envConfig?: GatewayEnvironmentConfig): ResolvedModules {
        return {
            'project-scan-endpoint': {
                enabled: gatewayConfig.modules?.['project-scan-endpoint']?.enabled ?? false,
                apiTokenFilePath: envConfig?.modules?.['project-scan-endpoint']?.apiTokenFilePath,
                forceUpdateDesigner: envConfig?.modules?.['project-scan-endpoint']?.forceUpdateDesigner ?? false
            }
        };
    }

    /**
     * Gets the currently active environment configuration for a gateway
     * Uses the stored selection or falls back to default
     */
    getActiveEnvironmentConfig(gatewayConfig: GatewayConfig): ResolvedEnvironmentConfig {
        const selectedEnv = this.getSelectedEnvironment(gatewayConfig.id);
        return this.resolveEnvironmentConfig(gatewayConfig, selectedEnv);
    }

    /**
     * Builds the gateway URL for the active environment
     */
    buildGatewayUrl(gatewayConfig: GatewayConfig, path: string = ''): string {
        const envConfig = this.getActiveEnvironmentConfig(gatewayConfig);
        const protocol = envConfig.ssl ? 'https' : 'http';
        const portSuffix = envConfig.port !== (envConfig.ssl ? 443 : 80) ? `:${envConfig.port}` : '';
        return `${protocol}://${envConfig.host}${portSuffix}${path}`;
    }
}
