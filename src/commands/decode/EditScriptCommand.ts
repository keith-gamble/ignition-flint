/**
 * @module EditScriptCommand
 * @description Command to open an embedded Python script from a JSON file as a side-by-side Python editor
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { ScriptFileSystemService } from '@/services/decode/ScriptFileSystemService';

/**
 * Command to edit an embedded script from JSON as a Python file
 * Opens the script in a side panel with proper syntax highlighting
 */
export class EditScriptCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.EDIT_EMBEDDED_SCRIPT, context);
    }

    protected validateArguments(...args: unknown[]): CommandValidationResult {
        // Optional: URI and line number can be passed, otherwise use active editor
        const uri = args[0];
        const lineNumber = args[1];

        if (uri !== undefined && !(uri instanceof vscode.Uri)) {
            return {
                isValid: false,
                errors: ['Invalid argument: expected a file URI or no argument'],
                warnings: []
            };
        }

        if (lineNumber !== undefined && typeof lineNumber !== 'number') {
            return {
                isValid: false,
                errors: ['Invalid argument: line number must be a number'],
                warnings: []
            };
        }

        return {
            isValid: true,
            errors: [],
            warnings: []
        };
    }

    protected async executeImpl(uri?: vscode.Uri, lineNumber?: number): Promise<void> {
        try {
            const editor = vscode.window.activeTextEditor;

            // Get URI and line from arguments or active editor
            const documentUri = uri ?? editor?.document.uri;
            const line = lineNumber ?? editor?.selection.active.line;

            if (!documentUri || line === undefined) {
                throw new FlintError(
                    'No JSON file selected',
                    'NO_FILE_SELECTED',
                    'Please position your cursor on a script value in a JSON file'
                );
            }

            // Validate it's a JSON file
            if (!documentUri.fsPath.endsWith('.json')) {
                throw new FlintError('Not a JSON file', 'INVALID_FILE_TYPE', 'This command only works with JSON files');
            }

            // Get the document
            const document = await vscode.workspace.openTextDocument(documentUri);

            // Get the script service
            const scriptService = this.getService<ScriptFileSystemService>('ScriptFileSystemService');

            // Detect the script at the current line
            const detection = await scriptService.detectScriptAtLine(document, line);

            if (!detection) {
                throw new FlintError(
                    'No script found',
                    'NO_SCRIPT_AT_LINE',
                    'Position your cursor on a line containing "script" or "code" value'
                );
            }

            const { scriptType, context, encodedValue } = detection;

            // Open the script
            const scriptUri = scriptService.openScriptAtPosition(documentUri, line, scriptType, context, encodedValue);

            // Open the script file in a side panel
            const scriptDoc = await vscode.workspace.openTextDocument(scriptUri);
            await vscode.window.showTextDocument(scriptDoc, {
                preview: false,
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: false
            });

            // Show info about the script type
            vscode.window.setStatusBarMessage(`Editing ${scriptType.displayName}`, 3000);
        } catch (error) {
            if (error instanceof FlintError) {
                throw error;
            }
            throw new FlintError(
                'Failed to open script',
                'EDIT_SCRIPT_FAILED',
                `Unable to extract script: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    getTitle(): string {
        return 'Edit Embedded Script';
    }
}
