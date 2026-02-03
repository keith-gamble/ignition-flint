/**
 * @module GatewayManagerService
 * @description Service for managing gateway and project selections
 * Simplified to handle selections without maintaining connections
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';

/**
 * Gateway manager service for handling selections and configurations
 * Simplified to not maintain actual connections
 */
export class GatewayManagerService implements IServiceLifecycle {
    private selectedGatewayId: string | null = null;
    private selectedProjectId: string | null = null;
    private isInitialized = false;

    // Event emitters for selection changes
    private readonly gatewaySelectedEmitter = new vscode.EventEmitter<string | null>();
    private readonly projectSelectedEmitter = new vscode.EventEmitter<string | null>();

    public readonly onGatewaySelected = this.gatewaySelectedEmitter.event;
    public readonly onProjectSelected = this.projectSelectedEmitter.event;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    async initialize(): Promise<void> {
        // Load workspace-specific persisted selections
        const context = this.serviceContainer.get<vscode.ExtensionContext>('extensionContext');
        if (context) {
            const workspaceKey = this.getWorkspaceKey();
            this.selectedGatewayId = context.workspaceState.get(`flint.selectedGateway.${workspaceKey}`, null);
            this.selectedProjectId = context.workspaceState.get(`flint.selectedProject.${workspaceKey}`, null);
        }

        // Auto-select if no selections exist
        await this.autoSelectDefaults();

        this.isInitialized = true;
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            throw new FlintError(
                'GatewayManagerService must be initialized before starting',
                'SERVICE_NOT_INITIALIZED'
            );
        }
        return Promise.resolve();
    }

    stop(): Promise<void> {
        return Promise.resolve();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.gatewaySelectedEmitter.dispose();
        this.projectSelectedEmitter.dispose();
        this.isInitialized = false;
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Gets the currently selected gateway ID
     */
    getSelectedGateway(): string | null {
        return this.selectedGatewayId;
    }

    /**
     * Gets the currently selected project ID
     */
    getSelectedProject(): string | null {
        return this.selectedProjectId;
    }

    /**
     * Gets active gateway ID (alias for getSelectedGateway)
     */
    getActiveGatewayId(): string | null {
        return this.selectedGatewayId;
    }

    /**
     * Gets active project ID (alias for getSelectedProject)
     */
    getActiveProjectId(): string | null {
        return this.selectedProjectId;
    }

    /**
     * Selects a gateway (updates selection state)
     */
    async selectGateway(gatewayId: string | null): Promise<void> {
        if (this.selectedGatewayId === gatewayId) {
            return; // No change
        }

        this.selectedGatewayId = gatewayId;

        // Clear project selection when gateway changes
        if (this.selectedProjectId) {
            this.selectedProjectId = null;
            this.projectSelectedEmitter.fire(null);
        }

        // Persist selection
        await this.persistSelections();

        // Emit event
        this.gatewaySelectedEmitter.fire(gatewayId);
    }

    /**
     * Selects a project within the current gateway
     */
    async selectProject(projectId: string | null): Promise<void> {
        if (this.selectedProjectId === projectId) {
            return; // No change
        }

        this.selectedProjectId = projectId;

        // Persist selection
        await this.persistSelections();

        // Emit event
        this.projectSelectedEmitter.fire(projectId);
    }

    /**
     * Gets available projects for the currently selected gateway
     */
    async getAvailableProjects(): Promise<string[]> {
        if (!this.selectedGatewayId) {
            return [];
        }

        // Get projects from gateway configuration
        const configService = this.serviceContainer.get<WorkspaceConfigService>('WorkspaceConfigService');
        if (configService) {
            const gateways = await configService.getGateways();
            const gateway = gateways[this.selectedGatewayId];
            return gateway?.projects ? [...gateway.projects] : [];
        }

        return [];
    }

    /**
     * Persists current selections to workspace-specific extension state
     */
    private async persistSelections(): Promise<void> {
        const context = this.serviceContainer.get<vscode.ExtensionContext>('extensionContext');
        if (context) {
            const workspaceKey = this.getWorkspaceKey();
            await context.workspaceState.update(`flint.selectedGateway.${workspaceKey}`, this.selectedGatewayId);
            await context.workspaceState.update(`flint.selectedProject.${workspaceKey}`, this.selectedProjectId);
        }
    }

    /**
     * Auto-selects first available gateway and project if none are selected
     */
    private async autoSelectDefaults(): Promise<void> {
        const configService = this.serviceContainer.get<any>('WorkspaceConfigService');
        if (!configService) return;

        try {
            // Check if config exists before trying to load it
            if (!(await configService.configurationExists())) {
                return; // No config yet, nothing to auto-select
            }

            const gateways = await configService.getGateways();
            const gatewayIds = Object.keys(gateways);

            // Auto-select first gateway if none selected
            if (!this.selectedGatewayId && gatewayIds.length > 0) {
                this.selectedGatewayId = gatewayIds[0];

                // Fire event but don't persist yet (will persist after project selection)
                this.gatewaySelectedEmitter.fire(this.selectedGatewayId);
            }

            // Auto-select first project if gateway is selected but no project
            if (this.selectedGatewayId && !this.selectedProjectId) {
                const gateway = gateways[this.selectedGatewayId];
                const projects = gateway?.projects ?? [];

                if (projects.length > 0) {
                    this.selectedProjectId = projects[0];

                    // Fire event
                    this.projectSelectedEmitter.fire(this.selectedProjectId);
                }
            }

            // Persist the auto-selections
            if (this.selectedGatewayId || this.selectedProjectId) {
                await this.persistSelections();
            }
        } catch (error) {
            console.warn('Failed to auto-select defaults:', error);
        }
    }

    /**
     * Gets workspace-specific key for storing selections
     */
    private getWorkspaceKey(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            // Use workspace folder name as key
            return workspaceFolder.name;
        }
        // Fallback to 'default' if no workspace
        return 'default';
    }
}
