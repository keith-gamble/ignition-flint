/**
 * @module ResourceTypes
 * @description Resource type definitions and related interfaces
 * Core types for Ignition resource management
 */

/**
 * Pattern for matching resource files
 */
export interface ResourcePattern {
    /** Glob pattern for matching files */
    readonly pattern: string;
    /** Primary file within the resource */
    readonly primaryFile: string;
    /** Optional path transformation function */
    readonly pathTransform?: (fullPath: string) => string;
}

/**
 * Category within a resource type
 */
export interface ResourceCategory {
    /** Unique category identifier */
    readonly id: string;
    /** Display name for category */
    readonly displayName: string;
    /** Category name */
    readonly name: string;
    /** Singular form of category name */
    readonly singularName?: string;
    /** Plural form of category name */
    readonly pluralName?: string;
    /** Icon identifier for category */
    readonly icon: string;
    /** Sort order for category */
    readonly sortOrder: number;
    /** File patterns that belong to this category */
    readonly patterns: readonly ResourcePattern[];
    /** Category description */
    readonly description?: string;
}

/**
 * Complete resource type definition
 */
export interface ResourceTypeDefinition {
    /** Unique resource type identifier */
    readonly id: string;
    /** Display name for resource type */
    readonly name: string;
    /** Singular form of resource type name */
    readonly singularName?: string;
    /** Plural form of resource type name */
    readonly pluralName?: string;
    /** Icon identifier for resource type */
    readonly icon: string;
    /** Sort order for display */
    readonly sortOrder?: number;
    /** Resource type description */
    readonly description?: string;
    /** File patterns for resources without categories */
    readonly patterns?: readonly ResourcePattern[];
    /** Path delimiter for resource paths (default: '/') */
    readonly pathDelimiter?: string;
    /** Categories within this resource type */
    readonly categories?: Readonly<Record<string, ResourceCategory>>;
    /** Whether resources of this type are searchable */
    readonly searchable?: boolean;
    /** Whether text search is supported */
    readonly supportsTextSearch?: boolean;
    /** Function to transform path for display */
    readonly displayNameTransform?: (path: string) => string;
    /** Whether this is an internal resource type */
    readonly internal?: boolean;
    /** Custom configuration for resource type */
    readonly customConfig?: Readonly<Record<string, unknown>>;
    /** Available templates for creating resources */
    readonly templates?: readonly ResourceTemplate[];
    /** Editor configuration for this resource type */
    readonly editorConfig?: ResourceEditorConfig;
}

/**
 * Template for creating new resources
 */
export interface ResourceTemplate {
    /** Template identifier */
    readonly id: string;
    /** Template display name */
    readonly name: string;
    /** Resource type this template is for */
    readonly resourceTypeId: string;
    /** Template description */
    readonly description?: string;
    /** Files to create from template */
    readonly files: Readonly<Record<string, string>>;
    /** Additional template metadata */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Editor configuration for resource type
 */
export interface ResourceEditorConfig {
    /** Type of editor to use */
    readonly editorType: 'text' | 'json' | 'binary' | 'custom';
    /** Pattern to match files this editor can handle */
    readonly canHandlePattern: RegExp;
    /** Command to execute for custom editors */
    readonly editorCommand?: string;
    /** Additional editor options */
    readonly options?: Readonly<Record<string, unknown>>;
}

/**
 * Resource provider interface for scanning and managing resources
 */
export interface ResourceProvider {
    /**
     * Scans project path for resources
     * @param projectPath - Path to project directory
     * @returns Array of discovered resources
     */
    scanResources(projectPath: string): Promise<readonly ResourceScanResult[]>;

    /**
     * Gets display path for resource
     * @param resourcePath - Full resource path
     * @returns Display-friendly path
     */
    getDisplayPath(resourcePath: string): string;

    /**
     * Gets primary file from resource files
     * @param files - Array of files in resource
     * @returns Path to primary file or undefined
     */
    getPrimaryFile(files: readonly ResourceFileInfo[]): string | undefined;
}

/**
 * Result of resource scan operation
 */
export interface ResourceScanResult {
    /** Resource path relative to project */
    readonly path: string;
    /** Files that make up this resource */
    readonly files: readonly ResourceFileInfo[];
    /** Resource type identifier */
    readonly typeId?: string;
    /** Resource category identifier */
    readonly categoryId?: string;
    /** Additional metadata discovered during scan */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * File information from resource scan
 */
export interface ResourceFileInfo {
    /** File name */
    readonly name: string;
    /** Full file system path */
    readonly path: string;
    /** File size in bytes */
    readonly size?: number;
    /** Last modification timestamp */
    readonly lastModified?: Date;
    /** File content type/MIME type if known */
    readonly contentType?: string;
}

/**
 * Resource editor interface
 */
export interface ResourceEditor {
    /**
     * Checks if this editor can handle the resource
     * @param resourcePath - Path to resource
     * @param files - Files in the resource
     * @returns True if editor can handle resource
     */
    canHandle(resourcePath: string, files: readonly ResourceFileInfo[]): boolean;

    /**
     * Opens resource in editor
     * @param resourcePath - Path to resource
     * @param files - Files in the resource
     */
    open(resourcePath: string, files: readonly ResourceFileInfo[]): Promise<void>;

    /**
     * Gets title for editor tab
     * @param resourcePath - Path to resource
     * @returns Editor title
     */
    getEditorTitle?(resourcePath: string): string;
}

/**
 * Resource operations interface
 */
export interface ResourceOperations {
    /**
     * Creates a new resource
     * @param projectPath - Path to project
     * @param resourcePath - Path for new resource
     * @param templateData - Template data for creation
     */
    create(projectPath: string, resourcePath: string, templateData?: unknown): Promise<void>;

