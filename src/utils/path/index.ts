/**
 * @module PathUtilities
 * @description Path utilities module exports
 * Enhanced path manipulation, validation, and resolution utilities
 */

export * from './PathUtilities';
export * from './ResourcePathResolver';
export * from './PathValidator';

// Re-export commonly used types from PathUtilities
export type { PathNormalizationOptions, PathValidationResult, ParsedResourcePath } from './PathUtilities';

// Re-export commonly used types from ResourcePathResolver
export type {
    ResourcePathContext,
    ParsedResourceKey,
    DisplayPathConfig,
    ResourceLocation
} from './ResourcePathResolver';

// Re-export commonly used types from PathValidator
export type {
    ValidationRuleConfig,
    PathValidationConfig,
    ValidationContext,
    DetailedValidationResult,
    PathSuggestionOptions
} from './PathValidator';

// Type aliases are available through re-exports above
