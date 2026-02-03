/**
 * @module ModuleTypes
 * @description Type definitions for Ignition Gateway module configurations
 * Defines module-specific settings at gateway, environment, and resolved levels
 */

/**
 * Project scan endpoint module configuration (gateway-level)
 * Defines whether the module is installed/available on the gateway
 */
export interface ProjectScanModuleGatewayConfig {
    /** Whether the project-scan-endpoint module is installed on this gateway */
    readonly enabled?: boolean;
}

/**
 * Project scan endpoint module configuration (environment-specific)
 * Defines behavior settings for the module in a specific environment
 */
export interface ProjectScanModuleEnvironmentConfig {
    /** Whether to force update designers when scanning (module endpoint only) */
    readonly forceUpdateDesigner?: boolean;
    /** Path to API token file for 8.3+ Gateway API authentication */
    readonly apiTokenFilePath?: string;
}

/**
 * Module configurations at gateway level
 * Defines which modules are installed/available on the gateway
 */
export interface GatewayModules {
    /** Project scan endpoint module configuration */
    readonly 'project-scan-endpoint'?: ProjectScanModuleGatewayConfig;
}

/**
 * Module configurations at environment level
 * Defines behavior settings for modules in a specific environment
 */
export interface GatewayEnvironmentModules {
    /** Project scan endpoint module configuration */
    readonly 'project-scan-endpoint'?: ProjectScanModuleEnvironmentConfig;
}

/**
 * Resolved project scan module configuration
 * Merges gateway-level (enabled) and environment-level (behavior) settings
 */
export interface ResolvedProjectScanModuleConfig {
    /** Whether the module is enabled (from gateway config) */
    enabled?: boolean;
    /** Path to API token file (from environment config) */
    apiTokenFilePath?: string;
    /** Whether to force update designers (from environment config) */
    forceUpdateDesigner?: boolean;
}

/**
 * Resolved module configurations
 * Merged configuration from gateway and environment levels
 */
export interface ResolvedModules {
    'project-scan-endpoint'?: ResolvedProjectScanModuleConfig;
}
