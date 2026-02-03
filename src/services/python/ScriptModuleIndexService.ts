/**
 * @module ScriptModuleIndexService
 * @description Service for indexing and managing Ignition script modules
 * Builds a hierarchical module structure from script-python directories
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { IgnitionStubParser } from './IgnitionStubParser';
import { IgnitionStubsManagerService } from './IgnitionStubsManagerService';
import { PythonASTService, PythonSymbol } from './PythonASTService';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ProjectScanResult, ProjectScannerService } from '@/services/config/ProjectScannerService';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';

/**
 * Represents a script module in the hierarchy
 */
export interface ScriptModule {
    /** Module name (folder name) */
    readonly name: string;
    /** Full module path (e.g., General.Perspective.Dropdown) */
    readonly qualifiedPath: string;
    /** Parent module path */
    readonly parentPath?: string;
    /** Child modules */
    readonly children: ReadonlyMap<string, ScriptModule>;
    /** Symbols defined in this module */
    readonly symbols: readonly PythonSymbol[];
    /** File path to the module's code.py */
    readonly filePath?: string;
    /** Source project */
    readonly sourceProject: string;
    /** Whether this module is inherited from a parent project */
    readonly isInherited: boolean;
}

/**
 * Module index for a project including inheritance
 */
export interface ProjectModuleIndex {
    /** Project ID */
    readonly projectId: string;
    /** Root modules map */
    readonly modules: ReadonlyMap<string, ScriptModule>;
    /** Flat map of all modules by qualified path */
    readonly flatModules: ReadonlyMap<string, ScriptModule>;
    /** All symbols indexed by qualified name */
    readonly symbols: ReadonlyMap<string, PythonSymbol>;
    /** Last index time */
    readonly indexedAt: Date;
}

/**
 * Service for indexing and managing script modules
 */
export class ScriptModuleIndexService implements IServiceLifecycle {
    private projectIndexes = new Map<string, ProjectModuleIndex>();
    private systemModules = new Map<string, ScriptModule[]>(); // System modules by version
    private currentSystemVersion?: string;
    private declinedVersionPrompts = new Set<string>(); // Track gateways where user declined version prompt
    private isInitialized = false;
    private pythonASTService?: PythonASTService;
    private projectScannerService?: ProjectScannerService;
    private ignitionStubsManagerService?: IgnitionStubsManagerService;
    private gatewayManagerService?: GatewayManagerService;
    private configService?: WorkspaceConfigService;

