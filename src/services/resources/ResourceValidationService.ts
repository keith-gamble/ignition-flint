/**
 * @module ResourceValidationService
 * @description Service for validating resource integrity and structure
 * Provides comprehensive validation for different resource types and project structures
 */

import * as fs from 'fs/promises';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ResourceValidationResult, ResourceFileInfo } from '@/core/types/resources';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';

/**
 * Validation rule definition
 */
interface ValidationRule {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly severity: 'error' | 'warning' | 'info';
    readonly validator: (
        resourcePath: string,
        files: ResourceFileInfo[],
        metadata?: Record<string, unknown>
    ) => Promise<ValidationIssue[]>;
}

/**
 * Validation issue found during validation
 */
interface ValidationIssue {
    readonly ruleId: string;
    readonly severity: 'error' | 'warning' | 'info';
    readonly message: string;
    readonly filePath?: string;
    readonly line?: number;
    readonly column?: number;
    readonly suggestion?: string;
}

/**
 * Validation context for resources
 */
interface ResourceValidationContext {
    readonly resourcePath: string;
    readonly resourceType: string;
    readonly projectPath: string;
    readonly files: ResourceFileInfo[];
    readonly metadata: Record<string, unknown>;
}

/**
 * Comprehensive resource validation service
 */
export class ResourceValidationService implements IServiceLifecycle {
    private validationRules = new Map<string, ValidationRule[]>();
    private globalRules: ValidationRule[] = [];
    private isInitialized = false;

