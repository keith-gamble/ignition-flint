/**
 * @module CommandRegistry
 * @description Registry for managing command registration and lookup
 * Handles VS Code command registration and provides type-safe command access
 */

import * as vscode from 'vscode';

import { FlintError, InvalidArgumentError } from '@/core/errors';
import { ICommand, ICommandRegistry, CommandContext } from '@/core/types/commands';

/**
 * Registry that manages command registration with VS Code and provides lookup capabilities
 * Implements the ICommandRegistry interface with enhanced functionality
 */
export class CommandRegistry implements ICommandRegistry {
    private readonly commands = new Map<string, ICommand>();
    private readonly disposables = new Map<string, vscode.Disposable>();
    private readonly context: CommandContext;

    constructor(context: CommandContext) {
        this.context = context;
    }

    /**
     * Registers a single command with VS Code and the internal registry
     * @param command - Command to register
     * @returns VS Code disposable for cleanup
     */
    register(command: ICommand): vscode.Disposable {
        this.validateCommand(command);

        if (this.commands.has(command.id)) {
            throw new FlintError(
                `Command '${command.id}' is already registered`,
                'COMMAND_ALREADY_REGISTERED',
                `Attempted to register duplicate command: ${command.id}`
            );
        }

        try {
            // Register with VS Code
            const disposable = vscode.commands.registerCommand(command.id, async (...args: unknown[]) => {
                try {
                    await command.execute(...args);
                } catch (error) {
                    console.error(`Command execution failed: ${command.id}`, error);
                    // Error is already handled in Command.execute(), just log and rethrow
                    throw error;
                }
            });

            // Store in internal registry
            this.commands.set(command.id, command);
            this.disposables.set(command.id, disposable);

            return disposable;
        } catch (error) {
            throw new FlintError(
                `Failed to register command '${command.id}'`,
                'COMMAND_REGISTRATION_FAILED',
                `VS Code command registration failed: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Registers multiple commands in batch
     * @param commands - Commands to register
     * @returns Array of VS Code disposables for cleanup
     */
    registerAll(commands: readonly ICommand[]): readonly vscode.Disposable[] {
        if (!Array.isArray(commands)) {
            throw new InvalidArgumentError('commands', 'array of ICommand', commands);
        }

        const disposables: vscode.Disposable[] = [];
        const registeredCommands: string[] = [];

        try {
            for (const command of commands) {
                const typedCommand = command as ICommand;
                const disposable = this.register(typedCommand);
                disposables.push(disposable);
                registeredCommands.push(typedCommand.id);
            }

            return Object.freeze(disposables);
        } catch (error) {
            // Clean up any commands that were successfully registered before the failure
            console.warn(
                `Failed to register all commands, cleaning up ${registeredCommands.length} registered commands`
            );
            for (const commandId of registeredCommands) {
                this.unregister(commandId);
            }
            throw error;
        }
    }

    /**
     * Gets a registered command by ID
     * @param id - Command ID
     * @returns Command instance or undefined if not found
     */
    get(id: string): ICommand | undefined {
        if (!id || typeof id !== 'string') {
            throw new InvalidArgumentError('id', 'non-empty string', id);
        }
        return this.commands.get(id);
    }

    /**
     * Gets all registered commands
     * @returns Read-only array of all commands
     */
    getAll(): readonly ICommand[] {
        return Object.freeze(Array.from(this.commands.values()));
    }

    /**
     * Checks if a command is registered
     * @param id - Command ID
     * @returns True if command is registered
     */
    has(id: string): boolean {
        if (!id || typeof id !== 'string') {
            return false;
        }
        return this.commands.has(id);
    }

    /**
     * Gets all registered command IDs
     * @returns Read-only array of command IDs
     */
    getCommandIds(): readonly string[] {
        return Object.freeze(Array.from(this.commands.keys()));
    }

    /**
     * Unregisters a command from VS Code and the internal registry
     * @param id - Command ID to unregister
     * @returns True if command was unregistered, false if it wasn't registered
     */
    unregister(id: string): boolean {
        if (!this.commands.has(id)) {
            return false;
        }

        try {
            // Dispose VS Code command registration
            const disposable = this.disposables.get(id);
            if (disposable) {
                disposable.dispose();
                this.disposables.delete(id);
            }

            // Remove from internal registry
            this.commands.delete(id);

            return true;
        } catch (error) {
            console.error(`Failed to unregister command: ${id}`, error);
            throw new FlintError(
                `Failed to unregister command '${id}'`,
                'COMMAND_UNREGISTER_FAILED',
                `Error during command cleanup: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Unregisters all commands and disposes resources
     */
    dispose(): void {
        const commandIds = Array.from(this.commands.keys());
        console.log(`Disposing command registry with ${commandIds.length} commands`);

        const errors: Error[] = [];

        // Unregister all commands
        for (const id of commandIds) {
            try {
                this.unregister(id);
            } catch (error) {
                errors.push(error instanceof Error ? error : new Error(String(error)));
            }
        }

        // Clear all collections
        this.commands.clear();
        this.disposables.clear();

        // Report any errors that occurred during disposal
        if (errors.length > 0) {
            console.error('Errors occurred during command registry disposal:', errors);
            throw new FlintError(
                'Some commands failed to unregister during disposal',
                'COMMAND_DISPOSAL_FAILED',
                `${errors.length} command(s) failed to unregister properly`
            );
        }

        console.log('Command registry disposed successfully');
    }

    /**
     * Executes a registered command by ID
     * @param id - Command ID
     * @param args - Command arguments
     * @returns Promise that resolves when command completes
     */
    async execute(id: string, ...args: unknown[]): Promise<void> {
        const command = this.get(id);
        if (!command) {
            throw new FlintError(
                `Command '${id}' is not registered`,
                'COMMAND_NOT_FOUND',
                `Available commands: ${this.getCommandIds().join(', ')}`
            );
        }

        return command.execute(...args);
    }

    /**
     * Gets commands by category or filter
     * @param filter - Filter function to apply
     * @returns Array of matching commands
     */
    getCommands(filter?: (command: ICommand) => boolean): readonly ICommand[] {
        const commands = this.getAll();

        if (!filter) {
            return commands;
        }

        return Object.freeze(commands.filter(filter));
    }

    /**
     * Gets registry statistics
     * @returns Registry statistics object
     */
    getStats(): Readonly<{
        commandCount: number;
        commandIds: readonly string[];
        hasVSCodeDisposables: boolean;
    }> {
        return Object.freeze({
            commandCount: this.commands.size,
            commandIds: this.getCommandIds(),
            hasVSCodeDisposables: this.disposables.size === this.commands.size
        });
    }

    /**
     * Validates a command before registration
     */
    private validateCommand(command: ICommand): void {
        // TypeScript ensures command is non-null, but validate its properties

        if (!command.id || typeof command.id !== 'string' || command.id.length === 0) {
            throw new InvalidArgumentError('command.id', 'non-empty string', command.id);
        }

        if (typeof command.execute !== 'function') {
            throw new InvalidArgumentError('command.execute', 'function', typeof command.execute);
        }

        // Validate command ID format
        if (!command.id.includes('.')) {
            throw new InvalidArgumentError(
                'command.id',
                'format "namespace.commandName"',
                command.id,
                'Command ID must contain a dot separator'
            );
        }
    }
}
