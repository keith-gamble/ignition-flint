/**
 * @module PythonCompletionProvider
 * @description Provides IntelliSense completion for Python files in Ignition projects
 * Offers completion for script modules using their fully qualified paths.
 *
 * This provider delegates to PythonCompletionService for the actual completion logic,
 * providing a unified completion experience across .py file editing and Script Console.
 */

import * as path from 'path';

import * as vscode from 'vscode';

import { ServiceContainer } from '@/core/ServiceContainer';
import { CompletionScope, PythonCompletionService } from '@/services/completion';
import { ProjectScannerService } from '@/services/config/ProjectScannerService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';
import { ScriptModuleIndexService } from '@/services/python/ScriptModuleIndexService';

/**
 * Completion provider for Python script modules in Ignition projects.
 * Delegates to PythonCompletionService for unified completion logic.
 */
export class PythonCompletionProvider implements vscode.CompletionItemProvider {
    private scriptModuleIndexService?: ScriptModuleIndexService;
    private projectScannerService?: ProjectScannerService;
    private gatewayManagerService?: GatewayManagerService;
    private completionService?: PythonCompletionService;

    constructor(serviceContainer: ServiceContainer) {
        this.scriptModuleIndexService = serviceContainer.get<ScriptModuleIndexService>('ScriptModuleIndexService');
        this.projectScannerService = serviceContainer.get<ProjectScannerService>('ProjectScannerService');
        this.gatewayManagerService = serviceContainer.get<GatewayManagerService>('GatewayManagerService');
        this.completionService = serviceContainer.get<PythonCompletionService>('PythonCompletionService');
    }

    /**
     * Provides completion items for the current position in the document.
     * Uses hybrid mode: tries Designer LSP first for system functions,
     * falls back to local indexing when Designer is not connected.
     *
     * Controlled by settings:
     * - flint.enablePythonAutocomplete: Master switch for all completions
     * - flint.enableDesignerLspCompletion: Enable/disable Designer LSP completions
     * - flint.enableLocalScriptCompletion: Enable/disable local script indexing
     */
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | vscode.CompletionList | null | undefined> {
        // Check if Python autocomplete is enabled (master switch)
        const config = vscode.workspace.getConfiguration('flint');
        if (!config.get<boolean>('enablePythonAutocomplete', true)) {
            return null;
        }

        // Get individual completion source settings
        const enableDesignerLsp = config.get<boolean>('enableDesignerLspCompletion', true);
        const enableLocalScript = config.get<boolean>('enableLocalScriptCompletion', true);

        // If both sources are disabled, return nothing
        if (!enableDesignerLsp && !enableLocalScript) {
            return null;
        }

        if (!this.completionService || !this.projectScannerService || !this.gatewayManagerService) {
            return null;
        }

        // Check if we're in an Ignition project
        const projectId = await this.getProjectIdForDocument(document);
        if (!projectId) {
            return null;
        }

        // Get the current line text up to the cursor
        const linePrefix = document.lineAt(position).text.substring(0, position.character);

        // Check if we're completing a module path
        const modulePathMatch = this.completionService.extractPrefix(linePrefix, position.character);
        if (!modulePathMatch) {
            // Check if we should provide root module completions
            if (this.shouldProvideRootCompletions(linePrefix)) {
                return this.getRootCompletions(projectId, enableDesignerLsp, enableLocalScript);
            }
            return null;
        }

        const { prefix, isComplete } = modulePathMatch;

        // Get completions from the unified service
        const response = await this.completionService.getCompletions({
            prefix: isComplete ? prefix : this.getParentPrefix(prefix),
            scope: CompletionScope.FILE,
            projectId,
            includeDesignerLsp: enableDesignerLsp,
            includeLocalScripts: enableLocalScript
        });

        // Convert to VS Code items
        let items = this.completionService.convertToVsCodeItems(response.items, isComplete ? prefix : '');

        // If not complete (partial typing), filter the results
        if (!isComplete && prefix) {
            const partialName = this.getPartialName(prefix);
            if (partialName) {
                items = this.filterItems(items, partialName);
            }
        }

        // If at root level with partial name, also do deep search
        if (!isComplete && !prefix.includes('.') && prefix && enableLocalScript) {
            const deepItems = await this.getDeepCompletionItems(projectId, prefix);
            items = this.mergeCompletionItems(items, deepItems);
        }

        return items.length > 0 ? items : null;
    }

