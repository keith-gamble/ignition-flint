/**
 * @module PythonCompletionService
 * @description Unified completion service for Python code in Ignition projects.
 * Consolidates completion logic used by both PythonCompletionProvider (for .py files)
 * and ScriptConsoleViewProvider (for Script Console).
 *
 * Completion sources:
 * 1. Context variables - scope-specific variables (designer, gateway, session, page, view, self)
 * 2. Perspective component properties - self.props.*, self.custom.*, etc.
 * 3. Designer LSP - system.* and project scripts via Designer's ScriptManager
 * 4. Local scripts - fallback when Designer is not connected
 */

import * as vscode from 'vscode';

import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ProjectScannerService } from '@/services/config/ProjectScannerService';
import { DesignerBridgeService } from '@/services/designer/DesignerBridgeService';
import { ConnectionState, DesignerConnectionManager } from '@/services/designer/DesignerConnectionManager';
import { LspClientService, LspCompletionItem } from '@/services/designer/LspClientService';
import { PythonSymbol } from '@/services/python/PythonASTService';
import { ScriptModuleIndexService, ScriptModule } from '@/services/python/ScriptModuleIndexService';

/**
 * Completion scope determines which context variables are available
 */
export enum CompletionScope {
    DESIGNER = 'designer',
    GATEWAY = 'gateway',
    PERSPECTIVE = 'perspective',
    FILE = 'file'
}

/**
 * Perspective context for component property completions
 */
export interface PerspectiveCompletionContext {
    sessionId: string;
    pageId?: string;
    viewInstanceId?: string;
    componentPath?: string;
}

/**
 * Request for completions
 */
export interface CompletionRequest {
    /** Module path prefix (e.g., "system.tag" or "") */
    prefix: string;
    /** The scope determines available context variables */
    scope: CompletionScope;
    /** Project ID for local script completions */
    projectId?: string;
    /** Perspective context for component property completions */
    perspectiveContext?: PerspectiveCompletionContext | null;
    /** Include local script module completions as fallback */
    includeLocalScripts?: boolean;
    /** Include Designer LSP completions */
    includeDesignerLsp?: boolean;
}

/**
 * Response containing completion items
 */
export interface CompletionResponse {
    /** Completion items */
    items: LspCompletionItem[];
    /** Whether results may be incomplete */
    isIncomplete: boolean;
}

/**
 * Interface for the PythonCompletionService
 */
export interface IPythonCompletionService extends IServiceLifecycle {
    /**
     * Gets completion items for the given request
     */
    getCompletions(request: CompletionRequest): Promise<CompletionResponse>;

    /**
     * Converts LSP completion items to VS Code completion items
     */
    convertToVsCodeItems(items: LspCompletionItem[], prefix: string): vscode.CompletionItem[];

    /**
     * Extracts the module path prefix from a line of text
     */
    extractPrefix(lineText: string, cursorPosition: number): { prefix: string; isComplete: boolean } | null;

    /**
     * Checks if Designer LSP is available
     */
    isLspAvailable(): boolean;

    /**
     * Sets the connection manager (called by consumers that manage their own LSP client)
     */
    setConnectionManager(connectionManager: DesignerConnectionManager): void;
}

/**
 * Unified completion service for Python code in Ignition projects.
 */
export class PythonCompletionService implements IPythonCompletionService {
    private status: ServiceStatus = ServiceStatus.NOT_INITIALIZED;
    private lspClientService: LspClientService | null = null;
    private scriptModuleIndexService: ScriptModuleIndexService | null = null;
    private designerBridgeService: DesignerBridgeService | null = null;
    private projectScannerService: ProjectScannerService | null = null;
    private externalConnectionManager: DesignerConnectionManager | null = null;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    async initialize(): Promise<void> {
        this.status = ServiceStatus.INITIALIZING;

        // Get services from container
        this.designerBridgeService = this.serviceContainer.get<DesignerBridgeService>('DesignerBridgeService');
        this.scriptModuleIndexService = this.serviceContainer.get<ScriptModuleIndexService>('ScriptModuleIndexService');
        this.projectScannerService = this.serviceContainer.get<ProjectScannerService>('ProjectScannerService');

        // Initialize LSP client service if Designer Bridge is available
        if (this.designerBridgeService) {
            this.lspClientService = new LspClientService(this.serviceContainer);
            await this.lspClientService.initialize();
        }

        this.status = ServiceStatus.INITIALIZED;
    }

