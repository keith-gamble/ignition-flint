/**
 * @module ResourceEditorWebview
 * @description Webview-based resource preview and editor for complex resources
 */

import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ProjectResource, ResourceFile } from '@/core/types/models';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';

/**
 * Resource editor configuration
 */
interface ResourceEditorConfig {
    readonly enablePreview: boolean;
    readonly enableEditing: boolean;
    readonly autoSave: boolean;
    readonly showLineNumbers: boolean;
    readonly theme: 'light' | 'dark' | 'auto';
    readonly fontSize: number;
}

/**
 * Resource editor state
 */
interface _ResourceEditorState {
    readonly resource: ProjectResource;
    readonly projectId: string;
    readonly activeFile?: ResourceFile;
    readonly isModified: boolean;
    readonly isReadOnly: boolean;
}

/**
 * Webview message types
 */
type WebviewMessage =
    | { command: 'contentChanged'; content: string; filePath: string }
    | { command: 'save'; content: string; filePath: string }
    | { command: 'requestContent'; filePath: string }
    | { command: 'switchFile'; filePath: string }
    | { command: 'ready' }
    | { command: 'error'; message: string };

/**
 * Resource editor result
 */
interface ResourceEditorResult {
    readonly saved: boolean;
    readonly cancelled: boolean;
    readonly modifiedFiles: readonly { filePath: string; content: string }[];
}

/**
 * Webview-based resource editor for complex Ignition resources
 */
export class ResourceEditorWebview implements IServiceLifecycle {
    private static readonly viewType = 'flint.resourceEditor';
    private readonly activeEditors = new Map<string, vscode.WebviewPanel>();

    private config: ResourceEditorConfig = {
        enablePreview: true,
        enableEditing: true,
        autoSave: false,
        showLineNumbers: true,
        theme: 'auto',
        fontSize: 14
    };

    private isInitialized = false;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {}

