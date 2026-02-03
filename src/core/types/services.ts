/**
 * @module ServiceTypes
 * @description Service interface definitions for dependency injection
 * Defines contracts for all services in the Flint extension
 */

import type {
    IgnitionProject,
    GatewayConfig,
    GatewayStatus,
    FlintWorkspaceConfig,
    ResourceScanStats
} from '@/core/types/models';
import type {
    ResourceTypeDefinition,
    ResourceProvider,
    ResourceOperations,
    ResourceSearchOptions,
    ResourceSearchResult,
    ResourceValidationResult,
    ResourceCreationContext,
    ResourceTemplate
} from '@/core/types/resources';

/**
 * Configuration management service interface
 */
export interface IConfigurationManager {
    /**
     * Initializes the configuration manager
     */
    initialize(): Promise<void>;

    /**
     * Loads workspace configuration
     * @param workspacePath - Path to workspace directory
     */
    loadConfiguration(workspacePath?: string): Promise<FlintWorkspaceConfig>;

    /**
     * Saves workspace configuration
     * @param config - Configuration to save
     * @param workspacePath - Path to workspace directory
     */
    saveConfiguration(config: FlintWorkspaceConfig, workspacePath?: string): Promise<void>;

    /**
     * Gets current configuration
     */
    getCurrentConfiguration(): FlintWorkspaceConfig | undefined;

    /**
     * Validates configuration against schema
     * @param config - Configuration to validate
     */
    validateConfiguration(config: unknown): Promise<ConfigurationValidationResult>;

    /**
     * Migrates configuration format to current version
     * @param config - Configuration to migrate
     */
    migrateConfiguration(config: unknown): Promise<FlintWorkspaceConfig>;

    /**
     * Watches for configuration file changes
     * @param callback - Callback for configuration changes
     */
    watchConfiguration(callback: (config: FlintWorkspaceConfig) => void): any; // vscode.Disposable
}

/**
 * Project scanning service interface
 */
export interface IProjectScanner {
    /**
     * Scans paths for Ignition projects
     * @param projectPaths - Paths to scan
     */
    scanProjects(projectPaths: readonly string[]): Promise<readonly IgnitionProject[]>;

    /**
     * Scans single project path
     * @param projectPath - Path to project
     */
    scanProject(projectPath: string): Promise<IgnitionProject | undefined>;

    /**
     * Gets scan statistics for last scan
     */
    getScanStats(): ResourceScanStats | undefined;

    /**
     * Validates project structure
     * @param projectPath - Path to project
     */
    validateProject(projectPath: string): Promise<ProjectValidationResult>;
}

/**
 * Gateway management service interface
 */
export interface IGatewayManager {
    /**
     * Gets all configured gateways
     */
    getGateways(): Readonly<Record<string, GatewayConfig>>;

    /**
     * Gets gateway status
     * @param gatewayId - Gateway identifier
     */
    getGatewayStatus(gatewayId: string): Promise<GatewayStatus>;

    /**
     * Connects to gateway
     * @param gatewayId - Gateway identifier
     */
    connectToGateway(gatewayId: string): Promise<void>;

    /**
     * Disconnects from gateway
     * @param gatewayId - Gateway identifier
     */
    disconnectFromGateway(gatewayId: string): Promise<void>;

    /**
     * Gets currently selected gateway
     */
    getSelectedGateway(): string | undefined;

    /**
     * Sets selected gateway
     * @param gatewayId - Gateway identifier
     */
    setSelectedGateway(gatewayId: string | undefined): Promise<void>;

    /**
     * Gets currently selected project
     */
    getSelectedProject(): string | undefined;

    /**
     * Sets selected project
     * @param projectName - Project name
     */
    setSelectedProject(projectName: string | undefined): Promise<void>;

    /**
     * Lists projects available on gateway
     * @param gatewayId - Gateway identifier
     */
    listGatewayProjects(gatewayId: string): Promise<readonly string[]>;

    /**
     * Tests gateway connection
     * @param gatewayId - Gateway identifier
     */
    testConnection(gatewayId: string): Promise<boolean>;
}

/**
 * Resource management service interface
 */
export interface IResourceManager {
    /**
     * Gets resource type registry
     */
    getResourceTypeRegistry(): IResourceTypeRegistry;

    /**
     * Gets resource operations for type
     * @param typeId - Resource type identifier
     */
    getResourceOperations(typeId: string): ResourceOperations | undefined;

    /**
     * Creates a new resource
     * @param context - Resource creation context
     */
    createResource(context: ResourceCreationContext): Promise<void>;

    /**
     * Deletes a resource
     * @param projectPath - Project path
     * @param resourcePath - Resource path
     * @param isFolder - Whether resource is a folder
     */
    deleteResource(projectPath: string, resourcePath: string, isFolder?: boolean): Promise<void>;

    /**
     * Renames a resource
     * @param projectPath - Project path
     * @param oldPath - Current resource path
     * @param newPath - New resource path
     * @param isFolder - Whether resource is a folder
     */
    renameResource(projectPath: string, oldPath: string, newPath: string, isFolder?: boolean): Promise<void>;

    /**
     * Copies a resource
     * @param sourceProject - Source project path
     * @param sourcePath - Source resource path
     * @param targetProject - Target project path
     * @param targetPath - Target resource path
     * @param isFolder - Whether resource is a folder
     */
    copyResource(
        sourceProject: string,
        sourcePath: string,
        targetProject: string,
        targetPath: string,
        isFolder?: boolean
    ): Promise<void>;

    /**
     * Validates resource
     * @param projectPath - Project path
     * @param resourcePath - Resource path
     */
    validateResource(projectPath: string, resourcePath: string): Promise<ResourceValidationResult>;
}

