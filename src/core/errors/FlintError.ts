/**
 * @module FlintError
 * @description Base error class for all Flint-specific errors
 */

/**
 * Base error class for all Flint-specific errors
 * Provides structured error handling with error codes and user-friendly messages
 */
export class FlintError extends Error {
    /**
     * Creates a new FlintError
     * @param message - Technical error message for logging
     * @param code - Unique error code for error discrimination
     * @param userMessage - Optional user-friendly message for display
     * @param cause - Optional underlying error that caused this error
     */
    constructor(
        message: string,
        public readonly code: string,
        public readonly userMessage?: string,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = 'FlintError';

        // Maintain proper stack trace for V8 engines
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, FlintError);
        }

        // Include cause in stack trace if available
        if (cause?.stack) {
            this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
        }
    }

    /**
     * Gets the message to display to the user
     * Falls back to technical message if no user message provided
     */
    getUserMessage(): string {
        return this.userMessage ?? this.message;
    }

    /**
     * Creates a JSON representation of the error
     * Useful for logging and debugging
     */
    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            userMessage: this.userMessage,
            stack: this.stack,
            cause: this.cause
                ? {
                      name: this.cause.name,
                      message: this.cause.message,
                      stack: this.cause.stack
                  }
                : undefined
        };
    }

    /**
     * Checks if an error is a FlintError with the given code
     * @param error - Error to check
     * @param code - Error code to match
     */
    static hasCode(error: unknown, code: string): error is FlintError {
        return error instanceof FlintError && error.code === code;
    }

    /**
     * Wraps an unknown error as a FlintError
     * Useful for handling unexpected errors
     * @param error - Unknown error to wrap
     * @param code - Error code to assign
     * @param userMessage - User-friendly message
     */
    static wrap(error: unknown, code: string, userMessage?: string): FlintError {
        if (error instanceof FlintError) {
            return error;
        }

        const message = error instanceof Error ? error.message : String(error);
        const cause = error instanceof Error ? error : undefined;

        return new FlintError(`Wrapped error: ${message}`, code, userMessage, cause);
    }
}

/**
 * Error thrown when an operation is attempted but not supported
 */
export class UnsupportedOperationError extends FlintError {
    constructor(operation: string, context?: string) {
        const message = `Unsupported operation: ${operation}${context ? ` in ${context}` : ''}`;
        super(message, 'UNSUPPORTED_OPERATION', `This operation is not supported: ${operation}`);
        this.name = 'UnsupportedOperationError';
    }
}

/**
 * Error thrown when invalid arguments are provided to a method
 */
export class InvalidArgumentError extends FlintError {
    constructor(argumentName: string, expectedType: string, actualValue: unknown, additionalInfo?: string) {
        const message = `Invalid argument '${argumentName}': expected ${expectedType}, got ${typeof actualValue}${additionalInfo ? ` (${additionalInfo})` : ''}`;
        super(message, 'INVALID_ARGUMENT', `Invalid ${argumentName}: ${additionalInfo ?? `expected ${expectedType}`}`);
        this.name = 'InvalidArgumentError';
    }
}

/**
 * Error thrown when a required dependency is not available
 */
export class DependencyError extends FlintError {
    constructor(dependencyName: string, reason?: string) {
        const message = `Dependency not available: ${dependencyName}${reason ? ` (${reason})` : ''}`;
        super(
            message,
            'DEPENDENCY_ERROR',
            `Required component '${dependencyName}' is not available${reason ? `: ${reason}` : ''}`
        );
        this.name = 'DependencyError';
    }
}

/**
 * Error thrown when an operation times out
 */
export class TimeoutError extends FlintError {
    constructor(operation: string, timeoutMs: number, additionalInfo?: string) {
        const message = `Operation timed out: ${operation} (${timeoutMs}ms)${additionalInfo ? ` - ${additionalInfo}` : ''}`;
        super(message, 'TIMEOUT', `Operation timed out: ${operation}${additionalInfo ? ` (${additionalInfo})` : ''}`);
        this.name = 'TimeoutError';
    }
}
