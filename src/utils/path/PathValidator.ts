/**
 * @module PathValidator
 * @description Comprehensive path validation with Ignition-specific rules
 * Enhanced validation for resource paths, names, and patterns
 */

import * as vscode from 'vscode';

import { PathUtilities, PathValidationResult } from './PathUtilities';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ResourceTypeDefinition } from '@/core/types/resources';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Validation rule configuration
 */
export interface ValidationRuleConfig {
    readonly enabled: boolean;
    readonly severity: 'error' | 'warning' | 'info';
    readonly message?: string;
}

/**
 * Path validation configuration
 */
export interface PathValidationConfig {
    readonly maxPathLength: number;
    readonly maxNameLength: number;
    readonly maxDepth: number;
    readonly allowUnicode: boolean;
    readonly allowSpaces: boolean;
    readonly reservedNames: readonly string[];
    readonly invalidCharacters: readonly string[];
    readonly rules: {
        readonly checkReservedNames: ValidationRuleConfig;
        readonly checkInvalidChars: ValidationRuleConfig;
        readonly checkLength: ValidationRuleConfig;
        readonly checkDepth: ValidationRuleConfig;
        readonly checkPatterns: ValidationRuleConfig;
        readonly checkCaseConsistency: ValidationRuleConfig;
    };
}

/**
 * Validation context for resource-specific rules
 */
export interface ValidationContext {
    readonly typeDefinition?: ResourceTypeDefinition;
    readonly categoryId?: string;
    readonly projectId?: string;
    readonly existingPaths?: readonly string[];
    readonly isFolder?: boolean;
}

/**
 * Enhanced validation result with detailed information
 */
export interface DetailedValidationResult extends PathValidationResult {
    readonly suggestions?: readonly string[];
    readonly ruleViolations: {
        readonly rule: string;
        readonly severity: 'error' | 'warning' | 'info';
        readonly message: string;
        readonly suggestion?: string;
    }[];
}

/**
 * Path suggestion options
 */
export interface PathSuggestionOptions {
    readonly maxSuggestions: number;
    readonly includeVariations: boolean;
    readonly respectTypeConstraints: boolean;
}

/**
 * Comprehensive path validator with Ignition-specific rules and service lifecycle
 * Provides detailed validation, suggestions, and type-aware constraints
 */
export class PathValidator implements IServiceLifecycle {
    private static readonly DEFAULT_CONFIG: PathValidationConfig = {
        maxPathLength: 260, // Windows MAX_PATH
        maxNameLength: 255,
        maxDepth: 10,
        allowUnicode: false,
        allowSpaces: true,
        reservedNames: [
            'CON',
            'PRN',
            'AUX',
            'NUL',
            'COM1',
            'COM2',
            'COM3',
            'COM4',
            'COM5',
            'COM6',
            'COM7',
            'COM8',
            'COM9',
            'LPT1',
            'LPT2',
            'LPT3',
            'LPT4',
            'LPT5',
            'LPT6',
            'LPT7',
            'LPT8',
            'LPT9',
            // Ignition-specific reserved names
            'system',
            'global',
            'shared',
            'gateway',
            'client',
            'designer'
        ],
        invalidCharacters: ['<', '>', ':', '"', '|', '?', '*', '\0'],
        rules: {
            checkReservedNames: { enabled: true, severity: 'error' },
            checkInvalidChars: { enabled: true, severity: 'error' },
            checkLength: { enabled: true, severity: 'error' },
            checkDepth: { enabled: true, severity: 'warning' },
            checkPatterns: { enabled: true, severity: 'warning' },
            checkCaseConsistency: { enabled: true, severity: 'info' }
        }
    };

    private isInitialized = false;
    private config: PathValidationConfig;
    private pathUtilities!: PathUtilities;

    constructor(
        private readonly serviceContainer?: ServiceContainer,
        config?: Partial<PathValidationConfig>
    ) {
        this.config = this.mergeConfig(PathValidator.DEFAULT_CONFIG, config);
    }

