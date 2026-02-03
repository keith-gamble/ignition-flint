/**
 * @module AcceptConflictSideCommand
 * @description Commands to quickly accept one side of a merge conflict
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { ConflictSide } from '@/core/types/conflict';
import { ConflictDetectionService } from '@/services/conflict/ConflictDetectionService';
import { ConflictScriptFileSystemService } from '@/services/conflict/ConflictScriptFileSystemService';

/**
 * Base command for accepting a specific side of a conflict
 */
abstract class AcceptConflictSideBaseCommand extends Command {
    protected abstract readonly side: ConflictSide;

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
            let documentUri = uri ?? editor?.document.uri;
            let resolvedConflictId = conflictId;

            if (!documentUri) {
                throw new FlintError(
                    'No file selected',
                    'NO_FILE_SELECTED',
                    'Please open a JSON file with merge conflicts'
                );
            }

            // Check if we're in a conflict virtual file (editor title button case)
            if (documentUri.scheme === 'flint-conflict') {
                // Extract original file and conflict ID from query params
                const params = new URLSearchParams(documentUri.query);
                const originalFile = params.get('file');
                const queryConflictId = params.get('conflictId');

                if (originalFile && queryConflictId) {
                    documentUri = vscode.Uri.file(decodeURIComponent(originalFile));
                    resolvedConflictId = decodeURIComponent(queryConflictId);
                }
            }

            // Validate it's a JSON file
            if (!documentUri.fsPath.endsWith('.json')) {
                throw new FlintError('Not a JSON file', 'INVALID_FILE_TYPE', 'This command only works with JSON files');
            }

            // Get services
            const conflictService = this.getService<ConflictDetectionService>('ConflictDetectionService');
            const scriptService = this.getService<ConflictScriptFileSystemService>('ConflictScriptFileSystemService');

            // Get the document
            const document = await vscode.workspace.openTextDocument(documentUri);

            // Find the conflict
            let conflict;

            if (resolvedConflictId) {
                conflict = conflictService.getConflictById(document, resolvedConflictId);
            } else {
                // Use cursor position to find conflict
                const line = editor?.selection.active.line ?? 0;
                conflict = conflictService.getScriptConflictAtLine(document, line);
                resolvedConflictId = conflict?.id ?? '';
            }

            if (!conflict || !resolvedConflictId) {
                throw new FlintError(
                    'No script conflict found',
                    'NO_CONFLICT',
                    'Position your cursor within a merge conflict containing a script field'
                );
            }

            // Resolve the conflict with the chosen side
            await scriptService.resolveConflictWithSide(documentUri, resolvedConflictId, this.side);
        } catch (error) {
            if (error instanceof FlintError) {
                throw error;
            }
            throw new FlintError(
                `Failed to accept ${this.side} script`,
                'ACCEPT_FAILED',
                `Unable to resolve conflict: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }
}

/**
 * Command to accept the current (HEAD) side of a conflict
 */
export class AcceptCurrentScriptCommand extends AcceptConflictSideBaseCommand {
    protected readonly side: ConflictSide = 'current';

    constructor(context: CommandContext) {
        super(COMMANDS.ACCEPT_CURRENT_SCRIPT, context);
    }

    getTitle(): string {
        return 'Accept Current Script';
    }
}

/**
 * Command to accept the incoming side of a conflict
 */
export class AcceptIncomingScriptCommand extends AcceptConflictSideBaseCommand {
    protected readonly side: ConflictSide = 'incoming';

    constructor(context: CommandContext) {
        super(COMMANDS.ACCEPT_INCOMING_SCRIPT, context);
    }

    getTitle(): string {
        return 'Accept Incoming Script';
    }
}
