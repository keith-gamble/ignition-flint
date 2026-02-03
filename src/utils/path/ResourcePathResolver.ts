/**
 * @module ResourcePathResolver
 * @description Advanced resource path resolution with type-aware operations
 * Enhanced from ResourcePathHelper with service architecture
 */

import { PathUtilities } from './PathUtilities';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ProjectResource, ResourceOrigin } from '@/core/types/models';
import { ResourceTypeDefinition } from '@/core/types/resources';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';

/**
 * Resource path context for resolution
 */
export interface ResourcePathContext {
    readonly projectId: string;
    readonly typeId: string;
    readonly categoryId?: string;
    readonly basePath?: string;
}

/**
 * Resource key parsing result
 */
export interface ParsedResourceKey {
    readonly typeId: string;
    readonly categoryId?: string;
    readonly resourcePath: string;
    readonly fullKey: string;
}

/**
 * Display path configuration
 */
export interface DisplayPathConfig {
    readonly delimiter: string;
    readonly showType: boolean;
    readonly showCategory: boolean;
    readonly maxLength?: number;
    readonly truncateFrom: 'start' | 'middle' | 'end';
}

/**
 * Resource location information
 */
export interface ResourceLocation {
    readonly projectPath: string;
    readonly resourcePath: string;
    readonly fullPath: string;
    readonly relativePath: string;
    readonly basePath: string;
    readonly exists: boolean;
}

/**
 * Advanced resource path resolver with type awareness and service lifecycle
 * Handles complex resource path operations including key parsing, display formatting,
 * and file system resolution
 */
export class ResourcePathResolver implements IServiceLifecycle {
    private static readonly DEFAULT_DISPLAY_CONFIG: DisplayPathConfig = {
        delimiter: '/',
        showType: false,
        showCategory: false,
        maxLength: 100,
        truncateFrom: 'middle'
    };

    private isInitialized = false;
    private pathUtilities!: PathUtilities;

    constructor(private readonly serviceContainer?: ServiceContainer) {}

