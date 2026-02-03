/**
 * @module CommandContext
 * @description Helper class for creating and managing command execution context
 * Provides utilities for context creation and service access
 */

import * as vscode from 'vscode';

import { FlintError, InvalidArgumentError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { CommandContext, ICommandRegistry } from '@/core/types/commands';

/**
 * Factory class for creating command contexts
 * Provides utilities for context management and validation
 */
export class CommandContextFactory {
    /**
     * Creates a command context for use in command construction
     * @param extensionContext - VS Code extension context
     * @param services - Service container instance
     * @param commandRegistry - Optional command registry instance
     * @returns Command context instance
     */
    static create(
        extensionContext: vscode.ExtensionContext,
        services: ServiceContainer,
        commandRegistry?: ICommandRegistry
    ): CommandContext {
        if (!extensionContext) {
            throw new InvalidArgumentError(
                'extensionContext',
                'VS Code ExtensionContext',
                extensionContext,
                'Extension context is required'
            );
        }

        if (!services) {
            throw new InvalidArgumentError(
                'services',
                'ServiceContainer instance',
                services,
                'Service container is required'
            );
        }

        if (!(services instanceof ServiceContainer)) {
            throw new InvalidArgumentError(
                'services',
                'ServiceContainer instance',
                services,
                'Must be an instance of ServiceContainer'
            );
        }

        const context: CommandContext = Object.freeze({
            extensionContext,
            services,
            commandRegistry
        });

        return context;
    }

    /**
     * Validates a command context to ensure it has all required properties
     * @param context - Context to validate
     * @throws FlintError if context is invalid
     */
    static validate(context: CommandContext): void {
        if (!context) {
            throw new InvalidArgumentError('context', 'CommandContext', context, 'Context cannot be null or undefined');
        }

        if (!context.extensionContext) {
            throw new FlintError(
                'Extension context is missing from command context',
                'MISSING_EXTENSION_CONTEXT',
                'CommandContext must have a valid extensionContext property'
            );
        }

        if (!context.services) {
            throw new FlintError(
                'Services container is missing from command context',
                'MISSING_SERVICES',
                'CommandContext must have a valid services property'
            );
        }

        // Validate service container has basic functionality
        if (
            typeof context.services.get !== 'function' ||
            typeof context.services.has !== 'function' ||
            typeof context.services.register !== 'function'
        ) {
            throw new FlintError(
                'Service container in command context is invalid',
                'INVALID_SERVICE_CONTAINER',
                'ServiceContainer must implement get, has, and register methods'
            );
        }
    }

    /**
     * Clones a command context with optional overrides
     * @param context - Original context to clone
     * @param overrides - Properties to override in the clone
     * @returns New command context with overrides applied
     */
    static clone(context: CommandContext, overrides: Partial<CommandContext> = {}): CommandContext {
        this.validate(context);

        const clonedContext: CommandContext = {
            extensionContext: (overrides.extensionContext ?? context.extensionContext) as vscode.ExtensionContext,
            services: overrides.services ?? context.services,
            commandRegistry: overrides.commandRegistry ?? context.commandRegistry
        };

        return Object.freeze(clonedContext);
    }
}

/**
 * Utility class for working with command contexts
 * Provides helper methods for common context operations
 */
export class CommandContextUtils {
    /**
     * Gets a service from the context with type safety and better error handling
     * @param context - Command context
     * @param serviceKey - Service key to retrieve
     * @param required - Whether the service is required (default: true)
     * @returns Service instance or undefined if not required and not found
     */
    static getService<T>(context: CommandContext, serviceKey: string, required = true): T | undefined {
        CommandContextFactory.validate(context);

        if (!serviceKey || typeof serviceKey !== 'string') {
            throw new InvalidArgumentError('serviceKey', 'non-empty string', serviceKey);
        }

        if (!context.services.has(serviceKey)) {
            if (required) {
                throw new FlintError(
                    `Required service '${serviceKey}' is not available in command context`,
                    'SERVICE_NOT_FOUND',
                    `Service must be registered before command execution. Available services: ${this.getAvailableServices(context).join(', ')}`
                );
            }
            return undefined;
        }

        return context.services.get<T>(serviceKey);
    }

    /**
     * Gets all available service keys from the context
     * @param context - Command context
     * @returns Array of available service keys
     */
    static getAvailableServices(context: CommandContext): readonly string[] {
        CommandContextFactory.validate(context);

        // Use ServiceContainer's getServiceKeys method if available
        if (context.services instanceof ServiceContainer) {
            return context.services.getServiceKeys();
        }

        // Fallback if ServiceContainer doesn't have getServiceKeys method
        console.warn('ServiceContainer does not implement getServiceKeys method');
        return [];
    }

    /**
     * Checks if a service is available in the context
     * @param context - Command context
     * @param serviceKey - Service key to check
     * @returns True if service is available
     */
    static hasService(context: CommandContext, serviceKey: string): boolean {
        try {
            CommandContextFactory.validate(context);
            return context.services.has(serviceKey);
        } catch {
            return false;
        }
    }

    /**
     * Gets the VS Code extension context from the command context
     * @param context - Command context
     * @returns VS Code extension context
     */
    static getExtensionContext(context: CommandContext): vscode.ExtensionContext {
        CommandContextFactory.validate(context);
        return context.extensionContext as vscode.ExtensionContext;
    }

    /**
     * Gets the command registry from the context if available
     * @param context - Command context
     * @param required - Whether the registry is required (default: false)
     * @returns Command registry or undefined if not required and not available
     */
    static getCommandRegistry(context: CommandContext, required = false): ICommandRegistry | undefined {
        CommandContextFactory.validate(context);

        if (!context.commandRegistry && required) {
            throw new FlintError(
                'Command registry is not available in command context',
                'COMMAND_REGISTRY_NOT_FOUND',
                'CommandRegistry must be provided in context for this operation'
            );
        }

        return context.commandRegistry;
    }

    /**
     * Creates a summary of the command context for debugging
     * @param context - Command context
     * @returns Context summary object
     */
    static summarize(context: CommandContext): Readonly<{
        hasExtensionContext: boolean;
        hasServices: boolean;
        hasCommandRegistry: boolean;
        availableServices: readonly string[];
        contextValid: boolean;
    }> {
        let contextValid = false;
        let availableServices: readonly string[] = [];

        try {
            CommandContextFactory.validate(context);
            contextValid = true;
            availableServices = this.getAvailableServices(context);
        } catch {
            // Context is invalid, summary will reflect this
        }

        return Object.freeze({
            hasExtensionContext: Boolean(context.extensionContext),
            hasServices: Boolean(context.services),
            hasCommandRegistry: Boolean(context.commandRegistry),
            availableServices,
            contextValid
        });
    }
}
