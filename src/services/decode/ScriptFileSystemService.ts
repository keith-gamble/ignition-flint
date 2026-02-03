/**
 * @module ScriptFileSystemService
 * @description Virtual filesystem provider for extracted Python scripts from JSON files
 * Allows editing individual script values as Python files with syntax highlighting
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { decodeScript, encodeScript } from '@/utils/decode';

/**
 * Script type definitions with function wrappers
 */
interface ScriptType {
    /** JSON key pattern (e.g., 'config.script', 'transforms.code') */
    readonly keyPattern: string;
    /** Display name for the script type */
    readonly displayName: string;
    /** Function definition to wrap the script with */
    getFunctionDefinition(context: ScriptContext): string;
    /** Default filename for the script */
    getFileName(context: ScriptContext): string;
}

/**
 * Context extracted from the parent JSON object
 */
interface ScriptContext {
    /** Method/function name if available */
    name?: string;
    /** Method parameters if available */
    params?: string[];
    /** Message type for message handlers */
    messageType?: string;
    /** Event ID for tag events */
    eventid?: string;
    /** Property name for property change scripts */
    property?: string;
}

/**
 * Metadata for an opened script file
 */
interface ScriptFileEntry {
    /** Original JSON file URI */
    readonly originalUri: vscode.Uri;
    /** Line number in the JSON file where the script value is */
    readonly lineNumber: number;
    /** The JSON key (e.g., 'script', 'code') */
    readonly jsonKey: string;
    /** Script type information */
    readonly scriptType: ScriptType;
    /** Context from parent JSON object */
    readonly context: ScriptContext;
    /** Current script content (with function wrapper) */
    content: string;
    /** Original encoded value (for change detection) */
    readonly originalEncoded: string;
}

/**
 * Known script types in Ignition JSON files
 */
const SCRIPT_TYPES: readonly ScriptType[] = [
    {
        keyPattern: 'config.script',
        displayName: 'Script',
        getFunctionDefinition: () => 'def runAction(self, event):\n',
        getFileName: () => 'runAction'
    },
    {
        keyPattern: 'transforms.code',
        displayName: 'Transform',
        getFunctionDefinition: () => 'def transform(self, value, quality, timestamp):\n',
        getFileName: () => 'transform'
    },
    {
        keyPattern: 'customMethods.script',
        displayName: 'Method',
        getFunctionDefinition: (ctx): string => {
            const name = ctx.name ?? 'customMethod';
            const params = ctx.params?.length ? `self, ${ctx.params.join(', ')}` : 'self';
            return `def ${name}(${params}):\n`;
        },
        getFileName: ctx => ctx.name ?? 'customMethod'
    },
    {
        keyPattern: 'messageHandlers.script',
        displayName: 'Handler',
        getFunctionDefinition: () => 'def onMessageReceived(self, payload):\n',
        getFileName: ctx => ctx.messageType ?? 'onMessageReceived'
    },
    {
        keyPattern: 'eventScripts.script',
        displayName: 'Tag Event',
        getFunctionDefinition: () =>
            'def valueChanged(tag, tagPath, previousValue, currentValue, initialChange, missedEvents):\n',
        getFileName: ctx => ctx.eventid ?? 'valueChanged'
    },
    {
        keyPattern: 'onChange.script',
        displayName: 'OnChange',
        getFunctionDefinition: () => 'def valueChanged(self, previousValue, currentValue, origin, missedEvents):\n',
        getFileName: ctx => ctx.property ?? 'onChange'
    }
];

/**
 * Virtual filesystem provider for extracted Python scripts
 * Uses the 'flint-script' URI scheme
 */
export class ScriptFileSystemService implements vscode.FileSystemProvider, IServiceLifecycle {
    /** URI scheme for script files */
    static readonly SCHEME = 'flint-script';

    private serviceContainer: ServiceContainer;
    private isInitialized = false;