    private readonly indexUpdateEmitter = new vscode.EventEmitter<ProjectModuleIndex>();
    public readonly onIndexUpdate = this.indexUpdateEmitter.event;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    initialize(): Promise<void> {
        this.pythonASTService = this.serviceContainer.get<PythonASTService>('PythonASTService');
        this.projectScannerService = this.serviceContainer.get<ProjectScannerService>('ProjectScannerService');
        this.ignitionStubsManagerService =
            this.serviceContainer.get<IgnitionStubsManagerService>('IgnitionStubsManagerService');
        this.gatewayManagerService = this.serviceContainer.get<GatewayManagerService>('GatewayManagerService');
        this.configService = this.serviceContainer.get<WorkspaceConfigService>('WorkspaceConfigService');

        if (!this.pythonASTService) {
            throw new FlintError(
                'PythonASTService is required for ScriptModuleIndexService',
                'SERVICE_DEPENDENCY_MISSING'
            );
        }

        if (!this.projectScannerService) {
            throw new FlintError(
                'ProjectScannerService is required for ScriptModuleIndexService',
                'SERVICE_DEPENDENCY_MISSING'
            );
        }

        this.isInitialized = true;
        return Promise.resolve();
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            throw new FlintError(
                'ScriptModuleIndexService must be initialized before starting',
                'SERVICE_NOT_INITIALIZED'
            );
        }
        return Promise.resolve();
    }

    stop(): Promise<void> {
        this.projectIndexes.clear();
        return Promise.resolve();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.indexUpdateEmitter.dispose();
        this.isInitialized = false;
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Indexes script modules for a project
     */
    async indexProject(projectPath: string, projectId: string): Promise<ProjectModuleIndex> {
        if (!this.pythonASTService || !this.projectScannerService) {
            throw new FlintError('Services not initialized', 'SERVICES_NOT_INITIALIZED');
        }

        // Get project scan result to include inheritance
        const scanResult = await this.projectScannerService.scanProject(projectPath);

        // Build module tree for this project
        const modules = await this.buildModuleTree(projectPath, projectId, false);

        // Add inherited modules from parent projects
        const inheritedModules = await this.getInheritedModules(scanResult);

        const mergedModules = this.mergeModules(modules, inheritedModules);

        // Build flat module map and symbol map
        const flatModules = new Map<string, ScriptModule>();
        const symbols = new Map<string, PythonSymbol>();

        this.flattenModules(mergedModules, flatModules, symbols);

        const index: ProjectModuleIndex = {
            projectId,
            modules: mergedModules,
            flatModules,
            symbols,
            indexedAt: new Date()
        };

        // Cache the index
        this.projectIndexes.set(projectId, index);

        // Emit update event
        this.indexUpdateEmitter.fire(index);

        return index;
    }

    /**
     * Gets the module index for a project
     */
    async getProjectIndex(projectId: string): Promise<ProjectModuleIndex | undefined> {
        // Check cache first
        const cached = this.projectIndexes.get(projectId);
        if (cached) {
            return cached;
        }

        // Try to find project and index it
        if (this.projectScannerService) {
            const project = this.projectScannerService.getProject(projectId);
            if (project) {
                return this.indexProject(project.projectPath, projectId);
            }
        }

        return undefined;
    }

    /**
     * Builds the module tree for a project
     */
    private async buildModuleTree(
        projectPath: string,
        projectId: string,
        isInherited: boolean
    ): Promise<Map<string, ScriptModule>> {
        const modules = new Map<string, ScriptModule>();
        const scriptPythonPath = path.join(projectPath, 'ignition', 'script-python');

        try {
            await fs.access(scriptPythonPath);
        } catch {
            // No script-python directory
            return modules;
        }

        await this.scanModuleDirectory(scriptPythonPath, '', modules, projectId, isInherited);

        return modules;
    }

    /**
     * Recursively scans a directory for script modules
     */
    private async scanModuleDirectory(
        dirPath: string,
        parentPath: string,
        modules: Map<string, ScriptModule>,
        projectId: string,
        isInherited: boolean
    ): Promise<void> {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const moduleName = entry.name;
            const modulePath = path.join(dirPath, moduleName);
            const qualifiedPath = parentPath ? `${parentPath}.${moduleName}` : moduleName;

            // Check if this directory contains code.py
            const codePyPath = path.join(modulePath, 'code.py');
            let symbols: PythonSymbol[] = [];
            let hasCodePy = false;

            try {
                await fs.access(codePyPath);
                hasCodePy = true;

                // Parse the code.py file
                if (this.pythonASTService) {
                    symbols = await this.pythonASTService.parseFile(codePyPath, qualifiedPath);
                }
            } catch {
                // No code.py file, but still could have subdirectories
            }

            // Create module entry
            const module: ScriptModule = {
                name: moduleName,
                qualifiedPath,
                parentPath: parentPath || undefined,
                children: new Map(),
                symbols,
                filePath: hasCodePy ? codePyPath : undefined,
                sourceProject: projectId,
                isInherited
            };

            // Recursively scan subdirectories
            await this.scanModuleDirectory(
                modulePath,
                qualifiedPath,
                module.children as Map<string, ScriptModule>,
                projectId,
                isInherited
            );

            // Add module to parent level
            modules.set(moduleName, module);
        }
    }

    /**
     * Gets inherited modules from parent projects
     */
    private async getInheritedModules(scanResult: ProjectScanResult): Promise<Map<string, ScriptModule>> {
        let inheritedModules = new Map<string, ScriptModule>();

        if (!this.projectScannerService || !scanResult.inheritanceChain.length) {
            return inheritedModules;
        }

        for (const parentProjectName of scanResult.inheritanceChain) {
            // Try to find the parent project - it might be cached by a different name
            let parentProject = this.projectScannerService.getProject(parentProjectName);

            // If not found by name, try to find by matching project title
            if (!parentProject) {
                const allProjects = this.projectScannerService.getAllCachedResults();

                // The inheritance chain uses directory names (from parent field in project.json)
                // We need to match by directory name primarily
                parentProject = allProjects.find(p => {
                    const directoryName = path.basename(p.projectPath);
                    return (
                        directoryName === parentProjectName ||
                        p.projectName === parentProjectName ||
                        p.metadata.title === parentProjectName
                    );
                });
            }

            if (parentProject) {
                const parentModules = await this.buildModuleTree(
                    parentProject.projectPath,
                    parentProject.projectName,
                    true
                );

                // Merge parent modules (earlier parents override later ones)
                inheritedModules = this.mergeModules(inheritedModules, parentModules);
            }
        }

        return inheritedModules;
    }

    /**
     * Merges two module maps, with base modules being overridden by override modules
     */
    private mergeModules(
        base: Map<string, ScriptModule>,
        override: Map<string, ScriptModule>
    ): Map<string, ScriptModule> {
        const merged = new Map<string, ScriptModule>();

        // Add all base modules
        for (const [name, module] of base) {
            merged.set(name, module);
        }

        // Override or add modules from override map
        for (const [name, overrideModule] of override) {
            const baseModule = merged.get(name);

            if (baseModule && !overrideModule.isInherited) {
                // If local module exists, it overrides inherited
                merged.set(name, overrideModule);
            } else if (baseModule) {
                // Merge children recursively
                const mergedChildren = this.mergeModules(
                    baseModule.children as Map<string, ScriptModule>,
                    overrideModule.children as Map<string, ScriptModule>
                );

                // Combine symbols (local overrides inherited with same name)
                const symbolMap = new Map<string, PythonSymbol>();

                // Add inherited symbols first
                for (const symbol of overrideModule.symbols) {
                    symbolMap.set(symbol.name, symbol);
                }

                // Override with local symbols
                for (const symbol of baseModule.symbols) {
                    symbolMap.set(symbol.name, symbol);
                }

                const mergedModule: ScriptModule = {
                    ...baseModule,
                    children: mergedChildren,
                    symbols: Array.from(symbolMap.values())
                };

                merged.set(name, mergedModule);
            } else {
                // New module from override
                merged.set(name, overrideModule);
            }
        }

        return merged;
    }

    /**
     * Flattens the module tree into a flat map
     */
    private flattenModules(
        modules: Map<string, ScriptModule>,
        flatMap: Map<string, ScriptModule>,
        symbolMap: Map<string, PythonSymbol>
    ): void {
        for (const module of modules.values()) {
            // Add module to flat map
            flatMap.set(module.qualifiedPath, module);

            // Add symbols to symbol map
            for (const symbol of module.symbols) {
                symbolMap.set(symbol.qualifiedName, symbol);
            }

            // Recursively flatten children
            if (module.children.size > 0) {
                this.flattenModules(module.children as Map<string, ScriptModule>, flatMap, symbolMap);
            }
        }
    }

    /**
     * Gets all modules for deep searching
     */
    async getAllModules(projectId: string): Promise<ScriptModule[]> {
        const index = await this.getProjectIndex(projectId);
        if (!index) {
            return [];
        }

        // Return all modules as an array
        return Array.from(index.flatModules.values());
    }

    /**
     * Gets all symbols (functions, classes, etc) with their containing modules for deep searching
     */
    async getAllSymbolsWithModules(projectId: string): Promise<Array<{ symbol: PythonSymbol; module: ScriptModule }>> {
        const index = await this.getProjectIndex(projectId);
        if (!index) {
            return [];
        }

        const symbolsWithModules: Array<{ symbol: PythonSymbol; module: ScriptModule }> = [];

        // Go through all modules and collect their symbols
        for (const module of index.flatModules.values()) {
            for (const symbol of module.symbols) {
                symbolsWithModules.push({ symbol, module });
            }
        }

        return symbolsWithModules;
    }

    /**
     * Ensures system modules are loaded for the current gateway version
     */
    private async ensureSystemModules(): Promise<void> {
        if (!this.ignitionStubsManagerService || !this.gatewayManagerService || !this.configService) {
            // Services not available for system modules
            return;
        }

        // Get active gateway and its version
        const activeGatewayId = this.gatewayManagerService.getActiveGatewayId();
        if (!activeGatewayId) {
            // No active gateway for system modules
            return;
        }

        const gateways = await this.configService.getGateways();
        const gateway = gateways[activeGatewayId];

        let version = gateway?.ignitionVersion;

        // If no version configured, prompt user to select one
        if (!version) {
            // Don't prompt again if user already declined for this gateway in this session
            if (this.declinedVersionPrompts.has(activeGatewayId)) {
                return;
            }

            version = await this.promptForIgnitionVersion(activeGatewayId);
            if (!version) {
                // User cancelled or dismissed the prompt - track to avoid repeated prompts
                this.declinedVersionPrompts.add(activeGatewayId);
                return;
            }
        }

        // Check if we already have this version loaded
        if (this.currentSystemVersion === version && this.systemModules.has(version)) {
            return;
        }

        try {
            // Ensure stubs are downloaded (with user prompt)
            const metadata = await this.ignitionStubsManagerService.ensureStubs(version, true);

            // User declined to download or download failed
            if (!metadata) {
                return;
            }

            // Parse the stub files if not already cached
            if (!this.systemModules.has(version)) {
                const parser = new IgnitionStubParser();
                const symbolsByModule = await parser.parseStubDirectory(metadata.stubPath, '');

                // Convert parsed symbols to ScriptModule format
                const systemModules: ScriptModule[] = [];

                for (const [moduleName, symbols] of symbolsByModule) {
                    // Create a module for each parsed file
                    const module: ScriptModule = {
                        name: moduleName.split('.').pop() || moduleName,
                        qualifiedPath: moduleName,
                        parentPath: moduleName.includes('.')
                            ? moduleName.substring(0, moduleName.lastIndexOf('.'))
                            : undefined,
                        children: new Map(),
                        symbols: symbols.map(s => ({
                            ...s,
                            modulePath: moduleName // Ensure module path is set
                        })),
                        filePath: undefined,
                        sourceProject: 'Ignition System',
                        isInherited: false
                    };

                    systemModules.push(module);
                }

                // Build module hierarchy
                const hierarchicalModules = this.buildSystemModuleHierarchy(systemModules);
                this.systemModules.set(version, hierarchicalModules);
            }

            this.currentSystemVersion = version;
            // System modules loaded successfully
        } catch (error) {
            console.error(`Failed to load system modules for version ${version}:`, error);
        }
    }

    /**
     * Prompts user to select an Ignition version for system stubs
     */
    private async promptForIgnitionVersion(gatewayId: string): Promise<string | undefined> {
        // Common Ignition versions
        const commonVersions = ['8.1.33', '8.1.35', '8.1.42', '8.1.43', '8.1.44', '8.3.0', '8.3.1', '8.3.2', '8.3.3'];

        // Build quick pick items
        const items: vscode.QuickPickItem[] = commonVersions.map(v => ({
            label: v,
            description: v.startsWith('8.3') ? 'Ignition 8.3.x' : 'Ignition 8.1.x'
        }));

        // Add custom version option
        items.push({
            label: '$(edit) Enter custom version...',
            description: 'Specify a different Ignition version'
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select Ignition version for system function IntelliSense',
            title: `No Ignition version configured for gateway "${gatewayId}"`
        });

        if (!selected) {
            return undefined;
        }

        let version: string;

        if (selected.label.startsWith('$(edit)')) {
            // Custom version input
            const customVersion = await vscode.window.showInputBox({
                prompt: 'Enter Ignition version (e.g., 8.1.33, 8.3.2)',
                placeHolder: '8.1.33',
                validateInput: value => {
                    if (!value) {
                        return 'Version is required';
                    }
                    if (!/^\d+\.\d+(\.\d+)?$/.test(value)) {
                        return 'Invalid version format. Use format like 8.1.33 or 8.3.2';
                    }
                    return undefined;
                }
            });

            if (!customVersion) {
                return undefined;
            }
            version = customVersion;
        } else {
            version = selected.label;
        }

        // Offer to save the version to config
        const saveChoice = await vscode.window.showInformationMessage(
            `Save Ignition version ${version} to gateway "${gatewayId}" configuration?`,
            'Save to Config',
            'Use Once'
        );

        if (saveChoice === 'Save to Config' && this.configService) {
            try {
                const gateways = await this.configService.getGateways();
                const gateway = gateways[gatewayId];
                if (gateway) {
                    await this.configService.setGateway(gatewayId, {
                        ...gateway,
                        ignitionVersion: version
                    });
                }
            } catch (error) {
                console.error('Failed to save ignitionVersion to config:', error);
            }
        }

        return version;
    }

    /**
     * Builds hierarchical structure for system modules
     */
    private buildSystemModuleHierarchy(flatModules: ScriptModule[]): ScriptModule[] {
        const rootModules: ScriptModule[] = [];
        const moduleMap = new Map<string, ScriptModule>();

        // First pass: create all modules and ensure they have mutable children maps
        for (const module of flatModules) {
            // Create a mutable version with writable children map
            const mutableModule: ScriptModule = {
                ...module,
                children: new Map<string, ScriptModule>() // Create new empty map
            };
            moduleMap.set(module.qualifiedPath, mutableModule);
        }

        // Second pass: build hierarchy
        for (const module of moduleMap.values()) {
            if (module.parentPath) {
                const parent = moduleMap.get(module.parentPath);
                if (parent) {
                    // Add this module as a child of its parent
                    // Cast to mutable map since we created it above
                    (parent.children as Map<string, ScriptModule>).set(module.name, module);
                } else {
                    // Parent doesn't exist, treat as root
                    rootModules.push(module);
                }
            } else {
                // No parent, it's a root module
                rootModules.push(module);
            }
        }

        return rootModules;
    }

    /**
     * Gets completion items for a given module path
     */
    async getCompletionItems(projectId: string, modulePath: string): Promise<vscode.CompletionItem[]> {
        // NOTE: Disabled auto-loading of system stubs - use Designer LSP for system completions
        // or explicitly call the "Download Ignition Stubs" command
        // await this.ensureSystemModules();

        const index = await this.getProjectIndex(projectId);
        if (!index) {
            return [];
        }

        const items: vscode.CompletionItem[] = [];

        if (!modulePath) {
            this.addRootLevelCompletions(index, items);
        } else if (modulePath.startsWith('system')) {
            this.addSystemModuleCompletions(modulePath, items);
        } else {
            this.addUserModuleCompletions(modulePath, index, items);
        }

        return items;
    }

    /**
     * Adds root level completion items (top-level modules + system)
     */
    private addRootLevelCompletions(index: ProjectModuleIndex, items: vscode.CompletionItem[]): void {
        for (const module of index.modules.values()) {
            const item = new vscode.CompletionItem(module.name, vscode.CompletionItemKind.Module);
            item.detail = module.isInherited ? `(inherited from ${module.sourceProject})` : module.sourceProject;
            item.documentation = new vscode.MarkdownString(`Script Module: ${module.qualifiedPath}`);
            items.push(item);
        }

        // Add system modules at root level
        if (this.currentSystemVersion && this.systemModules.has(this.currentSystemVersion)) {
            const systemModulesForVersion = this.systemModules.get(this.currentSystemVersion);
            const systemModule = systemModulesForVersion?.find(m => m.name === 'system');
            if (systemModule) {
                const item = new vscode.CompletionItem('system', vscode.CompletionItemKind.Module);
                item.detail = `Ignition ${this.currentSystemVersion} System Functions`;
                item.documentation = new vscode.MarkdownString('Built-in Ignition system functions');
                items.push(item);
            }
        }
    }

    /**
     * Adds system module completion items
     */
    private addSystemModuleCompletions(modulePath: string, items: vscode.CompletionItem[]): void {
        if (!this.currentSystemVersion || !this.systemModules.has(this.currentSystemVersion)) {
            return;
        }

        const systemModulesForVersion = this.systemModules.get(this.currentSystemVersion);
        if (!systemModulesForVersion) {
            return;
        }

        const systemModule = this.findSystemModule(systemModulesForVersion, modulePath);
        if (systemModule) {
            this.addChildModuleCompletions(systemModule.children, items, true);
            this.addSymbolCompletions(systemModule.symbols, items);
        }
    }

    /**
     * Adds user module completion items
     */
    private addUserModuleCompletions(
        modulePath: string,
        index: ProjectModuleIndex,
        items: vscode.CompletionItem[]
    ): void {
        const module = index.flatModules.get(modulePath);
        if (!module) {
            return;
        }

        this.addChildModuleCompletions(module.children, items, false);
        this.addSymbolCompletions(module.symbols, items, {
            isInherited: module.isInherited,
            sourceProject: module.sourceProject
        });
    }

    /**
     * Creates a completion item for a symbol
     */
    private createSymbolCompletionItem(
        symbol: PythonSymbol,
        inheritanceInfo?: { isInherited: boolean; sourceProject: string }
    ): vscode.CompletionItem {
        const kind = this.getCompletionItemKind(symbol.type);
        const item = new vscode.CompletionItem(symbol.name, kind);
        item.detail = symbol.signature || symbol.name;

        const docs: string[] = [];
        if (symbol.docstring) {
            docs.push(symbol.docstring);
        }
        if (symbol.returnType) {
            docs.push(`Returns: ${symbol.returnType}`);
        }
        if (inheritanceInfo?.isInherited) {
            docs.push(`\n*Inherited from ${inheritanceInfo.sourceProject}*`);
        }

        if (docs.length > 0) {
            item.documentation = new vscode.MarkdownString(docs.join('\n\n'));
        }

        if (symbol.type === 'function') {
            item.insertText = new vscode.SnippetString(this.buildFunctionSnippet(symbol));
        }

        return item;
    }

    /**
     * Adds child module completion items
     */
    private addChildModuleCompletions(
        children: ReadonlyMap<string, ScriptModule>,
        items: vscode.CompletionItem[],
        isSystemModule: boolean
    ): void {
        for (const child of children.values()) {
            const item = new vscode.CompletionItem(child.name, vscode.CompletionItemKind.Module);
            if (isSystemModule) {
                item.detail = 'System Module';
                item.documentation = new vscode.MarkdownString(`System Module: ${child.qualifiedPath}`);
            } else {
                item.detail = child.isInherited ? `(inherited from ${child.sourceProject})` : child.sourceProject;
                item.documentation = new vscode.MarkdownString(`Script Module: ${child.qualifiedPath}`);
            }
            items.push(item);
        }
    }

    /**
     * Adds symbol completion items from a module
     */
    private addSymbolCompletions(
        symbols: readonly PythonSymbol[],
        items: vscode.CompletionItem[],
        inheritanceInfo?: { isInherited: boolean; sourceProject: string }
    ): void {
        for (const symbol of symbols) {
            items.push(this.createSymbolCompletionItem(symbol, inheritanceInfo));
        }
    }

    /**
     * Finds a system module by path
     */
    private findSystemModule(modules: ScriptModule[], path: string): ScriptModule | undefined {
        // Try direct lookup first
        for (const module of modules) {
            if (module.qualifiedPath === path) {
                return module;
            }

            // Search in children recursively
            const found = this.findSystemModuleRecursive(module.children as Map<string, ScriptModule>, path);
            if (found) {
                return found;
            }
        }

        return undefined;
    }

    /**
     * Recursively searches for a system module
     */
    private findSystemModuleRecursive(children: Map<string, ScriptModule>, path: string): ScriptModule | undefined {
        for (const child of children.values()) {
            if (child.qualifiedPath === path) {
                return child;
            }

            const found = this.findSystemModuleRecursive(child.children as Map<string, ScriptModule>, path);
            if (found) {
                return found;
            }
        }

        return undefined;
    }

    /**
     * Gets the appropriate CompletionItemKind for a symbol type
     */
    private getCompletionItemKind(type: PythonSymbol['type']): vscode.CompletionItemKind {
        switch (type) {
            case 'function':
                return vscode.CompletionItemKind.Function;
            case 'class':
                return vscode.CompletionItemKind.Class;
            case 'variable':
                return vscode.CompletionItemKind.Variable;
            case 'constant':
                return vscode.CompletionItemKind.Constant;
            case 'module':
                return vscode.CompletionItemKind.Module;
            default:
                return vscode.CompletionItemKind.Text;
        }
    }

    /**
     * Builds a function snippet with placeholders for parameters
     */
    private buildFunctionSnippet(symbol: PythonSymbol): string {
        if (!symbol.parameters || symbol.parameters.length === 0) {
            return `${symbol.name}()`;
        }

        const params = symbol.parameters
            .filter(p => !p.optional && !p.name.startsWith('*'))
            .map((p, i) => `\${${i + 1}:${p.name}}`)
            .join(', ');

        return `${symbol.name}(${params})`;
    }

    /**
     * Invalidates the index for a project
     */
    invalidateIndex(projectId: string): void {
        this.projectIndexes.delete(projectId);
    }

    /**
     * Clears all indexes
     */
    clearAllIndexes(): void {
        this.projectIndexes.clear();
    }
}