    async initialize(): Promise<void> {
        try {
            this.pathUtilities = new PathUtilities(this.serviceContainer);
            await this.pathUtilities.initialize();

            // Load configuration from workspace
            this.loadWorkspaceConfiguration();

            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize path validator',
                'PATH_VALIDATOR_INIT_FAILED',
                'Path validator could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
        void this.pathUtilities.start();
    }

    async stop(): Promise<void> {
        if (this.pathUtilities) {
            await this.pathUtilities.stop();
        }
    }

    async dispose(): Promise<void> {
        if (this.pathUtilities) {
            await this.pathUtilities.dispose();
        }
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    // ============================================================================
    // COMPREHENSIVE VALIDATION
    // ============================================================================

    /**
     * Validates a path with comprehensive rules and context
     */
    validatePath(inputPath: string, context?: ValidationContext): DetailedValidationResult {
        const ruleViolations: DetailedValidationResult['ruleViolations'] = [];
        const errors: string[] = [];
        const warnings: string[] = [];
        const suggestions: string[] = [];

        if (!inputPath || typeof inputPath !== 'string') {
            errors.push('Path cannot be empty or null');
            return {
                isValid: false,
                errors,
                warnings,
                ruleViolations: [
                    {
                        rule: 'required',
                        severity: 'error',
                        message: 'Path is required'
                    }
                ]
            };
        }

        const normalizedPath = this.pathUtilities.normalize(inputPath);

        // Run all validation rules
        this.validateReservedNames(normalizedPath, ruleViolations, context);
        this.validateInvalidCharacters(normalizedPath, ruleViolations);
        this.validateLength(normalizedPath, ruleViolations);
        this.validateDepth(normalizedPath, ruleViolations);
        this.validatePatterns(normalizedPath, ruleViolations, context);
        this.validateCaseConsistency(normalizedPath, ruleViolations, context);

        // Extract errors and warnings from rule violations
        for (const violation of ruleViolations) {
            const message = violation.message;
            if (violation.severity === 'error') {
                errors.push(message);
            } else if (violation.severity === 'warning') {
                warnings.push(message);
            }

            if (violation.suggestion) {
                suggestions.push(violation.suggestion);
            }
        }

        // Generate additional suggestions
        if (errors.length > 0 || warnings.length > 0) {
            suggestions.push(...this.generatePathSuggestions(normalizedPath, context));
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            normalizedPath,
            ruleViolations,
            suggestions
        };
    }

    /**
     * Validates a resource name with enhanced rules
     */
    validateResourceName(name: string, context?: ValidationContext): DetailedValidationResult {
        const ruleViolations: DetailedValidationResult['ruleViolations'] = [];
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!name || typeof name !== 'string') {
            return {
                isValid: false,
                errors: ['Name cannot be empty or null'],
                warnings: [],
                ruleViolations: [
                    {
                        rule: 'required',
                        severity: 'error',
                        message: 'Resource name is required'
                    }
                ]
            };
        }

        const trimmed = name.trim();

        // Check for path separators
        if (trimmed.includes('/') || trimmed.includes('\\')) {
            ruleViolations.push({
                rule: 'pathSeparators',
                severity: 'error',
                message: 'Resource name cannot contain path separators',
                suggestion: 'Use only the final segment as the resource name'
            });
        }

        // Run standard path validation rules
        const pathResult = this.validatePath(trimmed, context);
        ruleViolations.push(...pathResult.ruleViolations);

        // Additional name-specific rules
        this.validateNameSpecificRules(trimmed, ruleViolations, context);

        // Extract errors and warnings
        for (const violation of ruleViolations) {
            if (violation.severity === 'error') {
                errors.push(violation.message);
            } else if (violation.severity === 'warning') {
                warnings.push(violation.message);
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            normalizedPath: trimmed,
            ruleViolations
        };
    }

    /**
     * Validates a batch of paths for consistency
     */
    validatePathBatch(paths: readonly string[], context?: ValidationContext): Map<string, DetailedValidationResult> {
        const results = new Map<string, DetailedValidationResult>();

        for (const path of paths) {
            const result = this.validatePath(path, {
                ...context,
                existingPaths: paths.filter(p => p !== path)
            });
            results.set(path, result);
        }

        // Check for duplicates
        this.checkForDuplicatePaths(results);

        return results;
    }

    // ============================================================================
    // PATH SUGGESTIONS
    // ============================================================================

    /**
     * Generates valid path suggestions based on invalid input
     */
    generatePathSuggestions(
        invalidPath: string,
        context?: ValidationContext,
        options?: Partial<PathSuggestionOptions>
    ): string[] {
        const opts: PathSuggestionOptions = {
            maxSuggestions: 3,
            includeVariations: true,
            respectTypeConstraints: true,
            ...options
        };

        const suggestions: string[] = [];

        // Clean up the path
        const cleanPath = this.sanitizePath(invalidPath);

        // Generate base suggestion
        if (cleanPath && cleanPath !== invalidPath) {
            suggestions.push(cleanPath);
        }

        // Generate variations if requested
        if (opts.includeVariations && suggestions.length < opts.maxSuggestions) {
            suggestions.push(...this.generatePathVariations(cleanPath, opts.maxSuggestions - suggestions.length));
        }

        // Apply type constraints if available
        if (opts.respectTypeConstraints && context?.typeDefinition) {
            return this.filterSuggestionsByType(suggestions, context.typeDefinition, context.categoryId);
        }

        return suggestions.slice(0, opts.maxSuggestions);
    }

    /**
     * Suggests alternative names for conflicts
     */
    suggestAlternativeNames(
        preferredName: string,
        existingNames: readonly string[],
        maxSuggestions: number = 3
    ): string[] {
        const suggestions: string[] = [];
        const baseName = this.pathUtilities.getName(preferredName);
        const extension = this.pathUtilities.getExtension(preferredName);
        const nameWithoutExt = extension ? baseName.replace(extension, '') : baseName;

        // Try numbered variations
        for (let i = 1; i <= maxSuggestions * 2; i++) {
            const suggestion = extension ? `${nameWithoutExt}_${i}${extension}` : `${nameWithoutExt}_${i}`;

            if (!existingNames.includes(suggestion)) {
                suggestions.push(suggestion);
                if (suggestions.length >= maxSuggestions) break;
            }
        }

        // Try common suffixes if numbers didn't work
        if (suggestions.length < maxSuggestions) {
            const suffixes = ['copy', 'new', 'alt', 'backup'];
            for (const suffix of suffixes) {
                const suggestion = extension
                    ? `${nameWithoutExt}_${suffix}${extension}`
                    : `${nameWithoutExt}_${suffix}`;

                if (!existingNames.includes(suggestion)) {
                    suggestions.push(suggestion);
                    if (suggestions.length >= maxSuggestions) break;
                }
            }
        }

        return suggestions;
    }

    // ============================================================================
    // CONFIGURATION MANAGEMENT
    // ============================================================================

    /**
     * Updates validation configuration
     */
    updateConfiguration(newConfig: Partial<PathValidationConfig>): void {
        this.config = this.mergeConfig(this.config, newConfig);
    }

    /**
     * Gets current configuration
     */
    getConfiguration(): Readonly<PathValidationConfig> {
        return Object.freeze(JSON.parse(JSON.stringify(this.config)) as PathValidationConfig);
    }

    /**
     * Resets configuration to defaults
     */
    resetConfiguration(): void {
        this.config = { ...PathValidator.DEFAULT_CONFIG };
    }

    // ============================================================================
    // PRIVATE VALIDATION METHODS
    // ============================================================================

    /**
     * Validates against reserved names
     */
    private validateReservedNames(
        path: string,
        violations: DetailedValidationResult['ruleViolations'],
        _context?: ValidationContext
    ): void {
        if (!this.config.rules.checkReservedNames.enabled) return;

        const segments = path.split('/');
        for (const segment of segments) {
            if (segment && this.config.reservedNames.includes(segment.toUpperCase())) {
                violations.push({
                    rule: 'reservedNames',
                    severity: this.config.rules.checkReservedNames.severity,
                    message: `"${segment}" is a reserved name and cannot be used`,
                    suggestion: `Try "${segment}_resource" or "${segment}_item" instead`
                });
            }
        }
    }

    /**
     * Validates against invalid characters
     */
    private validateInvalidCharacters(path: string, violations: DetailedValidationResult['ruleViolations']): void {
        if (!this.config.rules.checkInvalidChars.enabled) return;

        for (const char of this.config.invalidCharacters) {
            if (path.includes(char)) {
                violations.push({
                    rule: 'invalidChars',
                    severity: this.config.rules.checkInvalidChars.severity,
                    message: `Path contains invalid character: "${char}"`,
                    suggestion: `Remove or replace the character "${char}"`
                });
            }
        }

        // Check for unicode if not allowed
        if (!this.config.allowUnicode && /[^\x20-\x7E]/.test(path)) {
            violations.push({
                rule: 'unicode',
                severity: this.config.rules.checkInvalidChars.severity,
                message: 'Path contains non-ASCII characters',
                suggestion: 'Use only ASCII characters (a-z, A-Z, 0-9, _, -, .)'
            });
        }
    }

    /**
     * Validates path length constraints
     */
    private validateLength(path: string, violations: DetailedValidationResult['ruleViolations']): void {
        if (!this.config.rules.checkLength.enabled) return;

        if (path.length > this.config.maxPathLength) {
            violations.push({
                rule: 'pathLength',
                severity: this.config.rules.checkLength.severity,
                message: `Path length (${path.length}) exceeds maximum (${this.config.maxPathLength})`,
                suggestion: 'Shorten the path or use fewer directory levels'
            });
        }

        const name = this.pathUtilities.getName(path);
        if (name.length > this.config.maxNameLength) {
            violations.push({
                rule: 'nameLength',
                severity: this.config.rules.checkLength.severity,
                message: `Name length (${name.length}) exceeds maximum (${this.config.maxNameLength})`,
                suggestion: `Shorten the name to ${this.config.maxNameLength} characters or less`
            });
        }
    }

    /**
     * Validates path depth constraints
     */
    private validateDepth(path: string, violations: DetailedValidationResult['ruleViolations']): void {
        if (!this.config.rules.checkDepth.enabled) return;

        const depth = this.pathUtilities.getDepth(path);
        if (depth > this.config.maxDepth) {
            violations.push({
                rule: 'depth',
                severity: this.config.rules.checkDepth.severity,
                message: `Path depth (${depth}) exceeds recommended maximum (${this.config.maxDepth})`,
                suggestion: 'Consider flattening the directory structure'
            });
        }
    }

    /**
     * Validates against type-specific patterns
     */
    private validatePatterns(
        path: string,
        violations: DetailedValidationResult['ruleViolations'],
        context?: ValidationContext
    ): void {
        if (!this.config.rules.checkPatterns.enabled || !context?.typeDefinition) return;

        const { typeDefinition, categoryId } = context;

        // Check against type patterns
        if (typeDefinition.patterns) {
            // This would be enhanced with proper glob pattern matching
            const matchesAnyPattern = typeDefinition.patterns.some(pattern => {
                const pathPattern = pattern.pattern.replace(/\*+/g, '.*');
                return new RegExp(pathPattern).test(path);
            });

            if (!matchesAnyPattern) {
                violations.push({
                    rule: 'typePattern',
                    severity: this.config.rules.checkPatterns.severity,
                    message: `Path does not match expected patterns for ${typeDefinition.name}`,
                    suggestion: 'Ensure path follows the expected structure for this resource type'
                });
            }
        }

        // Check category constraints
        if (categoryId && typeDefinition.categories?.[categoryId]) {
            const category = typeDefinition.categories[categoryId];
            if (category.patterns) {
                const matchesCategoryPattern = category.patterns.some(pattern => {
                    const pathPattern = pattern.pattern.replace(/\*+/g, '.*');
                    return new RegExp(pathPattern).test(path);
                });

                if (!matchesCategoryPattern) {
                    violations.push({
                        rule: 'categoryPattern',
                        severity: this.config.rules.checkPatterns.severity,
                        message: `Path does not match patterns for ${category.name} category`,
                        suggestion: `Follow the expected pattern for ${category.name} resources`
                    });
                }
            }
        }
    }

    /**
     * Validates case consistency
     */
    private validateCaseConsistency(
        path: string,
        violations: DetailedValidationResult['ruleViolations'],
        _context?: ValidationContext
    ): void {
        if (!this.config.rules.checkCaseConsistency.enabled) return;

        const segments = path.split('/');
        const casePatterns = {
            allLower: segments.every(s => s === s.toLowerCase()),
            allUpper: segments.every(s => s === s.toUpperCase()),
            camelCase: segments.every(s => /^[a-z][a-zA-Z0-9]*$/.test(s)),
            pascalCase: segments.every(s => /^[A-Z][a-zA-Z0-9]*$/.test(s))
        };

        if (!Object.values(casePatterns).some(Boolean)) {
            violations.push({
                rule: 'caseConsistency',
                severity: this.config.rules.checkCaseConsistency.severity,
                message: 'Path has inconsistent case convention',
                suggestion: 'Use a consistent case convention (e.g., camelCase, snake_case, kebab-case)'
            });
        }
    }

    /**
     * Validates name-specific rules
     */
    private validateNameSpecificRules(
        name: string,
        violations: DetailedValidationResult['ruleViolations'],
        _context?: ValidationContext
    ): void {
        // Check for leading/trailing dots
        if (name.startsWith('.') || name.endsWith('.')) {
            violations.push({
                rule: 'dotName',
                severity: 'warning',
                message: 'Names starting or ending with dots may cause issues',
                suggestion: 'Avoid leading and trailing dots in resource names'
            });
        }

        // Check for multiple consecutive spaces
        if (name.includes('  ')) {
            violations.push({
                rule: 'multipleSpaces',
                severity: 'info',
                message: 'Name contains multiple consecutive spaces',
                suggestion: 'Replace multiple spaces with single spaces or underscores'
            });
        }

        // Check for leading/trailing spaces
        if (name !== name.trim()) {
            violations.push({
                rule: 'whitespace',
                severity: 'warning',
                message: 'Name has leading or trailing whitespace',
                suggestion: 'Remove leading and trailing spaces'
            });
        }
    }

    /**
     * Checks for duplicate paths in batch validation
     */
    private checkForDuplicatePaths(results: Map<string, DetailedValidationResult>): void {
        const normalizedPaths = new Map<string, string[]>();

        for (const [originalPath, result] of results) {
            if (result.normalizedPath) {
                const normalized = result.normalizedPath.toLowerCase();
                if (!normalizedPaths.has(normalized)) {
                    normalizedPaths.set(normalized, []);
                }
                normalizedPaths.get(normalized)!.push(originalPath);
            }
        }

        // Add duplicate warnings
        for (const [_normalized, paths] of normalizedPaths) {
            if (paths.length > 1) {
                for (const path of paths) {
                    const result = results.get(path)!;
                    result.ruleViolations.push({
                        rule: 'duplicate',
                        severity: 'warning',
                        message: `Path conflicts with other paths when normalized: ${paths.join(', ')}`,
                        suggestion: 'Use more distinctive names to avoid conflicts'
                    });
                }
            }
        }
    }

    /**
     * Sanitizes a path to make it valid
     */
    private sanitizePath(path: string): string {
        let sanitized = path;

        // Remove invalid characters
        for (const char of this.config.invalidCharacters) {
            sanitized = sanitized.replace(new RegExp(`\\${char}`, 'g'), '');
        }

        // Replace multiple slashes
        sanitized = sanitized.replace(/\/+/g, '/');

        // Remove leading/trailing slashes
        sanitized = sanitized.replace(/^\/+|\/+$/g, '');

        // Handle reserved names
        const segments = sanitized.split('/');
        for (let i = 0; i < segments.length; i++) {
            if (this.config.reservedNames.includes(segments[i].toUpperCase())) {
                segments[i] = `${segments[i]}_resource`;
            }
        }

        return segments.join('/');
    }

    /**
     * Generates path variations
     */
    private generatePathVariations(cleanPath: string, maxVariations: number): string[] {
        const variations: string[] = [];
        const baseName = this.pathUtilities.getName(cleanPath);
        const parent = this.pathUtilities.getParent(cleanPath);

        // Try different naming conventions
        const conventions = [
            (name: string): string => name.toLowerCase(),
            (name: string): string => name.replace(/\s+/g, '_'),
            (name: string): string => name.replace(/\s+/g, '-'),
            (name: string): string => name.replace(/[^a-zA-Z0-9]/g, '')
        ];

        for (const convention of conventions) {
            if (variations.length >= maxVariations) break;

            const newName = convention(baseName);
            if (newName && newName !== baseName) {
                const variation = parent ? `${parent}/${newName}` : newName;
                if (!variations.includes(variation)) {
                    variations.push(variation);
                }
            }
        }

        return variations;
    }

    /**
     * Filters suggestions by type constraints
     */
    private filterSuggestionsByType(
        suggestions: string[],
        typeDefinition: ResourceTypeDefinition,
        _categoryId?: string
    ): string[] {
        // This would be enhanced with actual type pattern matching
        return suggestions.filter(suggestion => {
            // Basic filtering - would be enhanced with proper pattern matching
            if (typeDefinition.patterns) {
                return typeDefinition.patterns.some(pattern => {
                    return suggestion.includes(pattern.primaryFile) || pattern.pattern.includes('**');
                });
            }
            return true;
        });
    }

    /**
     * Merges configuration objects
     */
    private mergeConfig(base: PathValidationConfig, override?: Partial<PathValidationConfig>): PathValidationConfig {
        if (!override) return { ...base };

        return {
            ...base,
            ...override,
            rules: {
                ...base.rules,
                ...(override.rules || {})
            },
            reservedNames: override.reservedNames || base.reservedNames,
            invalidCharacters: override.invalidCharacters || base.invalidCharacters
        };
    }

    /**
     * Loads configuration from workspace
     */
    private loadWorkspaceConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.validation.paths');
        this.config = this.mergeConfig(this.config, config as Partial<PathValidationConfig>);
    }

    /**
     * String representation for debugging
     */
    toString(): string {
        return `PathValidator(maxDepth: ${this.config.maxDepth}, rules: ${Object.keys(this.config.rules).length})`;
    }
}
