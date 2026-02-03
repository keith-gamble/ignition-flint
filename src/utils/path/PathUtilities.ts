/**
 * @module PathUtilities
 * @description Enhanced path utilities with service lifecycle support
 */

import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Path normalization options
 */
export interface PathNormalizationOptions {
    readonly preserveCase: boolean;
    readonly allowBackslashes: boolean;
    readonly maxDepth: number;
    readonly allowedExtensions?: readonly string[];
}

/**
 * Path validation result
 */
export interface PathValidationResult {
    readonly isValid: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly normalizedPath?: string;
}

/**
 * Path parsing result
 */
export interface ParsedResourcePath {
    readonly fullPath: string;
    readonly segments: readonly string[];
    readonly extension: string;
    readonly name: string;
    readonly parent: string | null;
    readonly depth: number;
    readonly isAbsolute: boolean;
}

/**
 * Enhanced path utilities with service lifecycle support
 * Provides comprehensive path manipulation, validation, and normalization
 */
export class PathUtilities implements IServiceLifecycle {
    private static readonly DEFAULT_OPTIONS: PathNormalizationOptions = {
        preserveCase: false,
        allowBackslashes: false,
        maxDepth: 10,
        allowedExtensions: ['.py', '.sql', '.json', '.xml', '.txt', '.js', '.ts', '.html', '.css']
    };

