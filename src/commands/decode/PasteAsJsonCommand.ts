/**
 * @module PasteAsJsonCommand
 * @description Command to paste clipboard content as converted JSON
 * Converts Python debug output (with u'string' notation) to valid JSON
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { PythonNotationConverter } from '@/utils/decode/pythonNotationConverter';

/**
 * Command to paste clipboard content as JSON, converting Python notation if needed
 */
export class PasteAsJsonCommand extends Command {
    private readonly converter: PythonNotationConverter;

    constructor(context: CommandContext) {
        super(COMMANDS.PASTE_AS_JSON, context);
        this.converter = new PythonNotationConverter();
    }

    protected validateArguments(): CommandValidationResult {
        return {
            isValid: true,
            errors: [],
            warnings: []
        };
    }

    protected async executeImpl(): Promise<void> {
        try {
            // Get active text editor
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                throw new FlintError('No active editor', 'NO_ACTIVE_EDITOR', 'Please open a file to paste JSON into');
            }

            // Read clipboard content
            const clipboardContent = await vscode.env.clipboard.readText();
            if (!clipboardContent.trim()) {
                throw new FlintError(
                    'Clipboard is empty',
                    'EMPTY_CLIPBOARD',
                    'Copy some Python debug output to the clipboard first'
                );
            }

            // Convert to JSON
            const result = this.converter.convert(clipboardContent);

            if (!result.success) {
                throw new FlintError(
                    'Conversion failed',
                    'CONVERSION_FAILED',
                    result.error ?? 'Could not convert clipboard content to valid JSON'
                );
            }

            // Insert at cursor position
            await editor.edit(editBuilder => {
                // If there's a selection, replace it; otherwise insert at cursor
                if (editor.selection.isEmpty) {
                    editBuilder.insert(editor.selection.active, result.json);
                } else {
                    editBuilder.replace(editor.selection, result.json);
                }
            });

            // Show success message
            vscode.window.setStatusBarMessage('Pasted as JSON', 3000);
        } catch (error) {
            if (error instanceof FlintError) {
                throw error;
            }
            throw new FlintError(
                'Failed to paste as JSON',
                'PASTE_AS_JSON_FAILED',
                `Unable to convert and paste: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    getTitle(): string {
        return 'Paste as JSON';
    }
}
