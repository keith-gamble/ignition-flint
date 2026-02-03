/**
 * @module ConfigMergeUtility
 * @description Utility for merging configuration files with hierarchical override support
 */

import { FlintConfig, FlintSettings, GatewayConfig } from '@/core/types/configuration';

/**
 * Options for merging configurations
 */
export interface ConfigMergeOptions {
    /**
     * Strategy for merging arrays
     * - 'replace': Local array completely replaces base array (default for project-paths)
     * - 'concat': Concatenate arrays (base + local)
     * - 'union': Combine arrays removing duplicates
     */
    readonly arrayMergeStrategy?: 'replace' | 'concat' | 'union';
}

/**
 * Default merge options
 */
const DEFAULT_MERGE_OPTIONS: ConfigMergeOptions = {
    arrayMergeStrategy: 'replace'
};

/**
 * Checks if a value is a plain object (not array, null, or other types)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep merges two objects, with the second object taking precedence
 */
function deepMergeObjects<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
    const result = { ...base };

    for (const key of Object.keys(override) as Array<keyof T>) {
        const baseValue = base[key];
        const overrideValue = override[key];

        if (overrideValue === undefined) {
            continue;
        }

        if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
            result[key] = deepMergeObjects(
                baseValue as Record<string, unknown>,
                overrideValue as Record<string, unknown>
            ) as T[keyof T];
        } else {
            result[key] = overrideValue as T[keyof T];
        }
    }

    return result;
}

/**
 * Merges gateway configurations
 * Local gateways override base gateways with the same ID
 * Properties within each gateway are deep merged
 */
function mergeGateways(
    baseGateways: Readonly<Record<string, GatewayConfig>>,
    localGateways: Readonly<Record<string, GatewayConfig>> | undefined
): Record<string, GatewayConfig> {
    if (!localGateways) {
        return { ...baseGateways };
    }

    const result: Record<string, GatewayConfig> = { ...baseGateways };

    for (const [gatewayId, localGateway] of Object.entries(localGateways)) {
        const baseGateway = baseGateways[gatewayId];

        if (baseGateway) {
            result[gatewayId] = deepMergeObjects(
                baseGateway as unknown as Record<string, unknown>,
                localGateway as unknown as Record<string, unknown>
            ) as unknown as GatewayConfig;
        } else {
            result[gatewayId] = localGateway;
        }
    }

    return result;
}

/**
 * Merges settings objects
 */
function mergeSettings(
    baseSettings: FlintSettings | undefined,
    localSettings: FlintSettings | undefined
): FlintSettings | undefined {
    if (!baseSettings && !localSettings) {
        return undefined;
    }

    if (!baseSettings) {
        return localSettings;
    }

    if (!localSettings) {
        return baseSettings;
    }

    return deepMergeObjects(
        baseSettings as unknown as Record<string, unknown>,
        localSettings as unknown as Record<string, unknown>
    ) as unknown as FlintSettings;
}

/**
 * Merges project paths arrays based on merge strategy
 */
function mergeProjectPaths(
    basePaths: readonly string[],
    localPaths: readonly string[] | undefined,
    strategy: 'replace' | 'concat' | 'union'
): string[] {
    if (!localPaths || localPaths.length === 0) {
        return [...basePaths];
    }

    switch (strategy) {
        case 'replace':
            return [...localPaths];
        case 'concat':
            return [...basePaths, ...localPaths];
        case 'union':
            return [...new Set([...basePaths, ...localPaths])];
        default:
            return [...localPaths];
    }
}

/**
 * Merges two Flint configurations
 *
 * @param baseConfig - The base configuration (typically version controlled)
 * @param localConfig - The local override configuration (typically gitignored)
 * @param options - Merge options
 * @returns The merged configuration
 *
 * Merge behavior:
 * - Objects (gateways, settings): Deep merged, local values override base
 * - Arrays (project-paths): Replaced by local array (configurable via options)
 * - Scalars: Local value overrides base value
 * - schemaVersion: Always uses base config's version (local doesn't need to specify)
 */
export function mergeConfigurations(
    baseConfig: FlintConfig,
    localConfig: Partial<FlintConfig>,
    options: ConfigMergeOptions = DEFAULT_MERGE_OPTIONS
): FlintConfig {
    const mergeOptions = { ...DEFAULT_MERGE_OPTIONS, ...options };

    const mergedConfig: FlintConfig = {
        schemaVersion: baseConfig.schemaVersion,
        'project-paths': mergeProjectPaths(
            baseConfig['project-paths'],
            localConfig['project-paths'],
            mergeOptions.arrayMergeStrategy ?? 'replace'
        ),
        gateways: mergeGateways(baseConfig.gateways, localConfig.gateways),
        settings: mergeSettings(baseConfig.settings, localConfig.settings),
        formatVersion: localConfig.formatVersion ?? baseConfig.formatVersion,
        metadata: localConfig.metadata
            ? deepMergeObjects(
                  (baseConfig.metadata ?? {}) as Record<string, unknown>,
                  localConfig.metadata as Record<string, unknown>
              )
            : baseConfig.metadata
    };

    return mergedConfig;
}

/**
 * Validates that a partial config is suitable for use as a local override
 * Local configs don't need required fields like schemaVersion
 */
export function isValidLocalConfig(config: unknown): config is Partial<FlintConfig> {
    if (!isPlainObject(config)) {
        return false;
    }

    const allowedKeys = ['schemaVersion', 'project-paths', 'gateways', 'settings', 'formatVersion', 'metadata'];
    const configKeys = Object.keys(config);

    for (const key of configKeys) {
        if (!allowedKeys.includes(key)) {
            return false;
        }
    }

    if ('project-paths' in config && !Array.isArray(config['project-paths'])) {
        return false;
    }

    if ('gateways' in config && !isPlainObject(config.gateways)) {
        return false;
    }

    if ('settings' in config && !isPlainObject(config.settings)) {
        return false;
    }

    return true;
}
