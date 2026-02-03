import * as vscode from 'vscode';

type ErrorType = (typeof ErrorHelper.ErrorTypes)[keyof typeof ErrorHelper.ErrorTypes];

/**
 * Centralized error handling and user messaging
 * Standardizes error presentation across the extension
 */
export class ErrorHelper {
    /**
     * When true, suppresses console output from logError and logWarning.
     * Useful for tests to reduce noise.
     */
    static silent = false;

    // ============================================================================
    // ERROR TYPES
    // ============================================================================

    /**
     * Standard error categories for consistent handling
     */
    static readonly ErrorTypes = {
        VALIDATION: 'validation',
        FILE_SYSTEM: 'filesystem',
        NETWORK: 'network',
        CONFIGURATION: 'configuration',
        RESOURCE: 'resource',
        PROJECT: 'project',
        PERMISSION: 'permission',
        UNKNOWN: 'unknown'
    } as const;

    // ============================================================================
    // USER MESSAGES
    // ============================================================================

    /**
     * Shows an error message to the user with appropriate actions
     */
    static async showError(message: string, error?: Error | string, actions?: string[]): Promise<string | undefined> {
        const fullMessage = this.buildErrorMessage(message, error);

        if (actions && actions.length > 0) {
            return vscode.window.showErrorMessage(fullMessage, ...actions);
        }
        vscode.window.showErrorMessage(fullMessage);
        return undefined;
    }

    /**
     * Shows a warning message to the user
     */
    static async showWarning(message: string, actions?: string[]): Promise<string | undefined> {
        if (actions && actions.length > 0) {
            return vscode.window.showWarningMessage(message, ...actions);
        }
        vscode.window.showWarningMessage(message);
        return undefined;
    }

    /**
     * Shows an information message to the user
     */
    static async showInfo(message: string, actions?: string[]): Promise<string | undefined> {
        if (actions && actions.length > 0) {
            return vscode.window.showInformationMessage(message, ...actions);
        }
        vscode.window.showInformationMessage(message);
        return undefined;
    }

    // ============================================================================
    // RESOURCE-SPECIFIC ERRORS
    // ============================================================================

    /**
     * Handles resource not found errors
     */
    static async handleResourceNotFound(resourceType: string, resourcePath: string, projectId?: string): Promise<void> {
        const project = projectId !== undefined && projectId.length > 0 ? ` in project "${projectId}"` : '';
        await this.showError(`${resourceType} not found: "${resourcePath}"${project}`, undefined, [
            'Refresh Projects',
            'Create Resource'
        ]);
    }

    /**
     * Handles resource creation errors
     */
    static async handleResourceCreationError(
        resourceType: string,
        resourceName: string,
        error: Error | string,
        projectId?: string
    ): Promise<void> {
        const project = projectId !== undefined && projectId.length > 0 ? ` in project "${projectId}"` : '';
        const errorType = this.categorizeError(error);

        const actions: string[] = ['Retry'];
        let message = `Failed to create ${resourceType} "${resourceName}"${project}`;

        if (errorType === this.ErrorTypes.PERMISSION) {
            message += '. Check file permissions.';
            actions.push('Open Folder');
        } else if (errorType === this.ErrorTypes.FILE_SYSTEM) {
            message += '. Check available disk space and file permissions.';
            actions.push('Open Folder');
        }

        await this.showError(message, error, actions);
    }

    /**
     * Handles resource deletion errors
     */
    static async handleResourceDeletionError(
        resourceType: string,
        resourceName: string,
        error: Error | string
    ): Promise<void> {
        const errorType = this.categorizeError(error);

        let message = `Failed to delete ${resourceType} "${resourceName}"`;
        const actions: string[] = ['Retry'];

        if (errorType === this.ErrorTypes.PERMISSION) {
            message += '. Check if the file is in use or read-only.';
            actions.push('Force Delete', 'Open Folder');
        }

        await this.showError(message, error, actions);
    }

