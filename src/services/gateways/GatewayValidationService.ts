/**
 * @module GatewayValidationService
 * @description Service for validating gateway configurations
 */

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { GatewayConfig } from '@/core/types/configuration';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Gateway validation result
 */
export interface GatewayValidationResult {
    readonly isValid: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
}

/**
 * Service for validating gateway configurations
 * Simplified to focus only on configuration validation
 */
export class GatewayValidationService implements IServiceLifecycle {
    private isInitialized = false;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    initialize(): Promise<void> {
        this.isInitialized = true;
        // console.log('GatewayValidationService initialized (config validation only)');
        return Promise.resolve();
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            throw new FlintError(
                'GatewayValidationService must be initialized before starting',
                'SERVICE_NOT_INITIALIZED'
            );
        }
        // console.log('GatewayValidationService started');
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
     * Validates a gateway configuration
     */
    validateGateway(gatewayId: string, gatewayConfig: GatewayConfig): Promise<GatewayValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate gateway ID
        if (!gatewayId || typeof gatewayId !== 'string' || gatewayId.trim().length === 0) {
            errors.push('Gateway ID is required and must be a non-empty string');
        }

        // Validate gateway configuration
        const configErrors = this.validateGatewayConfig(gatewayConfig);
        errors.push(...configErrors);

        return Promise.resolve({
            isValid: errors.length === 0,
            errors: Object.freeze(errors),
            warnings: Object.freeze(warnings)
        });
    }

    /**
     * Validates gateway configuration structure
     */
    private validateGatewayConfig(config: GatewayConfig): string[] {
        const errors: string[] = [];

        if (!config) {
            errors.push('Gateway configuration is required');
            return errors;
        }

        // Validate host
        if (!config.host || typeof config.host !== 'string' || config.host.trim().length === 0) {
            errors.push('Gateway host is required and must be a non-empty string');
        }

        // Validate port (optional, but if provided must be valid)
        if (config.port !== undefined) {
            if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
                errors.push('Gateway port must be an integer between 1 and 65535');
            }
        }

        // Validate SSL setting (optional)
        if (config.ssl !== undefined && typeof config.ssl !== 'boolean') {
            errors.push('Gateway SSL setting must be a boolean');
        }

        // Validate projects (optional)
        if (config.projects !== undefined) {
            if (!Array.isArray(config.projects)) {
                errors.push('Gateway projects must be an array');
            } else {
                config.projects.forEach((project, index) => {
                    if (typeof project !== 'string') {
                        errors.push(`Gateway project at index ${index} must be a string`);
                    }
                });
            }
        }

        return errors;
    }
}
