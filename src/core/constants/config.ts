/**
 * @module ConfigConstants
 * @description Configuration-related constants and default values
 */

/**
 * Configuration property paths
 */
export const CONFIG_PATHS = {
    PROJECT_PATHS: 'project-paths',
    GATEWAYS: 'gateways',
    GATEWAY_PROJECTS: 'projects',
    GATEWAY_ENABLED: 'enabled',
    GATEWAY_HOST: 'host',
    GATEWAY_PORT: 'port',
    GATEWAY_SSL: 'ssl',
    GATEWAY_USERNAME: 'username',
    GATEWAY_IGNORE_SSL: 'ignoreSSLErrors'
} as const;

/**
 * Configuration schema versions
 */
export const CONFIG_SCHEMA_VERSIONS = {
    CURRENT: '0.2',
    PREVIOUS: '0.1'
} as const;

/**
 * Default configuration values
 */
export const CONFIG_DEFAULTS = {
    GATEWAY: {
        PORT: 8088,
        SSL: false,
        IGNORE_SSL_ERRORS: true,
        ENABLED: true,
        TIMEOUT_MS: 30000,
        RETRY_ATTEMPTS: 3,
        RETRY_DELAY_MS: 1000
    },
    PROJECT: {
        SCAN_DEPTH: 10,
        SCAN_TIMEOUT_MS: 60000,
        CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
        VALIDATE_ON_SCAN: true,
        INCLUDE_HIDDEN: false
    },
    SEARCH: {
        MAX_RESULTS: 100,
        TIMEOUT_MS: 10000,
        CASE_SENSITIVE: false,
        USE_REGEX: false,
        INCLUDE_INHERITED: true,
        MAX_FILE_SIZE: 1024 * 1024 // 1MB
    },
    UI: {
        TREE_VIEW_EXPANDED: true,
        SHOW_INHERITED_RESOURCES: true,
        SHOW_RESOURCE_ORIGIN: true,
        SORT_RESOURCES: true,
        GROUP_BY_TYPE: true,
        SHOW_MISSING_RESOURCE_JSON: true
    },
    TOOLS: {
        KINDLING_AUTO_DETECT: true,
        DESIGNER_AUTO_LAUNCH: false,
        EXTERNAL_EDITOR_ENABLED: false
    }
} as const;

/**
 * Configuration validation rules
 */
export const CONFIG_VALIDATION = {
    PROJECT_PATHS: {
        MIN_LENGTH: 1,
        MAX_LENGTH: 500,
        REQUIRED: true,
        TYPE: 'array'
    },
    GATEWAY_HOST: {
        MIN_LENGTH: 1,
        MAX_LENGTH: 253,
        PATTERN: /^[a-zA-Z0-9.-]+$/,
        REQUIRED: true,
        TYPE: 'string'
    },
    GATEWAY_PORT: {
        MIN: 1,
        MAX: 65535,
        REQUIRED: false,
        TYPE: 'number'
    },
    GATEWAY_USERNAME: {
        MIN_LENGTH: 1,
        MAX_LENGTH: 100,
        REQUIRED: false,
        TYPE: 'string'
    },
    PROJECT_NAME: {
        MIN_LENGTH: 1,
        MAX_LENGTH: 100,
        PATTERN: /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
        REQUIRED: true,
        TYPE: 'string'
    }
} as const;

/**
 * Environment variable names
 */
export const ENV_VARS = {
    CONFIG_PATH: 'FLINT_CONFIG_PATH',
    DEBUG_MODE: 'FLINT_DEBUG',
    LOG_LEVEL: 'FLINT_LOG_LEVEL',
    CACHE_DIR: 'FLINT_CACHE_DIR',
    TEMP_DIR: 'FLINT_TEMP_DIR',
    KINDLING_PATH: 'FLINT_KINDLING_PATH',
    DESIGNER_PATH: 'FLINT_DESIGNER_PATH'
} as const;

/**
 * Configuration file locations in priority order (lowest priority first)
 */
export const CONFIG_LOCATIONS = [
    '.vscode/flint.config.json',
    '.flint-config.json',
    '.flint/config.json',
    'flint.config.json'
] as const;

/**
 * Local config override patterns
 * These files are merged with the base config and typically gitignored
 */
export const LOCAL_CONFIG_PATTERNS = ['flint.local.json', '.flint/config.local.json'] as const;

/**
 * VS Code setting keys for config paths
 */
export const CONFIG_SETTING_KEYS = {
    CONFIG_PATH: 'flint.configPath',
    LOCAL_CONFIG_PATH: 'flint.localConfigPath'
} as const;

/**
 * Configuration backup settings
 */
