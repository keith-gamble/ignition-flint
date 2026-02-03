/**
 * @module CoreTypes
 * @description Centralized type definitions for the Flint extension
 * Re-exports all type definitions from core modules
 */

// Re-export all types from sub-modules except conflicting ones
export * from '@/core/types/models';

// Re-export resources types except ProjectResource to avoid conflict
export type {
    ResourcePattern,
    ResourceCategory,
    ResourceTypeDefinition,
    ResourceTemplate,
    ResourceEditorConfig,
    ResourceProvider,
    ResourceScanResult,
    ResourceFileInfo,
    ResourceEditor,
    ResourceOperations,
    ResourceSearchProvider,
    ResourceSearchOptions,
    ResourceSearchResult,
    ResourceSearchMatch,
    ResourceSearchFilter,
    FilterOption,
    ResourceValidationResult,
    ResourceCreationContext,
    ResourceType
} from '@/core/types/resources';

// Export ProjectResource with alias to resolve conflict
export { ProjectResource as ResourcesProjectResource } from '@/core/types/resources';
export * from '@/core/types/commands';
export * from '@/core/types/services';
export * from '@/core/types/tree';