    /** Registered script files (URI string -> entry) */
    private readonly scriptEntries = new Map<string, ScriptFileEntry>();

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
        console.log('ScriptFileSystemService: Initialized');
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async stop(): Promise<void> {
        await Promise.resolve();
        this.scriptEntries.clear();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this._onDidChangeFile.dispose();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    // ============================================================================
    // SCRIPT OPENING
    // ============================================================================

    /**
     * Opens a script from a JSON file at the specified position
     * Returns the URI of the virtual Python file
     */
    openScriptAtPosition(
        documentUri: vscode.Uri,
        lineNumber: number,
        scriptType: ScriptType,
        context: ScriptContext,
        encodedScript: string
    ): vscode.Uri {
        // Decode the script
        const decodedScript = decodeScript(encodedScript);

        // Add function definition wrapper
        const functionDef = scriptType.getFunctionDefinition(context);
        const content = functionDef + decodedScript;

        // Create a unique URI for this script
        const fileName = scriptType.getFileName(context);
        const scriptUri = vscode.Uri.parse(
            `${ScriptFileSystemService.SCHEME}:/${fileName}.py` +
                `?file=${encodeURIComponent(documentUri.fsPath)}` +
                `&line=${lineNumber}` +
                `&key=${scriptType.keyPattern}`
        );

        // Extract the JSON key from the pattern (last part)
        const jsonKey = scriptType.keyPattern.split('.').pop() ?? 'script';

        // Store the entry
        const entry: ScriptFileEntry = {
            originalUri: documentUri,
            lineNumber,
            jsonKey,
            scriptType,
            context,
            content,
            originalEncoded: encodedScript
        };
        this.scriptEntries.set(scriptUri.toString(), entry);

        return scriptUri;
    }

    /**
     * Detects the script type at a given line in a JSON document
     */
    async detectScriptAtLine(
        document: vscode.TextDocument,
        lineNumber: number
    ): Promise<{ scriptType: ScriptType; context: ScriptContext; encodedValue: string } | undefined> {
        // Get document symbols for proper JSON structure understanding
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );

        if (!symbols) {
            return undefined;
        }

        // Find the symbol at this line
        const symbol = this.findSymbolAtLine(symbols, lineNumber);
        if (!symbol) {
            return undefined;
        }

        // Check if this is a script or code key
        const keyName = symbol.name;
        if (keyName !== 'script' && keyName !== 'code') {
            return undefined;
        }

        // Find the symbol path to this line
        const symbolPath = this.getSymbolPath(symbols, lineNumber);
        if (!symbolPath) {
            return undefined;
        }

        // Determine the script type from the symbol path
        const scriptType = this.getScriptTypeFromPath(symbolPath, keyName);
        if (!scriptType) {
            return undefined;
        }

        // Extract the encoded value from the symbol's range
        const encodedValue = this.extractEncodedValue(document, symbol);
        if (!encodedValue) {
            return undefined;
        }

        // Extract context from parent symbol
        const context = this.extractContext(document, symbols, lineNumber);

        return { scriptType, context, encodedValue };
    }

