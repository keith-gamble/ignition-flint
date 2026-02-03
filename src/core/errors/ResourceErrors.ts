/**
 * @module ResourceErrors
 * @description Resource-specific error classes for the Flint extension
 */

import { FlintError } from './FlintError';

/**
 * Error thrown when a resource is not found
 */
export class ResourceNotFoundError extends FlintError {
    constructor(
        public readonly resourcePath: string,
        public readonly projectId?: string,
        public readonly resourceType?: string
    ) {
        const message = `Resource not found: ${resourcePath}${projectId ? ` in project ${projectId}` : ''}${resourceType ? ` (${resourceType})` : ''}`;
        const userMessage = `Cannot find ${resourceType ?? 'resource'} "${resourcePath}"${projectId ? ` in project ${projectId}` : ''}`;

        super(message, 'RESOURCE_NOT_FOUND', userMessage);
        this.name = 'ResourceNotFoundError';
    }
}

/**
 * Error thrown when attempting to create a resource that already exists
 */
export class ResourceExistsError extends FlintError {
    constructor(
        public readonly resourcePath: string,
        public readonly projectId?: string,
        public readonly resourceType?: string
    ) {
        const message = `Resource already exists: ${resourcePath}${projectId ? ` in project ${projectId}` : ''}${resourceType ? ` (${resourceType})` : ''}`;
        const userMessage = `${resourceType ?? 'Resource'} "${resourcePath}" already exists${projectId ? ` in project ${projectId}` : ''}`;

        super(message, 'RESOURCE_EXISTS', userMessage);
        this.name = 'ResourceExistsError';
    }
}

/**
 * Error thrown when resource validation fails
 */
export class ResourceValidationError extends FlintError {
    constructor(
        public readonly resourcePath: string,
        public readonly validationErrors: string[],
        public readonly resourceType?: string
    ) {
        const message = `Resource validation failed for ${resourcePath}: ${validationErrors.join(', ')}`;
        const userMessage = `${resourceType ?? 'Resource'} "${resourcePath}" is invalid:\n${validationErrors.map(err => `• ${err}`).join('\n')}`;

        super(message, 'RESOURCE_VALIDATION_FAILED', userMessage);
        this.name = 'ResourceValidationError';
    }

    /**
     * Creates a ResourceValidationError for a single validation issue
     */
    static single(resourcePath: string, validationError: string, resourceType?: string): ResourceValidationError {
        return new ResourceValidationError(resourcePath, [validationError], resourceType);
    }
}

/**
 * Error thrown when resource name is invalid
 */
export class InvalidResourceNameError extends FlintError {
    constructor(
        public readonly resourceName: string,
        public readonly reason: string,
        public readonly resourceType?: string
    ) {
        const message = `Invalid resource name: ${resourceName} (${reason})`;
        const userMessage = `Invalid ${resourceType ?? 'resource'} name "${resourceName}": ${reason}`;

        super(message, 'INVALID_RESOURCE_NAME', userMessage);
        this.name = 'InvalidResourceNameError';
    }
}

/**
 * Error thrown when resource path is invalid
 */
export class InvalidResourcePathError extends FlintError {
    constructor(
        public readonly resourcePath: string,
        public readonly reason: string
    ) {
        const message = `Invalid resource path: ${resourcePath} (${reason})`;
        const userMessage = `Invalid resource path "${resourcePath}": ${reason}`;

        super(message, 'INVALID_RESOURCE_PATH', userMessage);
        this.name = 'InvalidResourcePathError';
    }
}

/**
 * Error thrown when resource type is not supported
 */
export class UnsupportedResourceTypeError extends FlintError {
    constructor(
        public readonly resourceType: string,
        public readonly availableTypes?: string[]
    ) {
        const message = `Unsupported resource type: ${resourceType}`;
        let userMessage = `Resource type "${resourceType}" is not supported`;

        if (availableTypes && availableTypes.length > 0) {
            userMessage += `\nAvailable types: ${availableTypes.join(', ')}`;
        }

        super(message, 'UNSUPPORTED_RESOURCE_TYPE', userMessage);
        this.name = 'UnsupportedResourceTypeError';
    }
}

/**
 * Error thrown when resource operation fails due to file system issues
 */
export class ResourceFileSystemError extends FlintError {
    constructor(
        public readonly resourcePath: string,
        public readonly operation: 'create' | 'read' | 'write' | 'delete' | 'rename' | 'copy',
        cause?: Error
    ) {
        const message = `File system error during ${operation} operation on ${resourcePath}`;
        const userMessage = `Failed to ${operation} resource "${resourcePath}"${cause ? `: ${cause.message}` : ''}`;

        super(message, 'RESOURCE_FILESYSTEM_ERROR', userMessage, cause);
        this.name = 'ResourceFileSystemError';
    }
}

/**
 * Error thrown when resource template is not found or invalid
 */
export class ResourceTemplateError extends FlintError {
    constructor(
        public readonly templateId: string,
        public readonly resourceType: string,
        public readonly reason: string
    ) {
        const message = `Resource template error: ${templateId} for ${resourceType} (${reason})`;
        const userMessage = `Template "${templateId}" for ${resourceType} is not available: ${reason}`;

        super(message, 'RESOURCE_TEMPLATE_ERROR', userMessage);
        this.name = 'ResourceTemplateError';
    }
}

/**
 * Error thrown when resource.json file is missing or invalid
 */
export class ResourceJsonError extends FlintError {
    constructor(
        public readonly resourcePath: string,
        public readonly issue: 'missing' | 'invalid' | 'corrupt',
        public readonly details?: string
    ) {
        const message = `Resource.json ${issue} for ${resourcePath}${details ? `: ${details}` : ''}`;
        let userMessage: string;

        switch (issue) {
            case 'missing':
                userMessage = `Missing resource.json file for "${resourcePath}"`;
                break;
            case 'invalid':
                userMessage = `Invalid resource.json file for "${resourcePath}"${details ? `: ${details}` : ''}`;
                break;
            case 'corrupt':
                userMessage = `Corrupted resource.json file for "${resourcePath}"${details ? `: ${details}` : ''}`;
                break;
            default:
                userMessage = `Unknown resource.json issue for "${resourcePath}"${details ? `: ${details}` : ''}`;
                break;
        }

        super(message, 'RESOURCE_JSON_ERROR', userMessage);
        this.name = 'ResourceJsonError';
    }
}

/**
 * Error thrown when resource operation is not allowed due to permissions or state
 */
export class ResourceOperationNotAllowedError extends FlintError {
    constructor(
        public readonly resourcePath: string,
        public readonly operation: string,
        public readonly reason: string
    ) {
        const message = `Operation '${operation}' not allowed on ${resourcePath}: ${reason}`;
        const userMessage = `Cannot ${operation} "${resourcePath}": ${reason}`;

        super(message, 'RESOURCE_OPERATION_NOT_ALLOWED', userMessage);
        this.name = 'ResourceOperationNotAllowedError';
    }
}