export const CONFIG_BACKUP = {
    ENABLED: true,
    MAX_BACKUPS: 5,
    BACKUP_EXTENSION: '.backup',
    BACKUP_TIMESTAMP_FORMAT: 'YYYY-MM-DD_HH-mm-ss'
} as const;

/**
 * Configuration migration mapping
 * (Currently empty as this is the initial version)
 */
export const CONFIG_MIGRATION = {
    // Future migrations will be added here as needed
} as const;

/**
 * Configuration sections
 */
export const CONFIG_SECTIONS = {
    PROJECT_PATHS: 'project-paths',
    GATEWAYS: 'gateways',
    SETTINGS: 'settings',
    TOOLS: 'tools',
    UI: 'ui',
    SEARCH: 'search'
} as const;

/**
 * Setting keys for VS Code configuration
 */
export const SETTING_KEYS = {
    // General settings
    ENABLE_AUTO_SCAN: 'flint.general.enableAutoScan',
    SCAN_ON_STARTUP: 'flint.general.scanOnStartup',
    DEBUG_MODE: 'flint.general.debugMode',

    // UI settings
    TREE_SORT_ORDER: 'flint.ui.treeSortOrder',
    SHOW_INHERITED: 'flint.ui.showInheritedResources',
    SHOW_RESOURCE_ORIGIN: 'flint.ui.showResourceOrigin',
    COMPACT_MODE: 'flint.ui.compactMode',

    // Search settings
    SEARCH_CASE_SENSITIVE: 'flint.search.caseSensitive',
    SEARCH_USE_REGEX: 'flint.search.useRegex',
    SEARCH_MAX_RESULTS: 'flint.search.maxResults',
    SEARCH_TIMEOUT: 'flint.search.timeoutMs',

    // Gateway settings
    GATEWAY_TIMEOUT: 'flint.gateway.timeoutMs',
    GATEWAY_RETRY_ATTEMPTS: 'flint.gateway.retryAttempts',
    GATEWAY_SSL_VERIFY: 'flint.gateway.verifySsl',

    // Project settings
    PROJECT_SCAN_DEPTH: 'flint.project.scanDepth',
    PROJECT_VALIDATE_ON_SCAN: 'flint.project.validateOnScan',
    PROJECT_CACHE_ENABLED: 'flint.project.cacheEnabled',

    // Tool settings
    KINDLING_PATH: 'flint.tools.kindlingPath',
    KINDLING_AUTO_DETECT: 'flint.tools.kindlingAutoDetect',
    DESIGNER_AUTO_LAUNCH: 'flint.tools.designerAutoLaunch',
    EXTERNAL_EDITOR_PATH: 'flint.tools.externalEditorPath'
} as const;

/**
 * Configuration validation error codes
 */
export const CONFIG_ERROR_CODES = {
    INVALID_JSON: 'INVALID_JSON',
    SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
    MISSING_REQUIRED_PROPERTY: 'MISSING_REQUIRED_PROPERTY',
    INVALID_PROPERTY_TYPE: 'INVALID_PROPERTY_TYPE',
    INVALID_PROPERTY_VALUE: 'INVALID_PROPERTY_VALUE',
    DUPLICATE_GATEWAY_ID: 'DUPLICATE_GATEWAY_ID',
    INVALID_PROJECT_PATH: 'INVALID_PROJECT_PATH',
    CONFIG_FILE_NOT_FOUND: 'CONFIG_FILE_NOT_FOUND',
    CONFIG_FILE_READ_ERROR: 'CONFIG_FILE_READ_ERROR',
    CONFIG_FILE_WRITE_ERROR: 'CONFIG_FILE_WRITE_ERROR',
    CONFIG_MIGRATION_FAILED: 'CONFIG_MIGRATION_FAILED'
} as const;

/**
 * Log levels for configuration
 */
export const LOG_LEVELS = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
    TRACE: 'trace'
} as const;

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
    ENABLED: true,
    MAX_SIZE_MB: 100,
    CLEANUP_INTERVAL_MS: 60 * 60 * 1000, // 1 hour
    DEFAULT_TTL_MS: 5 * 60 * 1000, // 5 minutes

    KEYS: {
        PROJECT_SCAN: 'project-scan',
        RESOURCE_SCAN: 'resource-scan',
        GATEWAY_STATUS: 'gateway-status',
        SEARCH_RESULTS: 'search-results',
        CONFIGURATION: 'configuration'
    }
} as const;

/**
 * Type for configuration paths
 */
export type ConfigPath = (typeof CONFIG_PATHS)[keyof typeof CONFIG_PATHS];

/**
 * Type for setting keys
 */
export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/**
 * Type for configuration error codes
 */
export type ConfigErrorCode = (typeof CONFIG_ERROR_CODES)[keyof typeof CONFIG_ERROR_CODES];

/**
 * Type for log levels
 */
export type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS];
