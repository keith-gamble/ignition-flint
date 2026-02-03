/**
 * @module ConfigurationTypes
 * @description Type definitions for Flint configuration structures
 * Defines the schema for flint.config.json and related configuration objects
 */

import { CONFIG_SCHEMA_VERSIONS } from '@/core/constants';
import { GatewayEnvironmentModules, GatewayModules } from '@/core/types/modules';

/**
 * Environment-specific gateway configuration
 */
export interface GatewayEnvironmentConfig {
    /** Gateway hostname or IP address for this environment */
    readonly host: string;
    /** Gateway port number (default: 8088) */
    readonly port?: number;
    /** Whether to use SSL/HTTPS */
    readonly ssl?: boolean;
    /** Username for authentication (environment-specific) */
    readonly username?: string;
    /** Whether to ignore SSL certificate errors */
    readonly ignoreSSLErrors?: boolean;
    /** Connection timeout in milliseconds */
    readonly timeoutMs?: number;
    /** Ignition version for this environment (e.g., '8.1.33', '8.3.2') */
    readonly ignitionVersion?: string;
    /** Module configurations for this environment */
    readonly modules?: GatewayEnvironmentModules;
}

/**
 * Gateway configuration for connecting to Ignition gateways
 * Supports both legacy single-environment format and new multi-environment format
 */
export interface GatewayConfig {
    /** Unique identifier for the gateway */
    readonly id: string;
    /** Gateway hostname or IP address (legacy single-environment format) */
    readonly host?: string;
    /** Gateway port number (legacy single-environment format) */
    readonly port?: number;
    /** Whether to use SSL/HTTPS (legacy single-environment format) */
    readonly ssl?: boolean;
    /** Username for authentication (legacy or global) */
    readonly username?: string;
    /** Whether to ignore SSL certificate errors (legacy or global) */
    readonly ignoreSSLErrors?: boolean;
    /** Multiple environments for this gateway */
    readonly environments?: Readonly<Record<string, GatewayEnvironmentConfig>>;
    /** Default environment to use when gateway is selected */
    readonly defaultEnvironment?: string;
    /** List of projects available on this gateway */
    readonly projects?: readonly string[];
    /** Whether this gateway is enabled */
    readonly enabled?: boolean;
    /** Display name for the gateway */
    readonly displayName?: string;
    /** Description of the gateway */
    readonly description?: string;
    /** Connection timeout in milliseconds (legacy or global) */
    readonly timeoutMs?: number;
    /** Ignition version for this gateway (e.g., '8.1.33', '8.3.2') */
    readonly ignitionVersion?: string;
    /** Module configurations for this gateway */
    readonly modules?: GatewayModules;
}

/**
 * Project configuration for Ignition projects
 */
export interface ProjectConfig {
    /** Project name */
    readonly name: string;
    /** Path to project directory */
    readonly path: string;
    /** Gateway ID this project belongs to */
    readonly gatewayId?: string;
    /** Whether project is enabled */
    readonly enabled?: boolean;
    /** Project description */
    readonly description?: string;
    /** Whether to show inherited resources */
    readonly showInheritedResources?: boolean;
}

/**
 * Application settings that control Flint behavior
 */
export interface FlintSettings {
    /** Whether to show inherited resources from parent projects */
    readonly showInheritedResources?: boolean;
    /** Whether to group resources by type in the tree view */
    readonly groupResourcesByType?: boolean;
    /** Whether to automatically refresh projects when files change */
    readonly autoRefreshProjects?: boolean;
    /** Whether to show empty resource type folders */
    readonly showEmptyResourceTypes?: boolean;
    /** Maximum number of items to keep in search history */
    readonly searchHistoryLimit?: number;
    /** Default timeout for gateway connections in milliseconds */
    readonly defaultGatewayTimeout?: number;
    /** Whether to cache project scans for better performance */
    readonly enableProjectCache?: boolean;
    /** Cache expiration time in milliseconds */
    readonly cacheExpirationMs?: number;
    /** Whether to validate resource.json files automatically */
    readonly autoValidateResourceJson?: boolean;
    /** Whether to create missing resource.json files automatically */
    readonly autoCreateResourceJson?: boolean;
}

/**
 * Main Flint configuration structure
 */
