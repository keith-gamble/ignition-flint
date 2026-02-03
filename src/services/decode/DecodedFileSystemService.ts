/**
 * @module DecodedFileSystemService
 * @description Virtual filesystem provider for decoded Ignition JSON files
 * Provides on-demand decoding of embedded Python scripts with full read/write support
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { extractAndDecodeScripts, encodeScriptsInContent, ExtractionResult } from '@/utils/decode';

/**
 * Metadata for a registered decoded file
 */
interface DecodedFileEntry {
    /** Original file URI (file:// scheme) */
    readonly originalUri: vscode.Uri;
    /** Original file path */
    readonly originalPath: string;
    /** Cached decoded content */
    decodedContent: string;
    /** Last extraction result for script locations */
    extractionResult: ExtractionResult;
    /** File modification time */
    mtime: number;
    /** File size in bytes */
    size: number;
    /** File watcher disposable */
    watcher?: vscode.Disposable;
}

/**
 * Virtual filesystem provider for decoded Ignition JSON files
 * Registers the 'flint-decoded' URI scheme and handles read/write operations
 */
export class DecodedFileSystemService implements vscode.FileSystemProvider, IServiceLifecycle {
    /** URI scheme for decoded files */
    static readonly SCHEME = 'flint-decoded';

    private serviceContainer: ServiceContainer;
    private context: vscode.ExtensionContext;
    private isInitialized = false;

    /** Registered decoded files (path -> entry) */
    private readonly fileEntries = new Map<string, DecodedFileEntry>();

    /** File change event emitter for VS Code */
    private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

    /** Event when a decoded file is registered */
    private readonly _onFileRegistered = new vscode.EventEmitter<vscode.Uri>();
    readonly onFileRegistered: vscode.Event<vscode.Uri> = this._onFileRegistered.event;

    /** Event when a decoded file is unregistered */
    private readonly _onFileUnregistered = new vscode.EventEmitter<vscode.Uri>();
    readonly onFileUnregistered: vscode.Event<vscode.Uri> = this._onFileUnregistered.event;

    constructor(serviceContainer: ServiceContainer, context: vscode.ExtensionContext) {
        this.serviceContainer = serviceContainer;
        this.context = context;
    }

    // ============================================================================
    // SERVICE LIFECYCLE
    // ============================================================================