    /**
     * Gets root level completions (empty prefix)
     */
    private async getRootCompletions(
        projectId: string,
        enableDesignerLsp: boolean,
        enableLocalScript: boolean
    ): Promise<vscode.CompletionItem[]> {
        if (!this.completionService) {
            return [];
        }

        const response = await this.completionService.getCompletions({
            prefix: '',
            scope: CompletionScope.FILE,
            projectId,
            includeDesignerLsp: enableDesignerLsp,
            includeLocalScripts: enableLocalScript
        });

        return this.completionService.convertToVsCodeItems(response.items, '');
    }

    /**
     * Gets the parent prefix (everything before the last dot)
     */
    private getParentPrefix(prefix: string): string {
        const lastDotIndex = prefix.lastIndexOf('.');
        return lastDotIndex >= 0 ? prefix.substring(0, lastDotIndex) : '';
    }

    /**
     * Gets the partial name (everything after the last dot)
     */
    private getPartialName(prefix: string): string {
        const lastDotIndex = prefix.lastIndexOf('.');
        return lastDotIndex >= 0 ? prefix.substring(lastDotIndex + 1) : prefix;
    }

    /**
     * Filters completion items by partial name
     */
    private filterItems(items: vscode.CompletionItem[], partialName: string): vscode.CompletionItem[] {
        const partialLower = partialName.toLowerCase();

        const filtered = items.filter(item => {
            const label = typeof item.label === 'string' ? item.label : item.label.label;
            const labelLower = label.toLowerCase();
            return labelLower.startsWith(partialLower) || labelLower.includes(partialLower);
        });

        // Sort: prefix matches first, then substring matches
        filtered.sort((a, b) => {
            const aLabel = (typeof a.label === 'string' ? a.label : a.label.label).toLowerCase();
            const bLabel = (typeof b.label === 'string' ? b.label : b.label.label).toLowerCase();

            const aStartsWith = aLabel.startsWith(partialLower);
            const bStartsWith = bLabel.startsWith(partialLower);

            if (aStartsWith && !bStartsWith) return -1;
            if (!aStartsWith && bStartsWith) return 1;

            return aLabel.localeCompare(bLabel);
        });

        return filtered;
    }

    /**
     * Gets deep completion items - searches all modules and symbols at all depths
     */
    private async getDeepCompletionItems(projectId: string, partialName: string): Promise<vscode.CompletionItem[]> {
        if (!this.completionService) {
            return [];
        }

        const deepItems = await this.completionService.getDeepCompletions(projectId, partialName);
        return this.completionService.convertToVsCodeItems(deepItems, '');
    }

    /**
     * Merges completion items, avoiding duplicates
     */
    private mergeCompletionItems(
        primaryItems: vscode.CompletionItem[],
        secondaryItems: vscode.CompletionItem[]
    ): vscode.CompletionItem[] {
        const primaryLabels = new Set<string>();
        for (const item of primaryItems) {
            const label = typeof item.label === 'string' ? item.label : item.label.label;
            primaryLabels.add(label.toLowerCase());
        }

        const merged = [...primaryItems];
        for (const item of secondaryItems) {
            const label = typeof item.label === 'string' ? item.label : item.label.label;
            if (!primaryLabels.has(label.toLowerCase())) {
                merged.push(item);
            }
        }

        return merged;
    }

