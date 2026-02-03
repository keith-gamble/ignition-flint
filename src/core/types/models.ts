/**
 * @module Models
 * @description Core data model types for the Flint extension
 * Consolidated from existing models/* files
 */

/**
 * Gateway connection configuration
 */
export interface GatewayConnection {
    /** Gateway host address */
    readonly host: string;
    /** Gateway port (default: 8088) */
    readonly port?: number;
    /** Whether to use SSL/HTTPS */
    readonly ssl?: boolean;
    /** Username for authentication */
    readonly username?: string;
    /** Whether to ignore SSL certificate errors */
    readonly ignoreSSLErrors?: boolean;
}

/**
 * Gateway configuration including connection and project list
 */
export interface GatewayConfig {
    /** Connection parameters */
    readonly connection: GatewayConnection;
    /** List of projects available on this gateway */
    readonly projects: readonly string[];
    /** Whether this gateway is enabled */
    readonly enabled?: boolean;
}

/**
 * Runtime gateway status information
 */
export interface GatewayStatus {
    /** Unique gateway identifier */
    readonly id: string;
    /** Display name for the gateway */
    readonly name: string;
    /** Whether currently connected */
    readonly connected: boolean;
    /** Last successful connection timestamp */
    readonly lastConnected?: Date;
    /** Gateway version if known */
    readonly version?: string;
    /** Error message if connection failed */
    readonly error?: string;
}

/**
 * Project metadata from project.json
 */
export interface ProjectJson {
    /** Project display title */
    readonly title: string;
    /** Project description */
    readonly description?: string;
    /** Parent project for inheritance */
    readonly parent?: string;
    /** Whether project is enabled */
    readonly enabled?: boolean;
    /** Whether project can be inherited from */
    readonly inheritable?: boolean;
}

/**
 * Complete project information with runtime data
 */
export interface IgnitionProject {
    /** Unique project identifier */
    readonly id: string;
    /** Project display title */
    readonly title: string;
    /** Project description */
    readonly description?: string;
    /** Parent project identifier for inheritance */
    readonly parent?: string;
    /** Whether project is enabled */
    readonly enabled: boolean;
    /** Whether project can be inherited from */
    readonly inheritable: boolean;
    /** Full file system path to project directory */
    readonly path: string;
    /** Map of resource path to resource data */
    readonly resources: ReadonlyMap<string, ProjectResource>;
    /** Chain of parent projects for inheritance resolution */
    readonly inheritanceChain: readonly string[];
}

/**
 * Workspace configuration for Flint extension
 */
export interface FlintWorkspaceConfig {
    /** Paths to scan for Ignition projects */
    readonly projectPaths: readonly string[];
    /** Gateway configurations by ID */
    readonly gateways: Readonly<Record<string, GatewayConfig>>;
}

/**
 * Project resource information
 * Re-exported here to avoid circular dependencies
 */
export interface ProjectResource {
    /** Resource type identifier */
    readonly type: string;
    /** Resource path within project */
    readonly path: string;
    /** Origin of this resource (local/inherited/overridden) */
    readonly origin: ResourceOrigin;
    /** Project where this resource is defined */
    readonly sourceProject: string;
    /** Files that make up this resource */
    readonly files: readonly ResourceFile[];
    /** Additional metadata */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Individual file within a resource
 */
export interface ResourceFile {
    /** File name */
    readonly name: string;
    /** Full file system path */
    readonly path: string;
    /** File size in bytes */
    readonly size?: number;
    /** Last modification timestamp */
    readonly lastModified?: Date;
}

/**
 * Resource origin enumeration
 */
export enum ResourceOrigin {
    /** Resource exists in current project */
    LOCAL = 'local',
    /** Resource inherited from parent project */
    INHERITED = 'inherited',
    /** Resource overrides inherited version */
    OVERRIDDEN = 'overridden'
}

/**
 * Gateway selection state
 */
export interface GatewaySelection {
    /** Selected gateway ID */
    readonly gatewayId?: string;
    /** Selected project name on gateway */
    readonly projectName?: string;
    /** Timestamp of selection */
    readonly selectedAt?: Date;
}

/**
 * Project scan result
 */
export interface ProjectScanResult {
    /** Projects found during scan */
    readonly projects: readonly IgnitionProject[];
    /** Scan timestamp */
    readonly scannedAt: Date;
    /** Scan duration in milliseconds */
    readonly scanDurationMs: number;
    /** Any errors encountered during scan */
    readonly errors: readonly string[];
}

/**
 * Resource scan statistics
 */
export interface ResourceScanStats {
    /** Number of resources scanned */
    readonly resourceCount: number;
    /** Number of files processed */
    readonly fileCount: number;
    /** Resources by type */
    readonly resourcesByType: Readonly<Record<string, number>>;
    /** Scan duration in milliseconds */
    readonly scanDurationMs: number;
}

/**
 * Extension activation context
 */
export interface ExtensionContext {
    /** VS Code extension context */
    readonly vscode: any; // vscode.ExtensionContext - avoiding direct import
    /** Extension version */
    readonly version: string;
    /** Extension ID */
    readonly extensionId: string;
    /** Whether in development mode */
    readonly isDevelopment: boolean;
}
