/**
 * @module ScriptCodeActionProvider
 * @description Provides code actions (lightbulb) for editing embedded Python scripts in JSON files
 */

import * as vscode from 'vscode';

import { COMMANDS } from '@/core/constants/commands';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ScriptFileSystemService } from '@/services/decode/ScriptFileSystemService';

/**
 * Code action provider that shows "Edit [Script Type]" lightbulb when cursor is on a script line
 */
export class ScriptCodeActionProvider implements vscode.CodeActionProvider {
    private serviceContainer: ServiceContainer;

    constructor(serviceContainer: ServiceContainer) {
        this.serviceContainer = serviceContainer;
    }

    /**
     * Provides code actions for the current cursor position
     */
    async provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection
    ): Promise<vscode.CodeAction[]> {
        // Only for JSON files
        if (!document.fileName.endsWith('.json')) {
            return [];
        }

        // Get the script file system service
        const scriptService = this.serviceContainer.get<ScriptFileSystemService>('ScriptFileSystemService');
        if (!scriptService) {
            return [];
        }

        // Check if the current line contains a script
        const lineNumber = range.start.line;
        const detection = await scriptService.detectScriptAtLine(document, lineNumber);

        if (!detection) {
            return [];
        }

        // Create the code action (using QuickFix for automatic lightbulb)
        const action = new vscode.CodeAction(
            `Edit ${detection.scriptType.displayName}`,
            vscode.CodeActionKind.QuickFix
        );

        action.command = {
            command: COMMANDS.EDIT_EMBEDDED_SCRIPT,
            title: `Edit ${detection.scriptType.displayName}`,
            arguments: [document.uri, lineNumber]
        };

        // Mark as preferred so it's the default action
        action.isPreferred = true;

        return [action];
    }
}
