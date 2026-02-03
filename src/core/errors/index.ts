/**
 * @module CoreErrors
 * @description Base error classes for the Flint extension
 */

// Export base error classes first (no circular dependencies)
export {
    FlintError,
    UnsupportedOperationError,
    InvalidArgumentError,
    DependencyError,
    TimeoutError
} from './FlintError';

// Then export specific error classes that depend on FlintError
export * from './ResourceErrors';
export * from './ConfigurationErrors';
export * from './GatewayErrors';
