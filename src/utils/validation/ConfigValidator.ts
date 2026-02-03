/**
 * @module ConfigValidator
 * @description Enhanced configuration validation with service lifecycle support
 * Provides comprehensive validation for Flint configuration files and settings
 */

import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import {
    ValidationUtilities,
    ValidationResult,
    ValidationMessage,
    ValidationSeverity,
    ValidationCategory
} from './ValidationUtilities';

import { CONFIG_SCHEMA_VERSIONS } from '@/core/constants/config';
import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Configuration validation context
 */
export interface ConfigValidationContext {
    readonly configPath: string;
    readonly workspaceRoot?: string;
    readonly schemaVersion?: string;
    readonly validationMode: 'strict' | 'lenient';
}

/**
 * Gateway validation result
 */
export interface GatewayValidationResult extends ValidationResult {
    readonly gatewayId: string;
}

/**
 * Project path validation result
 */
export interface ProjectPathValidationResult extends ValidationResult {
    readonly projectPath: string;
    readonly exists: boolean;
    readonly projectCount: number;
    readonly permissions: {
        readable: boolean;
        writable: boolean;
    };
}

/**
 * Configuration validation options
 */
export interface ConfigValidationOptions {
    validatePaths: boolean;
    validateSchema: boolean;
    allowPartial: boolean;
    timeout: number;
}

/**
 * Schema validation result
 */
export interface SchemaValidationResult extends ValidationResult {
    readonly schemaVersion: string;
    readonly compatibility: 'compatible' | 'upgrade-required' | 'unsupported';
    readonly migrationPath?: string[];
}

/**
 * Enhanced configuration validator with service lifecycle support
 * Provides comprehensive validation for Flint configuration files and settings
 */
export class ConfigValidator implements IServiceLifecycle {
    private static readonly DEFAULT_OPTIONS: ConfigValidationOptions = {
        validatePaths: true,
        validateSchema: true,
        allowPartial: false,
        timeout: 5000
    };

    private isInitialized = false;
    private validationUtilities?: ValidationUtilities;
    private configSchema: any = null;

    constructor(private readonly serviceContainer?: ServiceContainer) {}

