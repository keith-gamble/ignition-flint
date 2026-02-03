/**
 * @module ConfigMigrationService
 * @description Service for migrating configuration files between schema versions
 * Handles migrations between different schema versions including:
 * - v0.1: Initial version
 * - v0.2: Added ignitionVersion field to gateway configuration
 */

import { CONFIG_SCHEMA_VERSIONS } from '@/core/constants';
import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { FlintConfig, GatewayConfig } from '@/core/types/configuration';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Service for handling configuration file migrations
 * Supports migration from v0.1 to v0.2 and future versions
 */
export class ConfigMigrationService implements IServiceLifecycle {
    private static readonly CURRENT_SCHEMA_VERSION = CONFIG_SCHEMA_VERSIONS.CURRENT;

    private isInitialized = false;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    initialize(): Promise<void> {
        this.isInitialized = true;
        return Promise.resolve();
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            return Promise.reject(
                new FlintError('ConfigMigrationService must be initialized before starting', 'SERVICE_NOT_INITIALIZED')
            );
        }
        // console.log('ConfigMigrationService started');
        return Promise.resolve();
    }

    stop(): Promise<void> {
        return Promise.resolve();
    }

    dispose(): Promise<void> {
        this.isInitialized = false;
        return Promise.resolve();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Checks if a configuration needs migration
     * Checks for missing or outdated schema versions
     */
    needsMigration(config: any): boolean {
        if (!config || typeof config !== 'object') {
            return false;
        }

        const schemaVersion = config.schemaVersion;

        // If no version, needs migration
        if (!schemaVersion) {
            return true;
        }

        // Check if version is outdated
        return schemaVersion !== ConfigMigrationService.CURRENT_SCHEMA_VERSION;
    }

    /**
     * Migrates configuration to the current schema version
     * Handles migrations from v0.1 to v0.2
     */
    migrateConfiguration(config: any): Promise<FlintConfig> {
        // Handle null/undefined inputs
        if (!config || typeof config !== 'object') {
            return Promise.resolve(config as FlintConfig);
        }

        let currentVersion = config.schemaVersion || '0.1';

        // Perform incremental migrations
        if (currentVersion < '0.2') {
            // Migration from 0.1 to 0.2: Auto-detect Ignition version from gateway IDs
            if (config.gateways && typeof config.gateways === 'object') {
                for (const [gatewayId, gateway] of Object.entries(config.gateways)) {
                    const gw = gateway as GatewayConfig;

                    // Auto-detect version from gateway ID if not already set
                    if (!gw.ignitionVersion) {
                        // Check if gateway ID contains version hint
                        if (gatewayId.includes('81') || gatewayId.includes('8.1')) {
                            (gateway as any).ignitionVersion = '8.1';
                        } else if (gatewayId.includes('83') || gatewayId.includes('8.3')) {
                            (gateway as any).ignitionVersion = '8.3';
                        }
                        // If can't auto-detect, leave it undefined - user can set manually
                    }
                }
            }

            currentVersion = '0.2';
        }

        // Set to current version
        config.schemaVersion = ConfigMigrationService.CURRENT_SCHEMA_VERSION;

        return Promise.resolve(config as FlintConfig);
    }

    /**
     * Gets the list of supported schema versions
     */
    getSupportedVersions(): readonly string[] {
        return Object.freeze(['0.1', '0.2']);
    }

    /**
     * Gets migration information for a specific version
     */
    getMigrationInfo(fromVersion: string): {
        canMigrate: boolean;
        steps: readonly string[];
        warnings: readonly string[];
    } {
        if (fromVersion === ConfigMigrationService.CURRENT_SCHEMA_VERSION) {
            return {
                canMigrate: false,
                steps: [],
                warnings: []
            };
        }

        const steps: string[] = [];
        const warnings: string[] = [];

        if (!fromVersion || fromVersion < '0.2') {
            steps.push('Add ignitionVersion field to gateway configurations');
            steps.push('Auto-detect Ignition version from gateway IDs where possible');
            warnings.push('Please verify auto-detected Ignition versions are correct');
        }

        return {
            canMigrate: true,
            steps: Object.freeze(steps),
            warnings: Object.freeze(warnings)
        };
    }

    /**
     * Gets current schema version
     */
    getCurrentSchemaVersion(): string {
        return ConfigMigrationService.CURRENT_SCHEMA_VERSION;
    }
}
