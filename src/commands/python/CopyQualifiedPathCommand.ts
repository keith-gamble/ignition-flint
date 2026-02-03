/**
 * @module CopyQualifiedPathCommand
 * @description Command to copy the fully qualified path of a Python script element at the cursor position
 */

import * as path from 'path';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { CommandContext } from '@/core/types/commands';
import { ProjectScannerService } from '@/services/config/ProjectScannerService';
import { ScriptModuleIndexService } from '@/services/python/ScriptModuleIndexService';

/**
 * Command to copy the qualified path of the Python symbol at cursor
 */
export class CopyQualifiedPathCommand extends Command {
    static readonly ID = 'flint.copyQualifiedPath';

    private scriptModuleIndexService?: ScriptModuleIndexService;
    private projectScannerService?: ProjectScannerService;

    constructor(context: CommandContext) {
        super(CopyQualifiedPathCommand.ID, context);
    }

    protected async executeImpl(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        // Check if it's a Python file
        if (editor.document.languageId !== 'python') {
            vscode.window.showErrorMessage('This command is only available in Python files');
            return;
        }

        // Get services
        this.scriptModuleIndexService = this.getService<ScriptModuleIndexService>('ScriptModuleIndexService');
        this.projectScannerService = this.getService<ProjectScannerService>('ProjectScannerService');

        if (!this.scriptModuleIndexService || !this.projectScannerService) {
            vscode.window.showErrorMessage('Script services are not available');
            return;
        }

        // Get the current file path and cursor position
        const filePath = editor.document.uri.fsPath;
        const position = editor.selection.active;

        // Check if file is in a script-python directory
        if (!filePath.includes('script-python')) {
            vscode.window.showErrorMessage('This file is not in an Ignition script module');
            return;
        }

        // Determine the module path from the file path
        const modulePath = this.getModulePathFromFile(filePath);
        if (!modulePath) {
            vscode.window.showErrorMessage('Could not determine module path');
            return;
        }

        // Get the symbol at the current line
        const symbolName = this.getSymbolAtLine(editor.document, position);
        if (!symbolName) {
            vscode.window.showInformationMessage('No Python symbol found at cursor position');
            return;
        }

        // Build the qualified path
        let qualifiedPath = modulePath;

        // If we found a symbol name and it's not a module-level identifier, append it
        if (symbolName && symbolName !== '__init__') {
            qualifiedPath = `${modulePath}.${symbolName}`;
        }

        // Check if this is a function and get its parameters
        const functionSignature = this.getFunctionSignature(editor.document, position, symbolName);
        if (functionSignature) {
            qualifiedPath = `${modulePath}.${functionSignature}`;
        }

        // Copy to clipboard
        await vscode.env.clipboard.writeText(qualifiedPath);
        vscode.window.showInformationMessage(`Copied: ${qualifiedPath}`);
    }

    /**
     * Gets the module path from a file path
     */
    private getModulePathFromFile(filePath: string): string | null {
        // Extract the script-python relative path
        const scriptPythonIndex = filePath.lastIndexOf('script-python');
        if (scriptPythonIndex === -1) {
            return null;
        }

        // Get the path after script-python
        const relativePath = filePath.substring(scriptPythonIndex + 'script-python'.length + 1);

        // Remove the code.py filename if present
        const withoutCodePy = relativePath.replace(/[/\\]code\.py$/, '');

        // Convert path separators to dots
        const modulePath = withoutCodePy
            .split(path.sep)
            .filter(p => p)
            .join('.');

        return modulePath;
    }