    async initialize(): Promise<void> {
        try {
            this.validationUtilities = new ValidationUtilities(this.serviceContainer);
            await this.validationUtilities.start();
            this.loadConfigSchema();
            this.setupConfigValidationRules();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize config validator',
                'CONFIG_VALIDATOR_INIT_FAILED',
                'Config validator could not start properly',
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
        if (this.validationUtilities) {
            await this.validationUtilities.stop();
        }
    }

    async dispose(): Promise<void> {
        if (this.validationUtilities) {
            await this.validationUtilities.dispose();
        }
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Validates a complete configuration file
     */
    async validateConfig(configPath: string, options?: Partial<ConfigValidationOptions>): Promise<ValidationResult> {
        if (!this.isInitialized || !this.validationUtilities) {
            throw new FlintError('Config validator not initialized', 'NOT_INITIALIZED');
        }

        const opts = { ...ConfigValidator.DEFAULT_OPTIONS, ...options };

        try {
            // Load configuration file
            const configContent = this.loadConfigFile(configPath);
            const config = JSON.parse(configContent);

            // Create validation context
            const context: ConfigValidationContext = {
                configPath,
                workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                schemaVersion: config.$schema,
                validationMode: opts.allowPartial ? 'lenient' : 'strict'
            };

            // Run comprehensive validation
            const results = await Promise.all([
                Promise.resolve(this.validateSchema(config, context)),
                opts.validatePaths
                    ? this.validateProjectPaths(config['project-paths'] || [], context)
                    : Promise.resolve(this.createEmptyResult())
            ]);

            // Combine results
            return this.combineValidationResults(results);
        } catch (error) {
            return {
                isValid: false,
                messages: [
                    {
                        severity: ValidationSeverity.CRITICAL,
                        category: ValidationCategory.SYNTAX,
                        message: `Failed to validate config: ${error instanceof Error ? error.message : 'Unknown error'}`
                    }
                ]
            };
        }
    }

    /**
     * Validates configuration schema
     */
    validateSchema(config: any, _context: ConfigValidationContext): SchemaValidationResult {
        if (!this.validationUtilities) {
            throw new FlintError('Validation utilities not available', 'NOT_INITIALIZED');
        }

        const messages: ValidationMessage[] = [];
        let compatibility: 'compatible' | 'upgrade-required' | 'unsupported' = 'compatible';

        // Validate required fields
        const requiredFields = ['project-paths'];
        for (const field of requiredFields) {
            if (!config[field]) {
                messages.push({
                    severity: ValidationSeverity.ERROR,
                    category: ValidationCategory.SEMANTICS,
                    message: `Required field '${field}' is missing`
                });
            }
        }

        // Validate schema version
        const schemaVersion = config.$schema;

        const supportedVersions = Object.values(CONFIG_SCHEMA_VERSIONS);

        if (!supportedVersions.includes(schemaVersion)) {
            compatibility = 'unsupported';
            messages.push({
                severity: ValidationSeverity.CRITICAL,
                category: ValidationCategory.COMPATIBILITY,
                message: `Unsupported schema version: ${schemaVersion}`
            });
        } else if (schemaVersion !== CONFIG_SCHEMA_VERSIONS.CURRENT) {
            compatibility = 'upgrade-required';
            messages.push({
                severity: ValidationSeverity.WARNING,
                category: ValidationCategory.COMPATIBILITY,
                message: `Schema version ${schemaVersion} is outdated. Consider upgrading to ${CONFIG_SCHEMA_VERSIONS.CURRENT}`
            });
        }

        // Validate project-paths format
        if (config['project-paths'] && !Array.isArray(config['project-paths'])) {
            messages.push({
                severity: ValidationSeverity.ERROR,
                category: ValidationCategory.SEMANTICS,
                message: 'project-paths must be an array'
            });
        }

        // Validate gateways format
        if (config.gateways && typeof config.gateways !== 'object') {
            messages.push({
                severity: ValidationSeverity.ERROR,
                category: ValidationCategory.SEMANTICS,
                message: 'gateways must be an object'
            });
        }

        const isValid = !messages.some(
            msg => msg.severity === ValidationSeverity.ERROR || msg.severity === ValidationSeverity.CRITICAL
        );

        return {
            isValid,
            messages,
            schemaVersion,
            compatibility,
            migrationPath: compatibility === 'upgrade-required' ? this.getMigrationPath(schemaVersion) : undefined
        };
    }

    /**
     * Validates project paths
     */
    validateProjectPaths(projectPaths: string[], context: ConfigValidationContext): ValidationResult {
        const messages: ValidationMessage[] = [];
        const pathResults: ProjectPathValidationResult[] = [];

        if (!Array.isArray(projectPaths)) {
            return {
                isValid: false,
                messages: [
                    {
                        severity: ValidationSeverity.ERROR,
                        category: ValidationCategory.SEMANTICS,
                        message: 'project-paths must be an array'
                    }
                ]
            };
        }

        // Validate each path
        for (const projectPath of projectPaths) {
            if (typeof projectPath !== 'string') {
                messages.push({
                    severity: ValidationSeverity.ERROR,
                    category: ValidationCategory.SEMANTICS,
                    message: `Project path must be a string, got ${typeof projectPath}`
                });
                continue;
            }

            try {
                const result = this.validateSingleProjectPath(projectPath, context);
                pathResults.push(result);
                messages.push(...result.messages);
            } catch (error) {
                messages.push({
                    severity: ValidationSeverity.ERROR,
                    category: ValidationCategory.SEMANTICS,
                    message: `Failed to validate path '${projectPath}': ${error instanceof Error ? error.message : 'Unknown error'}`
                });
            }
        }

        // Check for duplicate paths
        const uniquePaths = new Set(projectPaths);
        if (uniquePaths.size !== projectPaths.length) {
            messages.push({
                severity: ValidationSeverity.WARNING,
                category: ValidationCategory.STYLE,
                message: 'Duplicate project paths detected'
            });
        }

        const isValid = !messages.some(
            msg => msg.severity === ValidationSeverity.ERROR || msg.severity === ValidationSeverity.CRITICAL
        );

        return { isValid, messages };
    }

    /**
     * Validates gateways configuration
     */
    validateGateways(
        gateways: Record<string, any>,
        context: ConfigValidationContext,
        timeout: number
    ): ValidationResult {
        const messages: ValidationMessage[] = [];
        const gatewayResults: GatewayValidationResult[] = [];

        if (typeof gateways !== 'object' || gateways === null) {
            return {
                isValid: false,
                messages: [
                    {
                        severity: ValidationSeverity.ERROR,
                        category: ValidationCategory.SEMANTICS,
                        message: 'gateways must be an object'
                    }
                ]
            };
        }

        // Validate each gateway
        for (const [gatewayId, gatewayConfig] of Object.entries(gateways)) {
            try {
                const result = this.validateSingleGateway(gatewayId, gatewayConfig, context, timeout);
                gatewayResults.push(result);
                messages.push(...result.messages);
            } catch (error) {
                messages.push({
                    severity: ValidationSeverity.ERROR,
                    category: ValidationCategory.SEMANTICS,
                    message: `Failed to validate gateway '${gatewayId}': ${error instanceof Error ? error.message : 'Unknown error'}`
                });
            }
        }

        const isValid = !messages.some(
            msg => msg.severity === ValidationSeverity.ERROR || msg.severity === ValidationSeverity.CRITICAL
        );

        return { isValid, messages };
    }

    /**
     * String representation for debugging
     */
    toString(): string {
        return `ConfigValidator(status: ${this.getStatus()})`;
    }

    /**
     * Validates a single project path
     */
    private validateSingleProjectPath(
        projectPath: string,
        context: ConfigValidationContext
    ): ProjectPathValidationResult {
        const messages: ValidationMessage[] = [];
        let exists = false;
        let projectCount = 0;
        const permissions = { readable: false, writable: false };

        try {
            // Resolve path relative to workspace or config
            const resolvedPath = path.isAbsolute(projectPath)
                ? projectPath
                : path.resolve(path.dirname(context.configPath), projectPath);

            // Check if path exists
            exists = fs.existsSync(resolvedPath);
            if (!exists) {
                messages.push({
                    severity: ValidationSeverity.ERROR,
                    category: ValidationCategory.SEMANTICS,
                    message: `Project path does not exist: ${resolvedPath}`
                });
            } else {
                // Check permissions
                try {
                    fs.accessSync(resolvedPath, fs.constants.R_OK);
                    permissions.readable = true;
                } catch {
                    messages.push({
                        severity: ValidationSeverity.WARNING,
                        category: ValidationCategory.SEMANTICS,
                        message: `No read permission for path: ${resolvedPath}`
                    });
                }

                try {
                    fs.accessSync(resolvedPath, fs.constants.W_OK);
                    permissions.writable = true;
                } catch {
                    messages.push({
                        severity: ValidationSeverity.WARNING,
                        category: ValidationCategory.SEMANTICS,
                        message: `No write permission for path: ${resolvedPath}`
                    });
                }

                // Count projects (basic check for .proj files)
                try {
                    const items = fs.readdirSync(resolvedPath);
                    projectCount = items.filter(item => {
                        const itemPath = path.join(resolvedPath, item);
                        return (
                            fs.statSync(itemPath).isDirectory() && fs.existsSync(path.join(itemPath, 'project.json'))
                        );
                    }).length;

                    if (projectCount === 0) {
                        messages.push({
                            severity: ValidationSeverity.WARNING,
                            category: ValidationCategory.SEMANTICS,
                            message: `No Ignition projects found in path: ${resolvedPath}`
                        });
                    }
                } catch {
                    messages.push({
                        severity: ValidationSeverity.WARNING,
                        category: ValidationCategory.SEMANTICS,
                        message: `Could not scan projects in path: ${resolvedPath}`
                    });
                }
            }
        } catch (error) {
            messages.push({
                severity: ValidationSeverity.ERROR,
                category: ValidationCategory.SEMANTICS,
                message: `Error validating project path: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }

        const isValid = !messages.some(
            msg => msg.severity === ValidationSeverity.ERROR || msg.severity === ValidationSeverity.CRITICAL
        );

        return {
            isValid,
            messages,
            projectPath,
            exists,
            projectCount,
            permissions
        };
    }

    /**
     * Validates a single gateway configuration
     */
    private validateSingleGateway(
        gatewayId: string,
        gatewayConfig: any,
        _context: ConfigValidationContext,
        _timeout: number
    ): GatewayValidationResult {
        const messages: ValidationMessage[] = [];

        // Validate required fields
        if (!gatewayConfig.url) {
            messages.push({
                severity: ValidationSeverity.ERROR,
                category: ValidationCategory.SEMANTICS,
                message: `Gateway '${gatewayId}' missing required field 'url'`
            });
        } else {
            // Validate URL format
            try {
                const url = new URL(gatewayConfig.url);
                if (!['http:', 'https:'].includes(url.protocol)) {
                    messages.push({
                        severity: ValidationSeverity.WARNING,
                        category: ValidationCategory.SEMANTICS,
                        message: `Gateway '${gatewayId}' URL should use HTTP or HTTPS protocol`
                    });
                }
            } catch {
                messages.push({
                    severity: ValidationSeverity.ERROR,
                    category: ValidationCategory.SEMANTICS,
                    message: `Gateway '${gatewayId}' has invalid URL format`
                });
            }
        }

        // Validate projects array
        if (gatewayConfig.projects && !Array.isArray(gatewayConfig.projects)) {
            messages.push({
                severity: ValidationSeverity.ERROR,
                category: ValidationCategory.SEMANTICS,
                message: `Gateway '${gatewayId}' projects must be an array`
            });
        }

        const isValid = !messages.some(
            msg => msg.severity === ValidationSeverity.ERROR || msg.severity === ValidationSeverity.CRITICAL
        );

        return {
            isValid,
            messages,
            gatewayId
        };
    }

    /**
     * Loads configuration file content
     */
    private loadConfigFile(configPath: string): string {
        try {
            return fs.readFileSync(configPath, 'utf8');
        } catch (error) {
            throw new FlintError(
                `Failed to load config file: ${configPath}`,
                'CONFIG_LOAD_FAILED',
                error instanceof Error ? error.message : 'Unknown error'
            );
        }
    }

    /**
     * Loads configuration schema
     */
    private loadConfigSchema(): void {
        // In a real implementation, you would load this from a schema file
        this.configSchema = {
            type: 'object',
            required: ['project-paths'],
            properties: {
                $schema: { type: 'string' },
                'project-paths': {
                    type: 'array',
                    items: { type: 'string' }
                },
                gateways: {
                    type: 'object',
                    patternProperties: {
                        '^.+$': {
                            type: 'object',
                            required: ['url'],
                            properties: {
                                url: { type: 'string' },
                                username: { type: 'string' },
                                projects: {
                                    type: 'array',
                                    items: { type: 'string' }
                                }
                            }
                        }
                    }
                }
            }
        };
    }

    /**
     * Sets up configuration-specific validation rules
     */
    private setupConfigValidationRules(): void {
        if (!this.validationUtilities) return;

        // Flint config validation rule
        this.validationUtilities.registerRule({
            name: 'flint-config',
            description: 'Validates Flint configuration format',
            category: ValidationCategory.SEMANTICS,
            severity: ValidationSeverity.ERROR,
            validator: (config: any) => {
                const messages: ValidationMessage[] = [];

                if (!config['project-paths']) {
                    messages.push({
                        severity: ValidationSeverity.ERROR,
                        category: ValidationCategory.SEMANTICS,
                        message: 'Missing required field: project-paths'
                    });
                }

                return {
                    isValid: messages.length === 0,
                    messages,
                    score: messages.length === 0 ? 100 : 0
                };
            }
        });
    }

    /**
     * Gets migration path for schema upgrade
     */
    private getMigrationPath(currentVersion: string): string[] {
        // Since we are on version 0.1, we don't have any migrations yet
        const migrations: Record<string, string[]> = {};

        return migrations[currentVersion] || [];
    }

    /**
     * Creates an empty validation result
     */
    private createEmptyResult(): ValidationResult {
        return {
            isValid: true,
            messages: []
        };
    }

    /**
     * Combines multiple validation results
     */
    private combineValidationResults(results: ValidationResult[]): ValidationResult {
        const allMessages: ValidationMessage[] = [];
        let allValid = true;

        for (const result of results) {
            allMessages.push(...result.messages);
            if (!result.isValid) {
                allValid = false;
            }
        }

        return {
            isValid: allValid,
            messages: allMessages
        };
    }
}
