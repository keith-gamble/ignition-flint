/**
 * @module IgnitionStubParser
 * @description Parses Ignition Python stub files to extract function signatures and documentation
 * Converts stub files to PythonSymbol format for use in autocompletion
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { PythonSymbol, ParameterInfo } from './PythonASTService';

/**
 * Options for creating a class symbol
 */
interface ClassSymbolOptions {
    className: string;
    modulePath: string;
    signature: string;
    docstring: string;
    lineNumber: number;
}

/**
 * Options for creating a function symbol
 */
interface FunctionSymbolOptions {
    funcName: string;
    modulePath: string;
    currentClass: string | null;
    paramsStr: string;
    returnType: string | undefined;
    docstring: string;
    lineNumber: number;
}

/**
 * Options for creating a variable symbol
 */
interface VariableSymbolOptions {
    varName: string;
    modulePath: string;
    currentClass: string | null;
    varType: string;
    defaultValue: string | undefined;
    docstring: string;
    lineNumber: number;
}

/**
 * Parser for Ignition Python stub files
 * Extracts functions, classes, and their documentation
 */
export class IgnitionStubParser {
    /**
     * Parses a stub file and returns symbols
     */
    async parseStubFile(filePath: string, modulePath: string): Promise<PythonSymbol[]> {
        const content = await fs.readFile(filePath, 'utf-8');
        return this.parseStubContent(content, modulePath);
    }

    /**
     * Creates a class symbol
     */
    private createClassSymbol(options: ClassSymbolOptions): PythonSymbol {
        const { className, modulePath, signature, docstring, lineNumber } = options;
        return {
            name: className,
            type: 'class',
            qualifiedName: `${modulePath}.${className}`,
            modulePath,
            signature,
            parameters: [],
            docstring: docstring || undefined,
            filePath: '',
            lineNumber
        };
    }

    /**
     * Creates a function symbol
     */
    private createFunctionSymbol(options: FunctionSymbolOptions): PythonSymbol {
        const { funcName, modulePath, currentClass, paramsStr, returnType, docstring, lineNumber } = options;
        const parameters = this.parseParameters(paramsStr);
        const qualifiedName = currentClass ? `${modulePath}.${currentClass}.${funcName}` : `${modulePath}.${funcName}`;
        const signature = `${funcName}(${paramsStr})${returnType ? ` -> ${returnType}` : ''}`;

        return {
            name: funcName,
            type: 'function',
            qualifiedName,
            modulePath,
            signature,
            parameters,
            returnType,
            docstring: docstring || undefined,
            filePath: '',
            lineNumber
        };
    }

    /**
     * Creates a variable/constant symbol
     */
    private createVariableSymbol(options: VariableSymbolOptions): PythonSymbol {
        const { varName, modulePath, currentClass, varType, defaultValue, docstring, lineNumber } = options;
        const isConstant = varName === varName.toUpperCase();
        const qualifiedName = currentClass ? `${modulePath}.${currentClass}.${varName}` : `${modulePath}.${varName}`;

        return {
            name: varName,
            type: isConstant ? 'constant' : 'variable',
            qualifiedName,
            modulePath,
            signature: `${varName}: ${varType}${defaultValue ? ` = ${defaultValue}` : ''}`,
            parameters: [],
            returnType: varType,
            docstring: docstring || undefined,
            filePath: '',
            lineNumber
        };
    }

    /**
     * Parses stub content and extracts symbols
     */
    parseStubContent(content: string, modulePath: string): PythonSymbol[] {
        const symbols: PythonSymbol[] = [];
        const lines = content.split('\n');

        let currentClass: string | null = null;
        let currentIndent = 0;
        let docstringBuffer: string[] = [];
        let inDocstring = false;
        let docstringQuotes = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const indent = line.length - line.trimStart().length;

            // Handle docstrings
            if (inDocstring) {
                if (trimmed.endsWith(docstringQuotes)) {
                    docstringBuffer.push(trimmed.slice(0, -docstringQuotes.length));
                    inDocstring = false;
                } else {
                    docstringBuffer.push(trimmed);
                }
                continue;
            }

            // Check for docstring start
            if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
                docstringQuotes = trimmed.slice(0, 3);
                const docContent = trimmed.slice(3);
                if (docContent.endsWith(docstringQuotes)) {
                    docstringBuffer = [docContent.slice(0, -3)];
                } else {
                    inDocstring = true;
                    docstringBuffer = [docContent];
                }
                continue;
            }

            // Exit class context if dedented
            if (currentClass && indent <= currentIndent) {
                currentClass = null;
            }

            const docstring = docstringBuffer.join('\n').trim();

