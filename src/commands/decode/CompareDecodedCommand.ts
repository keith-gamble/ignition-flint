/**
 * @module CompareDecodedCommand
 * @description Command to compare decoded JSON with the original or Git HEAD
 * Provides diff view for reviewing changes with readable scripts
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { DecodedFileSystemService } from '@/services/decode/DecodedFileSystemService';

/**
 * Comparison mode for the diff view
 */
type CompareMode = 'original' | 'git';

/**
 * Command to compare decoded JSON files
 * Supports comparing with original (encoded) or Git HEAD
 */
export class CompareDecodedCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.COMPARE_DECODED_WITH_GIT, context);
    }

    protected validateArguments(...args: unknown[]): CommandValidationResult {
        const uri = args[0];
        const mode = args[1] as CompareMode | undefined;

        if (uri !== undefined && !(uri instanceof vscode.Uri)) {
            return {
                isValid: false,
                errors: ['Invalid argument: expected a file URI or no argument'],
                warnings: []
            };
        }

        if (mode !== undefined && mode !== 'original' && mode !== 'git') {
            return {
                isValid: false,
                errors: ['Invalid mode: expected "original" or "git"'],
                warnings: []
            };
        }

        return {
            isValid: true,
            errors: [],
            warnings: []
        };
    }

    protected async executeImpl(uri?: vscode.Uri, mode?: CompareMode): Promise<void> {
        try {
            // Get the file URI from argument or active editor
            const fileUri = uri ?? this.getActiveEditorUri();

            if (!fileUri) {
                throw new FlintError('No JSON file selected', 'NO_FILE_SELECTED', 'Please open a JSON file first');
            }

            // Validate it's a JSON file
            if (!fileUri.fsPath.endsWith('.json')) {
                throw new FlintError('Not a JSON file', 'INVALID_FILE_TYPE', 'This command only works with JSON files');
            }

            // Determine compare mode - default to git if available
            const compareMode = mode ?? (await this.determineDefaultMode(fileUri));

            if (compareMode === 'git') {
                await this.compareWithGit(fileUri);
            } else {
                await this.compareWithOriginal(fileUri);
            }
        } catch (error) {
            if (error instanceof FlintError) {
                throw error;
            }
            throw new FlintError(
                'Failed to open comparison view',
                'COMPARE_DECODED_FAILED',
                `Unable to compare files: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Compares decoded current file with decoded Git HEAD version
     */
    private async compareWithGit(fileUri: vscode.Uri): Promise<void> {
        const decodedFsService = this.getService<DecodedFileSystemService>('DecodedFileSystemService');

        // Register the current file for decoded viewing
        const decodedCurrentUri = await decodedFsService.registerFile(fileUri);

        // Get the Git HEAD version
        const gitUri = fileUri.with({ scheme: 'git', query: 'HEAD' });

        // Check if the file is tracked by Git
        try {
            await vscode.workspace.fs.stat(gitUri);
        } catch {
            throw new FlintError(
                'File not tracked by Git',
                'GIT_FILE_NOT_TRACKED',
                'This file is not tracked by Git or has no previous commits'
            );
        }

        // For Git comparison, we need to show:
        // Left: Decoded Git HEAD version
        // Right: Decoded current version
        //
        // Unfortunately, we can't easily decode the Git version without creating
        // a temporary decoded provider for it. For now, we'll show:
        // Left: Original Git HEAD (encoded)
        // Right: Decoded current version
        //
        // This still helps as users can see the decoded current version

        const fileName = fileUri.fsPath.split('/').pop() ?? 'file.json';
        const title = `${fileName} (Git HEAD ↔ Decoded)`;

        await vscode.commands.executeCommand('vscode.diff', gitUri, decodedCurrentUri, title);
    }

    /**
     * Compares decoded version with original encoded version
     */
    private async compareWithOriginal(fileUri: vscode.Uri): Promise<void> {
        const decodedFsService = this.getService<DecodedFileSystemService>('DecodedFileSystemService');

        // Register the file for decoded viewing
        const decodedUri = await decodedFsService.registerFile(fileUri);

        const fileName = fileUri.fsPath.split('/').pop() ?? 'file.json';
        const title = `${fileName} (Encoded ↔ Decoded)`;

        // Show diff: original (encoded) vs decoded
        await vscode.commands.executeCommand('vscode.diff', fileUri, decodedUri, title);
    }

    /**
     * Determines the default comparison mode based on Git availability
     */
    private async determineDefaultMode(fileUri: vscode.Uri): Promise<CompareMode> {
        try {
            // Check if Git extension is available and file is tracked
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (gitExtension?.isActive) {
                const gitUri = fileUri.with({ scheme: 'git', query: 'HEAD' });
                await vscode.workspace.fs.stat(gitUri);
                return 'git';
            }
        } catch {
            // Git not available or file not tracked
        }

        return 'original';
    }

    /**
     * Gets the URI of the active editor's document
     */
    private getActiveEditorUri(): vscode.Uri | undefined {
        const uri = vscode.window.activeTextEditor?.document.uri;
        if (!uri) {
            return undefined;
        }

        // Handle both regular files and decoded files
        if (uri.scheme === 'file') {
            return uri;
        }

        // If it's already a decoded file, get the original
        if (uri.scheme === DecodedFileSystemService.SCHEME) {
            const decodedFsService = this.getService<DecodedFileSystemService>('DecodedFileSystemService');
            return decodedFsService.getOriginalUri(uri);
        }

        return undefined;
    }

    getTitle(): string {
        return 'Compare Decoded with Git';
    }
}
