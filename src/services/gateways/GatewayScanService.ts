/**
 * @module GatewayScanService
 * @description Service for triggering project scans on Ignition Gateways
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { GatewayConfig } from '@/core/types/configuration';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';
import { EnvironmentService, ResolvedEnvironmentConfig } from '@/services/environments/EnvironmentService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';
import { requestProjectScan } from '@/utils/gatewayHttpHelper';

/**
 * Service for managing gateway project scans
 */
export class GatewayScanService implements IServiceLifecycle {
    private isInitialized = false;
    private gatewayManagerService?: GatewayManagerService;
    private environmentService?: EnvironmentService;
    private configService?: WorkspaceConfigService;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    initialize(): Promise<void> {
        // Get services from container
        this.gatewayManagerService = this.serviceContainer.get<GatewayManagerService>('GatewayManagerService');
        this.environmentService = this.serviceContainer.get<EnvironmentService>('EnvironmentService');
        this.configService = this.serviceContainer.get<WorkspaceConfigService>('WorkspaceConfigService');

        if (!this.gatewayManagerService || !this.environmentService || !this.configService) {
            throw new FlintError(
                'Required services not available for GatewayScanService',
                'SERVICE_DEPENDENCY_MISSING'
            );
        }

        this.isInitialized = true;
        return Promise.resolve();
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            throw new FlintError('GatewayScanService must be initialized before starting', 'SERVICE_NOT_INITIALIZED');
        }
        return Promise.resolve();
    }

    stop(): Promise<void> {
        return Promise.resolve();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.isInitialized = false;
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Triggers a project scan on the active gateway
     * @param projectName Optional project name (defaults to active project)
     * @throws FlintError if services are not initialized or gateway/project not selected
     */
    async scanProject(projectName?: string): Promise<void> {
        this.validateServices();

        const { gatewayId, projectId } = this.getActiveContext(projectName);
        if (!gatewayId || !projectId) {
            return;
        }

        try {
            await this.executeScan(gatewayId, projectId);
        } catch (error) {
            this.handleScanError(error, projectId);
        }
    }

    /**
     * Validates that required services are initialized
     */
    private validateServices(): void {
        if (!this.gatewayManagerService || !this.environmentService || !this.configService) {
            throw new FlintError('GatewayScanService not properly initialized', 'SERVICE_NOT_INITIALIZED');
        }
    }

    /**
     * Gets active gateway and project context
     */
    private getActiveContext(projectName?: string): { gatewayId?: string; projectId?: string } {
        const gatewayId = this.gatewayManagerService!.getActiveGatewayId();
        if (!gatewayId) {
            void vscode.window.showErrorMessage('No gateway selected. Please select a gateway first.');
            return {};
        }

        const projectId = projectName ?? this.gatewayManagerService!.getActiveProjectId();
        if (!projectId) {
            void vscode.window.showErrorMessage('No project selected. Please select a project first.');
            return { gatewayId };
        }

        return { gatewayId, projectId };
    }

    /**
     * Executes the scan for a specific gateway and project
     */
    private async executeScan(gatewayId: string, projectId: string): Promise<void> {
        const gatewayConfig = await this.getGatewayConfig(gatewayId);
        if (!gatewayConfig) {
            return;
        }

        const environmentConfig = this.environmentService!.getActiveEnvironmentConfig(gatewayConfig);
        if (!this.shouldScan(gatewayId, gatewayConfig, environmentConfig)) {
            return;
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        console.log(`Triggering project scan for '${projectId}' on gateway '${gatewayId}'...`);

        await requestProjectScan(gatewayConfig, projectId, environmentConfig, workspaceRoot);

        void vscode.window.showInformationMessage(`Project scan triggered requested for '${gatewayId}'.`);
        console.log(`Project scan requested for '${gatewayId}'`);
    }

    /**
     * Gets gateway configuration
     */
    private async getGatewayConfig(gatewayId: string): Promise<GatewayConfig | undefined> {
        const gateways = await this.configService!.getGateways();
        const gatewayConfig = gateways[gatewayId];

        if (!gatewayConfig) {
            void vscode.window.showErrorMessage(`Gateway '${gatewayId}' not found in configuration.`);
            return undefined;
        }

        return gatewayConfig;
    }

    /**
     * Determines if scan should proceed based on version and module availability
     */
    private shouldScan(
        gatewayId: string,
        gatewayConfig: GatewayConfig,
        environmentConfig: ResolvedEnvironmentConfig
    ): boolean {
        const version = environmentConfig.ignitionVersion ?? gatewayConfig.ignitionVersion ?? '8.1.0';
        const is83Plus = this.compareVersion(version, '8.3.0') >= 0;
        const moduleEnabled = environmentConfig.modules?.['project-scan-endpoint']?.enabled ?? false;

        if (!is83Plus && !moduleEnabled) {
            console.log(
                `Gateway '${gatewayId}' (${version}) does not have project-scan-endpoint module enabled. Skipping scan.`
            );
            return false;
        }

        return true;
    }

    /**
     * Handles scan errors
     */
    private handleScanError(error: unknown, projectId: string): never {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to trigger project scan: ${errorMessage}`, error);

        void vscode.window.showErrorMessage(errorMessage);

        throw new FlintError(
            `Failed to trigger gateway project scan for '${projectId}'`,
            'GATEWAY_SCAN_FAILED',
            errorMessage,
            error instanceof Error ? error : undefined
        );
    }

    /**
     * Compares two version strings (e.g., '8.1.0' vs '8.3.0')
     * @returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2
     */
    private compareVersion(v1: string, v2: string): number {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const num1 = parts1[i] || 0;
            const num2 = parts2[i] || 0;

            if (num1 > num2) return 1;
            if (num1 < num2) return -1;
        }

        return 0;
    }
}