    private static readonly INVALID_PATH_CHARS = /[<>:"|?*]/;
    private static readonly RESERVED_NAMES = new Set([
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
        'LPT9'
    ]);

    private isInitialized = false;
    private options: PathNormalizationOptions;

    constructor(
        private readonly serviceContainer?: ServiceContainer,
        options?: Partial<PathNormalizationOptions>
    ) {
        this.options = { ...PathUtilities.DEFAULT_OPTIONS, ...options };
    }

    async initialize(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        try {
            // Load configuration from workspace settings if available
            this.loadConfiguration();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize path utilities',
                'PATH_UTILITIES_INIT_FAILED',
                'Path utilities could not start properly',
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

    // ============================================================================
    // PATH NORMALIZATION
    // ============================================================================

    /**
     * Normalizes a path with comprehensive options
     */
    normalize(inputPath: string, options?: Partial<PathNormalizationOptions>): string {
        const opts = { ...this.options, ...options };

        if (!inputPath || typeof inputPath !== 'string') {
            return '';
        }

        let normalized = inputPath.trim();

        // Handle case sensitivity
        if (!opts.preserveCase) {
            normalized = normalized.toLowerCase();
        }

        // Handle backslashes
        if (!opts.allowBackslashes) {
            normalized = normalized.replace(/\\/g, '/');
        }

        // Remove leading/trailing slashes
        normalized = normalized.replace(/^[/\\]+|[/\\]+$/g, '');

        // Normalize multiple consecutive slashes
        normalized = normalized.replace(/[/\\]+/g, '/');

        // Remove current directory references
        normalized = normalized.replace(/\/\.\//g, '/');
        normalized = normalized.replace(/^\.\//, '');

        // Handle parent directory references (simple implementation)
        const segments = normalized.split('/');
        const cleanSegments = [];
        for (const segment of segments) {
            if (segment === '..') {
                if (cleanSegments.length > 0 && cleanSegments[cleanSegments.length - 1] !== '..') {
                    cleanSegments.pop();
                }
            } else if (segment && segment !== '.') {
                cleanSegments.push(segment);
            }
        }

        return cleanSegments.join('/');
    }

    /**
     * Joins path segments with normalization
     */
    join(...segments: string[]): string {
        const validSegments = segments.filter(segment => segment && typeof segment === 'string' && segment.trim());

        if (validSegments.length === 0) {
            return '';
        }

        const joined = validSegments.join('/');
        return this.normalize(joined);
    }

    /**
     * Creates a relative path from base to target
     */
    relative(basePath: string, targetPath: string): string {
        const normalizedBase = this.normalize(basePath);
        const normalizedTarget = this.normalize(targetPath);

        if (normalizedBase === normalizedTarget) {
            return '';
        }

        const baseSegments = normalizedBase ? normalizedBase.split('/') : [];
        const targetSegments = normalizedTarget ? normalizedTarget.split('/') : [];

        // Find common prefix
        let commonLength = 0;
        const minLength = Math.min(baseSegments.length, targetSegments.length);

        for (let i = 0; i < minLength; i++) {
            if (baseSegments[i] === targetSegments[i]) {
                commonLength++;
            } else {
                break;
            }
        }

        // Build relative path
        const upSegments = baseSegments.slice(commonLength).map(() => '..');
        const downSegments = targetSegments.slice(commonLength);

        return [...upSegments, ...downSegments].join('/') || '.';
    }

    // ============================================================================
    // PATH PARSING AND ANALYSIS
    // ============================================================================

    /**
     * Parses a path into its components
     */
    parse(inputPath: string): ParsedResourcePath {
        const normalized = this.normalize(inputPath);
        const segments = normalized ? normalized.split('/') : [];
        const name = segments.length > 0 ? segments[segments.length - 1] : '';
        const extension = path.extname(name);
        const parent = segments.length > 1 ? segments.slice(0, -1).join('/') : null;

        return {
            fullPath: normalized,
            segments,
            extension,
            name,
            parent,
            depth: segments.length,
            isAbsolute: inputPath.startsWith('/') || /^[a-zA-Z]:/.test(inputPath)
        };
    }

    /**
     * Gets the parent path
     */
    getParent(inputPath: string): string | null {
        const parsed = this.parse(inputPath);
        return parsed.parent;
    }

    /**
     * Gets the name (last segment) of a path
     */
    getName(inputPath: string): string {
        const parsed = this.parse(inputPath);
        return parsed.name;
    }

    /**
     * Gets the extension of a path
     */
    getExtension(inputPath: string): string {
        const parsed = this.parse(inputPath);
        return parsed.extension;
    }

    /**
     * Gets the depth (number of segments) of a path
     */
    getDepth(inputPath: string): number {
        const parsed = this.parse(inputPath);
        return parsed.depth;
    }

    // ============================================================================
    // PATH RELATIONSHIPS
    // ============================================================================

    /**
     * Checks if one path is a subpath of another
     */
    isSubPath(childPath: string, parentPath: string): boolean {
        const normalizedChild = this.normalize(childPath);
        const normalizedParent = this.normalize(parentPath);

        if (!normalizedChild || !normalizedParent) {
            return false;
        }

        if (normalizedChild === normalizedParent) {
            return true;
        }

        return normalizedChild.startsWith(`${normalizedParent}/`);
    }

    /**
     * Checks if paths are siblings (same parent)
     */
    areSiblings(path1: string, path2: string): boolean {
        const parent1 = this.getParent(path1);
        const parent2 = this.getParent(path2);

        return parent1 !== null && parent2 !== null && parent1 === parent2;
    }

    /**
     * Gets the common ancestor path of multiple paths
     */
    getCommonAncestor(...paths: string[]): string | null {
        if (paths.length === 0) return null;
        if (paths.length === 1) return this.getParent(paths[0]);

        const normalizedPaths = paths.map(p => this.normalize(p));
        const segmentLists = normalizedPaths.map(p => (p ? p.split('/') : []));

        if (segmentLists.some(segments => segments.length === 0)) {
            return null;
        }

        const minLength = Math.min(...segmentLists.map(segments => segments.length));
        const commonSegments: string[] = [];

        for (let i = 0; i < minLength; i++) {
            const segment = segmentLists[0][i];
            if (segmentLists.every(segments => segments[i] === segment)) {
                commonSegments.push(segment);
            } else {
                break;
            }
        }

        return commonSegments.length > 0 ? commonSegments.join('/') : null;
    }

    // ============================================================================
    // VALIDATION
    // ============================================================================

    /**
     * Validates a path with comprehensive checks
     */
    validate(inputPath: string, options?: Partial<PathNormalizationOptions>): PathValidationResult {
        const opts = { ...this.options, ...options };
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!inputPath || typeof inputPath !== 'string') {
            errors.push('Path cannot be empty or null');
            return { isValid: false, errors, warnings };
        }

        const trimmed = inputPath.trim();
        if (trimmed.length === 0) {
            errors.push('Path cannot be empty after trimming');
            return { isValid: false, errors, warnings };
        }

        // Check for invalid characters
        if (PathUtilities.INVALID_PATH_CHARS.test(trimmed)) {
            errors.push('Path contains invalid characters');
        }

        // Check for reserved names
        const segments = trimmed.split(/[/\\]/);
        for (const segment of segments) {
            if (segment && PathUtilities.RESERVED_NAMES.has(segment.toUpperCase())) {
                errors.push(`Path contains reserved name: ${segment}`);
            }
        }

        // Check depth
        const normalized = this.normalize(trimmed, opts);
        const depth = this.getDepth(normalized);
        if (depth > opts.maxDepth) {
            errors.push(`Path depth (${depth}) exceeds maximum (${opts.maxDepth})`);
        }

        // Check extension if restricted
        if (opts.allowedExtensions) {
            const extension = this.getExtension(normalized);
            if (extension && !opts.allowedExtensions.includes(extension)) {
                warnings.push(`Extension ${extension} is not in allowed list`);
            }
        }

        // Check for potential issues
        if (normalized.includes('..')) {
            warnings.push('Path contains parent directory references');
        }

        if (normalized.startsWith('.')) {
            warnings.push('Path starts with hidden file/directory marker');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            normalizedPath: normalized
        };
    }

    /**
     * Validates a resource name (final segment)
     */
    validateName(name: string): PathValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!name || typeof name !== 'string') {
            errors.push('Name cannot be empty or null');
            return { isValid: false, errors, warnings };
        }

        const trimmed = name.trim();
        if (trimmed.length === 0) {
            errors.push('Name cannot be empty after trimming');
            return { isValid: false, errors, warnings };
        }

        // Check for path separators
        if (trimmed.includes('/') || trimmed.includes('\\')) {
            errors.push('Name cannot contain path separators');
        }

        // Check for invalid characters
        if (PathUtilities.INVALID_PATH_CHARS.test(trimmed)) {
            errors.push('Name contains invalid characters');
        }

        // Check for reserved names
        if (PathUtilities.RESERVED_NAMES.has(trimmed.toUpperCase())) {
            errors.push(`Name is reserved: ${trimmed}`);
        }

        // Check length
        if (trimmed.length > 255) {
            errors.push('Name is too long (maximum 255 characters)');
        }

        // Check for potentially problematic patterns
        if (trimmed.startsWith('.')) {
            warnings.push('Name starts with dot (hidden file/directory)');
        }

        if (trimmed.endsWith('.')) {
            warnings.push('Name ends with dot');
        }

        if (trimmed.includes('  ')) {
            warnings.push('Name contains multiple consecutive spaces');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            normalizedPath: trimmed
        };
    }

    // ============================================================================
    // CONFIGURATION
    // ============================================================================

    /**
     * Updates configuration options
     */
    updateConfiguration(newOptions: Partial<PathNormalizationOptions>): void {
        this.options = { ...this.options, ...newOptions };
    }

    /**
     * Gets current configuration
     */
    getConfiguration(): Readonly<PathNormalizationOptions> {
        return Object.freeze({ ...this.options });
    }

    /**
     * String representation for debugging
     */
    toString(): string {
        return `PathUtilities(preserveCase: ${this.options.preserveCase}, maxDepth: ${this.options.maxDepth})`;
    }

    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================

    /**
     * Loads configuration from workspace settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.paths');
        this.options = { ...this.options, ...(config as Partial<PathNormalizationOptions>) };
    }
}
