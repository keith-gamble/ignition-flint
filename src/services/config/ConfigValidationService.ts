/**
 * @module ConfigValidationService
 * @description Configuration validation service using JSON schema
 * Validates flint.config.json files against defined schemas
 */

import { CONFIG_SCHEMA_VERSIONS } from '@/core/constants';
import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { FlintConfig, GatewayConfig } from '@/core/types/configuration';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Validation result for configuration
 */
export interface ConfigValidationResult {
    readonly isValid: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Gateway validation result
 */
export interface GatewayValidationResult extends ConfigValidationResult {
    // Configuration validation only - no connection testing
    readonly gatewayId?: string;
}

/**
 * Service for validating configuration files and gateway settings
 */
export class ConfigValidationService implements IServiceLifecycle {
    private static readonly SUPPORTED_VERSIONS = [CONFIG_SCHEMA_VERSIONS.PREVIOUS, CONFIG_SCHEMA_VERSIONS.CURRENT];
    private static readonly REQUIRED_PROPERTIES = ['schemaVersion', 'project-paths', 'gateways'];

    private isInitialized = false;
    private validationRules: Map<string, (value: unknown) => string[]> = new Map();

    constructor(private readonly serviceContainer: ServiceContainer) {}

    initialize(): Promise<void> {
        this.setupValidationRules();
        this.isInitialized = true;
        // console.log('ConfigValidationService initialized');
        return Promise.resolve();
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            return Promise.reject(
                new FlintError('ConfigValidationService must be initialized before starting', 'SERVICE_NOT_INITIALIZED')
            );
        }
        // console.log('ConfigValidationService started');
        return Promise.resolve();
    }

    stop(): Promise<void> {
        return Promise.resolve();
    }

    dispose(): Promise<void> {
        this.validationRules.clear();
        this.isInitialized = false;
        return Promise.resolve();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Validates a complete Flint configuration
     */
    validateConfiguration(config: FlintConfig): Promise<ConfigValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!config || typeof config !== 'object') {
            errors.push('Configuration must be a valid JSON object');
            return Promise.resolve({ isValid: false, errors, warnings });
        }

        // Validate schema version
        const schemaValidation = this.validateSchemaVersion(config.schemaVersion);
        errors.push(...schemaValidation);

        // Validate required properties
        const requiredValidation = this.validateRequiredProperties(config);
        errors.push(...requiredValidation);

        // Validate project paths
        const pathValidation = this.validateProjectPaths(config['project-paths']);
        errors.push(...pathValidation.errors);
        warnings.push(...pathValidation.warnings);

        // Validate gateways
        const gatewayValidation = this.validateGateways(config.gateways);
        errors.push(...gatewayValidation.errors);
        warnings.push(...gatewayValidation.warnings);

        // Validate settings if present
        if (config.settings) {
            const settingsValidation = this.validateSettings(config.settings);
            errors.push(...settingsValidation.errors);
            warnings.push(...settingsValidation.warnings);
        }

