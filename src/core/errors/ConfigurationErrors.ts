/**
 * @module ConfigurationErrors
 * @description Configuration-specific error classes for the Flint extension
 */

import { FlintError } from './FlintError';

/**
 * Error thrown when configuration file is not found
 */
export class ConfigurationNotFoundError extends FlintError {
    constructor(
        public readonly configPath: string,
        public readonly workspacePath?: string
    ) {
        const message = `Configuration file not found: ${configPath}${workspacePath ? ` in workspace ${workspacePath}` : ''}`;
        const userMessage = `Flint configuration file not found${workspacePath ? ` in workspace "${workspacePath}"` : ''}\nExpected: ${configPath}`;

        super(message, 'CONFIGURATION_NOT_FOUND', userMessage);
        this.name = 'ConfigurationNotFoundError';
    }
}

/**
 * Error thrown when configuration file is invalid or corrupted
 */
export class ConfigurationInvalidError extends FlintError {
    constructor(
        public readonly configPath: string,
        public readonly validationErrors: string[],
        cause?: Error
    ) {
        const message = `Invalid configuration file: ${configPath} - ${validationErrors.join(', ')}`;
        const userMessage = `Configuration file "${configPath}" is invalid:\n${validationErrors.map(err => `• ${err}`).join('\n')}`;

        super(message, 'CONFIGURATION_INVALID', userMessage, cause);
        this.name = 'ConfigurationInvalidError';
    }

    /**
     * Creates a ConfigurationInvalidError for a single validation issue
     */
    static single(configPath: string, validationError: string, cause?: Error): ConfigurationInvalidError {
        return new ConfigurationInvalidError(configPath, [validationError], cause);
    }
}

/**
 * Error thrown when configuration schema validation fails
 */
export class ConfigurationSchemaError extends FlintError {
    constructor(
        public readonly configPath: string,
        public readonly schemaErrors: Array<{
            path: string;
            message: string;
            value?: unknown;
        }>
    ) {
        const message = `Configuration schema validation failed: ${configPath}`;
        const userMessage = `Configuration file "${configPath}" does not match the expected format:\n${schemaErrors
            .map(err => `• ${err.path}: ${err.message}`)
            .join('\n')}`;

        super(message, 'CONFIGURATION_SCHEMA_ERROR', userMessage);
        this.name = 'ConfigurationSchemaError';
    }
}

/**
 * Error thrown when configuration migration fails
 */
export class ConfigurationMigrationError extends FlintError {
    constructor(
        public readonly configPath: string,
        public readonly fromVersion: string,
        public readonly toVersion: string,
        public readonly migrationStep: string,
        cause?: Error
    ) {
        const message = `Configuration migration failed: ${configPath} (${fromVersion} -> ${toVersion}) at step: ${migrationStep}`;
        const userMessage = `Failed to migrate configuration file "${configPath}" from version ${fromVersion} to ${toVersion}`;

        super(message, 'CONFIGURATION_MIGRATION_ERROR', userMessage, cause);
        this.name = 'ConfigurationMigrationError';
    }
}

/**
 * Error thrown when project path in configuration is invalid
 */
export class InvalidProjectPathError extends FlintError {
    constructor(
        public readonly projectPath: string,
        public readonly reason: string
    ) {
        const message = `Invalid project path: ${projectPath} (${reason})`;
        const userMessage = `Project path "${projectPath}" is invalid: ${reason}`;

        super(message, 'INVALID_PROJECT_PATH', userMessage);
        this.name = 'InvalidProjectPathError';
    }
}

/**
 * Error thrown when project path does not exist or is not accessible
 */
export class ProjectPathNotFoundError extends FlintError {
    constructor(
        public readonly projectPath: string,
        public readonly reason?: string
    ) {
        const message = `Project path not found: ${projectPath}${reason ? ` (${reason})` : ''}`;
        const userMessage = `Project path "${projectPath}" does not exist or is not accessible${reason ? `: ${reason}` : ''}`;

        super(message, 'PROJECT_PATH_NOT_FOUND', userMessage);
        this.name = 'ProjectPathNotFoundError';
    }
}

/**
 * Error thrown when configuration is missing required properties
 */
export class ConfigurationMissingPropertyError extends FlintError {
    constructor(
        public readonly configPath: string,
        public readonly propertyPath: string,
        public readonly description?: string
    ) {
        const message = `Missing required configuration property: ${propertyPath} in ${configPath}`;
        const userMessage = `Configuration file "${configPath}" is missing required property "${propertyPath}"${description ? `\n${description}` : ''}`;

        super(message, 'CONFIGURATION_MISSING_PROPERTY', userMessage);
        this.name = 'ConfigurationMissingPropertyError';
    }
}

/**
 * Error thrown when configuration property has invalid value
 */
export class ConfigurationInvalidPropertyError extends FlintError {
    constructor(
        public readonly configPath: string,
        public readonly propertyPath: string,
        public readonly expectedType: string,
        public readonly actualValue: unknown,
        public readonly additionalInfo?: string
    ) {
        const message = `Invalid configuration property: ${propertyPath} in ${configPath} (expected ${expectedType}, got ${typeof actualValue})`;
        const userMessage = `Configuration property "${propertyPath}" in "${configPath}" has invalid value\nExpected: ${expectedType}${additionalInfo ? `\n${additionalInfo}` : ''}`;

        super(message, 'CONFIGURATION_INVALID_PROPERTY', userMessage);
        this.name = 'ConfigurationInvalidPropertyError';
    }
}

/**
 * Error thrown when configuration file cannot be written
 */
export class ConfigurationWriteError extends FlintError {
    constructor(
        public readonly configPath: string,
        public readonly reason: string,
        cause?: Error
    ) {
        const message = `Failed to write configuration file: ${configPath} (${reason})`;
        const userMessage = `Cannot save configuration file "${configPath}": ${reason}`;

        super(message, 'CONFIGURATION_WRITE_ERROR', userMessage, cause);
        this.name = 'ConfigurationWriteError';
    }
}

/**
 * Error thrown when workspace has no valid configuration
 */
export class NoValidConfigurationError extends FlintError {
    constructor(
        public readonly workspacePath: string,
        public readonly searchedPaths: string[]
    ) {
        const message = `No valid configuration found in workspace: ${workspacePath}`;
        const userMessage = `No valid Flint configuration found in workspace "${workspacePath}"\nSearched locations:\n${searchedPaths.map(path => `• ${path}`).join('\n')}`;

        super(message, 'NO_VALID_CONFIGURATION', userMessage);
        this.name = 'NoValidConfigurationError';
    }
}

/**
 * Error thrown when multiple configuration files conflict
 */
export class ConfigurationConflictError extends FlintError {
    constructor(
        public readonly conflictingPaths: string[],
        public readonly conflictDescription: string
    ) {
        const message = `Configuration conflict: ${conflictDescription}`;
        const userMessage = `Configuration conflict detected: ${conflictDescription}\nConflicting files:\n${conflictingPaths.map(path => `• ${path}`).join('\n')}`;

        super(message, 'CONFIGURATION_CONFLICT', userMessage);
        this.name = 'ConfigurationConflictError';
    }
}