    async start(): Promise<void> {
        if (this.status !== ServiceStatus.INITIALIZED && this.status !== ServiceStatus.STOPPED) {
            await this.initialize();
        }

        // Start LSP client and connect to Designer Bridge
        if (this.lspClientService && this.designerBridgeService) {
            await this.lspClientService.start();

            // Set connection manager if already connected
            const connectionManager = this.designerBridgeService.getConnectionManager();
            if (connectionManager) {
                this.lspClientService.setConnectionManager(connectionManager);
            }

            // Subscribe to connection state changes to update LSP client when Designer connects/disconnects
            this.designerBridgeService.onConnectionStateChanged((state, _designer) => {
                if (state === ConnectionState.CONNECTED) {
                    const manager = this.designerBridgeService?.getConnectionManager();
                    if (manager && this.lspClientService) {
                        this.lspClientService.setConnectionManager(manager);
                    }
                }
            });
        }

        this.status = ServiceStatus.RUNNING;
    }

    async stop(): Promise<void> {
        this.status = ServiceStatus.STOPPING;

        if (this.lspClientService) {
            await this.lspClientService.stop();
        }

        this.status = ServiceStatus.STOPPED;
    }

    async dispose(): Promise<void> {
        await this.stop();

        if (this.lspClientService) {
            await this.lspClientService.dispose();
            this.lspClientService = null;
        }

        this.externalConnectionManager = null;
    }

    getStatus(): ServiceStatus {
        return this.status;
    }

    /**
     * Sets an external connection manager for LSP completions.
     * Used by ScriptConsoleViewProvider which manages its own LSP client lifecycle.
     */
    setConnectionManager(connectionManager: DesignerConnectionManager): void {
        this.externalConnectionManager = connectionManager;

        // Also update the internal LSP client if it exists
        if (this.lspClientService) {
            this.lspClientService.setConnectionManager(connectionManager);
        }
    }

    /**
     * Checks if Designer LSP is available
     */
    isLspAvailable(): boolean {
        return this.lspClientService?.isAvailable() ?? false;
    }

    /**
     * Gets completion items for the given request.
     */
    async getCompletions(request: CompletionRequest): Promise<CompletionResponse> {
        const items: LspCompletionItem[] = [];
        let isIncomplete = false;

        // 1. Context variables (scope-based) - only at root level
        if (request.prefix === '') {
            const contextItems = this.getContextVariables(request.scope, request.perspectiveContext);
            items.push(...contextItems);
        }

        // 2. Perspective self.* completions (both top-level categories and nested properties)
        // Delegate to Designer to dynamically determine available property trees
        if (
            request.scope === CompletionScope.PERSPECTIVE &&
            (request.prefix === 'self' || request.prefix.startsWith('self.')) &&
            request.perspectiveContext?.componentPath
        ) {
            const componentItems = await this.getPerspectiveComponentCompletions(
                request.perspectiveContext,
                request.prefix
            );
            items.push(...componentItems);
        }

        // 4. Designer LSP completions (system.*, project scripts)
        // Skip for self.* prefixes as those are component-specific
        if (request.includeDesignerLsp !== false && !request.prefix.startsWith('self') && this.isLspAvailable()) {
            const lspItems = await this.getDesignerLspCompletions(request.prefix);
            if (lspItems) {
                items.push(...lspItems.items);
                isIncomplete = lspItems.isIncomplete;
            }
        }

        // 5. Local script completions (fallback when Designer not connected)
        if (request.includeLocalScripts && request.projectId) {
            const localItems = await this.getLocalScriptCompletions(request.projectId, request.prefix);
            // Only add items that aren't already present (avoid duplicates with LSP)
            const existingLabels = new Set(items.map(item => item.label.toLowerCase()));
            const uniqueLocalItems = localItems.filter(item => !existingLabels.has(item.label.toLowerCase()));
            items.push(...uniqueLocalItems);
        }

        return { items, isIncomplete };
    }