    async initialize(): Promise<void> {
        try {
            this.pathUtilities = new PathUtilities(this.serviceContainer);
            await this.pathUtilities.initialize();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize resource path resolver',
                'RESOURCE_PATH_RESOLVER_INIT_FAILED',
                'Resource path resolver could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
        await this.pathUtilities.start();
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
    // RESOURCE KEY OPERATIONS
    // ============================================================================

    /**
     * Builds a unique resource key for storage and identification
     */
    buildResourceKey(context: ResourcePathContext, resourcePath: string): string {
        const normalizedPath = this.pathUtilities.normalize(resourcePath);

        if (context.categoryId) {
            return `${context.typeId}:${context.categoryId}/${normalizedPath}`;
        }

        return `${context.typeId}:${normalizedPath}`;
    }

    /**
     * Parses a resource key into its components
     */
    parseResourceKey(resourceKey: string): ParsedResourceKey {
        const [typeId, pathPart = ''] = resourceKey.split(':', 2);

        if (!pathPart) {
            return {
                typeId,
                resourcePath: resourceKey,
                fullKey: resourceKey
            };
        }

        // Check if path part contains category
        if (pathPart.includes('/')) {
            const firstSlash = pathPart.indexOf('/');
            const potentialCategory = pathPart.substring(0, firstSlash);
            const remainingPath = pathPart.substring(firstSlash + 1);

            // Simple heuristic: categories typically don't contain file extensions
            if (!potentialCategory.includes('.') && remainingPath.length > 0) {
                return {
                    typeId,
                    categoryId: potentialCategory,
                    resourcePath: remainingPath,
                    fullKey: resourceKey
                };
            }
        }

        return {
            typeId,
            resourcePath: pathPart,
            fullKey: resourceKey
        };
    }

    /**
     * Extracts the clean resource path from a key
     */
    extractResourcePath(resourceKey: string): string {
        const parsed = this.parseResourceKey(resourceKey);
        return parsed.resourcePath;
    }

    /**
     * Extracts the type ID from a resource key
     */
    extractTypeId(resourceKey: string): string {
        const parsed = this.parseResourceKey(resourceKey);
        return parsed.typeId;
    }

    /**
     * Extracts the category ID from a resource key
     */
    extractCategoryId(resourceKey: string): string | undefined {
        const parsed = this.parseResourceKey(resourceKey);
        return parsed.categoryId;
    }

    // ============================================================================
    // PATH RESOLUTION AND LOCATION
    // ============================================================================

    /**
     * Resolves a resource path to its file system location
     */
    resolveResourceLocation(
        context: ResourcePathContext,
        resourcePath: string,
        projectBasePath: string
    ): ResourceLocation {
        const normalizedPath = this.pathUtilities.normalize(resourcePath);

        // Build base path from type and category
        const basePath = this.getResourceBasePath(context, projectBasePath);

        // Combine with resource path
        const fullPath = this.pathUtilities.join(projectBasePath, basePath, normalizedPath);
        const relativePath = this.pathUtilities.join(basePath, normalizedPath);

        return {
            projectPath: projectBasePath,
            resourcePath: normalizedPath,
            fullPath,
            relativePath,
            basePath,
            exists: false // This would be determined by file system check
        };
    }

    /**
     * Gets the base path for a resource type and category
     */
    getResourceBasePath(context: ResourcePathContext, projectBasePath?: string): string {
        if (context.basePath) {
            return this.pathUtilities.normalize(context.basePath);
        }

        // Build from type ID - this would integrate with ResourceTypeRegistry
        // For now, use a simple mapping
        const typeBasePath = this.getTypeBasePath(context.typeId, context.categoryId);

        return projectBasePath ? this.pathUtilities.join(projectBasePath, typeBasePath) : typeBasePath;
    }

    /**
     * Gets all directory paths for a resource type from the provider registry
     */
    getDirectoryPathsForResourceType(resourceTypeId: string): string[] {
        try {
            if (!this.serviceContainer) {
                throw new FlintError(
                    `Cannot get directory paths for resource type '${resourceTypeId}' - ServiceContainer is unavailable`,
                    'SERVICE_CONTAINER_UNAVAILABLE'
                );
            }

            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (!providerRegistry) {
                throw new FlintError(
                    `Cannot get directory paths for resource type '${resourceTypeId}' - ResourceTypeProviderRegistry is unavailable`,
                    'RESOURCE_PROVIDER_REGISTRY_UNAVAILABLE'
                );
            }

            const provider = providerRegistry.getProvider(resourceTypeId);
            if (!provider) {
                throw new FlintError(
                    `No provider found for resource type '${resourceTypeId}'`,
                    'RESOURCE_PROVIDER_NOT_FOUND'
                );
            }

            // Get paths directly from provider's search configuration
            const searchConfig = provider.getSearchConfig();

            if (searchConfig.directoryPaths && searchConfig.directoryPaths.length > 0) {
                return Array.from(searchConfig.directoryPaths);
            }

            // If provider doesn't define directory paths, return empty array
            console.warn(`Provider for resource type '${resourceTypeId}' does not define directory paths`);
            return [];
        } catch (error) {
            console.error(`Failed to get directory paths from provider registry for ${resourceTypeId}:`, error);
            throw new FlintError(
                `Cannot get directory paths for resource type '${resourceTypeId}' - ResourceTypeProviderRegistry failed`,
                'RESOURCE_PROVIDER_REGISTRY_FAILED',
                'Unable to determine resource paths',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Resolves relative paths within a resource context
     */
    resolveRelativePath(basePath: string, relativePath: string, _context: ResourcePathContext): string {
        const normalizedBase = this.pathUtilities.normalize(basePath);
        const normalizedRelative = this.pathUtilities.normalize(relativePath);

        if (this.pathUtilities.parse(normalizedRelative).isAbsolute) {
            return normalizedRelative;
        }

        return this.pathUtilities.join(normalizedBase, normalizedRelative);
    }

    // ============================================================================
    // DISPLAY FORMATTING
    // ============================================================================

    /**
     * Formats a resource path for display with type-aware options
     */
    formatDisplayPath(
        resourcePath: string,
        typeDefinition?: ResourceTypeDefinition,
        config?: Partial<DisplayPathConfig>
    ): string {
        const displayConfig = { ...ResourcePathResolver.DEFAULT_DISPLAY_CONFIG, ...config };
        const normalizedPath = this.pathUtilities.normalize(resourcePath);

        let displayPath = normalizedPath;

        // Apply type-specific formatting
        if (typeDefinition?.displayNameTransform) {
            try {
                displayPath = typeDefinition.displayNameTransform(displayPath);
            } catch (error) {
                console.warn(`Display transform failed for ${displayPath}:`, error);
            }
        }

        // Apply delimiter transformation
        if (displayConfig.delimiter !== '/') {
            displayPath = displayPath.replace(/\//g, displayConfig.delimiter);
        }

        // Apply length truncation
        if (displayConfig.maxLength && displayPath.length > displayConfig.maxLength) {
            displayPath = this.truncateDisplayPath(displayPath, displayConfig);
        }

        // Add type/category prefixes if requested
        if (displayConfig.showType && typeDefinition) {
            const prefix = this.buildDisplayPrefix(typeDefinition, displayConfig);
            if (prefix) {
                displayPath = `${prefix}${displayConfig.delimiter}${displayPath}`;
            }
        }

        return displayPath;
    }

    /**
     * Gets display name for a resource
     */
    getResourceDisplayName(
        resourcePath: string,
        typeDefinition?: ResourceTypeDefinition,
        isFolder: boolean = false
    ): string {
        if (isFolder) {
            return this.pathUtilities.getName(resourcePath);
        }

        const displayPath = this.formatDisplayPath(resourcePath, typeDefinition, {
            delimiter: typeDefinition?.pathDelimiter || '/',
            showType: false,
            showCategory: false
        });

        return this.pathUtilities.getName(displayPath);
    }

    /**
     * Gets display name for a category
     */
    getCategoryDisplayName(typeDefinition: ResourceTypeDefinition, categoryId?: string): string {
        if (categoryId && typeDefinition.categories?.[categoryId]) {
            const category = typeDefinition.categories[categoryId];
            return category.singularName || category.name;
        }

        return typeDefinition.singularName || typeDefinition.name;
    }

    // ============================================================================
    // PATH MANIPULATION
    // ============================================================================

    /**
     * Adds category prefix to a resource path
     */
    addCategoryPrefix(resourcePath: string, categoryId: string): string {
        const normalized = this.pathUtilities.normalize(resourcePath);
        return this.pathUtilities.join(categoryId, normalized);
    }

    /**
     * Removes category prefix from a resource path
     */
    removeCategoryPrefix(resourcePath: string, categoryId: string): string {
        const normalized = this.pathUtilities.normalize(resourcePath);
        const prefix = `${categoryId}/`;

        if (normalized.startsWith(prefix)) {
            return normalized.substring(prefix.length);
        }

        return normalized;
    }

    /**
     * Transforms a path for a specific resource type
     */
    transformPathForType(
        resourcePath: string,
        _sourceTypeId: string,
        _targetTypeId: string,
        _typeDefinitions?: Map<string, ResourceTypeDefinition>
    ): string {
        // This would integrate with ResourceTypeRegistry to get type definitions
        // For now, return the normalized path
        return this.pathUtilities.normalize(resourcePath);
    }

    // ============================================================================
    // RESOURCE METADATA
    // ============================================================================

    /**
     * Generates a comprehensive tooltip for a resource
     */
    generateResourceTooltip(resource: ProjectResource, typeDefinition?: ResourceTypeDefinition): string {
        const parts: string[] = [];

        // Basic info
        parts.push(`Path: ${resource.path}`);
        parts.push(`Type: ${resource.type}`);

        if (typeDefinition) {
            // Note: category info would be extracted from context or metadata
            if (typeDefinition) {
                parts.push(`Type: ${this.getCategoryDisplayName(typeDefinition)}`);
            }
        }

        // Origin info
        if (resource.origin === ResourceOrigin.INHERITED) {
            parts.push(`Inherited from: ${resource.sourceProject || 'parent project'}`);
        } else {
            parts.push('Origin: Local');
        }

        // Files info
        if (resource.files && resource.files.length > 0) {
            const fileNames = resource.files.map(f => f.name).join(', ');
            parts.push(`Files (${resource.files.length}): ${fileNames}`);
        } else if (resource.metadata?.isFolder) {
            parts.push('Type: Folder');
        }

        // Metadata
        if (resource.metadata) {
            const metadata = resource.metadata;
            const lastModified = metadata.lastModified as Date | number | undefined;
            const size = metadata.size as number | undefined;

            if (lastModified) {
                const date = typeof lastModified === 'number' ? new Date(lastModified) : lastModified;
                parts.push(`Modified: ${date.toLocaleString()}`);
            }
            if (size !== undefined) {
                parts.push(`Size: ${this.formatFileSize(size)}`);
            }
        }

        return parts.join('\n');
    }

    /**
     * Builds a unique node ID for tree structures
     */
    buildNodeId(
        nodeType: 'folder' | 'resource' | 'category' | 'type',
        context: ResourcePathContext,
        resourcePath: string
    ): string {
        const normalizedPath = this.pathUtilities.normalize(resourcePath);
        const categoryPart = context.categoryId || 'none';
        const fullPath = context.categoryId
            ? this.pathUtilities.join(context.categoryId, normalizedPath)
            : normalizedPath;

        return `${nodeType}::${context.projectId}::${context.typeId}::${categoryPart}::${fullPath}`;
    }

    // ============================================================================
    // VALIDATION WITH TYPE AWARENESS
    // ============================================================================

    /**
     * Validates a resource path within a specific type context
     */
    validateResourcePath(
        resourcePath: string,
        context: ResourcePathContext,
        typeDefinition?: ResourceTypeDefinition
    ): { isValid: boolean; errors: string[]; warnings: string[] } {
        const baseValidation = this.pathUtilities.validate(resourcePath);
        const errors = [...baseValidation.errors];
        const warnings = [...baseValidation.warnings];

        // Type-specific validation
        if (typeDefinition) {
            // Check against allowed patterns
            if (typeDefinition.patterns) {
                const matchesPattern = typeDefinition.patterns.some(pattern => {
                    // Simplified pattern matching - would be enhanced with proper glob matching
                    const pathPattern = pattern.pattern.replace('**/', '').replace('*', '');
                    return resourcePath.includes(pathPattern) || resourcePath.endsWith(pattern.primaryFile);
                });

                if (!matchesPattern) {
                    warnings.push(`Path may not match type patterns for ${typeDefinition.name}`);
                }
            }

            // Check category constraints
            if (context.categoryId && typeDefinition.categories) {
                if (!typeDefinition.categories[context.categoryId]) {
                    errors.push(`Invalid category ${context.categoryId} for type ${typeDefinition.name}`);
                }
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================

    /**
     * Gets base path for a resource type using ResourceTypeProviderRegistry
     */
    private getTypeBasePath(typeId: string, categoryId?: string): string {
        if (!this.serviceContainer) {
            throw new FlintError(
                `Cannot get base path for resource type '${typeId}' - ServiceContainer is unavailable`,
                'SERVICE_CONTAINER_UNAVAILABLE'
            );
        }

        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

        if (!providerRegistry) {
            throw new FlintError(
                `Cannot get base path for resource type '${typeId}' - ResourceTypeProviderRegistry is unavailable`,
                'RESOURCE_PROVIDER_REGISTRY_UNAVAILABLE'
            );
        }

        const provider = providerRegistry.getProvider(typeId);
        if (!provider) {
            throw new FlintError(`No provider found for resource type '${typeId}'`, 'RESOURCE_TYPE_PROVIDER_NOT_FOUND');
        }

        const searchConfig = provider.getSearchConfig();
        if (!searchConfig.directoryPaths || searchConfig.directoryPaths.length === 0) {
            throw new FlintError(
                `Provider for resource type '${typeId}' does not define directory paths`,
                'PROVIDER_MISSING_DIRECTORY_PATHS'
            );
        }

        // Use the first directory path as base path
        const basePath = searchConfig.directoryPaths[0];
        return categoryId ? this.pathUtilities.join(basePath, categoryId) : basePath;
    }

    /**
     * Truncates display path according to configuration
     */
    private truncateDisplayPath(displayPath: string, config: DisplayPathConfig): string {
        const maxLength = config.maxLength!;

        if (displayPath.length <= maxLength) {
            return displayPath;
        }

        const ellipsis = '...';
        const availableLength = maxLength - ellipsis.length;

        switch (config.truncateFrom) {
            case 'start':
                return ellipsis + displayPath.slice(-availableLength);

            case 'end':
                return displayPath.slice(0, availableLength) + ellipsis;

            case 'middle':
            default: {
                const half = Math.floor(availableLength / 2);
                const start = displayPath.slice(0, half);
                const end = displayPath.slice(-(availableLength - half));
                return start + ellipsis + end;
            }
        }
    }

    /**
     * Builds display prefix for type/category
     */
    private buildDisplayPrefix(typeDefinition: ResourceTypeDefinition, config: DisplayPathConfig): string {
        const parts: string[] = [];

        if (config.showType) {
            parts.push(typeDefinition.singularName || typeDefinition.name);
        }

        // Category would be added here if showCategory is true

        return parts.join(config.delimiter);
    }

    /**
     * Formats file size for display
     */
    private formatFileSize(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    }

    /**
     * String representation for debugging
     */
    toString(): string {
        return `ResourcePathResolver(status: ${this.getStatus()})`;
    }
}
