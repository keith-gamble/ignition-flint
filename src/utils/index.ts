/**
 * @module Utils
 * @description Utilities module exports
 * Enhanced utility classes and functions for path operations, search, validation, and tool integration
 */

// Path utilities
export * from './path';

// Config utilities (merging, validation)
export * from './config';

// Decode utilities (Ignition script encoding/decoding)
export * from './decode';

// Search utilities
export * from './search';

// Validation utilities - explicit exports to avoid naming conflicts
export { ValidationUtilities, ConfigValidator, ValidationSeverity, ValidationCategory } from './validation';

export type {
    ValidationRule,
    ValidationResult,
    ValidationMessage,
    ValidationSuggestion,
    ValidationConfiguration,
    BatchValidationOptions,
    ValidationProgress,
    ConfigValidationContext,
    GatewayValidationResult,
    ProjectPathValidationResult,
    ConfigValidationOptions,
    SchemaValidationResult
} from './validation';

// Aliased validation context to avoid conflict with path utilities
export type { ValidationContext as ValidatorContext } from './validation';

// Tool utilities (enhanced classes with service lifecycle support)
export { DesignerLauncherHelper } from './designerLauncherHelper';
export { KindlingHelper } from './kindlingHelper';

// Re-export tool utility types
export type { DesignerLaunchOptions, DesignerLauncherConfig } from './designerLauncherHelper';

export type { KindlingLaunchOptions, KindlingExecutionResult, KindlingConfig } from './kindlingHelper';

// Utility function exports
export { openWithKindling } from './kindlingHelper';

// Utility class exports
export * from './resourceScanHelper';
export * from './errorHelper';
export * from './searchHelper';

// Common utility constants
export const UTILITY_CONSTANTS = {
    // Path constants
    MAX_PATH_LENGTH: 260,
    INVALID_PATH_CHARS: /[<>:"|?*]/g,

    // Search constants
    DEFAULT_SEARCH_LIMIT: 100,
    MAX_SEARCH_RESULTS: 1000,

    // Validation constants
    MAX_VALIDATION_MESSAGES: 100,
    DEFAULT_VALIDATION_TIMEOUT: 5000,

    // Tool constants
    KINDLING_EXTENSIONS: ['.gwbk', '.modl', '.idb', '.log'],
    DESIGNER_PROTOCOL: 'designer://',

    // Common timeouts
    DEFAULT_TIMEOUT: 5000,
    LONG_TIMEOUT: 15000,
    SHORT_TIMEOUT: 2000
} as const;

// Utility helper functions
export const UtilityHelpers = {
    /**
     * Safely parses JSON with error handling
     */
    safeJsonParse: <T = unknown>(json: string, fallback: T): T => {
        try {
            return JSON.parse(json) as T;
        } catch {
            return fallback;
        }
    },

    /**
     * Debounces a function call
     */
    debounce: <T extends (...args: unknown[]) => unknown>(
        func: T,
        wait: number
    ): ((...args: Parameters<T>) => void) => {
        let timeout: NodeJS.Timeout | undefined;
        return (...args: Parameters<T>) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    },

    /**
     * Throttles a function call
     */
    throttle: <T extends (...args: unknown[]) => unknown>(
        func: T,
        limit: number
    ): ((...args: Parameters<T>) => void) => {
        let inThrottle: boolean;
        return (...args: Parameters<T>) => {
            if (!inThrottle) {
                func(...args);
                inThrottle = true;
                setTimeout(() => (inThrottle = false), limit);
            }
        };
    },

    /**
     * Creates a promise that resolves after a delay
     */
    delay: (ms: number): Promise<void> => {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Creates a promise with timeout
     */
    withTimeout: <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
        return Promise.race([
            promise,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Operation timed out')), timeoutMs))
        ]);
    },

    /**
     * Safely executes an async function with error handling
     */
    safeAsync: async <T>(asyncFn: () => Promise<T>, fallback: T, onError?: (error: Error) => void): Promise<T> => {
        try {
            return await asyncFn();
        } catch (error) {
            if (onError && error instanceof Error) {
                onError(error);
            }
            return fallback;
        }
    },

    /**
     * Formats file size in human readable format
     */
    formatFileSize: (bytes: number): string => {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    },

    /**
     * Escapes string for use in regular expression
     */
    escapeRegExp: (string: string): string => {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    /**
     * Capitalizes the first letter of a string
     */
    capitalize: (string: string): string => {
        return string.charAt(0).toUpperCase() + string.slice(1);
    },

    /**
     * Converts camelCase to kebab-case
     */
    camelToKebab: (string: string): string => {
        return string.replace(/([A-Z])/g, '-$1').toLowerCase();
    },

    /**
     * Converts kebab-case to camelCase
     */
    kebabToCamel: (string: string): string => {
        return string.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    }
} as const;
