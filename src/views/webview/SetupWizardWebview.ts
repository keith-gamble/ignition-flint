/**
 * @module SetupWizardWebview
 * @description Webview-based setup wizard for initial Flint configuration
 * Provides a single-page form for configuring project paths and gateways
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { ServiceContainer } from '@/core/ServiceContainer';
import { GatewayConfig } from '@/core/types/configuration';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';

/**
 * Discovered project from scanning
 */
interface DiscoveredProject {
    readonly name: string;
    readonly path: string;
    readonly title?: string;
    readonly parent?: string;
}

/**
 * Result of scanning a single project path
 */
interface PathScanResult {
    readonly path: string;
    readonly projectCount: number;
    readonly isDirectProject: boolean;
    readonly suggestedParent?: string;
    readonly projectName?: string;
}

/**
 * Gateway input from the wizard form
 */
interface SetupWizardGatewayInput {
    readonly name: string;
    readonly url: string;
    readonly ignoreSSLErrors: boolean;
    readonly projects: readonly string[];
}

/**
 * Complete setup data from the wizard
 */
interface SetupWizardData {
    readonly projectPaths: readonly string[];
    readonly gateways: readonly SetupWizardGatewayInput[];
}

/**
 * Validation error structure
 */
interface ValidationError {
    readonly field: string;
    readonly message: string;
    readonly index?: number;
}

/**
 * Result from the setup wizard
 */
export interface SetupWizardResult {
    readonly completed: boolean;
    readonly cancelled: boolean;
    readonly gatewayCount: number;
    readonly projectPathsAdded: number;
}

/**
 * Messages from webview to extension
 */
type WebviewToExtensionMessage =
    | { command: 'ready' }
    | { command: 'submitConfiguration'; data: SetupWizardData }
    | { command: 'browseFolder' }
    | { command: 'scanProjects'; paths: readonly string[] }
    | { command: 'correctPath'; oldPath: string; newPath: string }
    | { command: 'validateGatewayName'; name: string; index: number }
    | { command: 'validateGatewayUrl'; url: string; index: number }
    | { command: 'cancel' };

/**
 * Webview-based setup wizard for initial Flint configuration
 */
export class SetupWizardWebview implements IServiceLifecycle {
    private static readonly viewType = 'flint.setupWizard';
    private panel: vscode.WebviewPanel | null = null;
    private isInitialized = false;
    private pendingResolve: ((result: SetupWizardResult) => void) | null = null;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {}

