/**
 * @module ValidationUtilities
 * @description Enhanced validation utilities with service lifecycle support
 * Provides comprehensive validation operations for various data types and formats
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Validation rule definition
 */
export interface ValidationRule<T = any> {
    readonly name: string;
    readonly description: string;
    readonly validator: (value: T, context?: ValidationContext) => ValidationResult;
    readonly severity: ValidationSeverity;
    readonly category: ValidationCategory;
}

/**
 * Validation severity levels
 */
export enum ValidationSeverity {
    INFO = 'info',
    WARNING = 'warning',
    ERROR = 'error',
    CRITICAL = 'critical'
}

/**
 * Validation categories
 */
export enum ValidationCategory {
    SYNTAX = 'syntax',
    SEMANTICS = 'semantics',
    STYLE = 'style',
    SECURITY = 'security',
    PERFORMANCE = 'performance',
    COMPATIBILITY = 'compatibility'
}

/**
 * Validation context
 */
export interface ValidationContext {
    readonly source: string;
    readonly filePath?: string;
    readonly projectId?: string;
    readonly resourceType?: string;
    readonly metadata?: Record<string, any>;
}

/**
 * Validation result
 */
export interface ValidationResult {
    readonly isValid: boolean;
    readonly messages: ValidationMessage[];
    readonly score?: number; // 0-100 quality score
    readonly suggestions?: ValidationSuggestion[];
}

/**
 * Validation message
 */
export interface ValidationMessage {
    readonly severity: ValidationSeverity;
    readonly category: ValidationCategory;
    readonly message: string;
    readonly code?: string;
    readonly line?: number;
    readonly column?: number;
    readonly length?: number;
    readonly rule?: string;
}

/**
 * Validation suggestion
 */
export interface ValidationSuggestion {
    readonly message: string;
    readonly action: string;
    readonly autoFix?: boolean;
    readonly replacement?: string;
    readonly position?: vscode.Range;
}

/**
 * Validation configuration
 */
export interface ValidationConfiguration {
    enabledRules: string[];
    severityOverrides: Record<string, ValidationSeverity>;
    categoryFilters: ValidationCategory[];
    maxMessages: number;
    autoFix: boolean;
    showScore: boolean;
}

/**
 * Batch validation options
 */
export interface BatchValidationOptions {
    concurrency: number;
    stopOnError: boolean;
    includeWarnings: boolean;
    progressCallback?: (progress: ValidationProgress) => void;
}

/**
 * Validation progress information
 */
export interface ValidationProgress {
    readonly total: number;
    readonly completed: number;
    readonly current: string;
    readonly errors: number;
    readonly warnings: number;
}

/**
 * Enhanced validation utilities with service lifecycle support
 * Provides comprehensive validation operations for various data types and formats
 */
export class ValidationUtilities implements IServiceLifecycle {
    private static readonly DEFAULT_CONFIG: ValidationConfiguration = {
        enabledRules: [],
        severityOverrides: {},
        categoryFilters: Object.values(ValidationCategory),
        maxMessages: 100,
        autoFix: false,
        showScore: true
    };

    private isInitialized = false;
    private config: ValidationConfiguration = { ...ValidationUtilities.DEFAULT_CONFIG };
    private rules: Map<string, ValidationRule> = new Map();
    private rulesByCategory: Map<ValidationCategory, ValidationRule[]> = new Map();

    constructor(private readonly serviceContainer?: ServiceContainer) {}