    /**
     * Gets the symbol at the current line, or finds the enclosing function/class
     */
    private getSymbolAtLine(document: vscode.TextDocument, position: vscode.Position): string | null {
        const line = document.lineAt(position.line).text;

        // Check for function definition on current line
        const funcMatch = line.match(/^\s*def\s+(\w+)\s*\(/);
        if (funcMatch) {
            return funcMatch[1];
        }

        // Check for class definition on current line
        const classMatch = line.match(/^\s*class\s+(\w+)(?:\(|:)/);
        if (classMatch) {
            return classMatch[1];
        }

        // Check for variable/constant assignment at module level
        const varMatch = line.match(/^(\w+)\s*=/);
        if (varMatch && (position.line === 0 || this.isModuleLevel(document, position.line))) {
            return varMatch[1];
        }

        // Try to get the word at cursor position and check if it's a defined symbol
        const wordRange = document.getWordRangeAtPosition(position);
        if (wordRange) {
            const word = document.getText(wordRange);

            // Check if this word is a defined function or class in the file
            const fileText = document.getText();
            const defPattern = new RegExp(`^\\s*def\\s+${word}\\s*\\(`, 'm');
            const classPattern = new RegExp(`^\\s*class\\s+${word}(?:\\(|:)`, 'm');

            if (defPattern.test(fileText) || classPattern.test(fileText)) {
                return word;
            }
        }

        // If not on a definition line, find the enclosing function
        const enclosingFunction = this.findEnclosingFunction(document, position.line);
        if (enclosingFunction) {
            return enclosingFunction;
        }

        // Last resort: find the nearest function definition above the cursor
        const nearestFunction = this.findNearestFunctionAbove(document, position.line);
        if (nearestFunction) {
            return nearestFunction;
        }

        return null;
    }

    /**
     * Finds the nearest function definition above the cursor (regardless of scope)
     */
    private findNearestFunctionAbove(document: vscode.TextDocument, lineNumber: number): string | null {
        for (let i = lineNumber; i >= 0; i--) {
            const lineText = document.lineAt(i).text;
            const funcMatch = lineText.match(/^\s*def\s+(\w+)\s*\(/);
            if (funcMatch) {
                return funcMatch[1];
            }
        }
        return null;
    }

    /**
     * Finds the enclosing function by walking backwards from the current line
     */
    private findEnclosingFunction(document: vscode.TextDocument, lineNumber: number): string | null {
        // Get the indentation of the current line
        const currentIndent = this.getEffectiveIndentation(document, lineNumber);

        // Walk backwards to find the enclosing function definition
        for (let i = lineNumber - 1; i >= 0; i--) {
            const lineText = document.lineAt(i).text;

            // Skip empty lines and comments
            if (lineText.trim() === '' || lineText.trim().startsWith('#')) {
                continue;
            }

            // Check for function definition
            const funcMatch = lineText.match(/^(\s*)def\s+(\w+)\s*\(/);
            if (funcMatch) {
                const funcIndent = funcMatch[1].length;
                // This function encloses our position if its indentation is less than ours
                if (funcIndent < currentIndent) {
                    return funcMatch[2];
                }
            }

            // If we hit a line at module level (no indentation) that's not a function,
            // we've exited any function scope
            const lineIndent = this.getIndentation(lineText);
            if (lineIndent === 0 && !funcMatch) {
                // Could be a class, import, or other module-level code
                // Check if it's a class that might contain a method
                const classMatch = lineText.match(/^class\s+\w+/);
                if (!classMatch) {
                    return null;
                }
            }
        }

        return null;
    }

    /**
     * Gets the indentation level (number of leading spaces/tabs) of a line
     */
    private getIndentation(line: string): number {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
    }

    /**
     * Gets the effective indentation by finding the nearest non-blank line
     */
    private getEffectiveIndentation(document: vscode.TextDocument, lineNumber: number): number {
        // First check the current line
        const currentLine = document.lineAt(lineNumber).text;
        if (currentLine.trim() !== '') {
            return this.getIndentation(currentLine);
        }

        // If current line is blank, look at surrounding lines to determine context
        for (let i = lineNumber + 1; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            if (line.trim() !== '' && !line.trim().startsWith('#')) {
                return this.getIndentation(line);
            }
        }

        return 0;
    }

    /**
     * Gets the function signature with parameters
     */
    private getFunctionSignature(
        document: vscode.TextDocument,
        position: vscode.Position,
        symbolName: string
    ): string | null {
        // Search for the function definition in the document
        // First check the current line, then search backwards
        for (let i = position.line; i >= 0; i--) {
            const lineText = document.lineAt(i).text;
            const funcMatch = lineText.match(/^\s*def\s+(\w+)\s*\(([^)]*)\)/);

            if (funcMatch && funcMatch[1] === symbolName) {
                const params = funcMatch[2].trim();
                if (params) {
                    // Parse parameters and keep only names (no default values)
                    const paramNames = params
                        .split(',')
                        .map(p => {
                            const paramName = p.trim().split('=')[0].trim();
                            // Skip 'self' parameter for methods
                            return paramName === 'self' ? null : paramName;
                        })
                        .filter(p => p)
                        .join(', ');

                    if (paramNames) {
                        return `${symbolName}(${paramNames})`;
                    }
                }
                return `${symbolName}()`;
            }
        }

        return null;
    }

    /**
     * Checks if a line is at module level (not inside a class or function)
     */
    private isModuleLevel(document: vscode.TextDocument, lineNumber: number): boolean {
        // Check indentation - module level should have no indentation
        const line = document.lineAt(lineNumber).text;
        return /^[^\s]/.test(line);
    }
}