    private readonly validationCompleteEmitter = new vscode.EventEmitter<{
        resourcePath: string;
        result: ResourceValidationResult;
        duration: number;
    }>();
    public readonly onValidationComplete = this.validationCompleteEmitter.event;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    async initialize(): Promise<void> {
        await this.registerBuiltInValidationRules();
        this.isInitialized = true;
        // console.log(`ResourceValidationService initialized with ${this.getTotalRuleCount()} validation rules`);
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            throw new FlintError(
                'ResourceValidationService must be initialized before starting',
                'SERVICE_NOT_INITIALIZED'
            );
        }
        // console.log('ResourceValidationService started');
        return Promise.resolve();
    }

    stop(): Promise<void> {
        return Promise.resolve();
    }

    dispose(): Promise<void> {
        this.validationRules.clear();
        this.globalRules = [];
        this.validationCompleteEmitter.dispose();
        this.isInitialized = false;
        return Promise.resolve();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Validates a resource and returns validation results
     */
    async validateResource(
        resourcePath: string,
        resourceType: string,
        projectPath: string,
        files: ResourceFileInfo[],
        metadata: Record<string, unknown> = {}
    ): Promise<ResourceValidationResult> {
        const _validationStartTime = Date.now();

        try {
            const _context: ResourceValidationContext = {
                resourcePath,
                resourceType,
                projectPath,
                files,
                metadata
            };

            // Collect all applicable rules
            const applicableRules = this.getApplicableRules(resourceType);

            // Run all validation rules
            const allIssues: ValidationIssue[] = [];

            for (const rule of applicableRules) {
                try {
                    const issues = await rule.validator(resourcePath, files, metadata);
                    allIssues.push(...issues);
                } catch (error) {
                    console.warn(`Validation rule ${rule.id} failed:`, error);
                    allIssues.push({
                        ruleId: rule.id,
                        severity: 'error',
                        message: `Validation rule failed: ${error instanceof Error ? error.message : String(error)}`
                    });
                }
            }

            // Categorize issues by severity
            const errors = allIssues.filter(issue => issue.severity === 'error');
            const warnings = allIssues.filter(issue => issue.severity === 'warning');
            const _info = allIssues.filter(issue => issue.severity === 'info');

            const result: ResourceValidationResult = {
                isValid: errors.length === 0,
                errors: errors.map(issue => issue.message),
                warnings: warnings.map(issue => issue.message),
                metadata: {
                    issues: allIssues,
                    rulesExecuted: applicableRules.length,
                    validationDuration: Date.now() - _validationStartTime
                }
            };

            this.validationCompleteEmitter.fire({
                resourcePath,
                result,
                duration: Date.now() - _validationStartTime
            });

            console.log(`Validated resource ${resourcePath}: ${errors.length} errors, ${warnings.length} warnings`);

            return result;
        } catch (error) {
            console.error(`Validation failed for resource ${resourcePath}:`, error);
            throw new FlintError(
                `Resource validation failed: ${error instanceof Error ? error.message : String(error)}`,
                'RESOURCE_VALIDATION_FAILED',
                `Could not validate resource "${resourcePath}"`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Validates multiple resources in batch
     */
    async validateResources(
        resources: Array<{
            resourcePath: string;
            resourceType: string;
            projectPath: string;
            files: ResourceFileInfo[];
            metadata?: Record<string, unknown>;
        }>
    ): Promise<ResourceValidationResult[]> {
        const results: ResourceValidationResult[] = [];

        for (const resource of resources) {
            try {
                const result = await this.validateResource(
                    resource.resourcePath,
                    resource.resourceType,
                    resource.projectPath,
                    resource.files,
                    resource.metadata
                );
                results.push(result);
            } catch (error) {
                console.error(`Batch validation failed for ${resource.resourcePath}:`, error);
                results.push({
                    isValid: false,
                    errors: [`Validation failed: ${error instanceof Error ? error.message : String(error)}`],
                    warnings: [],
                    metadata: { batchValidationError: true }
                });
            }
        }

        return results;
    }

    /**
     * Registers a validation rule for a specific resource type
     */
    registerValidationRule(resourceType: string, rule: ValidationRule): void {
        if (!this.validationRules.has(resourceType)) {
            this.validationRules.set(resourceType, []);
        }

        const rules = this.validationRules.get(resourceType)!;
        rules.push(rule);
    }

    /**
     * Registers a global validation rule that applies to all resources
     */
    registerGlobalValidationRule(rule: ValidationRule): void {
        this.globalRules.push(rule);
    }

    /**
     * Unregisters a validation rule
     */
    unregisterValidationRule(resourceType: string, ruleId: string): boolean {
        const rules = this.validationRules.get(resourceType);
        if (!rules) {
            return false;
        }

        const index = rules.findIndex(rule => rule.id === ruleId);
        if (index === -1) {
            return false;
        }

        rules.splice(index, 1);

        if (rules.length === 0) {
            this.validationRules.delete(resourceType);
        }

        console.log(`Unregistered validation rule '${ruleId}' for resource type: ${resourceType}`);
        return true;
    }

    /**
     * Gets validation statistics
     */
    getValidationStats(): {
        readonly totalRules: number;
        readonly rulesByType: Readonly<Record<string, number>>;
        readonly globalRules: number;
    } {
        const rulesByType: Record<string, number> = {};

        for (const [resourceType, rules] of this.validationRules) {
            rulesByType[resourceType] = rules.length;
        }

        return Object.freeze({
            totalRules: this.getTotalRuleCount(),
            rulesByType: Object.freeze(rulesByType),
            globalRules: this.globalRules.length
        });
    }

    /**
     * Gets all applicable rules for a resource type
     */
    private getApplicableRules(resourceType: string): ValidationRule[] {
        const specificRules = this.validationRules.get(resourceType) ?? [];
        return [...this.globalRules, ...specificRules];
    }

    /**
     * Gets total number of validation rules
     */
    private getTotalRuleCount(): number {
        let total = this.globalRules.length;
        for (const rules of this.validationRules.values()) {
            total += rules.length;
        }
        return total;
    }

    /**
     * Registers built-in validation rules
     */
    private async registerBuiltInValidationRules(): Promise<void> {
        // Global validation rules
        this.registerGlobalValidationRule({
            id: 'file-exists',
            name: 'File Existence Check',
            description: 'Ensures all referenced files exist on disk',
            severity: 'error',
            validator: async (resourcePath: string, files: ResourceFileInfo[]) => {
                const issues: ValidationIssue[] = [];

                for (const file of files) {
                    try {
                        await fs.access(file.path);
                    } catch {
                        issues.push({
                            ruleId: 'file-exists',
                            severity: 'error',
                            message: `Referenced file does not exist: ${file.path}`,
                            filePath: file.path
                        });
                    }
                }

                return issues;
            }
        });

        this.registerGlobalValidationRule({
            id: 'file-readable',
            name: 'File Readability Check',
            description: 'Ensures all files are readable',
            severity: 'error',
            validator: async (resourcePath: string, files: ResourceFileInfo[]) => {
                const issues: ValidationIssue[] = [];

                for (const file of files) {
                    try {
                        await fs.access(file.path, fs.constants.R_OK);
                    } catch {
                        issues.push({
                            ruleId: 'file-readable',
                            severity: 'error',
                            message: `File is not readable: ${file.path}`,
                            filePath: file.path
                        });
                    }
                }

                return issues;
            }
        });

        // Register validation rules from ResourceTypeProviderRegistry
        await this.registerValidationRulesFromProviders();

        // Resource.json validation
        this.registerGlobalValidationRule({
            id: 'resource-json',
            name: 'Resource JSON Validation',
            description: 'Validates resource.json files for completeness',
            severity: 'warning',
            validator: async (resourcePath: string, files: ResourceFileInfo[]) => {
                const issues: ValidationIssue[] = [];

                const resourceJsonFile = files.find(f => f.name === 'resource.json');
                if (!resourceJsonFile) {
                    issues.push({
                        ruleId: 'resource-json',
                        severity: 'warning',
                        message: 'Missing resource.json file',
                        suggestion: 'Create resource.json file with resource metadata'
                    });
                } else {
                    try {
                        const content = await fs.readFile(resourceJsonFile.path, 'utf8');
                        const resourceData = JSON.parse(content);

                        if (!resourceData.scope) {
                            issues.push({
                                ruleId: 'resource-json',
                                severity: 'info',
                                message: 'Resource.json missing scope field',
                                filePath: resourceJsonFile.path,
                                suggestion: 'Add scope field to define resource visibility'
                            });
                        }
                    } catch (error) {
                        issues.push({
                            ruleId: 'resource-json',
                            severity: 'error',
                            message: `Invalid resource.json: ${error instanceof Error ? error.message : String(error)}`,
                            filePath: resourceJsonFile.path
                        });
                    }
                }

                return issues;
            }
        });
    }

    /**
     * Registers validation rules from ResourceTypeProviderRegistry
     */
    private registerValidationRulesFromProviders(): Promise<void> {
        try {
            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (!providerRegistry) {
                console.warn('ResourceTypeProviderRegistry not available, skipping provider-based validation rules');
                return Promise.resolve();
            }

            // Get all providers and register their validation rules
            const allProviders = providerRegistry.getAllProviders();
            let _totalRulesRegistered = 0;

            for (const provider of allProviders) {
                try {
                    const validationRules = provider.getValidationRules();

                    for (const rule of validationRules) {
                        // Convert provider validation rule to service validation rule format
                        this.registerValidationRule(provider.resourceTypeId, {
                            id: rule.id,
                            name: rule.name,
                            description: rule.description,
                            severity: rule.severity,
                            validator: async (resourcePath: string, files: ResourceFileInfo[]) => {
                                const issues: ValidationIssue[] = [];

                                // Find primary files for this resource type
                                const primaryFiles = provider.getTemplateConfig().templates[0]?.files ?? {};
                                const primaryFileName = Object.keys(primaryFiles)[0];

                                // Find the primary file to validate using provider configuration
                                const targetFile = primaryFileName
                                    ? files.find(f => f.name === primaryFileName)
                                    : files[0]; // Use first file if no primary file specified

                                if (targetFile) {
                                    try {
                                        const content = await fs.readFile(targetFile.path, 'utf8');
                                        const ruleResult = await rule.validate(targetFile.path, content);

                                        // Convert rule result to validation issues
                                        if (!ruleResult.isValid) {
                                            // Add errors
                                            issues.push(
                                                ...ruleResult.errors.map(error => ({
                                                    ruleId: rule.id,
                                                    severity: 'error' as const,
                                                    message: error,
                                                    filePath: targetFile.path
                                                }))
                                            );

                                            // Add warnings
                                            issues.push(
                                                ...ruleResult.warnings.map(warning => ({
                                                    ruleId: rule.id,
                                                    severity: 'warning' as const,
                                                    message: warning,
                                                    filePath: targetFile.path
                                                }))
                                            );
                                        }
                                    } catch (error) {
                                        issues.push({
                                            ruleId: rule.id,
                                            severity: 'error',
                                            message: `Failed to validate file: ${
                                                error instanceof Error ? error.message : String(error)
                                            }`,
                                            filePath: targetFile.path
                                        });
                                    }
                                }

                                return issues;
                            }
                        });

                        _totalRulesRegistered++;
                    }
                } catch (error) {
                    console.warn(`Failed to register validation rules for ${provider.resourceTypeId}:`, error);
                }
            }
        } catch (error) {
            console.error('Error registering validation rules from providers:', error);
        }
        return Promise.resolve();
    }
}