    /**
     * Gets context-specific completion items based on scope
     */
    private getContextVariables(
        scope: CompletionScope,
        perspectiveContext?: PerspectiveCompletionContext | null
    ): LspCompletionItem[] {
        const items: LspCompletionItem[] = [];

        if (scope === CompletionScope.DESIGNER || scope === CompletionScope.FILE) {
            items.push(
                {
                    label: 'designer',
                    kind: 6, // Variable
                    detail: 'DesignerContext',
                    documentation: 'The Designer context object',
                    insertText: 'designer',
                    insertTextFormat: 1
                },
                {
                    label: 'project',
                    kind: 6, // Variable
                    detail: 'DesignerProject',
                    documentation: 'The current Designer project',
                    insertText: 'project',
                    insertTextFormat: 1
                }
            );
        } else if (scope === CompletionScope.GATEWAY) {
            items.push({
                label: 'gateway',
                kind: 6, // Variable
                detail: 'GatewayContext',
                documentation: 'The Gateway context object',
                insertText: 'gateway',
                insertTextFormat: 1
            });
        } else if (scope === CompletionScope.PERSPECTIVE) {
            // Perspective scope context variables
            items.push({
                label: 'session',
                kind: 6, // Variable
                detail: 'PerspectiveSession',
                documentation: 'The current Perspective session',
                insertText: 'session',
                insertTextFormat: 1
            });

            // Add page/view/self only if context is provided
            if (perspectiveContext?.pageId) {
                items.push({
                    label: 'page',
                    kind: 6, // Variable
                    detail: 'PerspectivePage',
                    documentation: 'The current Perspective page',
                    insertText: 'page',
                    insertTextFormat: 1
                });
            }

            if (perspectiveContext?.viewInstanceId) {
                items.push({
                    label: 'view',
                    kind: 6, // Variable
                    detail: 'PerspectiveView',
                    documentation: 'The current Perspective view',
                    insertText: 'view',
                    insertTextFormat: 1
                });
            }

            if (perspectiveContext?.componentPath) {
                items.push({
                    label: 'self',
                    kind: 6, // Variable
                    detail: 'PerspectiveComponent',
                    documentation: 'The selected component bound as self',
                    insertText: 'self',
                    insertTextFormat: 1
                });
            }
        }

        return items;
    }

    /**
     * Gets Perspective component property completions via RPC.
     * Dynamically retrieves available property trees from the actual component.
     */
    private async getPerspectiveComponentCompletions(
        perspectiveContext: PerspectiveCompletionContext,
        prefix: string
    ): Promise<LspCompletionItem[]> {
        const connectionManager = this.getConnectionManager();
        if (!connectionManager) {
            return [];
        }

        const { sessionId, pageId, viewInstanceId, componentPath } = perspectiveContext;
        if (!sessionId || !pageId || !viewInstanceId || !componentPath) {
            return [];
        }

        try {
            const result = await connectionManager.perspectiveGetComponentCompletions(
                sessionId,
                pageId,
                viewInstanceId,
                componentPath,
                prefix
            );
            return result.items || [];
        } catch (error) {
            console.error('[PythonCompletionService] Error getting Perspective component completions:', error);
            return [];
        }
    }

    /**
     * Gets completions from Designer LSP
     */
    private async getDesignerLspCompletions(prefix: string): Promise<CompletionResponse | null> {
        if (!this.lspClientService?.isAvailable()) {
            return null;
        }

        const result = await this.lspClientService.getCompletions(prefix);
        if (!result) {
            return null;
        }

        return {
            items: result.items,
            isIncomplete: result.isIncomplete
        };
    }

    /**
     * Gets local script module completions (fallback when Designer not connected)
     */
    private async getLocalScriptCompletions(projectId: string, prefix: string): Promise<LspCompletionItem[]> {
        if (!this.scriptModuleIndexService) {
            return [];
        }

        try {
            // Ensure project is indexed before getting completions
            await this.ensureProjectIndexed(projectId);

            // Get VS Code completion items from the index service
            const vsCodeItems = await this.scriptModuleIndexService.getCompletionItems(projectId, prefix);

            // Convert VS Code items to LSP items
            return vsCodeItems.map(item => this.convertVsCodeItemToLsp(item));
        } catch (error) {
            console.error('[PythonCompletionService] Error getting local script completions:', error);
            return [];
        }
    }

