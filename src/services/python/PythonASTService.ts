/**
 * @module PythonASTService
 * @description Service for parsing Python files and extracting AST information
 * for autocomplete and IntelliSense support in Ignition script modules
 */

import * as fs from 'fs/promises';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Represents a Python symbol (function, class, variable, etc.)
 */
export interface PythonSymbol {
    /** Symbol name */
    readonly name: string;
    /** Symbol type (function, class, variable, constant) */
    readonly type: 'function' | 'class' | 'variable' | 'constant' | 'module';
    /** Fully qualified name (e.g., General.Perspective.Dropdown.build_tag_dropdown) */
    readonly qualifiedName: string;
    /** Module path (e.g., General.Perspective.Dropdown) */
    readonly modulePath: string;
    /** Function/method signature if applicable */
    readonly signature?: string;
    /** Docstring if available */
    readonly docstring?: string;
    /** Parameters for functions */
    readonly parameters?: readonly ParameterInfo[];
    /** Return type hint if available */
    readonly returnType?: string;
    /** Source file path */
    readonly filePath: string;
    /** Line number in source file */
    readonly lineNumber?: number;
}

/**
 * Function parameter information
 */
export interface ParameterInfo {
    /** Parameter name */
    readonly name: string;
    /** Type hint if available */
    readonly type?: string;
    /** Default value if available */
    readonly defaultValue?: string;
    /** Whether parameter is optional */
    readonly optional: boolean;
}

/**
 * AST cache entry
 */
interface ASTCacheEntry {
    /** Parsed symbols */
    readonly symbols: readonly PythonSymbol[];
    /** Last modified timestamp of the file */
    readonly lastModified: number;
    /** File path */
    readonly filePath: string;
}

/**
 * Service for parsing Python AST and extracting symbols
 */
