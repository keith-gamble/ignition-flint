/**
 * @module NavigateToScriptElementCommand
 * @description Command to navigate to a Python script element by its fully qualified path
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { CommandContext } from '@/core/types/commands';
import { ProjectScannerService } from '@/services/config/ProjectScannerService';
import { ScriptModuleIndexService } from '@/services/python/ScriptModuleIndexService';

/**
 * Command to navigate to a script element (function, class, module) by its qualified path
 */
export class NavigateToScriptElementCommand extends Command {
    static readonly ID = 'flint.navigateToScriptElement';

    private scriptModuleIndexService?: ScriptModuleIndexService;
    private projectScannerService?: ProjectScannerService;

    constructor(context: CommandContext) {
        super(NavigateToScriptElementCommand.ID, context);
    }

    protected async executeImpl(): Promise<void> {
        // Get services
        this.scriptModuleIndexService = this.getService<ScriptModuleIndexService>('ScriptModuleIndexService');
        this.projectScannerService = this.getService<ProjectScannerService>('ProjectScannerService');

        if (!this.scriptModuleIndexService || !this.projectScannerService) {
            vscode.window.showErrorMessage('Script navigation services are not available');
            return;
        }

        // Get the current selection or prompt for input
        const editor = vscode.window.activeTextEditor;
        let initialValue = '';

        if (editor && !editor.selection.isEmpty) {
            // Use selected text as initial value
            initialValue = editor.document.getText(editor.selection);
        }

        // Prompt for the qualified path
        const qualifiedPath = await vscode.window.showInputBox({
            prompt: 'Enter the fully qualified path',
            placeHolder: 'Module.SubModule.function_name',
            value: initialValue,
            validateInput: value => {
                if (!value || value.trim().length === 0) {
                    return 'Please enter a qualified path';
                }
                return null;
            }
        });

        if (!qualifiedPath) {
            return;
        }

        // Clean up the path (remove parentheses if it's a function call)
        const cleanPath = qualifiedPath.trim().replace(/\([^)]*\)$/, '');

        // Try to find the element
        await this.navigateToElement(cleanPath);
    }

    /**
     * Navigate to the specified element
     */
    private async navigateToElement(qualifiedPath: string): Promise<void> {
        // Get all cached projects
        const allProjects = this.projectScannerService!.getAllCachedResults();

        // Try to find the element in any project (including inherited modules)
        for (const project of allProjects) {
            // Get the module index for this project (includes inherited modules)
            const index = await this.scriptModuleIndexService!.getProjectIndex(project.projectName);
            if (!index) {
                continue;
            }

            // Try to find as a complete module first
            const module = index.flatModules.get(qualifiedPath);
            if (module?.filePath) {
                await this.openFileAtModule(module.filePath);
                return;
            }

            // Try to find as a symbol (function/class)
            const symbol = index.symbols.get(qualifiedPath);
            if (symbol) {
                await this.openFileAtLine(symbol.filePath, symbol.lineNumber);
                return;
            }

            // Try partial match - the path might be Module.function where Module contains the function
            const parts = qualifiedPath.split('.');
            if (parts.length >= 2) {
                const functionName = parts[parts.length - 1];
                const modulePath = parts.slice(0, -1).join('.');

                const parentModule = index.flatModules.get(modulePath);
                if (parentModule) {
                    // Look for the function in this module's symbols
                    const matchingSymbol = parentModule.symbols.find(s => s.name === functionName);
                    if (matchingSymbol) {
                        await this.openFileAtLine(matchingSymbol.filePath, matchingSymbol.lineNumber);
                        return;
                    }
                }
            }
        }

        // If we get here, we couldn't find it
        vscode.window.showWarningMessage(`Could not find script element: ${qualifiedPath}`);

        // Offer to search for partial matches
        const action = await vscode.window.showInformationMessage(
            'Would you like to search for similar elements?',
            'Search'
        );

        if (action === 'Search') {
            await this.searchForSimilarElements(qualifiedPath);
        }
    }

    /**
     * Search for similar elements and let user choose
     */
    private async searchForSimilarElements(searchTerm: string): Promise<void> {
        const allProjects = this.projectScannerService!.getAllCachedResults();
        const matches: vscode.QuickPickItem[] = [];

        // Search all projects for similar names
        for (const project of allProjects) {
            const index = await this.scriptModuleIndexService!.getProjectIndex(project.projectName);
            if (!index) continue;

            // Search modules
            for (const [path, module] of index.flatModules) {
                if (path.toLowerCase().includes(searchTerm.toLowerCase())) {
                    const projectInfo = module.isInherited
                        ? `${project.projectName} (inherited from ${module.sourceProject})`
                        : project.projectName;
                    matches.push({
                        label: path,
                        description: 'Module',
                        detail: `Project: ${projectInfo}`
                    });
                }
            }

            // Search symbols
            for (const [name, symbol] of index.symbols) {
                if (name.toLowerCase().includes(searchTerm.toLowerCase())) {
                    matches.push({
                        label: name,
                        description: symbol.type,
                        detail: `Project: ${project.projectName}`
                    });
                }
            }
        }

        if (matches.length === 0) {
            vscode.window.showInformationMessage('No similar elements found');
            return;
        }

        // Let user choose
        const selected = await vscode.window.showQuickPick(matches, {
            placeHolder: 'Select an element to navigate to'
        });

        if (selected) {
            // Navigate to the selected element
            await this.navigateToElement(selected.label);
        }
    }

    /**
     * Open a file at a specific line
     */
    private async openFileAtLine(filePath: string, lineNumber?: number): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            const editor = await vscode.window.showTextDocument(document);

            if (lineNumber && lineNumber > 0) {
                const position = new vscode.Position(lineNumber - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            }

            // Trigger tree reveal for the opened file
            await this.revealInTree(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
            console.error(error);
        }
    }

    /**
     * Open a file for a module
     */
    private async openFileAtModule(filePath: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);

            // Trigger tree reveal for the opened file
            await this.revealInTree(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open module file: ${filePath}`);
            console.error(error);
        }
    }

    /**
     * Triggers the tree to reveal and expand the file node
     */
    private async revealInTree(document: vscode.TextDocument): Promise<void> {
        // Fire an event or command that the tree provider listens to
        // We'll use a command that the tree provider can handle
        await vscode.commands.executeCommand('flint.revealResourceInTree', document.uri);
    }
}
