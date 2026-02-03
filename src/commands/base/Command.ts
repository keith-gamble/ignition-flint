/**
 * @module Command
 * @description Base command class that all commands must extend
 * Provides common functionality and enforces consistent command structure
 */

import * as vscode from 'vscode';

import { FlintError, InvalidArgumentError } from '@/core/errors';
import {
    ICommand,
    CommandContext,
    CommandResult,
    CommandValidationResult,
    CommandExecutionOptions
} from '@/core/types/commands';

/**
 * Abstract base class for all commands in the Flint extension
 * Implements common command functionality and error handling patterns
 */
export abstract class Command implements ICommand {
    /**
     * Command context containing services and extension context
     */
    protected readonly context: CommandContext;

    constructor(
        public readonly id: string,
        context: CommandContext
    ) {
        this.validateCommandId(id);
        this.context = context;
    }

    /**
     * Executes the command with the given arguments
     * Handles validation, error catching, and result formatting
     */
    async execute(...args: unknown[]): Promise<void> {
        try {
            // Validate arguments before execution
            const validation = this.validateArguments(...args);
            if (!validation.isValid) {
                throw new InvalidArgumentError(
                    'arguments',
                    'valid command arguments',
                    args,
                    validation.errors.join(', ')
                );
            }

            // Show warnings if any
            if (validation.warnings.length > 0) {
                await this.showWarnings(validation.warnings);
            }

            // Check if command can be executed in current context
            if (!this.canExecute(...args)) {
                throw new FlintError(
                    `Command '${this.id}' cannot be executed in current context`,
                    'COMMAND_EXECUTION_BLOCKED'
                );
            }

            // Execute the command implementation
            await this.executeImpl(...args);
        } catch (error) {
            await this.handleExecutionError(error, args);
            throw error;
        }
    }

    /**
     * Checks if the command can be executed with the given arguments
     * Override this method to implement custom execution conditions
     */
    canExecute(..._args: unknown[]): boolean {
        return true;
    }

    /**
     * Gets the display title for this command
     * Override to provide dynamic titles based on context
     */
    getTitle(): string {
        return this.id;
    }

    /**
     * Validates command arguments before execution
     * Override this method to implement custom argument validation
     */
    protected validateArguments(..._args: unknown[]): CommandValidationResult {
        return {
            isValid: true,
            errors: [],
            warnings: []
        };
    }

    /**
     * Abstract method that subclasses must implement
     * Contains the actual command logic
     */
    protected abstract executeImpl(...args: unknown[]): Promise<void>;

