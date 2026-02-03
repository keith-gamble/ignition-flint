/**
 * @module ConsoleCodeDocumentProvider
 * @description TextDocumentContentProvider for Script Console virtual documents
 * Provides the code content for debugging console scripts without creating temporary files
 */

import * as vscode from 'vscode';

import { CONSOLE_DOCUMENT_PATH, CONSOLE_DOCUMENT_SCHEME } from '@/services/debug';

/**
 * Provides virtual document content for Script Console debugging.
 * When VS Code requests the content of a flint-console:// URI, this provider
 * returns the current console buffer code.
 */
export class ConsoleCodeDocumentProvider implements vscode.TextDocumentContentProvider {
    private static instance: ConsoleCodeDocumentProvider | null = null;

    private content = '';
    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

    /**
     * Event that fires when the document content changes
     */
    readonly onDidChange = this.onDidChangeEmitter.event;

    /**
     * Gets the singleton instance of the provider
     */
    static getInstance(): ConsoleCodeDocumentProvider {
        if (!ConsoleCodeDocumentProvider.instance) {
            ConsoleCodeDocumentProvider.instance = new ConsoleCodeDocumentProvider();
        }
        return ConsoleCodeDocumentProvider.instance;
    }

    /**
     * Gets the URI for the console document
     */
    static getUri(): vscode.Uri {
        return vscode.Uri.parse(`${CONSOLE_DOCUMENT_SCHEME}:${CONSOLE_DOCUMENT_PATH}`);
    }

    /**
     * Provides the content for a virtual document
     */
    provideTextDocumentContent(uri: vscode.Uri): string {
        // Only provide content for our console document
        if (uri.path === CONSOLE_DOCUMENT_PATH) {
            return this.content;
        }
        return '';
    }

    /**
     * Updates the console document content
     */
    updateContent(code: string): void {
        this.content = code;
        this.onDidChangeEmitter.fire(ConsoleCodeDocumentProvider.getUri());
    }

    /**
     * Gets the current content
     */
    getContent(): string {
        return this.content;
    }

    /**
     * Clears the content
     */
    clearContent(): void {
        this.content = '';
        this.onDidChangeEmitter.fire(ConsoleCodeDocumentProvider.getUri());
    }

    /**
     * Disposes the provider
     */
    dispose(): void {
        this.onDidChangeEmitter.dispose();
        ConsoleCodeDocumentProvider.instance = null;
    }
}

/**
 * Registers the ConsoleCodeDocumentProvider with VS Code
 * @param context The extension context
 * @returns The registered provider instance
 */
export function registerConsoleCodeDocumentProvider(context: vscode.ExtensionContext): ConsoleCodeDocumentProvider {
    const provider = ConsoleCodeDocumentProvider.getInstance();

    const disposable = vscode.workspace.registerTextDocumentContentProvider(CONSOLE_DOCUMENT_SCHEME, provider);

    context.subscriptions.push(disposable);

    return provider;
}
