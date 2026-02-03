/**
 * @module ResourceEditorManagerService
 * @description Service for managing resource editors and editor integrations
 * Handles opening resources in appropriate editors and managing editor lifecycle
 */

import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ResourceEditor, ResourceFileInfo } from '@/core/types/resources';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';

/**
 * Editor registration entry
 */
interface EditorRegistration {
    readonly typeId: string;
    readonly editor: ResourceEditor;
    readonly priority: number;
    readonly canHandlePattern?: RegExp;
}

/**
 * Service for managing resource editors and opening resources
 */
export class ResourceEditorManagerService implements IServiceLifecycle {
    private editorRegistry = new Map<string, EditorRegistration[]>();
    private defaultEditors = new Map<string, ResourceEditor>();
    private isInitialized = false;

    private readonly editorOpenedEmitter = new vscode.EventEmitter<{ resourcePath: string; editorType: string }>();
    public readonly onEditorOpened = this.editorOpenedEmitter.event;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    async initialize(): Promise<void> {
        await this.registerBuiltInEditors();
        this.isInitialized = true;
        // console.log('ResourceEditorManagerService initialized');
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            throw new FlintError(
                'ResourceEditorManagerService must be initialized before starting',
                'SERVICE_NOT_INITIALIZED'
            );
        }
        // console.log('ResourceEditorManagerService started');
        return Promise.resolve();
    }

    stop(): Promise<void> {
        console.log('ResourceEditorManagerService stopped');
        return Promise.resolve();
    }

    dispose(): Promise<void> {
        this.editorRegistry.clear();
        this.defaultEditors.clear();
        this.editorOpenedEmitter.dispose();
        this.isInitialized = false;
        console.log('ResourceEditorManagerService disposed');
        return Promise.resolve();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Registers a resource editor for a specific resource type
     */
    registerEditor(typeId: string, editor: ResourceEditor, priority = 0, canHandlePattern?: RegExp): void {
        if (!this.editorRegistry.has(typeId)) {
            this.editorRegistry.set(typeId, []);
        }

        const editors = this.editorRegistry.get(typeId)!;
        editors.push({
            typeId,
            editor,
            priority,
            canHandlePattern
        });

        // Sort editors by priority (higher priority first)
        editors.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Unregisters an editor for a resource type
     */
    unregisterEditor(typeId: string, editor: ResourceEditor): boolean {
        const editors = this.editorRegistry.get(typeId);
        if (!editors) {
            return false;
        }

        const index = editors.findIndex(reg => reg.editor === editor);
        if (index === -1) {
            return false;
        }

        editors.splice(index, 1);

        if (editors.length === 0) {
            this.editorRegistry.delete(typeId);
        }

        return true;
    }

    /**
     * Opens a resource using the appropriate editor
     */
    async openResource(
        resourcePath: string,
        files: ResourceFileInfo[],
        typeId?: string,
        editorHint?: string
    ): Promise<void> {
        try {
            // Try to find the best editor for this resource
            const editor = await this.findBestEditor(resourcePath, files, typeId, editorHint);

            if (!editor) {
                // Fall back to default VS Code editor
                await this.openWithDefaultEditor(resourcePath, files);
                return;
            }

            // Open with the selected editor
            await editor.open(resourcePath, files);

            this.editorOpenedEmitter.fire({
                resourcePath,
                editorType: editor.constructor.name
            });

            console.log(`Opened resource ${resourcePath} with editor: ${editor.constructor.name}`);
        } catch (error) {
            console.error(`Failed to open resource ${resourcePath}:`, error);
            throw new FlintError(
                `Failed to open resource: ${resourcePath}`,
                'RESOURCE_EDITOR_FAILED',
                `Could not open resource "${resourcePath}"`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Gets available editors for a resource
     */
    getAvailableEditors(resourcePath: string, files: ResourceFileInfo[], typeId?: string): Promise<ResourceEditor[]> {
        const editors: ResourceEditor[] = [];

        // Get editors registered for the specific type
        if (typeId) {
            const typeEditors = this.editorRegistry.get(typeId);
            if (typeEditors) {
                for (const registration of typeEditors) {
                    if (registration.editor.canHandle(resourcePath, files)) {
                        editors.push(registration.editor);
                    }
                }
            }
        }

        // Check all registered editors if type is unknown
        if (!typeId || editors.length === 0) {
            for (const [, registrations] of this.editorRegistry) {
                for (const registration of registrations) {
                    if (registration.editor.canHandle(resourcePath, files) && !editors.includes(registration.editor)) {
                        editors.push(registration.editor);
                    }
                }
            }
        }

        return Promise.resolve(editors);
    }

    /**
     * Checks if a resource can be opened
     */
    async canOpenResource(resourcePath: string, files: ResourceFileInfo[], typeId?: string): Promise<boolean> {
        const editors = await this.getAvailableEditors(resourcePath, files, typeId);
        return editors.length > 0;
    }

    /**
     * Gets editor statistics
     */
    getEditorStats(): {
        readonly registeredTypes: number;
        readonly totalEditors: number;
        readonly editorsByType: Readonly<Record<string, number>>;
    } {
        let totalEditors = 0;
        const editorsByType: Record<string, number> = {};

        for (const [typeId, editors] of this.editorRegistry) {
            editorsByType[typeId] = editors.length;
            totalEditors += editors.length;
        }

        return Object.freeze({
            registeredTypes: this.editorRegistry.size,
            totalEditors,
            editorsByType: Object.freeze(editorsByType)
        });
    }

    /**
     * Finds the best editor for a resource
     */
    private async findBestEditor(
        resourcePath: string,
        files: ResourceFileInfo[],
        typeId?: string,
        editorHint?: string
    ): Promise<ResourceEditor | null> {
        // If editor hint is provided, try to find that specific editor
        if (editorHint) {
            const hintedEditor = await this.findEditorByHint(editorHint, resourcePath, files, typeId);
            if (hintedEditor) {
                return hintedEditor;
            }
        }

        // Get available editors and return the highest priority one
        const editors = await this.getAvailableEditors(resourcePath, files, typeId);
        return editors.length > 0 ? editors[0] : null;
    }

    /**
     * Finds editor by hint (editor name or pattern)
     */
    private findEditorByHint(
        hint: string,
        resourcePath: string,
        files: ResourceFileInfo[],
        _typeId?: string
    ): Promise<ResourceEditor | null> {
        // Check if hint matches an editor class name
        for (const [, registrations] of this.editorRegistry) {
            for (const registration of registrations) {
                if (
                    registration.editor.constructor.name === hint &&
                    registration.editor.canHandle(resourcePath, files)
                ) {
                    return Promise.resolve(registration.editor);
                }
            }
        }

        return Promise.resolve(null);
    }

    /**
     * Opens resource with VS Code's default editor
     */
    private async openWithDefaultEditor(resourcePath: string, files: ResourceFileInfo[]): Promise<void> {
        if (files.length === 0) {
            throw new FlintError(
                'No files found in resource',
                'NO_FILES_IN_RESOURCE',
                `Resource "${resourcePath}" contains no files to open`
            );
        }

        // Try to find the primary file using provider registry
        let primaryFile = files[0]; // Default to first file

        try {
            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
            if (providerRegistry) {
                // Try to determine resource type from path and find appropriate primary file
                const segments = resourcePath.split('/');
                const resourceTypeSegment = segments.find(segment => segment.includes(':'));

                if (resourceTypeSegment) {
                    const [resourceTypeId] = resourceTypeSegment.split(':');
                    const provider = providerRegistry.getProvider(resourceTypeId);

                    if (provider) {
                        const templateConfig = provider.getTemplateConfig();
                        const template = templateConfig.templates[0]; // Use first template

                        if (template?.files) {
                            // Find the first non-resource.json file as primary file
                            const templateFiles = Object.keys(template.files);
                            const primaryFileName =
                                templateFiles.find(fileName => fileName !== 'resource.json') ?? templateFiles[0];

                            if (primaryFileName) {
                                const providerPrimaryFile = files.find(f => f.name === primaryFileName);
                                if (providerPrimaryFile) {
                                    primaryFile = providerPrimaryFile;
                                    console.log(`Using provider-specified primary file: ${primaryFileName}`);
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to determine primary file from provider registry:', error);
        }

        const uri = vscode.Uri.file(primaryFile.path);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        console.log(`Opened resource ${resourcePath} with default editor (file: ${primaryFile.name})`);
    }

    /**
     * Registers built-in editors for common resource types using ResourceTypeProviderRegistry
     */
    private async registerBuiltInEditors(): Promise<void> {
        try {
            const providerRegistry =
                this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            if (!providerRegistry) {
                throw new FlintError(
                    'ResourceTypeProviderRegistry is not available',
                    'RESOURCE_PROVIDER_REGISTRY_UNAVAILABLE',
                    'Cannot initialize resource editors without provider registry'
                );
            }

            // Get all providers and register their editors automatically
            const allProviders = providerRegistry.getAllProviders();
            let _totalEditorsRegistered = 0;

            for (const provider of allProviders) {
                try {
                    const editorConfig = provider.getEditorConfig();

                    // Create appropriate editor based on config
                    const editor = this.createEditorFromConfig(editorConfig);
                    if (editor) {
                        this.registerEditor(provider.resourceTypeId, editor, editorConfig.priority ?? 100);
                        _totalEditorsRegistered++;
                        // Resource editor registered
                    }
                } catch (error) {
                    console.warn(`Failed to register editor for ${provider.resourceTypeId}:`, error);
                }
            }

            // Also register generic editors for general file types
            await this.registerGenericEditors();
        } catch (error) {
            console.error('Error registering editors from providers:', error);
            // Cannot continue without provider registry
            throw new FlintError(
                'Failed to initialize resource editors from provider registry',
                'RESOURCE_EDITOR_INITIALIZATION_FAILED',
                'Resource editing functionality is unavailable',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Creates an editor instance from editor configuration
     */
    private createEditorFromConfig(
        config: import('@/core/types/resourceProviders').ResourceEditorConfig
    ): ResourceEditor | null {
        switch (config.editorType) {
            case 'json':
                return new JsonResourceEditor();
            case 'text':
                return new TextResourceEditor();
            case 'binary':
                return new BinaryResourceEditor();
            case 'custom':
                // For custom editors, we would need to implement a factory or plugin system
                // For now, fall back to text editor for custom types
                return new TextResourceEditor();
            default:
                console.warn(`Unknown editor type: ${String(config.editorType)}, falling back to JSON editor`);
                return new JsonResourceEditor();
        }
    }

    /**
     * Registers generic editors for general file types
     */
    private registerGenericEditors(): Promise<void> {
        // These are general-purpose editors that can handle any file type
        // They have lower priority than resource-type-specific editors
        this.registerEditor('*', new JsonResourceEditor(), 10);
        this.registerEditor('*', new TextResourceEditor(), 5);
        return Promise.resolve();
    }
}

/**
 * JSON resource editor for JSON-based resources
 */
class JsonResourceEditor implements ResourceEditor {
    canHandle(resourcePath: string, files: ResourceFileInfo[]): boolean {
        return files.some(file => file.name.endsWith('.json'));
    }

    async open(resourcePath: string, files: ResourceFileInfo[]): Promise<void> {
        const jsonFile = files.find(file => file.name.endsWith('.json'));
        if (!jsonFile) {
            throw new FlintError(
                'No JSON file found in resource',
                'NO_JSON_FILE',
                'This resource does not contain a JSON file'
            );
        }

        const uri = vscode.Uri.file(jsonFile.path);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
    }

    getEditorTitle(resourcePath: string): string {
        return path.basename(resourcePath);
    }
}

/**
 * Text resource editor for text-based resources
 */
class TextResourceEditor implements ResourceEditor {
    canHandle(resourcePath: string, files: ResourceFileInfo[]): boolean {
        // Accept any files and let VS Code decide if it can handle them
        return files.length > 0;
    }

    async open(resourcePath: string, files: ResourceFileInfo[]): Promise<void> {
        if (files.length === 0) {
            throw new FlintError(
                'No files found in resource',
                'NO_FILES_IN_RESOURCE',
                'This resource does not contain any files'
            );
        }

        // Use the first available file and let VS Code handle it
        const fileToOpen = files[0];

        const uri = vscode.Uri.file(fileToOpen.path);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
    }

    getEditorTitle(resourcePath: string): string {
        return path.basename(resourcePath);
    }
}

/**
 * Binary resource editor for binary files
 */
class BinaryResourceEditor implements ResourceEditor {
    canHandle(resourcePath: string, files: ResourceFileInfo[]): boolean {
        // Accept any files and let the system decide if it can handle them
        return files.length > 0;
    }

    async open(resourcePath: string, files: ResourceFileInfo[]): Promise<void> {
        if (files.length === 0) {
            throw new FlintError(
                'No files found in resource',
                'NO_FILES_IN_RESOURCE',
                'This resource does not contain any files'
            );
        }

        // Use the first available file and let the system handle it
        const fileToOpen = files[0];

        // For binary files, try to open with system default application
        const uri = vscode.Uri.file(fileToOpen.path);
        await vscode.env.openExternal(uri);
    }

    getEditorTitle(resourcePath: string): string {
        return path.basename(resourcePath);
    }
}