    /**
     * Determines if we should provide root module completions
     */
    private shouldProvideRootCompletions(lineText: string): boolean {
        const triggers = [/(?:^|\s)from\s*$/, /(?:^|\s)import\s*$/, /=\s*$/, /\(\s*$/, /,\s*$/, /:\s*$/, /^\s*$/];

        return triggers.some(pattern => pattern.test(lineText));
    }

    private async getProjectIdForDocument(document: vscode.TextDocument): Promise<string | null> {
        let filePath = document.uri.fsPath;

        // Handle virtual script files (flint-script:// scheme)
        if (document.uri.scheme === 'flint-script') {
            const query = new URLSearchParams(document.uri.query);
            const originalFile = query.get('file');
            if (originalFile) {
                filePath = decodeURIComponent(originalFile);
            } else {
                return this.getProjectIdFromActiveContext();
            }
        }

        // Find the project root based on the file path structure
        const parts = filePath.split(path.sep);
        let projectRoot: string | null = null;

        // Check for script-python structure: project-root/ignition/script-python/...
        const ignitionIndex = parts.lastIndexOf('ignition');
        if (ignitionIndex > 0 && filePath.includes('script-python')) {
            projectRoot = parts.slice(0, ignitionIndex).join(path.sep);
        }

        // Check for Perspective/Vision structure: project-root/com.inductiveautomation.*/...
        if (!projectRoot) {
            for (let i = 0; i < parts.length; i++) {
                if (parts[i].startsWith('com.inductiveautomation.')) {
                    projectRoot = parts.slice(0, i).join(path.sep);
                    break;
                }
            }
        }

        // If we still don't have a project root, try to get from active context
        if (!projectRoot) {
            return this.getProjectIdFromActiveContext();
        }

        // First check if the project is already indexed
        const projectName = path.basename(projectRoot);

        // Try to get from cached results first
        let project = this.projectScannerService!.getProject(projectName);

        // If not found by directory name, scan all cached projects by path
        if (!project) {
            const allProjects = this.projectScannerService!.getAllCachedResults();
            project = allProjects.find(p => p.projectPath === projectRoot);
        }

        if (!project) {
            // Check if this is actually an Ignition project
            const isProject = await this.projectScannerService!.isIgnitionProject(projectRoot);
            if (!isProject) {
                console.warn('Not an Ignition project (no project.json):', projectRoot);
                return null;
            }

            // Try to index the project on-demand with progress indicator
            try {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Indexing project "${projectName}" for completions...`,
                        cancellable: false
                    },
                    async progress => {
                        progress.report({ message: 'Scanning project structure...' });
                        await this.projectScannerService!.scanProject(projectRoot);

                        // Now try to index the Python modules
                        if (this.scriptModuleIndexService) {
                            progress.report({ message: 'Indexing Python modules...' });
                            await this.scriptModuleIndexService.indexProject(projectRoot, projectName);
                        }
                    }
                );

                // Try to get the project again
                project = this.projectScannerService!.getProject(projectName);
            } catch (error) {
                console.error('Failed to index project:', error);
            }
        } else {
            // Ensure the project is indexed for Python modules
            if (this.scriptModuleIndexService) {
                const index = await this.scriptModuleIndexService.getProjectIndex(projectName);
                if (!index) {
                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: `Indexing project "${projectName}" for completions...`,
                            cancellable: false
                        },
                        async progress => {
                            progress.report({ message: 'Indexing Python modules...' });
                            await this.scriptModuleIndexService!.indexProject(projectRoot, projectName);
                        }
                    );
                }
            }
        }

        return project ? project.projectName : projectName;
    }

    /**
     * Gets the project ID from the currently active gateway/project context
     */
    private getProjectIdFromActiveContext(): string | null {
        if (!this.gatewayManagerService) {
            return null;
        }

        return this.gatewayManagerService.getActiveProjectId();
    }

    /**
     * Resolves completion item with additional details
     */
    resolveCompletionItem?(
        item: vscode.CompletionItem,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CompletionItem> {
        return item;
    }
}