    /**
     * Executes a command with progress reporting and options
     * Useful for long-running operations
     */
    protected async executeWithProgress<T>(
        operation: (progress?: (increment: number, message?: string) => void) => Promise<T>,
        options: CommandExecutionOptions = {}
    ): Promise<T> {
        const {
            showProgress = false,
            progressTitle = `Executing ${this.getTitle()}...`,
            timeoutMs,
            cancellable = true
        } = options;

        // Disable progress dialogs in test environments to prevent hangs
        const isTestEnvironment = this.isTestEnvironment();
        if (isTestEnvironment) {
            console.log(`Command ${this.id}: Detected test environment, skipping progress dialog`);
        }
        if (!showProgress || isTestEnvironment) {
            // Execute without progress indication
            if (timeoutMs !== undefined) {
                return this.executeWithTimeout(operation, timeoutMs);
            }
            return operation();
        }

        // Execute with VS Code progress indication
        return new Promise<T>((resolve, reject) => {
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: progressTitle,
                    cancellable
                },
                async (
                    progress: vscode.Progress<{ increment?: number; message?: string }>,
                    token: vscode.CancellationToken
                ) => {
                    try {
                        const reportProgress = (increment: number, message?: string): void => {
                            progress.report({ increment, message });
                        };

                        // Handle cancellation
                        if (cancellable) {
                            token.onCancellationRequested(() => {
                                reject(new FlintError('Command execution cancelled', 'COMMAND_CANCELLED'));
                            });
                        }

                        let result: T;
                        if (timeoutMs !== undefined) {
                            result = await this.executeWithTimeout(() => operation(reportProgress), timeoutMs);
                        } else {
                            result = await operation(reportProgress);
                        }

                        resolve(result);
                    } catch (error) {
                        reject(error instanceof Error ? error : new Error(String(error)));
                    }
                }
            );
        });
    }

    /**
     * Detects if running in a test environment to avoid progress dialogs
     */
    private isTestEnvironment(): boolean {
        try {
            // Check for common test indicators
            const isMochaTest = typeof globalThis !== 'undefined' && 'describe' in globalThis && 'it' in globalThis;
            const hasTestFixtures =
                vscode.workspace.workspaceFolders?.some(folder => folder.uri.path.includes('test-fixtures')) === true;
            const isNodeTest = process.env.NODE_ENV === 'test';

            console.log(
                `Test environment check: Mocha=${isMochaTest}, TestFixtures=${hasTestFixtures}, NodeEnv=${isNodeTest}`
            );

            return isMochaTest || hasTestFixtures || isNodeTest;
        } catch (error) {
            console.log(`Test environment check failed: ${String(error)}`);
            return false;
        }
    }

    /**
     * Executes an operation with a timeout
     */
    private async executeWithTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
        return Promise.race([
            operation(),
            new Promise<never>((_, reject) => {
                setTimeout(() => {
                    reject(new FlintError(`Command '${this.id}' timed out after ${timeoutMs}ms`, 'COMMAND_TIMEOUT'));
                }, timeoutMs);
            })
        ]);
    }

    /**
     * Shows warning messages to the user
     */
    protected async showWarnings(warnings: readonly string[]): Promise<void> {
        for (const warning of warnings) {
            await vscode.window.showWarningMessage(`${this.getTitle()}: ${warning}`);
        }
    }

    /**
     * Handles errors that occur during command execution
     */
    protected async handleExecutionError(error: unknown, args: unknown[]): Promise<void> {
        if (error instanceof FlintError) {
            // Show user-friendly error message
            const message = error.getUserMessage();
            await vscode.window.showErrorMessage(`${this.getTitle()}: ${message}`);
        } else if (error instanceof Error) {
            // Wrap unknown errors
            const wrappedError = FlintError.wrap(error, 'COMMAND_EXECUTION_ERROR');
            await vscode.window.showErrorMessage(`${this.getTitle()}: ${wrappedError.getUserMessage()}`);
        } else {
            // Handle non-Error objects
            await vscode.window.showErrorMessage(`${this.getTitle()}: An unexpected error occurred`);
        }

        // Log error details for debugging
        console.error(`Command execution failed: ${this.id}`, {
            error,
            arguments: args,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Validates that the command ID is valid
     */
    private validateCommandId(id: string): void {
        if (!id || typeof id !== 'string') {
            throw new InvalidArgumentError('id', 'non-empty string', id);
        }

        if (!id.includes('.')) {
            throw new InvalidArgumentError(
                'id',
                'format "namespace.commandName"',
                id,
                'Command ID must contain a dot separator'
            );
        }
    }

    /**
     * Gets a service from the service container with type safety
     */
    protected getService<T>(serviceKey: string): T {
        if (!this.context.services.has(serviceKey)) {
            throw new FlintError(
                `Required service '${serviceKey}' is not available`,
                'SERVICE_NOT_FOUND',
                `Service '${serviceKey}' must be registered before executing command '${this.id}'`
            );
        }
        return this.context.services.get<T>(serviceKey);
    }

    /**
     * Creates a command result object
     */
    protected createResult<T>(
        success: boolean,
        data?: T,
        error?: string,
        metadata?: Record<string, unknown>
    ): CommandResult<T> {
        return {
            success,
            data,
            error,
            metadata: metadata ? Object.freeze(metadata) : undefined
        };
    }
}
