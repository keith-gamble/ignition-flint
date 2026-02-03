/**
 * @module ResourceProviders
 * @description Resource type provider interfaces for extensible resource-specific behavior
 */

import { ResourceTemplate } from '@/core/types/resources';
import { ResourceValidationRule, ResourceValidationResult } from '@/core/types/validation';

/**
 * Content search configuration for a resource type
 */
export interface ResourceSearchConfig {
    /** Whether this resource type supports text content search */
    readonly supportsContentSearch: boolean;
    /** File extensions to include in content search */
    readonly searchableExtensions: readonly string[];
    /** Directory paths where this resource type can be found */
    readonly directoryPaths: readonly string[];
    /**
     * Category display name this resource type belongs to (e.g., 'Perspective', 'Vision'),
     * null for top-level resources
     */
    readonly category?: string | null;
    /** Icon name for the category (e.g., 'window', 'preview') */
    readonly categoryIcon?: string;
    /** Whether this resource type is a singleton (only one instance per project) */
    readonly isSingleton?: boolean;
    /** Maximum file size for content search (in bytes) */
    readonly maxSearchableFileSize?: number;
    /** Encoding to use when reading files for search */
    readonly searchEncoding?: string;
}

/**
 * Editor configuration for a resource type
 */
export interface ResourceEditorConfig {
    /** Editor type identifier */
    readonly editorType: 'text' | 'json' | 'binary' | 'custom';
    /** Priority for editor selection (higher = preferred) */
    readonly priority: number;
    /** Primary file to focus when opening resource (e.g., 'code.py', 'view.json') - REQUIRED */
    readonly primaryFile: string;
    /** Custom editor command if editorType is 'custom' */
    readonly customEditorCommand?: string;
    /** Additional editor options */
    readonly options?: Readonly<Record<string, unknown>>;
}

/**
 * Template generation configuration
 */
export interface ResourceTemplateConfig {
    /** Available templates for this resource type */
    readonly templates: readonly ResourceTemplate[];
    /** Default template ID to use when creating new resources */
    readonly defaultTemplateId?: string;
    /** Function to generate default content for new resources */
    readonly generateDefaultContent?: (templateId?: string, context?: any) => string;
}

/**
 * Resource type provider interface
 * Each resource type can have a dedicated provider that defines all its specific behavior
 */
export interface ResourceTypeProvider {
    /** Resource type ID this provider handles */
    readonly resourceTypeId: string;

    /** Display name for this provider */
    readonly displayName: string;

    /** Search configuration */
    getSearchConfig(): ResourceSearchConfig;

    /** Editor configuration */
    getEditorConfig(): ResourceEditorConfig;

    /** Validation rules specific to this resource type */
    getValidationRules(): readonly ResourceValidationRule[];

    /** Template configuration */
    getTemplateConfig(): ResourceTemplateConfig;

    /** Custom file operations if needed */
    createResource?(resourcePath: string, templateId?: string, context?: any): Promise<void>;

    /** Custom validation logic */
    validateResource?(resourcePath: string, content: string): Promise<ResourceValidationResult>;

    /** Custom search logic */
    searchContent?(query: string, options: any): Promise<any[]>;
}

/**
 * Abstract base class for resource type providers
 */
export abstract class BaseResourceTypeProvider implements ResourceTypeProvider {
    constructor(
        public readonly resourceTypeId: string,
        public readonly displayName: string
    ) {}

    abstract getSearchConfig(): ResourceSearchConfig;
    abstract getEditorConfig(): ResourceEditorConfig;
    abstract getValidationRules(): readonly ResourceValidationRule[];
    abstract getTemplateConfig(): ResourceTemplateConfig;

    /** Default implementation - can be overridden by specific providers */
    createResource(_resourcePath: string, _templateId?: string, _context?: any): Promise<void> {
        // Default implementation uses template system
        throw new Error(`Default resource creation not implemented for ${this.resourceTypeId}`);
    }

    /** Default implementation - can be overridden by specific providers */
    validateResource(_resourcePath: string, _content: string): Promise<ResourceValidationResult> {
        // Run standard validation rules
        return Promise.resolve({
            isValid: true,
            errors: [],
            warnings: [],
            info: [],
            summary: {
                totalIssues: 0,
                errorCount: 0,
                warningCount: 0,
                infoCount: 0
            }
        });
    }

    /** Default implementation - uses standard content search */
    searchContent(_query: string, _options: any): Promise<any[]> {
        // Default implementation delegates to standard search providers
        return Promise.resolve([]);
    }
}
