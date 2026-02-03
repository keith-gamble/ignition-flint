/**
 * @module ConflictCodeLensProvider
 * @description Provides Code Lens actions above merge conflicts containing scripts
 */

import * as vscode from 'vscode';

import { COMMANDS } from '@/core/constants/commands';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ConflictDetectionService } from '@/services/conflict/ConflictDetectionService';

/**
 * Code Lens provider that shows actions above script conflicts
 */
export class ConflictCodeLensProvider implements vscode.CodeLensProvider {
    private serviceContainer: ServiceContainer;

    constructor(serviceContainer: ServiceContainer) {
        this.serviceContainer = serviceContainer;
    }

    /**
     * Provides code lenses for script conflicts
     */
    provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
        // Only for JSON files
        if (!document.fileName.endsWith('.json')) {
            return [];
        }

        // Get the conflict detection service
        const conflictService = this.serviceContainer.get<ConflictDetectionService>('ConflictDetectionService');
        if (!conflictService) {
            return [];
        }

        // Parse conflicts
        const result = conflictService.parseConflicts(document);
        if (!result.hasConflicts || result.scriptConflicts.length === 0) {
            return [];
        }

        const lenses: vscode.CodeLens[] = [];

        for (const conflict of result.scriptConflicts) {
            const range = new vscode.Range(conflict.startLine, 0, conflict.startLine, 0);

            // Main action: Compare decoded scripts (Flint-specific)
            // User can use native VS Code actions to accept current/incoming
            lenses.push(
                new vscode.CodeLens(range, {
                    title: 'Flint: Compare Decoded Scripts',
                    command: COMMANDS.COMPARE_CONFLICT_SCRIPTS,
                    arguments: [document.uri, conflict.id]
                })
            );
        }

        return lenses;
    }

    /**
     * Resolve code lens (optional - we provide commands directly)
     */
    resolveCodeLens?(codeLens: vscode.CodeLens, _token: vscode.CancellationToken): vscode.CodeLens {
        return codeLens;
    }
}