    async initialize(): Promise<void> {
        await Promise.resolve();
        this.isInitialized = true;
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async stop(): Promise<void> {
        await Promise.resolve();
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }

    async dispose(): Promise<void> {
        await this.stop();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Opens the setup wizard in a new webview panel
     * Returns a promise that resolves when the wizard is closed
     */
    async openWizard(): Promise<SetupWizardResult> {
        // If already open, bring to front
        if (this.panel) {
            this.panel.reveal();
            return {
                completed: false,
                cancelled: false,
                gatewayCount: 0,
                projectPathsAdded: 0
            };
        }

        // Create new webview panel
        this.panel = vscode.window.createWebviewPanel(
            SetupWizardWebview.viewType,
            'Flint Setup',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))]
            }
        );

        // Generate HTML content
        this.panel.webview.html = this.generateWebviewHtml(this.panel.webview);

        // Setup message handling
        this.panel.webview.onDidReceiveMessage(
            (message: WebviewToExtensionMessage) => this.handleWebviewMessage(message),
            undefined,
            this.context.subscriptions
        );

        // Handle panel disposal
        this.panel.onDidDispose(() => {
            this.panel = null;
            if (this.pendingResolve) {
                this.pendingResolve({
                    completed: false,
                    cancelled: true,
                    gatewayCount: 0,
                    projectPathsAdded: 0
                });
                this.pendingResolve = null;
            }
        });

        // Return promise that resolves when wizard completes
        return new Promise<SetupWizardResult>(resolve => {
            this.pendingResolve = resolve;
        });
    }

    /**
     * Handles messages from the webview
     */
    private async handleWebviewMessage(message: WebviewToExtensionMessage): Promise<void> {
        switch (message.command) {
            case 'ready':
                break;

            case 'submitConfiguration':
                await this.handleSubmitConfiguration(message.data);
                break;

            case 'browseFolder':
                await this.handleBrowseFolder();
                break;

            case 'scanProjects':
                await this.handleScanProjects(message.paths);
                break;

            case 'correctPath':
                await this.handleCorrectPath(message.oldPath, message.newPath);
                break;

            case 'validateGatewayName':
                await this.handleValidateGatewayName(message.name, message.index);
                break;

            case 'validateGatewayUrl':
                await this.handleValidateGatewayUrl(message.url, message.index);
                break;

            case 'cancel':
                this.handleCancel();
                break;

            default:
                console.warn('Unknown webview message:', message);
        }
    }

    /**
     * Handles the submit configuration action - creates the config file
     */
    private async handleSubmitConfiguration(data: SetupWizardData): Promise<void> {
        // Validate the configuration
        const errors = this.validateConfiguration(data);

        if (errors.length > 0) {
            await this.panel?.webview.postMessage({
                command: 'validationResult',
                errors
            });
            return;
        }

        try {
            const configService = this.serviceContainer.get<WorkspaceConfigService>('WorkspaceConfigService');

            // Create the default config first (this creates the file)
            await configService.createDefaultConfiguration();

            // Add project paths
            if (data.projectPaths.length > 0) {
                await configService.addProjectPaths([...data.projectPaths]);
            }

            // Add each gateway
            for (const gateway of data.gateways) {
                const gatewayConfig = this.createGatewayConfig(gateway);
                await configService.setGateway(gateway.name, gatewayConfig);
            }

            // Notify webview of success
            await this.panel?.webview.postMessage({
                command: 'configurationSaved',
                success: true
            });

            // Resolve the promise with success
            if (this.pendingResolve) {
                this.pendingResolve({
                    completed: true,
                    cancelled: false,
                    gatewayCount: data.gateways.length,
                    projectPathsAdded: data.projectPaths.length
                });
                this.pendingResolve = null;
            }

            // Close the panel
            this.panel?.dispose();
        } catch (error) {
            console.error('Failed to save configuration:', error);

            await this.panel?.webview.postMessage({
                command: 'configurationSaved',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Handles the browse folder action
     */
    private async handleBrowseFolder(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        const selectedFolders = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: false,
            canSelectFolders: true,
            defaultUri: workspaceFolder?.uri,
            title: 'Select Directories Containing Ignition Projects',
            openLabel: 'Add Path'
        });

        if (selectedFolders && selectedFolders.length > 0) {
            const paths = selectedFolders.map(uri => {
                // Convert to relative path if within workspace
                if (workspaceFolder) {
                    const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
                    // Only use relative path if it doesn't go outside the workspace
                    if (!relativePath.startsWith('..')) {
                        return relativePath;
                    }
                }
                return uri.fsPath;
            });

            await this.panel?.webview.postMessage({
                command: 'folderSelected',
                paths
            });
        }
    }

    /**
     * Handles correcting a path (replacing a direct project path with its parent)
     */
    private async handleCorrectPath(oldPath: string, newPath: string): Promise<void> {
        await this.panel?.webview.postMessage({
            command: 'pathCorrected',
            oldPath,
            newPath
        });
    }

    /**
     * Scans project paths for Ignition projects
     */
    private async handleScanProjects(projectPaths: readonly string[]): Promise<void> {
        const discoveredProjects: DiscoveredProject[] = [];
        const pathResults: PathScanResult[] = [];
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        for (const projectPath of projectPaths) {
            // Resolve relative paths
            let absolutePath = projectPath;
            if (workspaceFolder && !path.isAbsolute(projectPath)) {
                absolutePath = path.join(workspaceFolder.uri.fsPath, projectPath);
            }

            let projectCount = 0;
            let isDirectProject = false;
            let suggestedParent: string | undefined;
            let directProjectName: string | undefined;

            try {
                // First, check if this folder IS a project (contains project.json directly)
                const directProjectJsonPath = path.join(absolutePath, 'project.json');
                try {
                    await fs.access(directProjectJsonPath);
                    // This folder is a project itself!
                    isDirectProject = true;
                    directProjectName = path.basename(absolutePath);

                    // Suggest the parent folder
                    const parentPath = path.dirname(absolutePath);
                    if (workspaceFolder) {
                        const relativePath = path.relative(workspaceFolder.uri.fsPath, parentPath);
                        if (!relativePath.startsWith('..')) {
                            suggestedParent = relativePath || '.';
                        } else {
                            suggestedParent = parentPath;
                        }
                    } else {
                        suggestedParent = parentPath;
                    }
                } catch {
                    // Not a direct project, scan for subdirectories
                }

                if (!isDirectProject) {
                    // Scan subdirectories for projects
                    const entries = await fs.readdir(absolutePath, { withFileTypes: true });

                    for (const entry of entries) {
                        if (entry.isDirectory()) {
                            const projectDir = path.join(absolutePath, entry.name);
                            const projectJsonPath = path.join(projectDir, 'project.json');

                            try {
                                const projectJsonContent = await fs.readFile(projectJsonPath, 'utf-8');
                                const projectJson = JSON.parse(projectJsonContent) as {
                                    title?: string;
                                    parent?: string;
                                };

                                discoveredProjects.push({
                                    name: entry.name,
                                    path: projectDir,
                                    title: projectJson.title,
                                    parent: projectJson.parent
                                });
                                projectCount++;
                            } catch {
                                // Not a valid project directory, skip
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn(`Failed to scan path ${projectPath}:`, error);
            }

            pathResults.push({
                path: projectPath,
                projectCount,
                isDirectProject,
                suggestedParent,
                projectName: directProjectName
            });
        }

        await this.panel?.webview.postMessage({
            command: 'projectsDiscovered',
            projects: discoveredProjects,
            pathResults
        });
    }

    /**
     * Handles gateway name validation
     */
    private async handleValidateGatewayName(name: string, index: number): Promise<void> {
        const trimmedName = name.trim();

        if (!trimmedName) {
            await this.panel?.webview.postMessage({
                command: 'nameValidation',
                index,
                isValid: false,
                error: 'Gateway name is required'
            });
            return;
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
            await this.panel?.webview.postMessage({
                command: 'nameValidation',
                index,
                isValid: false,
                error: 'Only letters, numbers, underscores, and hyphens allowed'
            });
            return;
        }

        await this.panel?.webview.postMessage({
            command: 'nameValidation',
            index,
            isValid: true
        });
    }

    /**
     * Handles gateway URL validation
     */
    private async handleValidateGatewayUrl(url: string, index: number): Promise<void> {
        const trimmedUrl = url.trim();

        if (!trimmedUrl) {
            await this.panel?.webview.postMessage({
                command: 'urlValidation',
                index,
                isValid: false,
                error: 'Gateway URL is required'
            });
            return;
        }

        try {
            new URL(trimmedUrl);
            await this.panel?.webview.postMessage({
                command: 'urlValidation',
                index,
                isValid: true
            });
        } catch {
            await this.panel?.webview.postMessage({
                command: 'urlValidation',
                index,
                isValid: false,
                error: 'Please enter a valid URL (e.g., http://localhost:8088)'
            });
        }
    }

    /**
     * Handles the cancel action
     */
    private handleCancel(): void {
        if (this.pendingResolve) {
            this.pendingResolve({
                completed: false,
                cancelled: true,
                gatewayCount: 0,
                projectPathsAdded: 0
            });
            this.pendingResolve = null;
        }
        this.panel?.dispose();
    }

    /**
     * Validates the complete configuration
     */
    private validateConfiguration(data: SetupWizardData): ValidationError[] {
        const errors: ValidationError[] = [];

        // Validate at least one gateway
        if (data.gateways.length === 0) {
            errors.push({ field: 'gateways', message: 'At least one gateway is required' });
        }

        // Validate each gateway
        const gatewayNames = new Set<string>();
        for (let i = 0; i < data.gateways.length; i++) {
            const gateway = data.gateways[i];
            const gatewayName = gateway.name.trim();

            if (!gatewayName) {
                errors.push({ field: 'gatewayName', index: i, message: 'Gateway name is required' });
            } else if (!/^[a-zA-Z0-9_-]+$/.test(gatewayName)) {
                errors.push({
                    field: 'gatewayName',
                    index: i,
                    message: 'Only letters, numbers, underscores, and hyphens allowed'
                });
            } else if (gatewayNames.has(gatewayName)) {
                errors.push({ field: 'gatewayName', index: i, message: 'Gateway names must be unique' });
            } else {
                gatewayNames.add(gatewayName);
            }

            const gatewayUrl = gateway.url.trim();
            if (!gatewayUrl) {
                errors.push({ field: 'gatewayUrl', index: i, message: 'Gateway URL is required' });
            } else {
                try {
                    new URL(gatewayUrl);
                } catch {
                    errors.push({ field: 'gatewayUrl', index: i, message: 'Please enter a valid URL' });
                }
            }
        }

        return errors;
    }

    /**
     * Creates a gateway configuration from the form input
     */
    private createGatewayConfig(input: SetupWizardGatewayInput): Omit<GatewayConfig, 'id'> {
        const url = new URL(input.url.trim());

        const ssl = url.protocol === 'https:';
        const host = `${url.protocol}//${url.hostname}`;

        // Determine port
        let port: number;
        if (url.port) {
            port = parseInt(url.port, 10);
        } else if (ssl) {
            port = 443;
        } else {
            // Default Ignition port
            port = 8088;
        }

        return {
            host,
            port,
            ssl,
            ignoreSSLErrors: input.ignoreSSLErrors,
            projects: [...input.projects],
            enabled: true
        };
    }

    /**
     * Generates the HTML content for the webview
     */
    private generateWebviewHtml(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'setup-wizard.css'))
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'setup-wizard.js'))
        );

        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource};">
    <link href="${styleUri.toString()}" rel="stylesheet">
    <title>Flint Setup</title>
</head>
<body>
    <div class="wizard-container">
        <div class="wizard-header">
            <span class="wizard-icon">🔥</span>
            <h1>Configure Flint</h1>
        </div>

        <p class="intro-text">
            This wizard will create your <code>flint.config.json</code> file, which configures how the Flint extension
            interacts with your Ignition gateways and projects. You can always edit this file directly or
            return to this wizard later for changes.
        </p>

        <!-- Project Paths Section -->
        <div class="section">
            <h2 class="section-title">1. Project Paths</h2>
            <p class="section-description">
                Add the parent directories that contain your Ignition projects. Flint will scan these to discover available projects.
            </p>

            <button id="addFolderBtn" class="btn btn-secondary">
                Add Folder...
            </button>

            <ul id="pathList" class="path-list">
                <div class="empty-state">No project paths added yet.</div>
            </ul>

            <div id="discoveredProjectsSection" class="discovered-projects-section" style="display: none;">
                <h3 class="subsection-title">Discovered Projects</h3>
                <div id="discoveredProjectsList" class="discovered-projects-list"></div>
            </div>
        </div>

        <!-- Gateways Section -->
        <div class="section">
            <h2 class="section-title">2. Gateways</h2>
            <p class="section-description">
                Configure your Ignition gateway connections. For each gateway, select which projects it should manage.
            </p>

            <div id="gatewaysList" class="gateways-list">
                <!-- Gateway cards will be added here -->
            </div>

            <button id="addGatewayBtn" class="btn btn-secondary mt-4">
                + Add Gateway
            </button>
        </div>

        <div class="button-container">
            <button id="cancelBtn" class="btn btn-secondary">Cancel</button>
            <button id="submitBtn" class="btn btn-primary">Create Configuration</button>
        </div>
    </div>

    <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
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
