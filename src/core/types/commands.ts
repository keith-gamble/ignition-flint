/**
 * @module CommandTypes
 * @description Command-specific type definitions for the Flint extension
 * Defines interfaces for command execution, context, and arguments
 */

/**
 * Base command interface that all commands must implement
 */
export interface ICommand {
    /** Unique command identifier */
    readonly id: string;

    /**
     * Executes the command with given arguments
     * @param args - Command arguments
     */
    execute(...args: unknown[]): Promise<void>;

    /**
     * Whether the command can be executed in current context
     * @param args - Command arguments
     */
    canExecute?(...args: unknown[]): boolean;

    /**
     * Gets command title for display
     */
    getTitle?(): string;
}

/**
 * Command execution context shared across all commands
 */
export interface CommandContext {
    /** VS Code extension context */
    readonly extensionContext: any; // vscode.ExtensionContext
    /** Service container for dependency injection */
    readonly services: IServiceContainer;
    /** Command registry for command management */
    readonly commandRegistry?: ICommandRegistry;
}

/**
 * Service container interface for dependency injection
 */
export interface IServiceContainer {
    /**
     * Registers a service with the container
     * @param key - Service key
     * @param service - Service instance
     */
    register<T>(key: string, service: T): void;

    /**
     * Gets a service from the container
     * @param key - Service key
     */
    get<T>(key: string): T;

    /**
     * Checks if a service is registered
     * @param key - Service key
     */
    has(key: string): boolean;
}

/**
 * Command registry interface for managing commands
 */
export interface ICommandRegistry {
    /**
     * Registers a command
     * @param command - Command to register
     */
    register(command: ICommand): any; // vscode.Disposable

    /**
     * Registers multiple commands
     * @param commands - Commands to register
     */
    registerAll(commands: readonly ICommand[]): readonly any[]; // vscode.Disposable[]

    /**
     * Gets a registered command
     * @param id - Command ID
     */
    get(id: string): ICommand | undefined;

    /**
     * Gets all registered commands
     */
    getAll(): readonly ICommand[];
}

/**
 * Arguments for resource creation commands
 */
export interface CreateResourceArgs {
    /** Project ID where resource will be created */
    readonly projectId: string;
    /** Resource type identifier */
    readonly typeId: string;
    /** Parent path for new resource */
    readonly parentPath?: string;
    /** Resource category identifier */
    readonly categoryId?: string;
    /** Suggested resource name */
    readonly suggestedName?: string;
    /** Template to use for creation */
    readonly templateId?: string;
}

/**
 * Arguments for resource deletion commands
 */
export interface DeleteResourceArgs {
    /** Project ID containing the resource */
    readonly projectId: string;
    /** Path to resource to delete */
    readonly resourcePath: string;
    /** Whether resource is a folder */
    readonly isFolder?: boolean;
    /** Whether to confirm deletion */
    readonly skipConfirmation?: boolean;
}

/**
 * Arguments for resource rename commands
 */
export interface RenameResourceArgs {
    /** Project ID containing the resource */
    readonly projectId: string;
    /** Current resource path */
    readonly currentPath: string;
    /** New resource path */
    readonly newPath?: string;
    /** Whether resource is a folder */
    readonly isFolder?: boolean;
}

/**
 * Arguments for resource copy/duplicate commands
 */
export interface CopyResourceArgs {
    /** Source project ID */
    readonly sourceProjectId: string;
    /** Source resource path */
    readonly sourceResourcePath: string;
    /** Target project ID */
    readonly targetProjectId?: string;
    /** Target resource path */
    readonly targetResourcePath?: string;
    /** Whether resource is a folder */
    readonly isFolder?: boolean;
}

/**
 * Arguments for gateway selection commands
 */
export interface SelectGatewayArgs {
    /** Gateway ID to select */
    readonly gatewayId?: string;
    /** Project name to select on gateway */
    readonly projectName?: string;
    /** Whether to prompt user for selection */
    readonly promptUser?: boolean;
}

