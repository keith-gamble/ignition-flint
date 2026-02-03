/**
 * @module GatewayErrors
 * @description Gateway connection and management specific error classes for the Flint extension
 */

import { FlintError } from './FlintError';

/**
 * Error thrown when gateway is not found in configuration
 */
export class GatewayNotFoundError extends FlintError {
    constructor(
        public readonly gatewayId: string,
        public readonly availableGateways?: string[]
    ) {
        const message = `Gateway not found: ${gatewayId}`;
        let userMessage = `Gateway "${gatewayId}" is not configured`;

        if (availableGateways && availableGateways.length > 0) {
            userMessage += `\nAvailable gateways: ${availableGateways.join(', ')}`;
        }

        super(message, 'GATEWAY_NOT_FOUND', userMessage);
        this.name = 'GatewayNotFoundError';
    }
}

/**
 * Error thrown when gateway configuration is invalid
 */
export class GatewayConfigurationError extends FlintError {
    constructor(
        public readonly gatewayId: string,
        public readonly validationErrors: string[]
    ) {
        const message = `Invalid gateway configuration: ${gatewayId} - ${validationErrors.join(', ')}`;
        const userMessage = `Gateway "${gatewayId}" configuration is invalid:\n${validationErrors.map(err => `• ${err}`).join('\n')}`;

        super(message, 'GATEWAY_CONFIGURATION_ERROR', userMessage);
        this.name = 'GatewayConfigurationError';
    }

    /**
     * Creates a GatewayConfigurationError for a single validation issue
     */
    static single(gatewayId: string, validationError: string): GatewayConfigurationError {
        return new GatewayConfigurationError(gatewayId, [validationError]);
    }
}

/**
 * Error thrown when gateway version is not supported
 */
export class UnsupportedGatewayVersionError extends FlintError {
    constructor(
        public readonly gatewayId: string,
        public readonly version: string,
        public readonly minSupportedVersion: string,
        public readonly maxSupportedVersion?: string
    ) {
        const message = `Unsupported gateway version: ${gatewayId} v${version}`;
        let userMessage = `Gateway "${gatewayId}" version ${version} is not supported\nMinimum version: ${minSupportedVersion}`;

        if (maxSupportedVersion) {
            userMessage += `\nMaximum version: ${maxSupportedVersion}`;
        }

        super(message, 'UNSUPPORTED_GATEWAY_VERSION', userMessage);
        this.name = 'UnsupportedGatewayVersionError';
    }
}

/**
 * Error thrown when project is not found on gateway
 */
export class ProjectNotFoundOnGatewayError extends FlintError {
    constructor(
        public readonly projectName: string,
        public readonly gatewayId: string,
        public readonly availableProjects?: string[]
    ) {
        const message = `Project not found on gateway: ${projectName} on ${gatewayId}`;
        let userMessage = `Project "${projectName}" was not found on gateway "${gatewayId}"`;

        if (availableProjects && availableProjects.length > 0) {
            userMessage += `\nAvailable projects: ${availableProjects.join(', ')}`;
        }

        super(message, 'PROJECT_NOT_FOUND_ON_GATEWAY', userMessage);
        this.name = 'ProjectNotFoundOnGatewayError';
    }
}

/**
 * Error thrown when gateway designer launcher is not available or fails
 */
export class DesignerLauncherError extends FlintError {
    constructor(
        public readonly gatewayId: string,
        public readonly reason: string,
        cause?: Error
    ) {
        const message = `Designer launcher error for gateway ${gatewayId}: ${reason}`;
        const userMessage = `Cannot launch Ignition Designer for gateway "${gatewayId}":\n${reason}`;

        super(message, 'DESIGNER_LAUNCHER_ERROR', userMessage, cause);
        this.name = 'DesignerLauncherError';
    }
}

/**
 * Error thrown when gateway requires license or has licensing issues
 */
export class GatewayLicenseError extends FlintError {
    constructor(
        public readonly gatewayId: string,
        public readonly licenseIssue: string
    ) {
        const message = `Gateway license error: ${gatewayId} - ${licenseIssue}`;
        const userMessage = `Gateway "${gatewayId}" license issue: ${licenseIssue}`;

        super(message, 'GATEWAY_LICENSE_ERROR', userMessage);
        this.name = 'GatewayLicenseError';
    }
}