    async initialize(): Promise<void> {
        try {
            await Promise.resolve(); // Satisfy async requirement
            this.isInitialized = true;
            console.log('DecodedFileSystemService: Initialized');
        } catch (error) {
            throw new FlintError(
                'Failed to initialize decoded filesystem service',
                'DECODED_FS_INIT_FAILED',
                'Decoded filesystem service could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async stop(): Promise<void> {
        await Promise.resolve(); // Satisfy async requirement
        // Dispose all file watchers
        for (const entry of this.fileEntries.values()) {
            entry.watcher?.dispose();
        }
        this.fileEntries.clear();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this._onDidChangeFile.dispose();
        this._onFileRegistered.dispose();
        this._onFileUnregistered.dispose();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    // ============================================================================
    // FILE REGISTRATION
    // ============================================================================

    /**
     * Registers a file for decoded viewing
     * Creates a decoded URI that maps to the original file
     *
     * @param originalUri - The original file:// URI
     * @returns The decoded file URI (flint-decoded:// scheme)
     */
    async registerFile(originalUri: vscode.Uri): Promise<vscode.Uri> {
        const originalPath = originalUri.fsPath;

        // Check if already registered
        if (this.fileEntries.has(originalPath)) {
            const entry = this.fileEntries.get(originalPath)!;
            await this.refreshEntry(entry);
            return this.createDecodedUri(originalPath);
        }

        // Read and decode the file
        const content = await fs.readFile(originalPath, 'utf8');
        const extractionResult = extractAndDecodeScripts(content);
        const stat = await fs.stat(originalPath);

        // Create file watcher for the original file
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(path.dirname(originalPath), path.basename(originalPath))
        );

        const entry: DecodedFileEntry = {
            originalUri,
            originalPath,
            decodedContent: extractionResult.decodedContent,
            extractionResult,
            mtime: stat.mtimeMs,
            size: Buffer.byteLength(extractionResult.decodedContent, 'utf8'),
            watcher
        };

        // Watch for changes to the original file
        watcher.onDidChange(async () => {
            await this.handleOriginalFileChange(entry);
        });

        watcher.onDidDelete(() => {
            this.unregisterFile(this.createDecodedUri(originalPath));
        });

        this.fileEntries.set(originalPath, entry);

        const decodedUri = this.createDecodedUri(originalPath);
        this._onFileRegistered.fire(decodedUri);

        console.log(`DecodedFileSystemService: Registered file ${originalPath}`);
        return decodedUri;
    }

    /**
     * Unregisters a decoded file
     *
     * @param decodedUri - The decoded file URI to unregister
     */
    unregisterFile(decodedUri: vscode.Uri): void {
        const originalPath = this.getOriginalPath(decodedUri);
        const entry = this.fileEntries.get(originalPath);

        if (entry) {
            entry.watcher?.dispose();
            this.fileEntries.delete(originalPath);
            this._onFileUnregistered.fire(decodedUri);
            console.log(`DecodedFileSystemService: Unregistered file ${originalPath}`);
        }
    }

    /**
     * Checks if a file is registered for decoded viewing
     */
    isFileRegistered(decodedUri: vscode.Uri): boolean {
        const originalPath = this.getOriginalPath(decodedUri);
        return this.fileEntries.has(originalPath);
    }

    /**
     * Gets the original file URI from a decoded URI
     */
    getOriginalUri(decodedUri: vscode.Uri): vscode.Uri | undefined {
        const originalPath = this.getOriginalPath(decodedUri);
        const entry = this.fileEntries.get(originalPath);
        return entry?.originalUri;
    }

    /**
     * Refreshes a decoded file from the original
     */
    async refreshFile(decodedUri: vscode.Uri): Promise<void> {
        const originalPath = this.getOriginalPath(decodedUri);
        const entry = this.fileEntries.get(originalPath);

        if (entry) {
            await this.refreshEntry(entry);
            this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri: decodedUri }]);
        }
    }

    // ============================================================================
    // FILESYSTEM PROVIDER IMPLEMENTATION
    // ============================================================================

    watch(_uri: vscode.Uri): vscode.Disposable {
        // File watching is handled internally via file watchers on original files
        return new vscode.Disposable(() => {
            // Cleanup handled by unregisterFile
        });
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const originalPath = this.getOriginalPath(uri);
        const entry = this.fileEntries.get(originalPath);

        if (!entry) {
            // Try to register the file on-demand
            const originalUri = vscode.Uri.file(originalPath);
            try {
                await this.registerFile(originalUri);
                const newEntry = this.fileEntries.get(originalPath);
                if (newEntry) {
                    return {
                        type: vscode.FileType.File,
                        ctime: newEntry.mtime,
                        mtime: newEntry.mtime,
                        size: newEntry.size
                    };
                }
            } catch {
                // Fall through to error
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        return {
            type: vscode.FileType.File,
            ctime: entry.mtime,
            mtime: entry.mtime,
            size: entry.size
        };
    }

    readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
        // Decoded files are virtual - no directory support
        throw vscode.FileSystemError.NoPermissions('Directory operations not supported for decoded files');
    }

    createDirectory(_uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions('Directory operations not supported for decoded files');
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const originalPath = this.getOriginalPath(uri);
        let entry = this.fileEntries.get(originalPath);

        if (!entry) {
            // Try to register the file on-demand
            const originalUri = vscode.Uri.file(originalPath);
            try {
                await this.registerFile(originalUri);
                entry = this.fileEntries.get(originalPath);
            } catch {
                // Fall through to error
            }
        }

        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        return Buffer.from(entry.decodedContent, 'utf8');
    }

    async writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        _options: { create: boolean; overwrite: boolean }
    ): Promise<void> {
        const originalPath = this.getOriginalPath(uri);
        const entry = this.fileEntries.get(originalPath);

        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        // Decode the content from Uint8Array
        const decodedContent = Buffer.from(content).toString('utf8');

        // Validate JSON syntax before saving
        try {
            JSON.parse(decodedContent);
        } catch (error) {
            throw new FlintError(
                'Invalid JSON syntax',
                'INVALID_JSON',
                `Cannot save decoded file: ${error instanceof Error ? error.message : 'Invalid JSON'}`
            );
        }

        // Encode scripts back to Ignition format
        const encodedContent = encodeScriptsInContent(decodedContent);

        // Write to the original file
        await fs.writeFile(originalPath, encodedContent, 'utf8');

        // Update the entry
        const stat = await fs.stat(originalPath);
        entry.decodedContent = decodedContent;
        entry.extractionResult = extractAndDecodeScripts(encodedContent);
        entry.mtime = stat.mtimeMs;
        entry.size = Buffer.byteLength(decodedContent, 'utf8');

        console.log(`DecodedFileSystemService: Saved decoded file to ${originalPath}`);

        // Fire change event
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    delete(_uri: vscode.Uri): void {
        // Don't allow deleting through the decoded filesystem
        throw vscode.FileSystemError.NoPermissions(
            'Delete not supported for decoded files. Delete the original file instead.'
        );
    }

    rename(_oldUri: vscode.Uri, _newUri: vscode.Uri): void {
        // Don't allow renaming through the decoded filesystem
        throw vscode.FileSystemError.NoPermissions(
            'Rename not supported for decoded files. Rename the original file instead.'
        );
    }

    // ============================================================================
    // PRIVATE HELPERS
    // ============================================================================

    /**
     * Creates a decoded URI from an original file path
     */
    private createDecodedUri(originalPath: string): vscode.Uri {
        return vscode.Uri.parse(`${DecodedFileSystemService.SCHEME}:${originalPath}`);
    }

    /**
     * Extracts the original file path from a decoded URI
     */
    private getOriginalPath(decodedUri: vscode.Uri): string {
        // The path is stored after the scheme
        return decodedUri.path;
    }

    /**
     * Refreshes a file entry from the original file
     */
    private async refreshEntry(entry: DecodedFileEntry): Promise<void> {
        try {
            const content = await fs.readFile(entry.originalPath, 'utf8');
            const extractionResult = extractAndDecodeScripts(content);
            const stat = await fs.stat(entry.originalPath);

            entry.decodedContent = extractionResult.decodedContent;
            entry.extractionResult = extractionResult;
            entry.mtime = stat.mtimeMs;
            entry.size = Buffer.byteLength(extractionResult.decodedContent, 'utf8');
        } catch (error) {
            console.error(`DecodedFileSystemService: Failed to refresh ${entry.originalPath}:`, error);
        }
    }

    /**
     * Handles changes to the original file
     */
    private async handleOriginalFileChange(entry: DecodedFileEntry): Promise<void> {
        await this.refreshEntry(entry);

        const decodedUri = this.createDecodedUri(entry.originalPath);
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri: decodedUri }]);

        console.log(`DecodedFileSystemService: Original file changed, refreshed ${entry.originalPath}`);
    }

    // ============================================================================
    // PUBLIC UTILITIES
    // ============================================================================

    /**
     * Gets the URI scheme used by this provider
     */
    getScheme(): string {
        return DecodedFileSystemService.SCHEME;
    }

    /**
     * Gets statistics about registered files
     */
    getStats(): { registeredFiles: number; totalDecodedSize: number } {
        let totalDecodedSize = 0;
        for (const entry of this.fileEntries.values()) {
            totalDecodedSize += entry.size;
        }
        return {
            registeredFiles: this.fileEntries.size,
            totalDecodedSize
        };
    }

    /**
     * Gets the extraction result for a decoded file
     * Useful for inspecting found scripts
     */
    getExtractionResult(decodedUri: vscode.Uri): ExtractionResult | undefined {
        const originalPath = this.getOriginalPath(decodedUri);
        const entry = this.fileEntries.get(originalPath);
        return entry?.extractionResult;
    }
}
