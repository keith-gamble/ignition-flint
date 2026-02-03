/**
 * @module CommandBase
 * @description Command infrastructure base classes and utilities
 * Exports all base command functionality for use throughout the extension
 */

// Base command class
export { Command } from './Command';

// Command registry
export { CommandRegistry } from './CommandRegistry';

// Command context utilities
export { CommandContextFactory, CommandContextUtils } from './CommandContext';

// Re-export command types for convenience
export type {
    ICommand,
    ICommandRegistry,
    CommandContext,
    CommandResult,
    CommandValidationResult,
    CommandExecutionOptions,
    CreateResourceArgs,
    DeleteResourceArgs,
    RenameResourceArgs,
    CopyResourceArgs,
    SelectGatewayArgs,
    SelectProjectArgs,
    SearchResourcesArgs,
    ConfigurationArgs,
    GatewayManagementArgs,
    ProjectPathArgs,
    OperationContext,
    CommandProgress,
    ProgressUpdate
} from '@/core/types/commands';
