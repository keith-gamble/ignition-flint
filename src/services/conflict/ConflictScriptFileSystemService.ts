/**
 * @module ConflictScriptFileSystemService
 * @description Virtual filesystem provider for conflict script versions
 * Allows viewing and editing decoded Python scripts from merge conflicts
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ConflictScriptEntry, ConflictSide, ScriptConflict } from '@/core/types/conflict';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ConflictDetectionService } from '@/services/conflict/ConflictDetectionService';
import { encodeScript } from '@/utils/decode';

/**
 * Virtual filesystem provider for conflict scripts
 * Uses the 'flint-conflict' URI scheme
 */
export class ConflictScriptFileSystemService implements vscode.FileSystemProvider, IServiceLifecycle {
    /** URI scheme for conflict scripts */
    static readonly SCHEME = 'flint-conflict';

    private serviceContainer: ServiceContainer;
    private isInitialized = false;

    /** Registered conflict script entries (URI string -> entry) */
    private readonly conflictEntries = new Map<string, ConflictScriptEntry>();

    /** File change event emitter */
    private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

    constructor(serviceContainer: ServiceContainer) {
        this.serviceContainer = serviceContainer;
    }

    // ============================================================================
    // SERVICE LIFECYCLE
    // ============================================================================

    async initialize(): Promise<void> {
        await Promise.resolve();
        this.isInitialized = true;
        console.log('ConflictScriptFileSystemService: Initialized');
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async stop(): Promise<void> {
        await Promise.resolve();
        this.conflictEntries.clear();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this._onDidChangeFile.dispose();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    // ============================================================================
    // CONFLICT SCRIPT HANDLING
    // ============================================================================

    /**
     * Get a function definition wrapper based on the JSON key
     * This provides visual context for the script in the diff view
     */
    private getFunctionDefinition(jsonKey: string): string {
        switch (jsonKey) {
            case 'script':
                return 'def runAction(self, event):\n';
            case 'code':
                return 'def transform(self, value, quality, timestamp):\n';
            default:
                return `def ${jsonKey}(self):\n`;
        }
    }

    /**
     * Opens a conflict script for viewing/editing
     * Returns the URI of the virtual Python file
     */
    openConflictScript(documentUri: vscode.Uri, conflict: ScriptConflict, side: ConflictSide): vscode.Uri {
        // Get the decoded script for this side
        const rawContent = side === 'current' ? conflict.currentScript : conflict.incomingScript;
        const originalEncoded =
            side === 'current'
                ? this.extractEncodedFromContent(conflict.currentContent, conflict.jsonKey)
                : this.extractEncodedFromContent(conflict.incomingContent, conflict.jsonKey);

        // Add function definition wrapper for better visual context
        const functionDefinition = this.getFunctionDefinition(conflict.jsonKey);
        const content = functionDefinition + rawContent;

        // Create a unique URI for this conflict script
        const fileName = `${conflict.jsonKey}-${side}`;
        const scriptUri = vscode.Uri.parse(
            `${ConflictScriptFileSystemService.SCHEME}:/${fileName}.py` +
                `?file=${encodeURIComponent(documentUri.fsPath)}` +
                `&conflictId=${encodeURIComponent(conflict.id)}` +
                `&side=${side}` +
                `&jsonKey=${encodeURIComponent(conflict.jsonKey)}`
        );

        // Store the entry
        const entry: ConflictScriptEntry = {
            originalUri: documentUri.fsPath,
            conflictId: conflict.id,
            side,
            jsonKey: conflict.jsonKey,
            conflict,
            content,
            functionDefinition,
            originalEncoded: originalEncoded ?? '',
            lastModified: Date.now()
        };
        this.conflictEntries.set(scriptUri.toString(), entry);

        return scriptUri;
    }

    /**
     * Extract the encoded script value from conflict content
     */
    private extractEncodedFromContent(content: string, jsonKey: string): string | undefined {
        const regex = new RegExp(`"${jsonKey}":\\s*"((?:[^"\\\\]|\\\\.)*)"`);
        const match = content.match(regex);
        return match ? match[1] : undefined;
    }

    // ============================================================================
    // FILESYSTEM PROVIDER IMPLEMENTATION
    // ============================================================================

    watch(_uri: vscode.Uri): vscode.Disposable {
        return new vscode.Disposable(() => undefined);
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const entry = this.conflictEntries.get(uri.toString());
        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        return {
            type: vscode.FileType.File,
            ctime: entry.lastModified,
            mtime: entry.lastModified,
            size: Buffer.byteLength(entry.content, 'utf8')
        };
    }

    readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
        throw vscode.FileSystemError.NoPermissions('Directory operations not supported');
    }

    createDirectory(_uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions('Directory operations not supported');
    }

    readFile(uri: vscode.Uri): Uint8Array {
        const entry = this.conflictEntries.get(uri.toString());
        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        return Buffer.from(entry.content, 'utf8');
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        const entry = this.conflictEntries.get(uri.toString());
        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        const newContent = Buffer.from(content).toString('utf8');

        // Update the entry
        entry.content = newContent;
        entry.lastModified = Date.now();

        // Resolve the conflict in the original file
        await this.resolveConflict(entry, newContent);

        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    delete(_uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions('Delete not supported');
    }

    rename(_oldUri: vscode.Uri, _newUri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions('Rename not supported');
    }

    // ============================================================================
    // CONFLICT RESOLUTION
    // ============================================================================

    /**
     * Resolve the conflict by replacing the conflict block with the resolved script
     */
    private async resolveConflict(entry: ConflictScriptEntry, resolvedScript: string): Promise<void> {
        // Strip the function definition wrapper before encoding
        let scriptToEncode = resolvedScript;
        if (entry.functionDefinition && scriptToEncode.startsWith(entry.functionDefinition)) {
            scriptToEncode = scriptToEncode.slice(entry.functionDefinition.length);
        }

        // Encode the script
        const encodedScript = encodeScript(scriptToEncode);

        // Open the original document
        const originalUri = vscode.Uri.file(entry.originalUri);
        const document = await vscode.workspace.openTextDocument(originalUri);

        // Re-parse conflicts to get current line numbers (in case file changed)
        const conflictService = this.serviceContainer.get<ConflictDetectionService>('ConflictDetectionService');
        if (!conflictService) {
            throw new FlintError('ConflictDetectionService not available', 'SERVICE_NOT_FOUND');
        }

        const result = conflictService.parseConflicts(document);
        const conflict = result.scriptConflicts.find(c => c.id === entry.conflictId);

        if (!conflict) {
            throw new FlintError(
                'Conflict no longer exists',
                'CONFLICT_NOT_FOUND',
                'The conflict may have been resolved or the file may have changed'
            );
        }

        // Build the replacement text
        // We need to preserve the indentation from the original
        const scriptLineIndent = this.detectScriptIndent(document, conflict);
        const replacement = `${scriptLineIndent}"${entry.jsonKey}": "${encodedScript}"`;

        // Calculate the range to replace (entire conflict block)
        const startPos = new vscode.Position(conflict.startLine, 0);
        const endPos = new vscode.Position(conflict.endLine, document.lineAt(conflict.endLine).text.length);
        const range = new vscode.Range(startPos, endPos);

        // Apply the edit
        const edit = new vscode.WorkspaceEdit();
        edit.replace(originalUri, range, replacement);
        const success = await vscode.workspace.applyEdit(edit);

        if (!success) {
            throw new FlintError('Failed to resolve conflict', 'EDIT_FAILED', 'Could not apply edit to the file');
        }

        // Invalidate the conflict cache
        conflictService.invalidateCache(originalUri);

        // Clean up entries for this conflict
        this.cleanupConflictEntries(entry.conflictId);

        // Show success message
        void vscode.window.showInformationMessage(`Conflict resolved with ${entry.side} script (edited)`);
    }

    /**
     * Detect the indentation of the script line within a conflict
     */
    private detectScriptIndent(document: vscode.TextDocument, conflict: ScriptConflict): string {
        // Look for the script/code line in the current content to get indentation
        const currentContent = conflict.currentContent;
        const lines = currentContent.split(/\r?\n/);

        for (const line of lines) {
            if (line.includes(`"${conflict.jsonKey}":`)) {
                const match = line.match(/^(\s*)/);
                return match ? match[1] : '';
            }
        }

        // Fallback: try to get indentation from the start line
        const startLineText = document.lineAt(conflict.startLine).text;
        const match = startLineText.match(/^(\s*)/);
        return match ? match[1] : '';
    }

    /**
     * Clean up all entries for a specific conflict
     */
    private cleanupConflictEntries(conflictId: string): void {
        for (const [uri, entry] of this.conflictEntries) {
            if (entry.conflictId === conflictId) {
                this.conflictEntries.delete(uri);
            }
        }
    }

    /**
     * Get an existing entry by conflict ID and side
     * Returns undefined if no entry exists (file not opened yet)
     */
    getEntryByConflictAndSide(conflictId: string, side: ConflictSide): ConflictScriptEntry | undefined {
        for (const entry of this.conflictEntries.values()) {
            if (entry.conflictId === conflictId && entry.side === side) {
                return entry;
            }
        }
        return undefined;
    }

    /**
     * Resolve a conflict with a specific side
     * If the virtual file has been edited, uses the edited content
     */
    async resolveConflictWithSide(documentUri: vscode.Uri, conflictId: string, side: ConflictSide): Promise<void> {
        // Get the conflict
        const conflictService = this.serviceContainer.get<ConflictDetectionService>('ConflictDetectionService');
        if (!conflictService) {
            throw new FlintError('ConflictDetectionService not available', 'SERVICE_NOT_FOUND');
        }

        const document = await vscode.workspace.openTextDocument(documentUri);
        const result = conflictService.parseConflicts(document);
        const conflict = result.scriptConflicts.find(c => c.id === conflictId);

        if (!conflict) {
            throw new FlintError('Conflict not found', 'CONFLICT_NOT_FOUND');
        }

        // Check if there's an existing entry with potential edits
        const existingEntry = this.getEntryByConflictAndSide(conflictId, side);

        if (existingEntry) {
            // Use the existing entry (which may have been edited)
            // The resolveConflict method will strip the function wrapper
            await this.resolveConflict(existingEntry, existingEntry.content);
        } else {
            // No existing entry - use the original decoded script
            const script = side === 'current' ? conflict.currentScript : conflict.incomingScript;

            // Create a temporary entry for resolution
            // Note: functionDefinition is empty since we're passing the raw script
            const tempEntry: ConflictScriptEntry = {
                originalUri: documentUri.fsPath,
                conflictId,
                side,
                jsonKey: conflict.jsonKey,
                conflict,
                content: script,
                functionDefinition: '',
                originalEncoded: '',
                lastModified: Date.now()
            };

            // Resolve with the raw script (no wrapper to strip)
            await this.resolveConflict(tempEntry, script);
        }
    }

    /**
     * Gets the scheme used by this provider
     */
    getScheme(): string {
        return ConflictScriptFileSystemService.SCHEME;
    }
}