    /**
     * Handles inherited resource operation errors
     */
    static handleInheritedResourceError(
        operation: string,
        resourceType: string,
        resourceName: string,
        sourceProject: string
    ): void {
        const message =
            `Cannot ${operation} inherited ${resourceType} "${resourceName}". ` +
            `It is inherited from project "${sourceProject}".`;

        void this.showWarning(message, ['Go to Source Project']);
    }

    // ============================================================================
    // PROJECT-SPECIFIC ERRORS
    // ============================================================================

    /**
     * Handles project not found errors
     */
    static async handleProjectNotFound(projectId: string): Promise<void> {
        await this.showError(`Project not found: "${projectId}"`, 'The project may have been deleted or moved.', [
            'Refresh Projects',
            'Check Configuration'
        ]);
    }

    /**
     * Handles project scanning errors
     */
    static async handleProjectScanError(projectPath: string, error: Error | string): Promise<void> {
        const errorType = this.categorizeError(error);
        const actions: string[] = ['Retry'];

        if (errorType === this.ErrorTypes.PERMISSION) {
            actions.push('Open Folder');
        } else if (errorType === this.ErrorTypes.CONFIGURATION) {
            actions.push('Check Configuration');
        }

        await this.showError(`Failed to scan project: "${projectPath}"`, error, actions);
    }

    /**
     * Handles invalid project structure errors
     */
    static async handleInvalidProjectStructure(projectPath: string, issues: string[]): Promise<void> {
        const message = `Invalid Ignition project structure in "${projectPath}":\n${issues
            .map(issue => `• ${issue}`)
            .join('\n')}`;

        await this.showWarning(message, ['Create project.json', 'Open Folder', 'Remove from Workspace']);
    }

    // ============================================================================
    // CONFIGURATION ERRORS
    // ============================================================================

    /**
     * Handles configuration loading errors
     */
    static async handleConfigurationError(configPath: string, error: Error | string): Promise<void> {
        const errorType = this.categorizeError(error);
        const actions: string[] = ['Create Default Config'];

        if (errorType === this.ErrorTypes.VALIDATION) {
            actions.unshift('Fix Configuration');
        }

        await this.showError(`Failed to load configuration from "${configPath}"`, error, actions);
    }

    // ============================================================================
    // FILE SYSTEM ERRORS
    // ============================================================================

    /**
     * Handles file system permission errors
     */
    static async handlePermissionError(operation: string, path: string): Promise<void> {
        const message =
            `Permission denied: Cannot ${operation} "${path}". ` +
            'Check file permissions and ensure the file is not in use.';

        await this.showError(message, undefined, ['Open Folder', 'Run as Administrator']);
    }

    /**
     * Handles disk space errors
     */
    static async handleDiskSpaceError(path: string): Promise<void> {
        await this.showError(`Insufficient disk space to complete operation in "${path}"`, undefined, [
            'Free Up Space',
            'Choose Different Location'
        ]);
    }

    // ============================================================================
    // SEARCH ERRORS
    // ============================================================================

    /**
     * Handles search errors
     */
    static async handleSearchError(query: string, error: Error | string): Promise<void> {
        const message = `Search failed for query "${query}"`;

        await this.showError(message, error, ['Try Again', 'Simplify Query']);
    }

    /**
     * Handles no search results
     */
    static handleNoSearchResults(query: string, suggestions?: string[]): void {
        let message = `No results found for "${query}"`;

        if (suggestions && suggestions.length > 0) {
            message += `\n\nSuggestions:\n${suggestions.map(s => `• ${s}`).join('\n')}`;
        }

        void this.showInfo(message);
    }

    // ============================================================================
    // ERROR PROCESSING
    // ============================================================================

    /**
     * Builds a complete error message from components
     */
    private static buildErrorMessage(message: string, error?: Error | string): string {
        if (error === undefined || error === '') {
            return message;
        }

        const errorText = error instanceof Error ? error.message : String(error);

        // Avoid duplicating the same message
        if (message.includes(errorText)) {
            return message;
        }

        return `${message}\n\nDetails: ${errorText}`;
    }

