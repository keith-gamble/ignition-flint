/**
 * @module SourcePathMapper
 * @description Maps between VS Code file paths and Ignition module paths
 */

import * as path from 'path';

/**
 * Mapping between a file path and an Ignition module path
 */
export interface PathMapping {
    readonly filePath: string;
    readonly modulePath: string;
}

/**
 * Service for mapping between VS Code file paths and Ignition module paths.
 *
 * The Project Browser displays actual filesystem files:
 * e.g., `/project/ignition/script-python/Shared/MyScript/code.py`
 *
 * This maps to Ignition module paths:
 * e.g., `Shared.MyScript`
 */
export class SourcePathMapper {
    private static readonly SCRIPT_PYTHON_DIR = 'script-python';
    private static readonly CODE_FILE = 'code.py';

    /**
     * Converts a file path to an Ignition module path.
     *
     * @param filePath The full file path (e.g., /project/ignition/script-python/Shared/MyScript/code.py)
     * @returns The Ignition module path (e.g., Shared.MyScript) or null if not a script file
     */
    static filePathToModulePath(filePath: string): string | null {
        // Normalize path separators
        const normalizedPath = filePath.replace(/\\/g, '/');

        // Find the script-python directory
        const scriptPythonIndex = normalizedPath.indexOf(this.SCRIPT_PYTHON_DIR);
        if (scriptPythonIndex === -1) {
            return null;
        }

        // Get the path after script-python/
        let modulePart = normalizedPath.substring(scriptPythonIndex + this.SCRIPT_PYTHON_DIR.length + 1);

        // Remove code.py suffix if present
        if (modulePart.endsWith(`/${this.CODE_FILE}`)) {
            modulePart = modulePart.slice(0, -`/${this.CODE_FILE}`.length);
        } else if (modulePart.endsWith('.py')) {
            // Direct .py file (not in a folder)
            modulePart = modulePart.slice(0, -3);
        }

        // Convert path separators to dots
        return modulePart.replace(/\//g, '.');
    }

    /**
     * Converts an Ignition module path to a file path.
     *
     * @param modulePath The Ignition module path (e.g., Shared.MyScript)
     * @param projectPath The base project path containing script-python directory
     * @returns The full file path
     */
    static modulePathToFilePath(modulePath: string, projectPath: string): string {
        // Convert dots to path separators
        const pathParts = modulePath.split('.');
        const relativePath = pathParts.join('/');

        return path.join(projectPath, this.SCRIPT_PYTHON_DIR, relativePath, this.CODE_FILE);
    }

    /**
     * Extracts the project path from a file path.
     *
     * @param filePath A file path containing script-python
     * @returns The project path (parent of script-python) or null
     */
    static extractProjectPath(filePath: string): string | null {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const scriptPythonIndex = normalizedPath.indexOf(this.SCRIPT_PYTHON_DIR);

        if (scriptPythonIndex === -1) {
            return null;
        }

        // Return the path up to and including the project directory
        return normalizedPath.substring(0, scriptPythonIndex - 1);
    }

    /**
     * Determines if a file path is an Ignition script file.
     *
     * @param filePath The file path to check
     * @returns True if the file is in a script-python directory
     */
    static isIgnitionScriptFile(filePath: string): boolean {
        const normalizedPath = filePath.replace(/\\/g, '/');
        return normalizedPath.includes(this.SCRIPT_PYTHON_DIR) && normalizedPath.endsWith('.py');
    }

    /**
     * Gets the filename suitable for use in the debugger.
     * Uses the full path for file identification.
     *
     * @param filePath The full file path
     * @returns The canonical filename for debugging
     */
    static getDebugFilename(filePath: string): string {
        // Return the normalized path
        return filePath.replace(/\\/g, '/');
    }

    /**
     * Creates a PathMapping from a file path.
     *
     * @param filePath The full file path
     * @returns A PathMapping object or null if not a valid script file
     */
    static createMapping(filePath: string): PathMapping | null {
        const modulePath = this.filePathToModulePath(filePath);
        if (!modulePath) {
            return null;
        }

        return {
            filePath: this.getDebugFilename(filePath),
            modulePath
        };
    }

    /**
     * Resolves a source reference from the debugger to a file path.
     *
     * The debugger may return either:
     * - A full file path
     * - A module path
     * - A relative path
     *
     * @param sourceRef The source reference from the debugger
     * @param projectPath The project path for resolution
     * @returns The resolved file path
     */
    static resolveSourceReference(sourceRef: string, projectPath: string): string {
        // If it's already an absolute path, return it
        if (path.isAbsolute(sourceRef) || sourceRef.startsWith('/')) {
            return sourceRef;
        }

        // If it looks like a module path (contains dots, no slashes)
        if (sourceRef.includes('.') && !sourceRef.includes('/') && !sourceRef.includes('\\')) {
            return this.modulePathToFilePath(sourceRef, projectPath);
        }

        // Otherwise, treat as relative path
        return path.join(projectPath, sourceRef);
    }

    /**
     * Matches a debugger filename to project files.
     *
     * The debugger may use different naming conventions, so we need
     * to match flexibly.
     *
     * @param debuggerFilename The filename from the debugger
     * @param projectFiles List of known project files
     * @returns The matching project file path or null
     */
    static matchDebuggerFilename(debuggerFilename: string, projectFiles: string[]): string | null {
        const normalizedDebug = debuggerFilename.replace(/\\/g, '/').toLowerCase();

        // Try exact match first
        for (const file of projectFiles) {
            const normalizedFile = file.replace(/\\/g, '/').toLowerCase();
            if (normalizedFile === normalizedDebug) {
                return file;
            }
        }

        // Try matching just the module path portion
        const debugModulePath = this.filePathToModulePath(debuggerFilename);
        if (debugModulePath) {
            for (const file of projectFiles) {
                const fileModulePath = this.filePathToModulePath(file);
                if (fileModulePath && fileModulePath.toLowerCase() === debugModulePath.toLowerCase()) {
                    return file;
                }
            }
        }

        // Try suffix match (for cases where paths differ in prefix)
        for (const file of projectFiles) {
            const normalizedFile = file.replace(/\\/g, '/').toLowerCase();
            if (normalizedFile.endsWith(normalizedDebug) || normalizedDebug.endsWith(normalizedFile)) {
                return file;
            }
        }

        return null;
    }
}