/**
 * Resource type registry service interface
 */
export interface IResourceTypeRegistry {
    /**
     * Registers a resource type
     * @param definition - Resource type definition
     */
    registerResourceType(definition: ResourceTypeDefinition): void;

    /**
     * Gets resource type definition
     * @param typeId - Resource type identifier
     */
    getResourceType(typeId: string): ResourceTypeDefinition | undefined;

    /**
     * Gets all registered resource types
     */
    getAllResourceTypes(): readonly ResourceTypeDefinition[];

    /**
     * Gets resource types for search
     */
    getSearchableResourceTypes(): readonly ResourceTypeDefinition[];

    /**
     * Matches file to resource type
     * @param filePath - File path to match
     */
    matchResourceType(filePath: string): ResourceTypeDefinition | undefined;

    /**
     * Gets resource provider for type
     * @param typeId - Resource type identifier
     */
    getResourceProvider(typeId: string): ResourceProvider | undefined;
}

/**
 * Search service interface
 */
export interface ISearchService {
    /**
     * Searches for resources
     * @param query - Search query
     * @param options - Search options
     */
    searchResources(query: string, options?: ResourceSearchOptions): Promise<readonly ResourceSearchResult[]>;

    /**
     * Indexes project resources for search
     * @param projectId - Project identifier
     */
    indexProject(projectId: string): Promise<void>;

    /**
     * Gets search history
     */
    getSearchHistory(): readonly string[];

    /**
     * Adds query to search history
     * @param query - Search query
     */
    addToSearchHistory(query: string): void;

    /**
     * Clears search history
     */
    clearSearchHistory(): void;

    /**
     * Gets search statistics
     */
    getSearchStats(): SearchStats;
}

/**
 * Editor service interface
 */
export interface IEditorService {
    /**
     * Opens resource in appropriate editor
     * @param projectPath - Project path
     * @param resourcePath - Resource path
     */
    openResource(projectPath: string, resourcePath: string): Promise<void>;

    /**
     * Gets available editors for resource
     * @param resourcePath - Resource path
     */
    getAvailableEditors(resourcePath: string): readonly string[];

    /**
     * Registers custom editor
     * @param typeId - Resource type identifier
     * @param editor - Editor implementation
     */
    registerEditor(typeId: string, editor: any): void; // ResourceEditor
}

/**
 * Template service interface
 */
export interface ITemplateService {
    /**
     * Gets available templates for resource type
     * @param typeId - Resource type identifier
     * @param categoryId - Resource category identifier
     */
    getTemplates(typeId: string, categoryId?: string): Promise<readonly ResourceTemplate[]>;

    /**
     * Applies template to create resource
     * @param templateId - Template identifier
     * @param context - Creation context
     */
    applyTemplate(templateId: string, context: ResourceCreationContext): Promise<void>;

    /**
     * Validates template
     * @param template - Template to validate
     */
    validateTemplate(template: ResourceTemplate): Promise<TemplateValidationResult>;
}

/**
 * Configuration validation result
 */
export interface ConfigurationValidationResult {
    /** Whether configuration is valid */
    readonly isValid: boolean;
    /** Validation errors */
    readonly errors: readonly string[];
    /** Validation warnings */
    readonly warnings: readonly string[];
    /** Schema validation results */
    readonly schemaErrors: readonly SchemaValidationError[];
}

/**
 * Schema validation error
 */
export interface SchemaValidationError {
    /** Property path where error occurred */
    readonly path: string;
    /** Error message */
    readonly message: string;
    /** Expected value/type */
    readonly expected?: string;
    /** Actual value */
    readonly actual?: unknown;
}

/**
 * Project validation result
 */
export interface ProjectValidationResult {
    /** Whether project is valid */
    readonly isValid: boolean;
    /** Validation errors */
    readonly errors: readonly string[];
    /** Validation warnings */
    readonly warnings: readonly string[];
    /** Missing files */
    readonly missingFiles: readonly string[];
    /** Invalid resources */
    readonly invalidResources: readonly string[];
}

/**
 * Search statistics
 */
export interface SearchStats {
    /** Total number of indexed resources */
    readonly totalResources: number;
    /** Resources by type */
    readonly resourcesByType: Readonly<Record<string, number>>;
    /** Last index update timestamp */
    readonly lastIndexed: Date;
    /** Index size in bytes */
    readonly indexSize: number;
}

/**
 * Template validation result
 */
export interface TemplateValidationResult {
    /** Whether template is valid */
    readonly isValid: boolean;
    /** Validation errors */
    readonly errors: readonly string[];
    /** Validation warnings */
    readonly warnings: readonly string[];
}

/**
 * Service lifecycle interface
 */
export interface IServiceLifecycle {
    /**
     * Initializes the service
     */
    initialize(): Promise<void>;

    /**
     * Starts the service
     */
    start(): Promise<void>;

    /**
     * Stops the service
     */
    stop(): Promise<void>;

    /**
     * Disposes service resources
     */
    dispose(): Promise<void>;

    /**
     * Gets service status
     */
    getStatus(): ServiceStatus;
}

/**
 * Service status enumeration
 */
export enum ServiceStatus {
    /** Service is not initialized */
    NOT_INITIALIZED = 'not-initialized',
    /** Service is initializing */
    INITIALIZING = 'initializing',
    /** Service is initialized but not started */
    INITIALIZED = 'initialized',
    /** Service is starting */
    STARTING = 'starting',
    /** Service is running */
    RUNNING = 'running',
    /** Service is stopping */
    STOPPING = 'stopping',
    /** Service is stopped */
    STOPPED = 'stopped',
    /** Service has failed */
    FAILED = 'failed',
    /** Service is disposed */
    DISPOSED = 'disposed'
}

// Import types that services need
