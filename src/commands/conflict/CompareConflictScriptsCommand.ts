/**
 * @module CompareConflictScriptsCommand
 * @description Command to open a merge editor webview for resolving encoded script conflicts
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { ConflictDetectionService } from '@/services/conflict/ConflictDetectionService';
import { ConflictMergeWebview } from '@/views/webview/ConflictMergeWebview';

/**
 * Command to compare and resolve decoded scripts from a merge conflict
 * Opens a custom 3-panel merge editor webview
 */
export class CompareConflictScriptsCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.COMPARE_CONFLICT_SCRIPTS, context);
    }

    protected validateArguments(...args: unknown[]): CommandValidationResult {
        const uri = args[0];
        const conflictId = args[1];

        if (uri !== undefined && !(uri instanceof vscode.Uri)) {
            return {
                isValid: false,
                errors: ['Invalid argument: expected a file URI'],
                warnings: []
            };
        }

        if (conflictId !== undefined && typeof conflictId !== 'string') {
            return {
                isValid: false,
                errors: ['Invalid argument: conflict ID must be a string'],
                warnings: []
            };
        }

        return {
            isValid: true,
            errors: [],
            warnings: []
        };
    }

    protected async executeImpl(uri?: vscode.Uri, conflictId?: string): Promise<void> {
        try {
            const editor = vscode.window.activeTextEditor;

            // Get URI from arguments or active editor
            const documentUri = uri ?? editor?.document.uri;

            if (!documentUri) {
                throw new FlintError(
                    'No file selected',
                    'NO_FILE_SELECTED',
                    'Please open a JSON file with merge conflicts'
                );
            }

            // Validate it's a JSON file
            if (!documentUri.fsPath.endsWith('.json')) {
                throw new FlintError('Not a JSON file', 'INVALID_FILE_TYPE', 'This command only works with JSON files');
            }

            // Get services
            const conflictService = this.getService<ConflictDetectionService>('ConflictDetectionService');
            const mergeWebview = this.getService<ConflictMergeWebview>('ConflictMergeWebview');

            // Get the document
            const document = await vscode.workspace.openTextDocument(documentUri);

            // Find the conflict
            let conflict;
            if (conflictId) {
                conflict = conflictService.getConflictById(document, conflictId);
            } else {
                // Use cursor position to find conflict
                const line = editor?.selection.active.line ?? 0;
                conflict = conflictService.getScriptConflictAtLine(document, line);
            }

            if (!conflict) {
                throw new FlintError(
                    'No script conflict found',
                    'NO_CONFLICT',
                    'Position your cursor within a merge conflict containing a script field'
                );
            }

            // Open the custom merge webview
            await mergeWebview.openConflictMerge(documentUri, conflict);
        } catch (error) {
            if (error instanceof FlintError) {
                throw error;
            }
            throw new FlintError(
                'Failed to open merge editor',
                'MERGE_EDITOR_FAILED',
                `Unable to open merge editor: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    getTitle(): string {
        return 'Compare Conflict Scripts';
    }
}