    /**
     * Categorizes an error by type for appropriate handling
     */
    private static categorizeError(error: Error | string): ErrorType {
        const errorText = (error instanceof Error ? error.message : String(error)).toLowerCase();

        if (errorText.includes('permission') || errorText.includes('access') || errorText.includes('eacces')) {
            return this.ErrorTypes.PERMISSION;
        }

        if (errorText.includes('enoent') || errorText.includes('not found') || errorText.includes('enotdir')) {
            return this.ErrorTypes.FILE_SYSTEM;
        }

        if (errorText.includes('enospc') || errorText.includes('no space')) {
            return this.ErrorTypes.FILE_SYSTEM;
        }

        if (errorText.includes('network') || errorText.includes('connection') || errorText.includes('timeout')) {
            return this.ErrorTypes.NETWORK;
        }

        if (errorText.includes('config') || errorText.includes('invalid') || errorText.includes('parse')) {
            return this.ErrorTypes.CONFIGURATION;
        }

        if (errorText.includes('validation') || errorText.includes('invalid name')) {
            return this.ErrorTypes.VALIDATION;
        }

        if (errorText.includes('resource') || errorText.includes('project')) {
            return this.ErrorTypes.RESOURCE;
        }

        return this.ErrorTypes.UNKNOWN;
    }

    // ============================================================================
    // LOGGING
    // ============================================================================

    /**
     * Logs an error for debugging purposes
     */
    static logError(context: string, error: Error | string, additionalData?: Record<string, unknown>): void {
        if (this.silent) return;

        const timestamp = new Date().toISOString();
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;

        console.error(`[${timestamp}] ${context}: ${errorMessage}`, {
            error: errorMessage,
            stack,
            ...additionalData
        });
    }

    /**
     * Logs a warning for debugging purposes
     */
    static logWarning(context: string, message: string, additionalData?: Record<string, unknown>): void {
        if (this.silent) return;

        const timestamp = new Date().toISOString();

        console.warn(`[${timestamp}] ${context}: ${message}`, additionalData);
    }

    /**
     * Safely executes an async operation with error handling
     */
    static async safeAsync<T>(
        operation: () => Promise<T>,
        context: string,
        fallback?: T,
        showUserError: boolean = true
    ): Promise<T | undefined> {
        try {
            return await operation();
        } catch (error: unknown) {
            this.logError(context, error as Error | string);

            if (showUserError) {
                await this.showError(`Operation failed: ${context}`, error as Error | string);
            }

            return fallback;
        }
    }

    /**
     * Safely executes a synchronous operation with error handling
     */
    static safe<T>(operation: () => T, context: string, fallback?: T, showUserError: boolean = false): T | undefined {
        try {
            return operation();
        } catch (error: unknown) {
            this.logError(context, error as Error | string);

            if (showUserError) {
                void this.showError(`Operation failed: ${context}`, error as Error | string);
            }

            return fallback;
        }
    }

    // ============================================================================
    // CONFIRMATION DIALOGS
    // ============================================================================

    /**
     * Shows a confirmation dialog for destructive operations
     */
    static async confirmDestructiveOperation(operation: string, target: string, details?: string): Promise<boolean> {
        const message = `${operation}: ${target}?`;
        const fullMessage = details !== undefined && details.length > 0 ? `${message}\n\n${details}` : message;

        const result = await vscode.window.showWarningMessage(fullMessage, { modal: true }, 'Confirm', 'Cancel');

        return result === 'Confirm';
    }

    /**
     * Shows a confirmation dialog with custom actions
     */
    static async confirmWithOptions(
        message: string,
        options: { destructive?: string; safe?: string; cancel?: string } = {}
    ): Promise<'destructive' | 'safe' | 'cancel'> {
        const actions: string[] = [];

        if (options.destructive !== undefined && options.destructive.length > 0) {
            actions.push(options.destructive);
        }
        if (options.safe !== undefined && options.safe.length > 0) {
            actions.push(options.safe);
        }
        if (options.cancel !== undefined && options.cancel.length > 0) {
            actions.push(options.cancel || 'Cancel');
        }

        const result = await vscode.window.showWarningMessage(message, { modal: true }, ...actions);

        if (result === options.destructive) {
            return 'destructive';
        }
        if (result === options.safe) {
            return 'safe';
        }
        return 'cancel';
    }
}
