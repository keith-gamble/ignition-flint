/**
 * @module ValidationUtilities
 * @description Validation utilities module exports
 * Enhanced validation operations for configuration files and various data formats
 */

export * from './ValidationUtilities';
export * from './ConfigValidator';

// Re-export commonly used types from ValidationUtilities
export type {
    ValidationRule,
    ValidationContext,
    ValidationResult,
    ValidationMessage,
    ValidationSuggestion,
    ValidationConfiguration,
    BatchValidationOptions,
    ValidationProgress
} from './ValidationUtilities';

// Re-export validation enums
export { ValidationSeverity, ValidationCategory } from './ValidationUtilities';

// Re-export commonly used types from ConfigValidator
export type {
    ConfigValidationContext,
    GatewayValidationResult,
    ProjectPathValidationResult,
    ConfigValidationOptions,
    SchemaValidationResult
} from './ConfigValidator';

// Export type aliases for convenience
export type {
    ValidationResult as ValidatorResult,
    ValidationMessage as ValidatorMessage,
    ValidationRule as ValidatorRule
} from './ValidationUtilities';

export type {
    ConfigValidationContext as ConfigContext,
    ConfigValidationOptions as ConfigOptions
} from './ConfigValidator';