    /**
     * Deletes a resource
     * @param projectPath - Path to project
     * @param resourcePath - Path to resource
     * @param isFolder - Whether resource is a folder
     */
    delete(projectPath: string, resourcePath: string, isFolder?: boolean): Promise<void>;

    /**
     * Copies a resource
     * @param sourceProjectPath - Source project path
     * @param sourceResourcePath - Source resource path
     * @param targetProjectPath - Target project path
     * @param targetResourcePath - Target resource path
     * @param isFolder - Whether resource is a folder
     */
    copy(
        sourceProjectPath: string,
        sourceResourcePath: string,
        targetProjectPath: string,
        targetResourcePath: string,
        isFolder?: boolean
    ): Promise<void>;

    /**
     * Renames a resource
     * @param projectPath - Path to project
     * @param oldPath - Current resource path
     * @param newPath - New resource path
     * @param isFolder - Whether resource is a folder
     */
    rename(projectPath: string, oldPath: string, newPath: string, isFolder?: boolean): Promise<void>;

    /** Whether create operation is supported */
    canCreate(): boolean;

    /** Whether delete operation is supported */
    canDelete(): boolean;

    /** Whether copy operation is supported */
    canCopy(): boolean;

    /** Whether rename operation is supported */
    canRename(): boolean;

    /**
     * Gets available templates for resource creation
     * @returns Array of available templates
     */
    getTemplates?(): Promise<readonly ResourceTemplate[]>;
}

/**
 * Resource search provider interface
 */
export interface ResourceSearchProvider {
    /**
     * Searches for resources
     * @param query - Search query
     * @param options - Search options
     * @returns Array of search results
     */
    search(query: string, options?: ResourceSearchOptions): Promise<readonly ResourceSearchResult[]>;

    /**
     * Whether text search within resources is supported
     * @returns True if text search is supported
     */
    supportsTextSearch(): boolean;

    /**
     * Gets available search filters
     * @returns Array of search filters
     */
    getSearchFilters?(): readonly ResourceSearchFilter[];
}

/**
 * Options for resource search
 */
export interface ResourceSearchOptions {
    /** Project IDs to search within */
    readonly projectIds?: readonly string[];
    /** Resource types to include */
    readonly resourceTypes?: readonly string[];
    /** Whether search is case sensitive */
    readonly caseSensitive?: boolean;
    /** Whether to use regex matching */
    readonly useRegex?: boolean;
    /** Whether to include inherited resources */
    readonly includeInherited?: boolean;
    /** Maximum number of results */
    readonly maxResults?: number;
    /** Search timeout in milliseconds */
    readonly timeoutMs?: number;
}

/**
 * Result of resource search
 */
export interface ResourceSearchResult {
    /** Resource path within project */
    readonly resourcePath: string;
    /** Project identifier where resource was found */
    readonly projectId: string;
    /** Resource type identifier */
    readonly resourceType: string;
    /** Display name for resource */
    readonly displayName: string;
    /** Search score/relevance (higher = more relevant) */
    readonly score?: number;
    /** Text matches within resource */
    readonly matches?: readonly ResourceSearchMatch[];
    /** Additional metadata */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Text match within resource search
 */
export interface ResourceSearchMatch {
    /** Line number of match */
    readonly line: number;
    /** Column number of match */
    readonly column: number;
    /** Matching text */
    readonly text: string;
    /** Surrounding context */
    readonly context?: string;
    /** File path where match was found */
    readonly filePath?: string;
}

/**
 * Search filter definition
 */
export interface ResourceSearchFilter {
    /** Filter identifier */
    readonly id: string;
    /** Filter display name */
    readonly name: string;
    /** Filter input type */
    readonly type: 'boolean' | 'select' | 'text' | 'number';
    /** Available options for select type */
    readonly options?: readonly FilterOption[];
    /** Default value */
    readonly defaultValue?: unknown;
    /** Filter description */
    readonly description?: string;
}

/**
 * Option for select-type filters
 */
export interface FilterOption {
    /** Option label */
    readonly label: string;
    /** Option value */
    readonly value: unknown;
    /** Option description */
    readonly description?: string;
}

/**
 * Resource validation result
 */
export interface ResourceValidationResult {
    /** Whether resource is valid */
    readonly isValid: boolean;
    /** Validation errors */
    readonly errors: readonly string[];
    /** Validation warnings */
    readonly warnings: readonly string[];
    /** Validation metadata */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Resource creation context
 */
export interface ResourceCreationContext {
    /** Project path where resource is being created */
    readonly projectPath: string;
    /** Resource path being created */
    readonly resourcePath: string;
    /** Resource type identifier */
    readonly typeId: string;
    /** Resource category identifier if applicable */
    readonly categoryId?: string;
    /** Selected template if any */
    readonly template?: ResourceTemplate;
    /** Additional creation options */
    readonly options?: Readonly<Record<string, unknown>>;
}

// Add missing types for compatibility
export type ResourceType = string;

export interface ProjectResource {
    readonly key: string;
    readonly name: string;
    readonly path: string;
    readonly type: string;
    readonly category: string;
    readonly projectPath: string;
    readonly isFolder: boolean;
    readonly lastModified: number;
    readonly size: number;
    readonly displayName?: string;
    readonly singleton?: boolean;
}