    async initialize(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        try {
            this.loadConfiguration();
            this.setupBuiltInRules();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize validation utilities',
                'VALIDATION_INIT_FAILED',
                'Validation utilities could not start properly',
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
        await Promise.resolve(); // Satisfy async/await requirement
        this.rules.clear();
        this.rulesByCategory.clear();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Validates a value against all applicable rules
     */
    validate<T>(
        value: T,
        context?: ValidationContext,
        ruleFilter?: (rule: ValidationRule) => boolean
    ): ValidationResult {
        if (!this.isInitialized) {
            throw new FlintError('Validation utilities not initialized', 'NOT_INITIALIZED');
        }

        const messages: ValidationMessage[] = [];
        const suggestions: ValidationSuggestion[] = [];
        let totalScore = 0;
        let ruleCount = 0;

        // Get applicable rules
        const applicableRules = Array.from(this.rules.values()).filter(rule => {
            if (ruleFilter && !ruleFilter(rule)) return false;
            if (!this.config.enabledRules.includes(rule.name)) return false;
            if (!this.config.categoryFilters.includes(rule.category)) return false;
            return true;
        });

        // Run validation rules
        for (const rule of applicableRules) {
            try {
                const result = rule.validator(value, context);

                // Add messages with severity overrides
                for (const msg of result.messages) {
                    const severity = this.config.severityOverrides[rule.name] || msg.severity;
                    messages.push({
                        ...msg,
                        severity,
                        rule: rule.name
                    });
                }

                // Add suggestions
                if (result.suggestions) {
                    suggestions.push(...result.suggestions);
                }

                // Calculate score
                if (result.score !== undefined) {
                    totalScore += result.score;
                    ruleCount++;
                }
            } catch (error) {
                messages.push({
                    severity: ValidationSeverity.ERROR,
                    category: ValidationCategory.SYNTAX,
                    message: `Validation rule '${rule.name}' failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    rule: rule.name
                });
            }
        }

        // Limit messages if configured
        const limitedMessages = messages.slice(0, this.config.maxMessages);

        // Calculate overall validity and score
        const isValid = !limitedMessages.some(
            msg => msg.severity === ValidationSeverity.ERROR || msg.severity === ValidationSeverity.CRITICAL
        );

        const score = ruleCount > 0 ? Math.round(totalScore / ruleCount) : undefined;

        return {
            isValid,
            messages: limitedMessages,
            score: this.config.showScore ? score : undefined,
            suggestions
        };
    }

    /**
     * Validates multiple values in batch
     */
    async validateBatch<T>(
        items: { value: T; context?: ValidationContext }[],
        options?: Partial<BatchValidationOptions>
    ): Promise<ValidationResult[]> {
        const opts: BatchValidationOptions = {
            concurrency: 5,
            stopOnError: false,
            includeWarnings: true,
            ...options
        };

        const results: ValidationResult[] = [];
        let completed = 0;
        let errors = 0;
        let warnings = 0;

        const updateProgress = (): void => {
            if (opts.progressCallback) {
                opts.progressCallback({
                    total: items.length,
                    completed,
                    current: `Validating item ${completed + 1}`,
                    errors,
                    warnings
                });
            }
        };

        // Process items in chunks for concurrency control
        for (let i = 0; i < items.length; i += opts.concurrency) {
            const chunk = items.slice(i, i + opts.concurrency);

            const chunkResults = await Promise.all(
                chunk.map((item, _index) => {
                    try {
                        const result = this.validate(item.value, item.context);

                        // Count errors and warnings
                        for (const msg of result.messages) {
                            if (
                                msg.severity === ValidationSeverity.ERROR ||
                                msg.severity === ValidationSeverity.CRITICAL
                            ) {
                                errors++;
                                if (opts.stopOnError) {
                                    throw new FlintError(
                                        'Validation failed with error',
                                        'VALIDATION_ERROR',
                                        msg.message
                                    );
                                }
                            } else if (msg.severity === ValidationSeverity.WARNING) {
                                warnings++;
                            }
                        }

                        completed++;
                        updateProgress();
                        return result;
                    } catch (error) {
                        completed++;
                        errors++;
                        updateProgress();

                        if (opts.stopOnError) {
                            throw error;
                        }

                        return {
                            isValid: false,
                            messages: [
                                {
                                    severity: ValidationSeverity.ERROR,
                                    category: ValidationCategory.SYNTAX,
                                    message: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                                }
                            ]
                        };
                    }
                })
            );

            results.push(...chunkResults);
        }

        return results;
    }

    /**
     * Registers a custom validation rule
     */
    registerRule(rule: ValidationRule): void {
        this.rules.set(rule.name, rule);

        // Add to category map
        if (!this.rulesByCategory.has(rule.category)) {
            this.rulesByCategory.set(rule.category, []);
        }
        this.rulesByCategory.get(rule.category)!.push(rule);
    }

    /**
     * Unregisters a validation rule
     */
    unregisterRule(ruleName: string): void {
        const rule = this.rules.get(ruleName);
        if (rule) {
            this.rules.delete(ruleName);

            // Remove from category map
            const categoryRules = this.rulesByCategory.get(rule.category);
            if (categoryRules) {
                const index = categoryRules.findIndex(r => r.name === ruleName);
                if (index >= 0) {
                    categoryRules.splice(index, 1);
                }
            }
        }
    }

    /**
     * Gets all registered rules
     */
    getRules(): readonly ValidationRule[] {
        return Array.from(this.rules.values());
    }

    /**
     * Gets rules by category
     */
    getRulesByCategory(category: ValidationCategory): readonly ValidationRule[] {
        return this.rulesByCategory.get(category) || [];
    }

    /**
     * Updates validation configuration
     */
    updateConfiguration(newConfig: Partial<ValidationConfiguration>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Gets current validation configuration
     */
    getCurrentConfiguration(): ValidationConfiguration {
        return { ...this.config };
    }

    /**
     * Formats validation results for display
     */
    formatResults(results: ValidationResult[], format: 'text' | 'markdown' | 'json' = 'text'): string {
        switch (format) {
            case 'markdown':
                return this.formatResultsAsMarkdown(results);
            case 'json':
                return JSON.stringify(results, null, 2);
            default:
                return this.formatResultsAsText(results);
        }
    }

    /**
     * String representation for debugging
     */
    toString(): string {
        return `ValidationUtilities(rules: ${this.rules.size}, status: ${this.getStatus()})`;
    }

    /**
     * Sets up built-in validation rules
     */
    private setupBuiltInRules(): void {
        // JSON validation rule
        this.registerRule({
            name: 'json-syntax',
            description: 'Validates JSON syntax',
            category: ValidationCategory.SYNTAX,
            severity: ValidationSeverity.ERROR,
            validator: (value: string) => {
                try {
                    JSON.parse(value);
                    return {
                        isValid: true,
                        messages: [],
                        score: 100
                    };
                } catch (error) {
                    return {
                        isValid: false,
                        messages: [
                            {
                                severity: ValidationSeverity.ERROR,
                                category: ValidationCategory.SYNTAX,
                                message: `Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
                            }
                        ],
                        score: 0
                    };
                }
            }
        });