/**
 * Arguments for project selection commands
 */
export interface SelectProjectArgs {
    /** Project ID to select */
    readonly projectId?: string;
    /** Whether to prompt user for selection */
    readonly promptUser?: boolean;
    /** Filter projects by gateway */
    readonly gatewayId?: string;
}

/**
 * Arguments for search commands
 */
export interface SearchResourcesArgs {
    /** Search query */
    readonly query?: string;
    /** Project IDs to search within */
    readonly projectIds?: readonly string[];
    /** Resource types to include */
    readonly resourceTypes?: readonly string[];
    /** Search options */
    readonly options?: ResourceSearchOptions;
}

/**
 * Arguments for configuration commands
 */
export interface ConfigurationArgs {
    /** Configuration file path */
    readonly configPath?: string;
    /** Configuration property path */
    readonly propertyPath?: string;
    /** New property value */
    readonly value?: unknown;
}

/**
 * Arguments for gateway management commands
 */
export interface GatewayManagementArgs {
    /** Gateway ID */
    readonly gatewayId: string;
    /** Gateway configuration */
    readonly config?: GatewayConfigInput;
    /** Operation type */
    readonly operation: 'add' | 'remove' | 'update';
}

/**
 * Input for gateway configuration
 */
export interface GatewayConfigInput {
    /** Gateway host */
    readonly host: string;
    /** Gateway port */
    readonly port?: number;
    /** Whether to use SSL */
    readonly ssl?: boolean;
    /** Username for authentication */
    readonly username?: string;
    /** Whether to ignore SSL errors */
    readonly ignoreSSLErrors?: boolean;
    /** Projects available on gateway */
    readonly projects?: readonly string[];
    /** Whether gateway is enabled */
    readonly enabled?: boolean;
}

/**
 * Arguments for project path management commands
 */
export interface ProjectPathArgs {
    /** Project paths to add */
    readonly pathsToAdd?: readonly string[];
    /** Project paths to remove */
    readonly pathsToRemove?: readonly string[];
    /** Whether to validate paths */
    readonly validatePaths?: boolean;
}

/**
 * Command execution result
 */
export interface CommandResult<T = unknown> {
    /** Whether command executed successfully */
    readonly success: boolean;
    /** Result data if successful */
    readonly data?: T;
    /** Error message if failed */
    readonly error?: string;
    /** Additional metadata */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Command validation result
 */
export interface CommandValidationResult {
    /** Whether arguments are valid */
    readonly isValid: boolean;
    /** Validation errors */
    readonly errors: readonly string[];
    /** Validation warnings */
    readonly warnings: readonly string[];
}

/**
 * Command execution context for specific operations
 */
export interface OperationContext {
    /** Operation type */
    readonly operation: string;
    /** Source data */
    readonly source?: unknown;
    /** Target data */
    readonly target?: unknown;
    /** Additional context */
    readonly metadata?: Readonly<Record<string, unknown>>;
    /** Cancellation token */
    readonly cancellationToken?: any; // vscode.CancellationToken
}

/**
 * Command progress reporter interface
 */
export interface CommandProgress {
    /**
     * Reports progress update
     * @param progress - Progress information
     */
    report(progress: ProgressUpdate): void;
}

/**
 * Progress update information
 */
export interface ProgressUpdate {
    /** Progress message */
    readonly message?: string;
    /** Progress increment (0-100) */
    readonly increment?: number;
    /** Total progress (0-100) */
    readonly total?: number;
}

/**
 * Command execution options
 */
export interface CommandExecutionOptions {
    /** Whether to show progress indicator */
    readonly showProgress?: boolean;
    /** Progress title */
    readonly progressTitle?: string;
    /** Execution timeout in milliseconds */
    readonly timeoutMs?: number;
    /** Whether execution is cancellable */
    readonly cancellable?: boolean;
}

// Import types that commands need
import type { ResourceSearchOptions } from '@/core/types/resources';