        return Promise.resolve({
            isValid: errors.length === 0,
            errors: Object.freeze(errors),
            warnings: Object.freeze(warnings)
        });
    }

    /**
     * Validates a single gateway configuration
     */
    validateGateway(gatewayId: string, gateway: GatewayConfig): Promise<GatewayValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Basic validation
        this.validateGatewayBasics(gatewayId, gateway, errors);
        if (errors.length > 0 && (!gateway || typeof gateway !== 'object')) {
            return Promise.resolve({ isValid: false, errors, warnings });
        }

        // Format validation
        this.validateGatewayFormat(gateway, errors, warnings);
        // Validate specific configurations
        this.validateLegacyConfig(gateway, errors);
        this.validateEnvironmentConfig(gateway, errors);
        this.validateGatewayProperties(gateway, errors);
        this.addConfigurationWarnings(gateway, warnings);

        return Promise.resolve({
            isValid: errors.length === 0,
            errors: Object.freeze(errors),
            warnings: Object.freeze(warnings)
        });
    }

    private validateGatewayBasics(gatewayId: string, gateway: GatewayConfig, errors: string[]): void {
        if (!gatewayId || typeof gatewayId !== 'string') {
            errors.push('Gateway ID must be a non-empty string');
        }

        if (!gateway || typeof gateway !== 'object') {
            errors.push('Gateway configuration must be an object');
        }
    }

    private validateGatewayFormat(gateway: GatewayConfig, errors: string[], warnings: string[]): void {
        const hasLegacyConfig = !!gateway.host;
        const hasEnvironmentConfig = !!gateway.environments;

        if (!hasLegacyConfig && !hasEnvironmentConfig) {
            errors.push(
                'Gateway must have either a host property (legacy format) or ' +
                    'environments property (multi-environment format)'
            );
        } else if (hasLegacyConfig && hasEnvironmentConfig) {
            warnings.push(
                'Gateway has both legacy (host) and multi-environment (environments) configuration. ' +
                    'Multi-environment format will take precedence.'
            );
        }
    }

    private validateLegacyConfig(gateway: GatewayConfig, errors: string[]): void {
        if (!gateway.host) {
            return;
        }

        if (typeof gateway.host !== 'string') {
            errors.push('Gateway host must be a string');
        }

        this.validatePortNumber(gateway.port, 'Gateway', errors);
        this.validateBooleanProperty(gateway.ssl, 'Gateway SSL setting', errors);
    }

    private validateEnvironmentConfig(gateway: GatewayConfig, errors: string[]): void {
        if (!gateway.environments) {
            return;
        }

        if (typeof gateway.environments !== 'object' || gateway.environments === null) {
            errors.push('Gateway environments must be an object');
            return;
        }

        const envNames = Object.keys(gateway.environments);
        if (envNames.length === 0) {
            errors.push('Gateway environments object cannot be empty');
            return;
        }

        // Validate each environment
        for (const [envName, envConfig] of Object.entries(gateway.environments)) {
            this.validateSingleEnvironment(envName, envConfig, errors);
        }

        this.validateDefaultEnvironment(gateway, errors);
    }

    private validateSingleEnvironment(envName: string, envConfig: unknown, errors: string[]): void {
        if (!envName || typeof envName !== 'string') {
            errors.push('Environment name must be a non-empty string');
            return;
        }

        if (!envConfig || typeof envConfig !== 'object') {
            errors.push(`Environment '${envName}' configuration must be an object`);
            return;
        }

        const env = envConfig as Record<string, unknown>;

        if (!env.host || typeof env.host !== 'string') {
            errors.push(`Environment '${envName}': host is required and must be a string`);
        }

        this.validatePortNumber(env.port, `Environment '${envName}':`, errors);
        this.validateBooleanProperty(env.ssl, `Environment '${envName}': SSL setting`, errors);
        this.validateStringProperty(env.username, `Environment '${envName}': username`, errors);
        this.validateBooleanProperty(env.ignoreSSLErrors, `Environment '${envName}': ignoreSSLErrors`, errors);
    }

    private validateDefaultEnvironment(gateway: GatewayConfig, errors: string[]): void {
        if (gateway.defaultEnvironment === undefined || !gateway.environments) {
            return;
        }

        if (typeof gateway.defaultEnvironment !== 'string') {
            errors.push('Gateway defaultEnvironment must be a string');
        } else if (!gateway.environments[gateway.defaultEnvironment]) {
            errors.push(`Gateway defaultEnvironment '${gateway.defaultEnvironment}' does not exist in environments`);
        }
    }

    private validateGatewayProperties(gateway: GatewayConfig, errors: string[]): void {
        this.validateStringProperty(gateway.username, 'Gateway username', errors);
        this.validateBooleanProperty(gateway.ignoreSSLErrors, 'Gateway ignoreSSLErrors setting', errors);
        this.validateProjectsArray(gateway.projects, errors);
        this.validateBooleanProperty(gateway.enabled, 'Gateway enabled setting', errors);
    }

    private validatePortNumber(port: unknown, context: string, errors: string[]): void {
        if (port !== undefined && port !== null) {
            const portNum = port as number;
            if (!Number.isInteger(port) || portNum < 1 || portNum > 65535) {
                errors.push(`${context} port must be an integer between 1 and 65535`);
            }
        }
    }

    private validateBooleanProperty(value: unknown, propertyName: string, errors: string[]): void {
        if (value !== undefined && typeof value !== 'boolean') {
            errors.push(`${propertyName} must be a boolean`);
        }
    }

    private validateStringProperty(value: unknown, propertyName: string, errors: string[]): void {
        if (value !== undefined && typeof value !== 'string') {
            errors.push(`${propertyName} must be a string`);
        }
    }

    private validateProjectsArray(projects: unknown, errors: string[]): void {
        if (projects === undefined) {
            return;
        }

        if (!Array.isArray(projects)) {
            errors.push('Gateway projects must be an array');
            return;
        }

        projects.forEach((project, index) => {
            if (typeof project !== 'string') {
                errors.push(`Gateway project at index ${index} must be a string`);
            }
        });
    }

    private addConfigurationWarnings(gateway: GatewayConfig, warnings: string[]): void {
        if (gateway.host === 'localhost' || gateway.host === '127.0.0.1') {
            warnings.push('Using localhost/127.0.0.1 may not work in all environments');
        }

        if (gateway.ssl === false && !gateway.ignoreSSLErrors) {
            warnings.push('Consider enabling SSL for secure communication');
        }
    }

    /**
     * Validates project path format and accessibility
     */
    validateProjectPath(projectPath: string): ConfigValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (typeof projectPath !== 'string') {
            errors.push('Project path must be a string');
            return { isValid: false, errors, warnings };
        }

        if (!projectPath.trim()) {
            errors.push('Project path cannot be empty');
        }

        // Relative paths are now allowed - they will be resolved relative to the config file
        // No need to require absolute paths anymore

        // Check for common path issues
        if (projectPath.includes('\\') && process.platform !== 'win32') {
            warnings.push(`Path contains backslashes which may not work on non-Windows systems: ${projectPath}`);
        }

        if (projectPath.endsWith('/') || projectPath.endsWith('\\')) {
            warnings.push(`Path should not end with trailing separator: ${projectPath}`);
        }

        return {
            isValid: errors.length === 0,
            errors: Object.freeze(errors),
            warnings: Object.freeze(warnings)
        };
    }

    /**
     * Validates a partial configuration (for local override configs)
     * Local configs don't require schemaVersion, project-paths, or gateways
     */
    validatePartialConfiguration(config: Partial<FlintConfig>): Promise<ConfigValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!config || typeof config !== 'object') {
            errors.push('Configuration must be a valid JSON object');
            return Promise.resolve({ isValid: false, errors, warnings });
        }

        // Validate project paths if present
        if ('project-paths' in config) {
            const pathValidation = this.validateProjectPaths(config['project-paths']);
            errors.push(...pathValidation.errors);
            warnings.push(...pathValidation.warnings);
        }

        // Validate gateways if present
        if ('gateways' in config) {
            const gatewayValidation = this.validateGateways(config.gateways);
            errors.push(...gatewayValidation.errors);
            warnings.push(...gatewayValidation.warnings);
        }

        // Validate settings if present
        if ('settings' in config && config.settings) {
            const settingsValidation = this.validateSettings(config.settings);
            errors.push(...settingsValidation.errors);
            warnings.push(...settingsValidation.warnings);
        }

        // Warn about schemaVersion in local config (it will be ignored)
        if ('schemaVersion' in config) {
            warnings.push('schemaVersion in local config will be ignored (base config version is used)');
        }

        return Promise.resolve({
            isValid: errors.length === 0,
            errors: Object.freeze(errors),
            warnings: Object.freeze(warnings)
        });
    }

    /**
     * Gets validation schema for IDE integration
     */
    getConfigurationSchema(): object {
        return {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            title: 'Flint Configuration',
            description: 'Configuration for the Flint VS Code extension',
            required: ['schemaVersion', 'project-paths', 'gateways'],
            properties: {
                schemaVersion: {
                    type: 'string',
                    enum: ConfigValidationService.SUPPORTED_VERSIONS,
                    description: 'Configuration schema version'
                },
                'project-paths': {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Paths to scan for Ignition projects'
                },
                gateways: {
                    type: 'object',
                    additionalProperties: {
                        type: 'object',
                        required: ['host'],
                        properties: {
                            host: { type: 'string' },
                            port: { type: 'integer', minimum: 1, maximum: 65535 },
                            ssl: { type: 'boolean' },
                            username: { type: 'string' },
                            ignoreSSLErrors: { type: 'boolean' },
                            projects: {
                                type: 'array',
                                items: { type: 'string' }
                            },
                            enabled: { type: 'boolean' }
                        }
                    }
                },
                settings: {
                    type: 'object',
                    properties: {
                        showInheritedResources: { type: 'boolean' },
                        groupResourcesByType: { type: 'boolean' },
                        autoRefreshProjects: { type: 'boolean' },
                        searchHistoryLimit: { type: 'integer', minimum: 0 }
                    }
                }
            }
        };
    }

    /**
     * Sets up validation rules for different configuration properties
     */
    private setupValidationRules(): void {
        this.validationRules.set('schemaVersion', value => {
            const errors: string[] = [];
            if (typeof value !== 'string') {
                errors.push('Schema version must be a string');
            } else if (!ConfigValidationService.SUPPORTED_VERSIONS.includes(value as any)) {
                errors.push(
                    `Unsupported schema version: ${value}. Supported versions: ${ConfigValidationService.SUPPORTED_VERSIONS.join(', ')}`
                );
            }
            return errors;
        });

        this.validationRules.set('project-paths', value => {
            const errors: string[] = [];
            if (!Array.isArray(value)) {
                errors.push('Project paths must be an array');
            } else {
                value.forEach((path, index) => {
                    if (typeof path !== 'string') {
                        errors.push(`Project path at index ${index} must be a string`);
                    }
                });
            }
            return errors;
        });
    }

    /**
     * Validates schema version
     */
    private validateSchemaVersion(schemaVersion: unknown): string[] {
        const rule = this.validationRules.get('schemaVersion');
        return rule ? rule(schemaVersion) : [];
    }

    /**
     * Validates required properties are present
     */
    private validateRequiredProperties(config: FlintConfig): string[] {
        const errors: string[] = [];

        ConfigValidationService.REQUIRED_PROPERTIES.forEach(prop => {
            if (!(prop in config)) {
                errors.push(`Required property '${prop}' is missing`);
            }
        });

        return errors;
    }

    /**
     * Validates project paths array
     */
    private validateProjectPaths(projectPaths: unknown): ConfigValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!Array.isArray(projectPaths)) {
            errors.push('Project paths must be an array');
            return { isValid: false, errors, warnings };
        }

        projectPaths.forEach((path, index) => {
            const pathValidation = this.validateProjectPath(path);
            pathValidation.errors.forEach(error => {
                errors.push(`Project path ${index}: ${error}`);
            });
            pathValidation.warnings.forEach(warning => {
                warnings.push(`Project path ${index}: ${warning}`);
            });
        });

        return { isValid: errors.length === 0, errors, warnings };
    }

    /**
     * Validates gateways object
     */
    private validateGateways(gateways: unknown): ConfigValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (typeof gateways !== 'object' || gateways === null) {
            errors.push('Gateways must be an object');
            return { isValid: false, errors, warnings };
        }

        for (const [gatewayId, gatewayConfig] of Object.entries(gateways)) {
            // Note: We can't await here, so we do synchronous validation
            const gatewayErrors = this.validateGatewaySynchronously(gatewayId, gatewayConfig);
            gatewayErrors.errors.forEach(error => {
                errors.push(`Gateway '${gatewayId}': ${error}`);
            });
            gatewayErrors.warnings.forEach(warning => {
                warnings.push(`Gateway '${gatewayId}': ${warning}`);
            });
        }

        return {
            isValid: errors.length === 0,
            errors: errors as readonly string[],
            warnings: warnings as readonly string[]
        };
    }

    /**
     * Validates gateway configuration synchronously (for use in main validation)
     */
    private validateGatewaySynchronously(gatewayId: string, gateway: unknown): ConfigValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!gateway || typeof gateway !== 'object') {
            errors.push('Gateway configuration must be an object');
            return { isValid: false, errors, warnings };
        }

        const gatewayObj = gateway as Record<string, unknown>;

        this.validateGatewayFormatSync(gatewayObj, errors, warnings);
        this.validateLegacyConfigSync(gatewayObj, errors);
        this.validateEnvironmentConfigSync(gatewayObj, errors);

        return { isValid: errors.length === 0, errors, warnings };
    }

    private validateGatewayFormatSync(gatewayObj: Record<string, unknown>, errors: string[], warnings: string[]): void {
        const hasLegacyConfig = Boolean(gatewayObj.host);
        const hasEnvironmentConfig = Boolean(gatewayObj.environments);

        if (!hasLegacyConfig && !hasEnvironmentConfig) {
            errors.push(
                'Gateway must have either a host property (legacy format) or ' +
                    'environments property (multi-environment format)'
            );
        } else if (hasLegacyConfig && hasEnvironmentConfig) {
            warnings.push(
                'Gateway has both legacy (host) and multi-environment (environments) configuration. ' +
                    'Multi-environment format will take precedence.'
            );
        }
    }

    private validateLegacyConfigSync(gatewayObj: Record<string, unknown>, errors: string[]): void {
        if (!gatewayObj.host) {
            return;
        }

        if (typeof gatewayObj.host !== 'string') {
            errors.push('Gateway host must be a string');
        }

        if (gatewayObj.port !== undefined && gatewayObj.port !== null) {
            const port = gatewayObj.port as number;
            if (!Number.isInteger(gatewayObj.port) || port < 1 || port > 65535) {
                errors.push('Gateway port must be an integer between 1 and 65535');
            }
        }
    }

    private validateEnvironmentConfigSync(gatewayObj: Record<string, unknown>, errors: string[]): void {
        if (!gatewayObj.environments) {
            return;
        }

        if (typeof gatewayObj.environments !== 'object' || gatewayObj.environments === null) {
            errors.push('Gateway environments must be an object');
            return;
        }

        const environments = gatewayObj.environments as Record<string, unknown>;
        const envNames = Object.keys(environments);

        if (envNames.length === 0) {
            errors.push('Gateway environments object cannot be empty');
            return;
        }

        for (const [envName, envConfig] of Object.entries(environments)) {
            this.validateSingleEnvironmentSync(envName, envConfig, errors);
        }

        this.validateDefaultEnvironmentSync(gatewayObj, environments, errors);
    }

    private validateSingleEnvironmentSync(envName: string, envConfig: unknown, errors: string[]): void {
        if (!envName || typeof envName !== 'string') {
            errors.push('Environment name must be a non-empty string');
            return;
        }

        if (!envConfig || typeof envConfig !== 'object') {
            errors.push(`Environment '${envName}' configuration must be an object`);
            return;
        }

        const env = envConfig as Record<string, unknown>;

        if (!env.host || typeof env.host !== 'string') {
            errors.push(`Environment '${envName}': host is required and must be a string`);
        }

        if (env.port !== undefined && env.port !== null) {
            const port = env.port as number;
            if (!Number.isInteger(env.port) || port < 1 || port > 65535) {
                errors.push(`Environment '${envName}': port must be an integer between 1 and 65535`);
            }
        }
    }

    private validateDefaultEnvironmentSync(
        gatewayObj: Record<string, unknown>,
        environments: Record<string, unknown>,
        errors: string[]
    ): void {
        if (gatewayObj.defaultEnvironment === undefined) {
            return;
        }

        if (typeof gatewayObj.defaultEnvironment !== 'string') {
            errors.push('Gateway defaultEnvironment must be a string');
        } else if (!environments[gatewayObj.defaultEnvironment]) {
            errors.push(`Gateway defaultEnvironment '${gatewayObj.defaultEnvironment}' does not exist in environments`);
        }
    }

    /**
     * Validates settings object
     */
    private validateSettings(settings: any): ConfigValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (typeof settings !== 'object' || settings === null) {
            errors.push('Settings must be an object');
            return { isValid: false, errors, warnings };
        }

        // Validate boolean settings
        const booleanSettings = ['showInheritedResources', 'groupResourcesByType', 'autoRefreshProjects'];
        booleanSettings.forEach(setting => {
            if (setting in settings && typeof settings[setting] !== 'boolean') {
                errors.push(`Setting '${setting}' must be a boolean`);
            }
        });

        // Validate numeric settings
        if ('searchHistoryLimit' in settings) {
            if (!Number.isInteger(settings.searchHistoryLimit) || settings.searchHistoryLimit < 0) {
                errors.push('Setting searchHistoryLimit must be a non-negative integer');
            }
        }

        return { isValid: errors.length === 0, errors, warnings };
    }
}
