/**
 * @module ConflictCodeActionProvider
 * @description Provides code actions (lightbulb) for merge conflicts containing scripts
 */

import * as vscode from 'vscode';

import { COMMANDS } from '@/core/constants/commands';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ConflictDetectionService } from '@/services/conflict/ConflictDetectionService';

/**
 * Code action provider that shows lightbulb actions for script conflicts
 */
export class ConflictCodeActionProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Source];

    private serviceContainer: ServiceContainer;

    constructor(serviceContainer: ServiceContainer) {
        this.serviceContainer = serviceContainer;
    }

    /**
     * Provides code actions for script conflicts
     */
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        // Only for JSON files
        if (!document.fileName.endsWith('.json')) {
            return [];
        }

        // Get the conflict detection service
        const conflictService = this.serviceContainer.get<ConflictDetectionService>('ConflictDetectionService');
        if (!conflictService) {
            return [];
        }

        // Check if the cursor is in a script conflict
        const conflict = conflictService.getScriptConflictAtLine(document, range.start.line);
        if (!conflict) {
            return [];
        }

        // Only provide Compare action - user can use native VS Code actions
        // for Accept Current/Incoming on the raw conflict
        const compareAction = new vscode.CodeAction('Flint: Compare Decoded Scripts', vscode.CodeActionKind.QuickFix);
        compareAction.command = {
            command: COMMANDS.COMPARE_CONFLICT_SCRIPTS,
            title: 'Compare Decoded Scripts',
            arguments: [document.uri, conflict.id]
        };
        compareAction.isPreferred = true;

        return [compareAction];
    }
}
