/**
 * @module CoreConstants
 * @description Centralized constants for the Flint extension
 * Re-exports all constants from sub-modules
 */

// Re-export all constants from sub-modules
export * from './commands';
export * from './contexts';
export * from './config';

/**
 * Extension identification constants
 */
export const EXTENSION_ID = 'ignition-flint' as const;
export const EXTENSION_DISPLAY_NAME = 'Ignition Flint' as const;
export const EXTENSION_PUBLISHER = 'bw-design-group' as const;

/**
 * Configuration file constants
 */
export const CONFIG_FILE_NAME = 'flint.config.json' as const;

/**
 * File system constants
 */
export const PROJECT_JSON_FILE = 'project.json' as const;
export const RESOURCE_JSON_FILE = 'resource.json' as const;
export const GATEWAY_BACKUP_EXTENSION = '.gwbk' as const;

/**
 * Default values
 */
export const DEFAULT_GATEWAY_PORT = 8088 as const;
export const DEFAULT_DESIGNER_PORT = 8088 as const;
export const DEFAULT_SSL_ENABLED = false as const;
export const DEFAULT_IGNORE_SSL_ERRORS = true as const;
export const DEFAULT_SEARCH_LIMIT = 100 as const;
export const DEFAULT_TIMEOUT_MS = 30000 as const;

/**
 * UI constants
 */
export const TREE_VIEW_ID = 'flint-project-browser' as const;
export const SEARCH_VIEW_ID = 'flint-search-results' as const;
export const OUTPUT_CHANNEL_NAME = 'Ignition Flint' as const;

/**
 * Icon constants
 */
export const ICONS = {
    GATEWAY: 'server',
    PROJECT: 'project',
    FOLDER: 'folder',
    FILE: 'file',
    WARNING: 'warning',
    ERROR: 'error',
    LOADING: 'loading~spin',
    SEARCH: 'search',
    REFRESH: 'refresh',
    SETTINGS: 'settings-gear'
    // Resource type icons are provided by ResourceTypeProviderRegistry
} as const;

/**
 * Color constants for themes
 */
export const COLORS = {
    WARNING: '#ffcc00',
    ERROR: '#ff0000',
    SUCCESS: '#00aa00',
    INFO: '#0088ff',
    // Resource origin colors
    LOCAL: '#ffffff',
    INHERITED: '#888888',
    OVERRIDDEN: '#ffaa00'
} as const;

/**
 * Regular expressions for validation
 */
export const REGEX = {
    /** Valid resource name pattern */
    RESOURCE_NAME: /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
    /** Valid project name pattern */
    PROJECT_NAME: /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
    /** Valid gateway host pattern */
    GATEWAY_HOST: /^[a-zA-Z0-9.-]+$/,
    /** Valid port number pattern */
    PORT_NUMBER: /^[1-9]\d{0,4}$/,
    /** File extension pattern */
    FILE_EXTENSION: /\.[a-zA-Z0-9]+$/
} as const;

/**
 * Limits and thresholds
 */
export const LIMITS = {
    /** Maximum search results */
    MAX_SEARCH_RESULTS: 1000,
    /** Maximum search history entries */
    MAX_SEARCH_HISTORY: 50,
    /** Maximum file size for text search (in bytes) */
    MAX_TEXT_SEARCH_FILE_SIZE: 1024 * 1024, // 1MB
    /** Maximum project scan depth */
    MAX_SCAN_DEPTH: 10,
    /** Maximum concurrent operations */
    MAX_CONCURRENT_OPERATIONS: 5
} as const;

/**
 * Cache configuration
 */
export const CACHE = {
    /** Cache TTL in milliseconds */
    DEFAULT_TTL: 5 * 60 * 1000, // 5 minutes
    /** Project scan cache TTL */
    PROJECT_SCAN_TTL: 10 * 60 * 1000, // 10 minutes
    /** Gateway status cache TTL */
    GATEWAY_STATUS_TTL: 30 * 1000, // 30 seconds
    /** Search results cache TTL */
    SEARCH_RESULTS_TTL: 2 * 60 * 1000 // 2 minutes
} as const;