    /**
     * Ensures a project is indexed for local script completions.
     * Tries to find the project path from configured projects or workspace folders.
     */
    private async ensureProjectIndexed(projectId: string): Promise<void> {
        if (!this.scriptModuleIndexService) {
            return;
        }

        // Check if already indexed
        const existingIndex = await this.scriptModuleIndexService.getProjectIndex(projectId);
        if (existingIndex) {
            return;
        }

        // Try to find the project path
        let projectPath: string | null = null;

        // 1. Try ProjectScannerService (configured projects)
        if (this.projectScannerService) {
            const project = this.projectScannerService.getProject(projectId);
            if (project) {
                projectPath = project.projectPath;
            } else {
                // Try searching all cached projects by name or title (case-insensitive, partial match)
                const allProjects = this.projectScannerService.getAllCachedResults();
                const projectIdLower = projectId.toLowerCase();
                const matchingProject = allProjects.find(p => {
                    const nameLower = p.projectName.toLowerCase();
                    const titleLower = (p.metadata.title ?? '').toLowerCase();
                    // Exact match (case-insensitive)
                    if (nameLower === projectIdLower || titleLower === projectIdLower) {
                        return true;
                    }
                    // Partial match - projectId is part of name/title or vice versa
                    if (
                        nameLower.includes(projectIdLower) ||
                        titleLower.includes(projectIdLower) ||
                        projectIdLower.includes(nameLower)
                    ) {
                        return true;
                    }
                    return false;
                });
                if (matchingProject) {
                    projectPath = matchingProject.projectPath;
                }
            }
        }

        // 2. If not found by name, search workspace folders for ANY Ignition project
        // (We're connected to Designer for LSP completions - local indexing is just for deep search)
        if (!projectPath) {
            projectPath = await this.findAnyProjectInWorkspace();
        }

        // 3. Index if found, with progress indicator
        if (projectPath) {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Indexing project "${projectId}" for completions...`,
                    cancellable: false
                },
                async progress => {
                    progress.report({ message: 'Scanning Python modules...' });
                    await this.scriptModuleIndexService!.indexProject(projectPath, projectId);
                    progress.report({ message: 'Done!' });
                }
            );
        }
    }

    /**
     * Searches workspace folders for ANY Ignition project (first one found).
     * Used when we can't match by name but still want local indexing.
     */
    private async findAnyProjectInWorkspace(): Promise<string | null> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return null;
        }

        for (const folder of workspaceFolders) {
            const projectPath = await this.searchFolderForAnyProject(folder.uri.fsPath, 0);
            if (projectPath) {
                return projectPath;
            }
        }

        return null;
    }

    /**
     * Recursively searches a folder for ANY Ignition project (first one found).
     * Limited to 4 levels deep to handle nested structures like docker/projects/ProjectName.
     */
    private async searchFolderForAnyProject(folderPath: string, depth: number): Promise<string | null> {
        if (depth > 4) {
            return null;
        }

        try {
            const path = await import('path');
            const projectJsonPath = path.join(folderPath, 'project.json');

            try {
                const stat = await vscode.workspace.fs.stat(vscode.Uri.file(projectJsonPath));
                if (stat.type === vscode.FileType.File) {
                    return folderPath;
                }
            } catch {
                // No project.json at this level
            }

            // Search subdirectories
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(folderPath));
            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory && !name.startsWith('.')) {
                    const subPath = path.join(folderPath, name);
                    const result = await this.searchFolderForAnyProject(subPath, depth + 1);
                    if (result) {
                        return result;
                    }
                }
            }
        } catch {
            // Ignore errors
        }

        return null;
    }

    /**
     * Searches workspace folders for an Ignition project matching the given name.
     */
    private async findProjectInWorkspace(projectName: string): Promise<string | null> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return null;
        }

        for (const folder of workspaceFolders) {
            const projectPath = await this.searchFolderForProject(folder.uri.fsPath, projectName, 0);
            if (projectPath) {
                return projectPath;
            }
        }

        return null;
    }

    /**
     * Recursively searches a folder for an Ignition project matching the given name.
     * Limited to 3 levels deep to avoid excessive searching.
     */
    private async searchFolderForProject(
        folderPath: string,
        projectName: string,
        depth: number
    ): Promise<string | null> {
        if (depth > 3) {
            return null;
        }

        try {
            const path = await import('path');
            const projectJsonPath = path.join(folderPath, 'project.json');

            try {
                const stat = await vscode.workspace.fs.stat(vscode.Uri.file(projectJsonPath));
                if (stat.type === vscode.FileType.File) {
                    // Found a project.json, check if it matches
                    const folderName = path.basename(folderPath);
                    const folderNameLower = folderName.toLowerCase();
                    const searchLower = projectName.toLowerCase();

                    // Helper to check if names match (exact or partial)
                    const namesMatch = (name1: string, name2: string): boolean => {
                        const n1 = name1.toLowerCase();
                        const n2 = name2.toLowerCase();
                        return n1 === n2 || n1.includes(n2) || n2.includes(n1);
                    };

                    if (namesMatch(folderNameLower, searchLower)) {
                        return folderPath;
                    }

                    // Check project.json title
                    try {
                        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(projectJsonPath));
                        const projectJson = JSON.parse(content.toString());
                        if (projectJson.title && namesMatch(projectJson.title, projectName)) {
                            return folderPath;
                        }
                    } catch {
                        // Ignore JSON parse errors
                    }
                }
            } catch {
                // No project.json at this level
            }

            // Search subdirectories
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(folderPath));
            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory && !name.startsWith('.')) {
                    const path = await import('path');
                    const subPath = path.join(folderPath, name);
                    const result = await this.searchFolderForProject(subPath, projectName, depth + 1);
                    if (result) {
                        return result;
                    }
                }
            }
        } catch {
            // Ignore errors
        }

        return null;
    }

    /**
     * Converts a VS Code completion item to an LSP completion item
     */
    private convertVsCodeItemToLsp(vsCodeItem: vscode.CompletionItem): LspCompletionItem {
        const label = typeof vsCodeItem.label === 'string' ? vsCodeItem.label : vsCodeItem.label.label;
        const labelDetail = typeof vsCodeItem.label === 'object' ? vsCodeItem.label.detail : undefined;

        let documentation: string | undefined;
        if (vsCodeItem.documentation) {
            if (typeof vsCodeItem.documentation === 'string') {
                documentation = vsCodeItem.documentation;
            } else {
                documentation = vsCodeItem.documentation.value;
            }
        }

        let insertText: string | undefined;
        if (vsCodeItem.insertText) {
            if (typeof vsCodeItem.insertText === 'string') {
                insertText = vsCodeItem.insertText;
            } else {
                insertText = vsCodeItem.insertText.value;
            }
        }

        return {
            label,
            kind: this.mapVsCodeKindToLspKind(vsCodeItem.kind),
            detail: labelDetail || vsCodeItem.detail,
            documentation,
            insertText,
            insertTextFormat: vsCodeItem.insertText instanceof vscode.SnippetString ? 2 : 1,
            sortText: vsCodeItem.sortText,
            filterText: vsCodeItem.filterText
        };
    }

    /**
     * Maps VS Code completion item kind to LSP kind
     */
    private mapVsCodeKindToLspKind(kind: vscode.CompletionItemKind | undefined): number {
        switch (kind) {
            case vscode.CompletionItemKind.Text:
                return 1;
            case vscode.CompletionItemKind.Method:
                return 2;
            case vscode.CompletionItemKind.Function:
                return 3;
            case vscode.CompletionItemKind.Constructor:
                return 4;
            case vscode.CompletionItemKind.Field:
                return 5;
            case vscode.CompletionItemKind.Variable:
                return 6;
            case vscode.CompletionItemKind.Class:
                return 7;
            case vscode.CompletionItemKind.Interface:
                return 8;
            case vscode.CompletionItemKind.Module:
                return 9;
            case vscode.CompletionItemKind.Property:
                return 10;
            case vscode.CompletionItemKind.Constant:
                return 21;
            default:
                return 1; // Text
        }
    }

    /**
     * Converts LSP completion items to VS Code completion items
     */
    convertToVsCodeItems(items: LspCompletionItem[], prefix: string): vscode.CompletionItem[] {
        return items.map(lspItem => this.convertLspItemToVsCode(lspItem, prefix));
    }

    /**
     * Converts an LSP completion item to a VS Code completion item
     */
    private convertLspItemToVsCode(lspItem: LspCompletionItem, prefix: string): vscode.CompletionItem {
        const kind = this.mapLspKindToVsCodeKind(lspItem.kind);
        const item = new vscode.CompletionItem(lspItem.label, kind);

        // Set detail if available
        if (lspItem.detail) {
            item.detail = lspItem.detail;
        }

        // Set documentation if available
        if (lspItem.documentation) {
            item.documentation = new vscode.MarkdownString(lspItem.documentation);
        }

        // Set insert text
        if (lspItem.insertText) {
            if (lspItem.insertTextFormat === 2) {
                // Snippet format
                item.insertText = new vscode.SnippetString(lspItem.insertText);
            } else {
                item.insertText = lspItem.insertText;
            }
        }

        // Set sort and filter text
        if (lspItem.sortText) {
            item.sortText = lspItem.sortText;
        }
        if (lspItem.filterText) {
            item.filterText = lspItem.filterText;
        }

        // Mark as deprecated if applicable
        if (lspItem.deprecated) {
            item.tags = [vscode.CompletionItemTag.Deprecated];
        }

        // Add source indicator in detail
        const sourcePrefix = prefix ? `${prefix}.${lspItem.label}` : lspItem.label;
        if (!item.detail) {
            item.detail = `Ignition: ${sourcePrefix}`;
        }

        return item;
    }

    /**
     * Maps LSP completion item kind to VS Code completion item kind
     */
    private mapLspKindToVsCodeKind(lspKind: number): vscode.CompletionItemKind {
        switch (lspKind) {
            case 1: // TEXT
                return vscode.CompletionItemKind.Text;
            case 2: // METHOD
                return vscode.CompletionItemKind.Method;
            case 3: // FUNCTION
                return vscode.CompletionItemKind.Function;
            case 4: // CONSTRUCTOR
                return vscode.CompletionItemKind.Constructor;
            case 5: // FIELD
                return vscode.CompletionItemKind.Field;
            case 6: // VARIABLE
                return vscode.CompletionItemKind.Variable;
            case 7: // CLASS
                return vscode.CompletionItemKind.Class;
            case 8: // INTERFACE
                return vscode.CompletionItemKind.Interface;
            case 9: // MODULE
                return vscode.CompletionItemKind.Module;
            case 10: // PROPERTY
                return vscode.CompletionItemKind.Property;
            case 21: // CONSTANT
                return vscode.CompletionItemKind.Constant;
            default:
                return vscode.CompletionItemKind.Text;
        }
    }

    /**
     * Extracts the module path being typed from the line text
     */
    extractPrefix(lineText: string, _cursorPosition: number): { prefix: string; isComplete: boolean } | null {
        // Look for patterns like:
        // - General.Perspective.
        // - from General.Perspective import
        // - general.persp (case insensitive)
        // - = General.

        // Pattern for module access (including from/import statements)
        const patterns = [
            // Direct module access: General.Perspective.Dropdown or general.perspective
            /(?:^|\s|=|\(|,)([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*)(\.|$)/i,
            // From import: from General.Perspective import
            /from\s+([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*)(\s+import\s*|\.|$)/i,
            // Import: import General.Perspective
            /import\s+([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*)(\.|$)/i
        ];

        for (const pattern of patterns) {
            const match = lineText.match(pattern);
            if (match) {
                const modulePath = match[1];
                const isComplete = match[2] === '.';
                return { prefix: modulePath, isComplete };
            }
        }

        // Check if we're in the middle of typing a module path (case insensitive)
        const partialPattern = /(?:^|\s|=|\(|,)([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]*)*)$/i;
        const partialMatch = lineText.match(partialPattern);
        if (partialMatch) {
            return { prefix: partialMatch[1], isComplete: false };
        }

        return null;
    }

    /**
     * Gets the connection manager to use for Perspective completions
     */
    private getConnectionManager(): DesignerConnectionManager | null {
        // Prefer external connection manager (set by ScriptConsoleViewProvider)
        if (this.externalConnectionManager) {
            return this.externalConnectionManager;
        }

        // Fall back to Designer Bridge connection manager
        return this.designerBridgeService?.getConnectionManager() ?? null;
    }

    /**
     * Gets completion items including deep search results for partial names
     * Used when searching at root level for functions/classes across all modules
     */
    async getDeepCompletions(projectId: string, partialName: string): Promise<LspCompletionItem[]> {
        if (!this.scriptModuleIndexService) {
            return [];
        }

        // Ensure project is indexed before searching
        await this.ensureProjectIndexed(projectId);

        const partialLower = partialName.toLowerCase();
        const matchedItems: LspCompletionItem[] = [];

        // Check if 'system' module matches
        if ('system'.startsWith(partialLower)) {
            matchedItems.push({
                label: 'system',
                kind: 9, // Module
                detail: 'Ignition System Functions',
                documentation: 'Built-in Ignition system functions (system.*)',
                insertText: 'system',
                insertTextFormat: 1,
                sortText: '0system'
            });
        }

        // Search modules
        const allModules = await this.scriptModuleIndexService.getAllModules(projectId);

        for (const module of allModules) {
            const parts = module.qualifiedPath.split('.');

            // Check if any part of the path matches
            let isMatch = false;
            let matchedPartIndex = -1;

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i].toLowerCase();
                if (part.startsWith(partialLower) || part.includes(partialLower)) {
                    isMatch = true;
                    matchedPartIndex = i;
                    break;
                }
            }

            if (isMatch) {
                const sortText = parts[matchedPartIndex].toLowerCase().startsWith(partialLower)
                    ? `0${module.qualifiedPath}`
                    : `1${module.qualifiedPath}`;

                matchedItems.push({
                    label: module.qualifiedPath,
                    kind: 9, // Module
                    detail: module.isInherited
                        ? `Module (inherited from ${module.sourceProject})`
                        : `Module (${module.sourceProject})`,
                    documentation: `Script Module: ${module.qualifiedPath}`,
                    insertText: module.qualifiedPath,
                    insertTextFormat: 1,
                    filterText: partialName,
                    sortText
                });
            }
        }

        // Search symbols
        const allSymbolsWithModules = await this.scriptModuleIndexService.getAllSymbolsWithModules(projectId);

        for (const { symbol, module } of allSymbolsWithModules) {
            const symbolNameLower = symbol.name.toLowerCase();

            if (symbolNameLower.startsWith(partialLower) || symbolNameLower.includes(partialLower)) {
                const item = this.createSymbolLspItem(symbol, module, partialName, partialLower);
                matchedItems.push(item);
            }
        }

        return matchedItems;
    }

    /**
     * Creates an LSP completion item for a symbol
     */
    private createSymbolLspItem(
        symbol: PythonSymbol,
        module: ScriptModule,
        partialName: string,
        partialLower: string
    ): LspCompletionItem {
        const fullName = `${module.qualifiedPath}.${symbol.name}`;
        const kind = this.getSymbolLspKind(symbol.type);

        let insertText = fullName;
        let insertTextFormat = 1;

        // Build function snippet
        if (symbol.type === 'function' && symbol.parameters && symbol.parameters.length > 0) {
            const snippetParams: string[] = [];
            let placeholderIndex = 1;

            for (const param of symbol.parameters) {
                if (param.name.startsWith('*')) continue;
                const defaultText = param.defaultValue || param.name;
                snippetParams.push(`\${${placeholderIndex}:${defaultText}}`);
                placeholderIndex++;
            }

            insertText = `${fullName}(${snippetParams.join(', ')})`;
            insertTextFormat = 2; // Snippet
        }

        const detailParts: string[] = [];
        if (symbol.signature) {
            detailParts.push(symbol.signature);
        }
        detailParts.push(module.isInherited ? `(inherited from ${module.sourceProject})` : `(${module.sourceProject})`);

        const symbolNameLower = symbol.name.toLowerCase();
        const sortText = symbolNameLower.startsWith(partialLower) ? `2${fullName}` : `3${fullName}`;

        return {
            label: fullName,
            kind,
            detail: detailParts.join(' '),
            documentation: this.buildSymbolDocumentation(symbol, module),
            insertText,
            insertTextFormat,
            filterText: partialName,
            sortText
        };
    }

    /**
     * Gets LSP kind for a symbol type
     */
    private getSymbolLspKind(symbolType: string): number {
        switch (symbolType) {
            case 'function':
                return 3; // Function
            case 'class':
                return 7; // Class
            case 'variable':
                return 6; // Variable
            case 'constant':
                return 21; // Constant
            default:
                return 1; // Text
        }
    }

    /**
     * Builds documentation string for a symbol
     */
    private buildSymbolDocumentation(symbol: PythonSymbol, module: ScriptModule): string {
        const docs: string[] = [];

        if (symbol.docstring) {
            docs.push(`**${symbol.name}**\n\n${symbol.docstring}`);
        }

        if (symbol.parameters && symbol.parameters.length > 0) {
            const paramDocs: string[] = ['**Parameters:**'];
            for (const param of symbol.parameters) {
                let paramDoc = `- \`${param.name}\``;
                if (param.defaultValue) {
                    paramDoc += ` = ${param.defaultValue}`;
                }
                paramDocs.push(paramDoc);
            }
            docs.push(paramDocs.join('\n'));
        }

        docs.push(`**Module:** \`${module.qualifiedPath}\``);

        if (module.isInherited) {
            docs.push(`*Inherited from ${module.sourceProject}*`);
        }

        return docs.join('\n\n');
    }
}