export interface FlintConfig {
    /** Configuration schema version for migration compatibility */
    readonly schemaVersion: string;
    /** Array of paths to scan for Ignition projects */
    readonly 'project-paths': readonly string[];
    /** Map of gateway configurations keyed by gateway ID */
    readonly gateways: Readonly<Record<string, GatewayConfig>>;
    /** Application settings */
    readonly settings?: FlintSettings;
    /** Configuration format version (internal) */
    readonly formatVersion?: number;
    /** User-defined metadata */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Configuration input for creating or updating gateways
 */
export interface GatewayConfigInput {
    /** Gateway hostname or IP address */
    readonly host: string;
    /** Gateway port number */
    readonly port?: number;
    /** Whether to use SSL/HTTPS */
    readonly ssl?: boolean;
    /** Username for authentication */
    readonly username?: string;
    /** Whether to ignore SSL certificate errors */
    readonly ignoreSSLErrors?: boolean;
    /** List of projects available on this gateway */
    readonly projects?: readonly string[];
    /** Whether this gateway is enabled */
    readonly enabled?: boolean;
    /** Display name for the gateway */
    readonly displayName?: string;
    /** Description of the gateway */
    readonly description?: string;
    /** Connection timeout in milliseconds */
    readonly timeoutMs?: number;
    /** Ignition version for this gateway (e.g., '8.1.33', '8.3.2') */
    readonly ignitionVersion?: string;
}

/**
 * Configuration validation result
 */
export interface ConfigurationValidationResult {
    /** Whether the configuration is valid */
    readonly isValid: boolean;
    /** List of validation errors */
    readonly errors: readonly string[];
    /** List of validation warnings */
    readonly warnings: readonly string[];
    /** Additional validation details */
    readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Configuration migration result
 */
export interface ConfigurationMigrationResult {
    /** Whether migration was performed */
    readonly migrated: boolean;
    /** The migrated configuration */
    readonly configuration: FlintConfig;
    /** Migration steps that were applied */
    readonly steps: readonly string[];
    /** Any warnings from the migration process */
    readonly warnings: readonly string[];
}

/**
 * Configuration backup information
 */
export interface ConfigurationBackup {
    /** Path to the backup file */
    readonly path: string;
    /** Timestamp when backup was created */
    readonly timestamp: string;
    /** Schema version of the backed up configuration */
    readonly schemaVersion: string;
    /** Size of the backup file in bytes */
    readonly size: number;
    /** Reason for creating the backup */
    readonly reason: 'migration' | 'manual' | 'auto' | 'error';
}

/**
 * Configuration change event data
 */
export interface ConfigurationChangeEvent {
    /** Type of change that occurred */
    readonly type: 'created' | 'updated' | 'deleted' | 'migrated';
    /** The updated configuration (if available) */
    readonly configuration?: FlintConfig;
    /** Previous configuration (for updates) */
    readonly previousConfiguration?: FlintConfig;
    /** Path to the configuration file */
    readonly path: string;
    /** Timestamp of the change */
    readonly timestamp: string;
    /** Additional change details */
    readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Information about a loaded configuration file
 */
export interface LoadedConfigInfo {
    /** Absolute path to the configuration file */
    readonly path: string;
    /** The loaded configuration (full or partial for local configs) */
    readonly config: FlintConfig | Partial<FlintConfig>;
    /** Whether this is a local override config */
    readonly isLocalOverride: boolean;
    /** Timestamp when the config was loaded */
    readonly loadedAt: Date;
}

/**
 * Result of resolving and loading configuration files
 */
export interface ConfigResolutionResult {
    /** Information about the base configuration file (null if not found) */
    readonly baseConfig: LoadedConfigInfo | null;
    /** Information about the local override config (null if not found) */
    readonly localConfig: LoadedConfigInfo | null;
    /** The merged configuration result (null if base config not found) */
    readonly mergedConfig: FlintConfig | null;
    /** List of paths that were searched for config files */
    readonly searchedPaths: readonly string[];
    /** Warnings generated during config resolution */
    readonly warnings: readonly string[];
}

/**
 * Default configuration values
 */
export const DEFAULT_FLINT_CONFIG: Readonly<Partial<FlintConfig>> = {
    schemaVersion: CONFIG_SCHEMA_VERSIONS.CURRENT,
    'project-paths': [],
    gateways: {},
    settings: {
        showInheritedResources: true,
        groupResourcesByType: true,
        autoRefreshProjects: true,
        showEmptyResourceTypes: false,
        searchHistoryLimit: 50,
        defaultGatewayTimeout: 10000,
        enableProjectCache: true,
        cacheExpirationMs: 300000, // 5 minutes
        autoValidateResourceJson: true,
        autoCreateResourceJson: false
    }
} as const;

/**
 * Default gateway configuration values
 */
export const DEFAULT_GATEWAY_CONFIG: Readonly<Partial<GatewayConfig>> = {
    port: 8088,
    ssl: true,
    enabled: true,
    ignoreSSLErrors: false,
    timeoutMs: 10000,
    projects: []
} as const;