        // File path validation rule
        this.registerRule({
            name: 'file-path',
            description: 'Validates file path format',
            category: ValidationCategory.SEMANTICS,
            severity: ValidationSeverity.WARNING,
            validator: (filePath: string) => {
                const messages: ValidationMessage[] = [];
                let score = 100;

                // Check for invalid characters
                const invalidChars = /[<>:"|?*]/g;
                if (invalidChars.test(filePath)) {
                    messages.push({
                        severity: ValidationSeverity.ERROR,
                        category: ValidationCategory.SEMANTICS,
                        message: 'File path contains invalid characters'
                    });
                    score = 0;
                }

                // Check path length
                if (filePath.length > 260) {
                    messages.push({
                        severity: ValidationSeverity.WARNING,
                        category: ValidationCategory.COMPATIBILITY,
                        message: 'File path is very long and may cause issues on some systems'
                    });
                    score -= 20;
                }

                return {
                    isValid: messages.length === 0 || !messages.some(m => m.severity === ValidationSeverity.ERROR),
                    messages,
                    score: Math.max(0, score)
                };
            }
        });

        // Enable built-in rules by default
        this.config.enabledRules = Array.from(this.rules.keys());
    }

    /**
     * Loads configuration from workspace settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration();
        const validationConfig = config.get('flint.validation', {});

        this.config = {
            ...ValidationUtilities.DEFAULT_CONFIG,
            ...(validationConfig as any)
        };
    }

    /**
     * Formats results as plain text
     */
    private formatResultsAsText(results: ValidationResult[]): string {
        let output = '';

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            output += `Result ${i + 1}:\n`;
            output += `  Valid: ${result.isValid}\n`;

            if (result.score !== undefined) {
                output += `  Score: ${result.score}/100\n`;
            }

            if (result.messages.length > 0) {
                output += '  Messages:\n';
                for (const msg of result.messages) {
                    output += `    [${msg.severity.toUpperCase()}] ${msg.message}\n`;
                }
            }

            if (result.suggestions && result.suggestions.length > 0) {
                output += '  Suggestions:\n';
                for (const suggestion of result.suggestions) {
                    output += `    - ${suggestion.message}\n`;
                }
            }

            output += '\n';
        }

        return output.trim();
    }

    /**
     * Formats results as markdown
     */
    private formatResultsAsMarkdown(results: ValidationResult[]): string {
        let output = '# Validation Results\n\n';

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const status = result.isValid ? '✅' : '❌';

            output += `## Result ${i + 1} ${status}\n\n`;

            if (result.score !== undefined) {
                output += `**Score:** ${result.score}/100\n\n`;
            }

            if (result.messages.length > 0) {
                output += '### Messages\n\n';
                for (const msg of result.messages) {
                    const icon = this.getSeverityIcon(msg.severity);
                    output += `- ${icon} **${msg.severity.toUpperCase()}**: ${msg.message}\n`;
                }
                output += '\n';
            }

            if (result.suggestions && result.suggestions.length > 0) {
                output += '### Suggestions\n\n';
                for (const suggestion of result.suggestions) {
                    output += `- 💡 ${suggestion.message}\n`;
                }
                output += '\n';
            }
        }

        return output;
    }

    /**
     * Gets icon for severity level
     */
    private getSeverityIcon(severity: ValidationSeverity): string {
        switch (severity) {
            case ValidationSeverity.INFO:
                return 'ℹ️';
            case ValidationSeverity.WARNING:
                return '⚠️';
            case ValidationSeverity.ERROR:
                return '❌';
            case ValidationSeverity.CRITICAL:
                return '🚨';
            default:
                return '❓';
        }
    }
}