            // Parse class definitions
            const classMatch = trimmed.match(/^class\s+(\w+)(?:\([^)]*\))?:/);
            if (classMatch) {
                currentClass = classMatch[1];
                currentIndent = indent;
                symbols.push(
                    this.createClassSymbol({
                        className: classMatch[1],
                        modulePath,
                        signature: trimmed.replace(':', ''),
                        docstring,
                        lineNumber: i + 1
                    })
                );
                docstringBuffer = [];
                continue;
            }

            // Parse function definitions
            const funcMatch = trimmed.match(/^def\s+(\w+)\s*\((.*?)\)(?:\s*->\s*([^:]+))?:/);
            if (funcMatch) {
                symbols.push(
                    this.createFunctionSymbol({
                        funcName: funcMatch[1],
                        modulePath,
                        currentClass,
                        paramsStr: funcMatch[2],
                        returnType: funcMatch[3]?.trim(),
                        docstring,
                        lineNumber: i + 1
                    })
                );
                docstringBuffer = [];
                continue;
            }

            // Parse variable/constant definitions
            const varMatch = trimmed.match(/^(\w+)\s*:\s*(.+?)(?:\s*=\s*(.+))?$/);
            if (varMatch && !trimmed.includes('def ') && !trimmed.includes('class ')) {
                if (!varMatch[1].startsWith('_')) {
                    symbols.push(
                        this.createVariableSymbol({
                            varName: varMatch[1],
                            modulePath,
                            currentClass,
                            varType: varMatch[2],
                            defaultValue: varMatch[3],
                            docstring,
                            lineNumber: i + 1
                        })
                    );
                    docstringBuffer = [];
                }
                continue;
            }

            // Clear docstring buffer for non-definition lines
            if (!trimmed.startsWith('#') && trimmed !== '') {
                docstringBuffer = [];
            }
        }

        return symbols;
    }

    /**
     * Parses function parameters from a parameter string
     */
    private parseParameters(paramsStr: string): ParameterInfo[] {
        if (!paramsStr.trim()) {
            return [];
        }

        const parameters: ParameterInfo[] = [];

        // Split by comma, but respect nested parentheses/brackets
        const params = this.smartSplit(paramsStr, ',');

        for (const param of params) {
            const trimmed = param.trim();

            // Skip 'self' and 'cls' parameters
            if (trimmed === 'self' || trimmed === 'cls') {
                continue;
            }

            // Parse parameter with type annotation and default value
            // Format: name: type = default
            const match = trimmed.match(/^(\*{0,2}\w+)(?:\s*:\s*([^=]+))?(?:\s*=\s*(.+))?$/);

            if (match) {
                const name = match[1];
                const type = match[2]?.trim();
                const defaultValue = match[3]?.trim();

                parameters.push({
                    name,
                    type,
                    defaultValue,
                    optional: !!defaultValue || name.startsWith('*')
                });
            }
        }

        return parameters;
    }

    /**
     * Smart split that respects nested structures
     */
    private smartSplit(str: string, delimiter: string): string[] {
        const result: string[] = [];
        let current = '';
        let depth = 0;
        let inString = false;
        let stringChar = '';

        for (let i = 0; i < str.length; i++) {
            const char = str[i];

            // Handle string literals
            if ((char === '"' || char === "'") && (i === 0 || str[i - 1] !== '\\')) {
                if (!inString) {
                    inString = true;
                    stringChar = char;
                } else if (char === stringChar) {
                    inString = false;
                }
            }

            // Track parentheses/brackets depth
            if (!inString) {
                if (char === '(' || char === '[' || char === '{') {
                    depth++;
                } else if (char === ')' || char === ']' || char === '}') {
                    depth--;
                }

                // Split at delimiter only at depth 0
                if (char === delimiter && depth === 0) {
                    result.push(current.trim());
                    current = '';
                    continue;
                }
            }

            current += char;
        }

        if (current.trim()) {
            result.push(current.trim());
        }

        return result;
    }

    /**
     * Extracts decorators from lines before a function
     */
    private extractDecorators(lines: string[], funcLineIndex: number): string[] | undefined {
        const decorators: string[] = [];

        for (let i = funcLineIndex - 1; i >= 0; i--) {
            const line = lines[i].trim();

            if (line.startsWith('@')) {
                decorators.unshift(line);
            } else if (line !== '' && !line.startsWith('#')) {
                // Stop if we hit a non-decorator, non-comment, non-empty line
                break;
            }
        }

        return decorators.length > 0 ? decorators : undefined;
    }

    /**
     * Recursively parses all stub files in a directory
     */
    async parseStubDirectory(dirPath: string, baseModulePath: string): Promise<Map<string, PythonSymbol[]>> {
        const symbolsByModule = new Map<string, PythonSymbol[]>();
        const foundModules = new Set<string>();

        async function scanDir(currentPath: string, currentModule: string): Promise<void> {
            const entries = await fs.readdir(currentPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);

                if (entry.isDirectory()) {
                    // Skip __pycache__ and other special directories
                    if (entry.name.startsWith('__')) {
                        continue;
                    }

                    // Create module path for this directory
                    const subModule = currentModule ? `${currentModule}.${entry.name}` : entry.name;

                    // Mark this directory as a module (even if empty)
                    foundModules.add(subModule);

                    // Recursively scan subdirectory
                    await scanDir(fullPath, subModule);
                } else if (entry.name.endsWith('.py') || entry.name.endsWith('.pyi')) {
                    // Parse Python stub file
                    const moduleName = entry.name.slice(0, entry.name.lastIndexOf('.'));

                    // For __init__ files, use the parent module name
                    let fullModuleName: string;
                    if (moduleName === '__init__') {
                        fullModuleName = currentModule || baseModulePath || 'system';
                    } else {
                        fullModuleName = currentModule ? `${currentModule}.${moduleName}` : moduleName;
                    }

                    const parser = new IgnitionStubParser();
                    const symbols = await parser.parseStubFile(fullPath, fullModuleName);

                    // Store the symbols for this module
                    symbolsByModule.set(fullModuleName, symbols);
                    foundModules.add(fullModuleName);
                }
            }
        }

        await scanDir(dirPath, baseModulePath);

        // Ensure all intermediate modules are created
        // For example, if we have system.util, we need entries for:
        // - system (as a parent module)
        // - system.util (with the actual symbols from util.py)
        for (const modulePath of foundModules) {
            // Ensure this module has an entry (even if empty)
            if (!symbolsByModule.has(modulePath)) {
                symbolsByModule.set(modulePath, []);
            }

            // Create all parent module entries
            const parts = modulePath.split('.');
            for (let i = 1; i <= parts.length - 1; i++) {
                const parentPath = parts.slice(0, i).join('.');
                if (!symbolsByModule.has(parentPath)) {
                    symbolsByModule.set(parentPath, []);
                }
            }
        }

        return symbolsByModule;
    }
}