    async initialize(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        try {
            this.loadConfiguration();
            this.registerWebviewProvider();
            this.setupEventHandlers();
            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize resource editor webview',
                'RESOURCE_EDITOR_INIT_FAILED',
                'Resource editor webview could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async stop(): Promise<void> {
        await Promise.resolve(); // Satisfy async/await requirement
        // Close all active editors
        for (const [, panel] of this.activeEditors) {
            panel.dispose();
        }
        this.activeEditors.clear();
    }

    async dispose(): Promise<void> {
        await this.stop();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Opens a resource in the webview editor
     */
    async openResource(
        resource: ProjectResource,
        projectId: string,
        options: { readonly?: boolean; focusFile?: string } = {}
    ): Promise<ResourceEditorResult | undefined> {
        try {
            const editorId = `${projectId}:${resource.path}`;

            // Check if already open
            let panel = this.activeEditors.get(editorId);

            if (panel) {
                // Bring existing panel to front
                panel.reveal();
                return undefined;
            }

            // Create new webview panel
            panel = vscode.window.createWebviewPanel(
                ResourceEditorWebview.viewType,
                this.getEditorTitle(resource),
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.file(this.context.extensionPath),
                        vscode.Uri.file(path.dirname(resource.files[0]?.path || ''))
                    ]
                }
            );

            // Track the panel
            this.activeEditors.set(editorId, panel);

            // Setup webview content
            await this.setupWebviewContent(panel, resource, projectId, options);

            // Handle panel disposal
            panel.onDidDispose(() => {
                this.activeEditors.delete(editorId);
            });

            return await new Promise<ResourceEditorResult>(resolve => {
                // TODO: Implement proper result handling
                panel?.onDidDispose(() => {
                    resolve({
                        saved: false,
                        cancelled: true,
                        modifiedFiles: []
                    });
                });
            });
        } catch (error) {
            throw new FlintError(
                'Failed to open resource editor',
                'RESOURCE_EDITOR_OPEN_FAILED',
                `Could not open resource editor for ${resource.path}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Opens a Perspective view for editing
     */
    async openPerspectiveView(resource: ProjectResource, projectId: string): Promise<ResourceEditorResult | undefined> {
        return this.openResource(resource, projectId, {
            focusFile: 'view.json'
        });
    }

    /**
     * Opens a resource with its primary file focused
     */
    async openResourceWithPrimaryFile(
        resource: ProjectResource,
        projectId: string
    ): Promise<ResourceEditorResult | undefined> {
        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
        let focusFile: string | undefined;

        if (providerRegistry) {
            const provider = providerRegistry.getProvider(resource.type);
            if (provider) {
                const editorConfig = provider.getEditorConfig();
                if (editorConfig?.primaryFile) {
                    // Look for the primary file specified by the provider
                    focusFile = resource.files.find(f => f.name === editorConfig.primaryFile)?.name;
                }
            }
        }

        // Fallback to first file if no primary file found
        if (!focusFile && resource.files.length > 0) {
            focusFile = resource.files[0].name;
        }

        return this.openResource(resource, projectId, {
            focusFile
        });
    }

    /**
     * Opens resource.json for editing
     */
    async openResourceJson(resource: ProjectResource, projectId: string): Promise<ResourceEditorResult | undefined> {
        return this.openResource(resource, projectId, {
            focusFile: 'resource.json'
        });
    }

    /**
     * Shows resource preview (read-only)
     */
    async previewResource(resource: ProjectResource, projectId: string): Promise<void> {
        await this.openResource(resource, projectId, { readonly: true });
    }

    /**
     * Updates editor configuration
     */
    updateConfiguration(newConfig: Partial<ResourceEditorConfig>): void {
        this.config = { ...this.config, ...newConfig };

        // Update all active editors
        for (const panel of this.activeEditors.values()) {
            this.sendConfigurationToWebview(panel).catch(error => {
                console.error('Failed to send configuration to webview:', error);
            });
        }
    }

    /**
     * Gets current configuration
     */
    getConfiguration(): Readonly<ResourceEditorConfig> {
        return Object.freeze({ ...this.config });
    }

    /**
     * Gets active editor count
     */
    getActiveEditorCount(): number {
        return this.activeEditors.size;
    }

    /**
     * Registers the webview provider
     */
    private registerWebviewProvider(): void {
        // Register custom editor provider if needed
        this.context.subscriptions.push(
            vscode.window.registerWebviewPanelSerializer(ResourceEditorWebview.viewType, {
                async deserializeWebviewPanel(webviewPanel, _state) {
                    await Promise.resolve(); // Satisfy async/await requirement
                    // TODO: Implement serialization/deserialization
                    webviewPanel.dispose();
                }
            })
        );
    }

    /**
     * Sets up webview content
     */
    private async setupWebviewContent(
        panel: vscode.WebviewPanel,
        resource: ProjectResource,
        projectId: string,
        options: { readonly?: boolean; focusFile?: string }
    ): Promise<void> {
        // Generate HTML content
        const html = this.generateWebviewHtml(panel.webview, resource, projectId, options);
        panel.webview.html = html;

        // Setup message handling
        panel.webview.onDidReceiveMessage(
            (message: WebviewMessage) => this.handleWebviewMessage(panel, message, resource, projectId),
            undefined,
            this.context.subscriptions
        );

        // Send initial configuration
        this.sendConfigurationToWebview(panel).catch(error => {
            console.error('Failed to send initial configuration to webview:', error);
        });

        // Load resource content
        await this.loadResourceContent(panel, resource, options.focusFile);
    }

    /**
     * Generates HTML content for the webview
     */
    private generateWebviewHtml(
        webview: vscode.Webview,
        resource: ProjectResource,
        projectId: string,
        options: { readonly?: boolean; focusFile?: string }
    ): string {
        // Get resource URIs
        const styleUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'editor.css'))
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'editor.js'))
        );

        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource};">
    <link href="${styleUri.toString()}" rel="stylesheet">
    <title>${resource.path} - Flint Editor</title>
</head>
<body>
    <div class="editor-container">
        <div class="editor-header">
            <div class="file-tabs" id="fileTabs">
                ${resource.files
                    .map(
                        file => `
                    <div class="file-tab" data-file="${file.name}">
                        <span class="file-icon">${this.getFileIcon(file.name)}</span>
                        <span class="file-name">${file.name}</span>
                    </div>
                `
                    )
                    .join('')}
            </div>
            <div class="editor-actions">
                ${!options.readonly ? '<button id="saveBtn" class="action-btn">Save</button>' : ''}
                <button id="formatBtn" class="action-btn">Format</button>
            </div>
        </div>
        <div class="editor-content">
            <div id="editor" class="monaco-editor"></div>
        </div>
        <div class="editor-status">
            <span id="statusText">Ready</span>
            <span id="cursorPosition"></span>
        </div>
    </div>
    
    <script nonce="${nonce}">
        // Initialize editor configuration
        window.editorConfig = {
            readonly: ${options.readonly ?? false},
            theme: '${this.config.theme}',
            fontSize: ${this.config.fontSize},
            showLineNumbers: ${this.config.showLineNumbers},
            resourceType: '${resource.type}',
            resourcePath: '${resource.path}',
            projectId: '${projectId}'
        };
    </script>
    <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
    }

    /**
     * Handles messages from webview
     */
    private async handleWebviewMessage(
        panel: vscode.WebviewPanel,
        message: WebviewMessage,
        resource: ProjectResource,
        projectId: string
    ): Promise<void> {
        switch (message.command) {
            case 'ready':
                // Webview is ready, send initial content
                break;

            case 'contentChanged':
                // Content was modified
                this.markEditorModified(panel, true);
                break;

            case 'save':
                await this.saveFileContent(message.filePath, message.content, resource, projectId);
                this.markEditorModified(panel, false);
                break;

            case 'requestContent':
                await this.sendFileContent(panel, message.filePath, resource);
                break;

            case 'switchFile':
                await this.sendFileContent(panel, message.filePath, resource);
                break;

            case 'error':
                vscode.window.showErrorMessage(`Editor Error: ${message.message}`);
                break;

            default:
                console.warn('Unknown webview message command:', message);
                break;
        }
    }

    /**
     * Loads resource content into webview
     */
    private async loadResourceContent(
        panel: vscode.WebviewPanel,
        resource: ProjectResource,
        focusFile?: string
    ): Promise<void> {
        try {
            // Load the focused file first, or the first file
            const targetFile = focusFile ? resource.files.find(f => f.name === focusFile) : resource.files[0];

            if (targetFile) {
                await this.sendFileContent(panel, targetFile.name, resource);
            }
        } catch (error) {
            console.error('Failed to load resource content:', error);
        }
    }

    /**
     * Sends file content to webview
     */
    private async sendFileContent(
        panel: vscode.WebviewPanel,
        fileName: string,
        resource: ProjectResource
    ): Promise<void> {
        try {
            const file = resource.files.find(f => f.name === fileName);
            if (!file) {
                throw new Error(`File ${fileName} not found`);
            }

            // TODO: Read actual file content from filesystem
            let content = '// File content would be loaded here\n';
            content += `// File: ${file.path}\n`;
            content += `// Resource: ${resource.path}\n`;

            // Generate content based on file type
            if (file.name === 'view.json') {
                content = JSON.stringify(
                    {
                        meta: {
                            name: resource.path.split('/').pop()
                        },
                        custom: {},
                        params: {},
                        propConfig: {},
                        props: {},
                        root: {
                            type: 'ia.container.coord'
                        }
                    },
                    null,
                    2
                );
            } else if (file.name === 'resource.json') {
                content = JSON.stringify(
                    {
                        scope: 'G',
                        version: 1,
                        restricted: false,
                        overridable: true,
                        files: ['view.json'],
                        attributes: {}
                    },
                    null,
                    2
                );
            }

            await panel.webview.postMessage({
                command: 'setFileContent',
                fileName,
                content,
                language: this.getLanguageForFile(fileName)
            });
        } catch (error) {
            await panel.webview.postMessage({
                command: 'error',
                message: `Failed to load ${fileName}: ${String(error)}`
            });
        }
    }

    /**
     * Saves file content
     */
    private saveFileContent(
        filePath: string,
        content: string,
        _resource: ProjectResource,
        _projectId: string
    ): Promise<void> {
        try {
            // TODO: Implement actual file saving
            console.log(`Saving file: ${filePath}`);
            console.log(`Content length: ${content.length}`);

            // Show save confirmation
            vscode.window.showInformationMessage(`Saved ${path.basename(filePath)}`);
            return Promise.resolve();
        } catch (error) {
            const message = `Failed to save ${path.basename(filePath)}: ${String(error)}`;
            vscode.window.showErrorMessage(message);
            throw new FlintError(
                'File save failed',
                'FILE_SAVE_FAILED',
                message,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Sends configuration to webview
     */
    private async sendConfigurationToWebview(panel: vscode.WebviewPanel): Promise<void> {
        await panel.webview.postMessage({
            command: 'updateConfig',
            config: this.config
        });
    }

    /**
     * Marks editor as modified
     */
    private markEditorModified(panel: vscode.WebviewPanel, modified: boolean): void {
        // Update panel title to indicate modification
        if (modified && !panel.title.endsWith(' •')) {
            panel.title += ' •';
        } else if (!modified && panel.title.endsWith(' •')) {
            panel.title = panel.title.slice(0, -2);
        }
    }

    /**
     * Gets appropriate title for editor
     */
    private getEditorTitle(resource: ProjectResource): string {
        const pathParts = resource.path.split('/');
        const resourceName = pathParts[pathParts.length - 1];
        return `${resourceName} - ${this.getResourceTypeName(resource.type)}`;
    }

    /**
     * Gets resource type display name
     */
    private getResourceTypeName(resourceType: string): string {
        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

        const provider = providerRegistry?.getProvider(resourceType);
        if (provider) {
            return provider.displayName;
        }

        console.warn(`ResourceEditorWebview: No provider found for resource type ${resourceType}, using raw type name`);
        return resourceType;
    }

    /**
     * Gets file icon for display
     */
    private getFileIcon(fileName: string): string {
        // Use generic file icon patterns instead of hardcoded extensions
        // Use common file type patterns for the webview display
        if (fileName.includes('json')) return '{}';
        if (fileName.includes('code') || fileName.includes('script')) return 'λ';
        if (fileName.includes('xml') || fileName.includes('config')) return '<>';
        return '📄';
    }

    /**
     * Gets Monaco Editor language for file
     */
    private getLanguageForFile(fileName: string): string {
        if (fileName.endsWith('.json')) return 'json';
        if (fileName.endsWith('.py')) return 'python';
        if (fileName.endsWith('.xml')) return 'xml';
        if (fileName.endsWith('.sql')) return 'sql';
        if (fileName.endsWith('.js')) return 'javascript';
        return 'text';
    }

    /**
     * Sets up event handlers
     */
    private setupEventHandlers(): void {
        // Configuration change listener
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('flint.ui.editor')) {
                try {
                    this.loadConfiguration();
                } catch (error) {
                    console.warn('Failed to reload editor configuration:', error);
                }
            }
        });
    }

    /**
     * Loads configuration from VS Code settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.ui.editor');

        this.config = {
            enablePreview: config.get<boolean>('enablePreview') ?? true,
            enableEditing: config.get<boolean>('enableEditing') ?? true,
            autoSave: config.get<boolean>('autoSave') ?? false,
            showLineNumbers: config.get<boolean>('showLineNumbers') ?? true,
            theme: config.get<'light' | 'dark' | 'auto'>('theme') ?? 'auto',
            fontSize: config.get<number>('fontSize') ?? 14
        };
    }

    /**
     * Generates a random nonce for CSP
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