export class PythonASTService implements IServiceLifecycle {
    private static readonly CACHE_EXPIRATION_MS = 60000; // 1 minute
    private astCache = new Map<string, ASTCacheEntry>();
    private isInitialized = false;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    initialize(): Promise<void> {
        this.isInitialized = true;
        return Promise.resolve();
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            throw new FlintError('PythonASTService must be initialized before starting', 'SERVICE_NOT_INITIALIZED');
        }
        return Promise.resolve();
    }

    stop(): Promise<void> {
        this.astCache.clear();
        return Promise.resolve();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.isInitialized = false;
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Parses a Python file and extracts symbols
     */
    async parseFile(filePath: string, modulePath: string): Promise<PythonSymbol[]> {
        // Check cache first
        const cached = this.getCachedResult(filePath);
        if (cached) {
            return [...cached];
        }

        try {
            const content = await fs.readFile(filePath, 'utf8');
            const symbols = await this.extractSymbols(content, filePath, modulePath);

            // Cache the results
            const stats = await fs.stat(filePath);
            this.cacheResult(filePath, symbols, stats.mtime.getTime());

            return symbols;
        } catch (error) {
            console.error(`Failed to parse Python file ${filePath}:`, error);
            return [];
        }
    }

    /**
     * Extracts symbols from Python code content
     */
    private extractSymbols(content: string, filePath: string, modulePath: string): Promise<PythonSymbol[]> {
        const symbols: PythonSymbol[] = [];

        // Use regex-based extraction for reliability and performance
        // This avoids heavy dependencies like pyodide which can cause memory issues
        this.extractSymbolsWithRegex(content, symbols, modulePath, filePath);

        return Promise.resolve(symbols);
    }

    /**
     * Simplified symbol extraction - just extract top-level functions and classes
     * For deeper Python intellisense, users should install Pylance or similar
     */
    private extractSymbolsWithRegex(
        content: string,
        symbols: PythonSymbol[],
        modulePath: string,
        filePath: string
    ): void {
        // Extract top-level functions with parameters and docstrings
        // Note: Jython 2.7 doesn't support type hints, so we don't parse them
        const functionRegex = /^def\s+(\w+)\s*\((.*?)\):/gm;
        let match;
        while ((match = functionRegex.exec(content)) !== null) {
            const [fullMatch, functionName, params] = match;
            const lineNumber = content.substring(0, match.index).split('\n').length;
            const functionEndIndex = match.index + fullMatch.length;

            // Parse parameters
            const parameters = this.parseParameters(params);

            // Try to extract docstring
            let docstring: string | undefined;
            const afterFunctionDef = content.substring(functionEndIndex);
            const docstringMatch = afterFunctionDef.match(/^\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/);
            if (docstringMatch) {
                docstring = (docstringMatch[1] || docstringMatch[2])?.trim();
            }

            symbols.push({
                name: functionName,
                type: 'function',
                qualifiedName: `${modulePath}.${functionName}`,
                modulePath,
                signature: `${functionName}(${params})`,
                parameters,
                returnType: undefined, // Jython 2.7 doesn't support return type annotations
                docstring,
                filePath,
                lineNumber
            });
        }

        // Extract top-level classes with docstrings and methods
        const classRegex = /^class\s+(\w+)(?:\([^)]*\))?:/gm;
        while ((match = classRegex.exec(content)) !== null) {
            const [fullMatch, className] = match;
            const lineNumber = content.substring(0, match.index).split('\n').length;
            const classEndIndex = match.index + fullMatch.length;

            // Try to extract docstring
            let docstring: string | undefined;
            const afterClassDef = content.substring(classEndIndex);
            const docstringMatch = afterClassDef.match(/^\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/);
            if (docstringMatch) {
                docstring = (docstringMatch[1] || docstringMatch[2])?.trim();
            }

            // Extract class methods
            const methods = this.extractClassMethods(content, match.index, className, modulePath, filePath);

            symbols.push({
                name: className,
                type: 'class',
                qualifiedName: `${modulePath}.${className}`,
                modulePath,
                docstring,
                filePath,
                lineNumber,
                methods // Add methods to the class symbol
            } as PythonSymbol & { methods: any[] });
        }
    }

    /**
     * Extracts methods from a class definition
     */
    private extractClassMethods(
        content: string,
        classStartIndex: number,
        className: string,
        modulePath: string,
        filePath: string
    ): any[] {
        const methods: any[] = [];

        // Find the class body by looking for the next dedent
        // We'll look for methods that are indented within the class
        const classContent = content.substring(classStartIndex);
        const lines = classContent.split('\n');

        // Determine the class indentation level
        const classLine = lines[0];
        const classIndent = classLine.match(/^(\s*)/)?.[1]?.length || 0;

        // Look for methods (def statements at the next indentation level)
        const methodRegex = new RegExp(`^\\s{${classIndent + 1},}def\\s+(\\w+)\\s*\\((.*?)\\):`, 'gm');
        let match;

        // Find where the class ends (next line with same or less indentation that isn't empty)
        let classEndIndex = classContent.length;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() && !line.startsWith(' '.repeat(classIndent + 1)) && !line.startsWith('\t')) {
                classEndIndex = lines.slice(0, i).join('\n').length;
                break;
            }
        }

        const classBody = classContent.substring(0, classEndIndex);

        while ((match = methodRegex.exec(classBody)) !== null) {
            const [fullMatch, methodName, params] = match;
            const lineNumber = content.substring(0, classStartIndex + match.index).split('\n').length;

            // Parse parameters (excluding self)
            const parameters = this.parseParameters(params);

            // Try to extract docstring
            const methodEndIndex = match.index + fullMatch.length;
            const afterMethodDef = classBody.substring(methodEndIndex);
            const docstringMatch = afterMethodDef.match(/^\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/);
            const docstring = docstringMatch ? (docstringMatch[1] || docstringMatch[2])?.trim() : undefined;

            methods.push({
                name: methodName,
                type: 'method',
                qualifiedName: `${modulePath}.${className}.${methodName}`,
                signature: `${methodName}(${params})`,
                parameters,
                docstring,
                filePath,
                lineNumber
            });
        }

        return methods;
    }

    /**
     * Parses function parameters from a parameter string (Jython 2.7 compatible)
     */
    private parseParameters(paramString: string): ParameterInfo[] {
        if (!paramString.trim()) {
            return [];
        }

        const parameters: ParameterInfo[] = [];
        // Split by comma but handle nested parentheses/brackets
        const params = this.smartSplit(paramString);

        for (const param of params) {
            const trimmed = param.trim();
            if (!trimmed || trimmed === 'self') continue; // Skip self parameter

            // Parse parameter with optional default value (no type hints in Jython 2.7)
            // Matches: name, name = default, *args, **kwargs
            const paramMatch = trimmed.match(/^(\*{0,2}\w+)(?:\s*=\s*(.+))?$/);

            if (paramMatch) {
                const [, name, defaultValue] = paramMatch;
                parameters.push({
                    name: name.trim(),
                    type: undefined, // Jython 2.7 doesn't support type hints
                    defaultValue: defaultValue?.trim(),
                    optional: !!defaultValue || name.startsWith('*')
                });
            }
        }

        return parameters;
    }

    /**
     * Splits a parameter string by commas, respecting nested brackets
     */
    private smartSplit(str: string): string[] {
        const result: string[] = [];
        let current = '';
        let depth = 0;

        for (const char of str) {
            if (char === '(' || char === '[' || char === '{') {
                depth++;
            } else if (char === ')' || char === ']' || char === '}') {
                depth--;
            } else if (char === ',' && depth === 0) {
                result.push(current);
                current = '';
                continue;
            }
            current += char;
        }

        if (current) {
            result.push(current);
        }

        return result;
    }

    /**
     * Gets cached AST result if valid
     */
    private getCachedResult(filePath: string): PythonSymbol[] | null {
        const entry = this.astCache.get(filePath);

        if (!entry) {
            return null;
        }

        // Check if cache is still valid
        const now = Date.now();
        if (now - entry.lastModified > PythonASTService.CACHE_EXPIRATION_MS) {
            this.astCache.delete(filePath);
            return null;
        }

        return [...entry.symbols];
    }

    /**
     * Caches AST parsing result
     */
    private cacheResult(filePath: string, symbols: PythonSymbol[], lastModified: number): void {
        this.astCache.set(filePath, {
            symbols,
            lastModified,
            filePath
        });
    }

    /**
     * Clears the AST cache
     */
    clearCache(): void {
        this.astCache.clear();
    }

    /**
     * Invalidates cache for a specific file
     */
    invalidateCache(filePath: string): void {
        this.astCache.delete(filePath);
    }
}