    /**
     * Finds the deepest symbol that contains the given line
     */
    private findSymbolAtLine(symbols: vscode.DocumentSymbol[], lineNumber: number): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            if (symbol.range.start.line <= lineNumber && symbol.range.end.line >= lineNumber) {
                // Check children first for deeper match
                if (symbol.children && symbol.children.length > 0) {
                    const childMatch = this.findSymbolAtLine(symbol.children, lineNumber);
                    if (childMatch) {
                        return childMatch;
                    }
                }
                return symbol;
            }
        }
        return undefined;
    }

    /**
     * Extracts the encoded script value from a symbol's range
     * Handles both single-line and multi-line string values
     */
    private extractEncodedValue(document: vscode.TextDocument, symbol: vscode.DocumentSymbol): string | undefined {
        // Get the full text of the symbol's range
        const text = document.getText(symbol.range);

        // Extract the value after the colon and quotes
        // Pattern: "script": "value" or "code": "value"
        // The value may contain escaped quotes and spans the full range
        const match = text.match(/^"(?:script|code)":\s*"((?:[^"\\]|\\.)*)"/s);
        if (match) {
            return match[1];
        }

        // Fallback: try to extract from current line only (legacy behavior)
        const lineText = document.lineAt(symbol.range.start.line).text;
        const lineMatch = lineText.match(/^\s*"(?:script|code)":\s*"(.*)"/);
        return lineMatch ? lineMatch[1] : undefined;
    }

    // ============================================================================
    // FILESYSTEM PROVIDER IMPLEMENTATION
    // ============================================================================

    watch(_uri: vscode.Uri): vscode.Disposable {
        // File watching not implemented - scripts are virtual and ephemeral
        return new vscode.Disposable(() => undefined);
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        let entry = this.scriptEntries.get(uri.toString());

        // Try to recover the entry if it doesn't exist (e.g., after VS Code restart)
        if (!entry) {
            entry = await this.recoverEntry(uri);
        }

        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        const now = Date.now();
        return {
            type: vscode.FileType.File,
            ctime: now,
            mtime: now,
            size: Buffer.byteLength(entry.content, 'utf8')
        };
    }

    readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
        throw vscode.FileSystemError.NoPermissions('Directory operations not supported');
    }

    createDirectory(_uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions('Directory operations not supported');
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        let entry = this.scriptEntries.get(uri.toString());

        // Try to recover the entry if it doesn't exist (e.g., after VS Code restart)
        if (!entry) {
            entry = await this.recoverEntry(uri);
        }

        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        return Buffer.from(entry.content, 'utf8');
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        let entry = this.scriptEntries.get(uri.toString());

        // Try to recover the entry if it doesn't exist (e.g., after VS Code restart)
        if (!entry) {
            entry = await this.recoverEntry(uri);
        }

        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        const newContent = Buffer.from(content).toString('utf8');

        // Remove the function definition wrapper
        const functionDef = entry.scriptType.getFunctionDefinition(entry.context);
        if (!newContent.startsWith(functionDef)) {
            throw new FlintError(
                'Function definition modified',
                'FUNCTION_DEF_MODIFIED',
                `Please keep the function definition "${functionDef.trim()}" intact`
            );
        }

        const scriptBody = newContent.substring(functionDef.length);

        // Encode the script
        const encodedScript = encodeScript(scriptBody);

        // Update the original JSON file
        await this.updateOriginalFile(entry, encodedScript);

        // Update our entry
        entry.content = newContent;

        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    delete(_uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions('Delete not supported');
    }

    rename(_oldUri: vscode.Uri, _newUri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions('Rename not supported');
    }

    // ============================================================================
    // PRIVATE HELPERS
    // ============================================================================

    /**
     * Attempts to recover a script entry from the URI parameters
     * This is used when VS Code tries to restore a tab after restart
     */
    private async recoverEntry(uri: vscode.Uri): Promise<ScriptFileEntry | undefined> {
        try {
            // Parse the URI query parameters
            const query = new URLSearchParams(uri.query);
            const originalFilePath = query.get('file');
            const lineStr = query.get('line');
            const keyPattern = query.get('key');

            if (!originalFilePath || !lineStr || !keyPattern) {
                console.warn('ScriptFileSystemService: Cannot recover entry - missing URI parameters');
                return undefined;
            }

            const lineNumber = parseInt(lineStr, 10);
            if (isNaN(lineNumber)) {
                console.warn('ScriptFileSystemService: Cannot recover entry - invalid line number');
                return undefined;
            }

            // Find the script type by key pattern
            const scriptType = SCRIPT_TYPES.find(st => st.keyPattern === keyPattern);
            if (!scriptType) {
                console.warn(`ScriptFileSystemService: Cannot recover entry - unknown key pattern: ${keyPattern}`);
                return undefined;
            }

            // Open the original JSON document
            const originalUri = vscode.Uri.file(decodeURIComponent(originalFilePath));
            const document = await vscode.workspace.openTextDocument(originalUri);

            // Try symbol-based detection first (works when JSON language service is ready)
            let detection = await this.detectScriptAtLine(document, lineNumber);

            // If symbol detection fails (e.g., during startup), use fallback regex extraction
            if (!detection) {
                detection = this.extractScriptFallback(document, lineNumber, scriptType);
            }

            if (!detection) {
                console.warn('ScriptFileSystemService: Cannot recover entry - script not found at line');
                return undefined;
            }

            // Re-register the entry using the existing method
            this.openScriptAtPosition(
                originalUri,
                lineNumber,
                detection.scriptType,
                detection.context,
                detection.encodedValue
            );

            // Return the newly created entry
            return this.scriptEntries.get(uri.toString());
        } catch (error) {
            console.error('ScriptFileSystemService: Failed to recover entry:', error);
            return undefined;
        }
    }

    /**
     * Fallback method to extract script when document symbols aren't available
     * Uses regex to directly extract the encoded value from the line
     */
    private extractScriptFallback(
        document: vscode.TextDocument,
        lineNumber: number,
        scriptType: ScriptType
    ): { scriptType: ScriptType; context: ScriptContext; encodedValue: string } | undefined {
        try {
            const line = document.lineAt(lineNumber);
            const lineText = line.text;

            // Extract the key name from the pattern (last part after the dot)
            const keyName = scriptType.keyPattern.split('.').pop() ?? 'script';

            // Try to extract the encoded value from this line
            // Pattern: "script": "value" or "code": "value"
            const regex = new RegExp(`"${keyName}":\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's');
            const match = lineText.match(regex);

            if (!match) {
                // Try multi-line: read from this line to find the complete value
                const fullText = document.getText();
                const lineStart = document.offsetAt(line.range.start);
                const remainingText = fullText.substring(lineStart);
                const multiLineMatch = remainingText.match(regex);

                if (!multiLineMatch) {
                    return undefined;
                }

                return {
                    scriptType,
                    context: {}, // Basic context - we don't have symbol info for full context
                    encodedValue: multiLineMatch[1]
                };
            }

            return {
                scriptType,
                context: {}, // Basic context - we don't have symbol info for full context
                encodedValue: match[1]
            };
        } catch {
            return undefined;
        }
    }

    /**
     * Gets the symbol path to a line number
     */
    private getSymbolPath(symbols: vscode.DocumentSymbol[], lineNumber: number, path: string = ''): string | undefined {
        for (const symbol of symbols) {
            if (symbol.range.start.line <= lineNumber && symbol.range.end.line >= lineNumber) {
                const newPath = path ? `${path}.${symbol.name}` : symbol.name;

                if (symbol.children && symbol.children.length > 0) {
                    const childPath = this.getSymbolPath(symbol.children, lineNumber, newPath);
                    if (childPath) {
                        return childPath;
                    }
                }

                return newPath;
            }
        }
        return undefined;
    }

    /**
     * Determines the script type from a symbol path
     */
    private getScriptTypeFromPath(symbolPath: string, keyName: string): ScriptType | undefined {
        // Clean the path - remove array indices
        const cleanPath = symbolPath.replace(/\.\d+\./g, '.').replace(/\.\d+$/, '');

        // Extract the last two parts to match against patterns
        const parts = cleanPath.split('.');
        if (parts.length < 2) {
            return undefined;
        }

        const parentKey = parts[parts.length - 2];
        const patternToMatch = `${parentKey}.${keyName}`;

        return SCRIPT_TYPES.find(st => st.keyPattern === patternToMatch);
    }

    /**
     * Extracts context information from the parent JSON object
     */
    private extractContext(
        document: vscode.TextDocument,
        symbols: vscode.DocumentSymbol[],
        lineNumber: number
    ): ScriptContext {
        const context: ScriptContext = {};

        // Find the parent symbol
        const parentSymbol = this.findParentSymbol(symbols, lineNumber);
        if (!parentSymbol) {
            return context;
        }

        // Parse the parent object
        try {
            const parentText = document.getText(parentSymbol.range);
            // Handle the case where the text starts with the property name
            const jsonStart = parentText.indexOf('{');
            if (jsonStart >= 0) {
                const jsonText = parentText.substring(jsonStart);
                const parentObj = JSON.parse(jsonText) as Record<string, unknown>;

                // Extract known context properties
                if (typeof parentObj.name === 'string') {
                    context.name = parentObj.name;
                }
                if (Array.isArray(parentObj.params)) {
                    context.params = parentObj.params as string[];
                }
                if (typeof parentObj.messageType === 'string') {
                    context.messageType = parentObj.messageType;
                }
                if (typeof parentObj.eventid === 'string') {
                    context.eventid = parentObj.eventid;
                }
                if (typeof parentObj.property === 'string') {
                    context.property = parentObj.property;
                }
            }
        } catch {
            // Ignore parse errors - context is optional
        }

        return context;
    }

    /**
     * Finds the parent symbol containing a line
     */
    private findParentSymbol(
        symbols: vscode.DocumentSymbol[],
        lineNumber: number,
        depth: number = 0
    ): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            if (symbol.range.start.line <= lineNumber && symbol.range.end.line >= lineNumber) {
                if (symbol.children && symbol.children.length > 0) {
                    const childResult = this.findParentSymbol(symbol.children, lineNumber, depth + 1);
                    if (childResult) {
                        // Return the parent of the deepest match (go one level up)
                        return depth > 0 ? symbol : childResult;
                    }
                }
                return symbol;
            }
        }
        return undefined;
    }

    /**
     * Updates the original JSON file with the new encoded script
     */
    private async updateOriginalFile(entry: ScriptFileEntry, encodedScript: string): Promise<void> {
        // Find the original document
        const originalDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === entry.originalUri.fsPath);

        if (!originalDoc) {
            throw new FlintError(
                'Original file not open',
                'ORIGINAL_FILE_CLOSED',
                'Please keep the original JSON file open while editing the script'
            );
        }

        // Get the line and replace the script value
        const line = originalDoc.lineAt(entry.lineNumber);
        const lineText = line.text;

        // Replace the value - handle both "script" and "code" keys
        const regex = new RegExp(`("${entry.jsonKey}":\\s*)"[^"]*"`, 'i');
        const newLineText = lineText.replace(regex, `$1"${encodedScript}"`);

        if (newLineText === lineText) {
            throw new FlintError(
                'Could not update script',
                'UPDATE_FAILED',
                'The script location in the JSON file may have changed'
            );
        }

        // Apply the edit
        const edit = new vscode.WorkspaceEdit();
        edit.replace(originalDoc.uri, line.range, newLineText);
        const success = await vscode.workspace.applyEdit(edit);

        if (!success) {
            throw new FlintError('Failed to update JSON file', 'EDIT_FAILED', 'Could not apply edit to the JSON file');
        }
    }

    /**
     * Gets the scheme used by this provider
     */
    getScheme(): string {
        return ScriptFileSystemService.SCHEME;
    }

    /**
     * Gets all known script types
     */
    getScriptTypes(): readonly ScriptType[] {
        return SCRIPT_TYPES;
    }
}
