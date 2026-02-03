/**
 * @module RefreshProjectsCommand
 * @description Command to refresh project data and rescan resources
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { ProjectScannerService } from '@/services/config/ProjectScannerService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';

/**
 * Command to refresh project data and rescan resources
 * Can refresh all projects or specific projects
 */
export class RefreshProjectsCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.REFRESH_PROJECTS, context);
    }

    protected validateArguments(_projectId?: string): CommandValidationResult {
        return {
            isValid: true, // projectId is optional - will refresh all if not provided
            errors: [],
            warnings: []
        };
    }

    protected async executeImpl(projectId?: string): Promise<void> {
        try {
            const projectScanner = this.getService<ProjectScannerService>('ProjectScannerService');
            const gatewayManager = this.getService<GatewayManagerService>('GatewayManagerService');

            let projectsToRefresh: string[] = [];

            if (projectId !== undefined && projectId.length > 0) {
                // Refresh specific project
                projectsToRefresh = [projectId];
            } else {
                // Get all configured projects for refresh
                const selectedGateway = gatewayManager.getSelectedGateway();
                if (selectedGateway === null || selectedGateway.length === 0) {
                    // Refresh all projects from scanner
                    projectsToRefresh = await this.getAllConfiguredProjects();
                } else {
                    // Refresh projects for selected gateway
                    projectsToRefresh = await this.getGatewayProjects(selectedGateway);
                }
            }

            if (projectsToRefresh.length === 0) {
                await vscode.window
                    .showWarningMessage('No projects found to refresh', 'Configure Projects')
                    .then(choice => {
                        if (choice === 'Configure Projects') {
                            vscode.commands.executeCommand(COMMANDS.ADD_PROJECT_PATHS);
                        }
                    });
                return;
            }

            // Refresh projects with progress indication
            await this.executeWithProgress(
                async progress => {
                    progress?.(
                        0,
                        `Refreshing ${projectsToRefresh.length} project path${projectsToRefresh.length > 1 ? 's' : ''}...`
                    );

                    try {
                        // Ensure project paths are strings (defensive programming)
                        const validProjectPaths = projectsToRefresh
                            .filter(p => Boolean(p) && typeof p === 'string')
                            .map(p => String(p));

                        if (validProjectPaths.length === 0) {
                            throw new Error('No valid project paths found to refresh');
                        }

                        console.log(`Refreshing ${validProjectPaths.length} project paths:`, validProjectPaths);

                        // Use scanProjects to scan all project paths, which will discover individual projects
                        await projectScanner.scanProjects(validProjectPaths, false); // Don't use cache for refresh
                    } catch (error) {
                        console.warn('Failed to refresh projects:', error);
                        throw error; // Re-throw to show error to user
                    }

                    progress?.(100, 'Project refresh completed');
                },
                {
                    showProgress: true,
                    progressTitle:
                        projectId !== undefined && projectId.length > 0
                            ? `Refreshing ${projectId}...`
                            : 'Refreshing Projects...',
                    timeoutMs: 60000 // 1 minute timeout for project refresh
                }
            );

            // Refresh the tree view to show updated data
            try {
                const treeProvider = this.getService('ProjectTreeDataProvider');
                if (treeProvider !== null && treeProvider !== undefined) {
                    (treeProvider as { refresh: () => void }).refresh();
                }
            } catch (error) {
                console.warn('Failed to refresh tree view after project scan:', error);
                // Don't fail the whole operation if tree refresh fails
            }

            // Show completion message
            const message =
                projectId !== undefined && projectId.length > 0
                    ? `Refreshed project: ${projectId}`
                    : `Refreshed ${projectsToRefresh.length} project path${projectsToRefresh.length > 1 ? 's' : ''}`;

            vscode.window.showInformationMessage(message);
        } catch (error) {
            throw new FlintError(
                'Failed to refresh projects',
                'PROJECT_REFRESH_FAILED',
                'Unable to refresh project data',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Gets all configured projects from scanner
     */
    private async getAllConfiguredProjects(): Promise<string[]> {
        try {
            // Get project paths from configuration
            const configService = this.getService('WorkspaceConfigService');
            const projectScanner = this.getService('ProjectScannerService');

            if (Boolean(configService) && Boolean(projectScanner)) {
                const configServiceTyped = configService as { getProjectPaths: () => Promise<string[]> };
                const projectPaths = await configServiceTyped.getProjectPaths();

                // Get actual project directories by discovering projects in the configured paths
                const projectDirectories: string[] = [];
                const fs = await import('fs/promises');

                for (const basePath of projectPaths) {
                    const directories = await this.scanBasePath(String(basePath));
                    projectDirectories.push(...directories);
                }

                console.log(`Found ${projectDirectories.length} project directories:`, projectDirectories);

                // Debug logging to understand what's happening
                if (projectDirectories.length === 0) {
                    await this.logDebugInfo(projectPaths.map(String), fs);
                }

                return projectDirectories;
            }

            return [];
        } catch (error) {
            console.warn('Failed to get all configured projects:', error);
            return [];
        }
    }

    /**
     * Gets projects for a specific gateway
     */
    private async getGatewayProjects(gatewayId: string): Promise<string[]> {
        try {
            // For scanning purposes, we scan all discovered project directories
            // regardless of the selected gateway, since the scanner works on filesystem paths
            // The gateway config's "projects" field is about which projects are available on that gateway,
            // not which filesystem paths to scan
            console.log(`Getting project paths for gateway: ${gatewayId}`);
            return await this.getAllConfiguredProjects();
        } catch (error) {
            console.warn(`Failed to get gateway projects for ${gatewayId}:`, error);
            return [];
        }
    }

    /**
     * Scans a base path for project directories (helper method to reduce nesting)
     */
    private async scanBasePath(basePath: string): Promise<string[]> {
        const projectDirectories: string[] = [];

        try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const entries = await fs.readdir(basePath, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const projectPath = path.join(basePath, entry.name);
                    const projectJsonPath = path.join(projectPath, 'project.json');

                    try {
                        await fs.access(projectJsonPath);
                        // This is a valid Ignition project directory
                        projectDirectories.push(projectPath);
                    } catch {
                        // Not a project directory, skip
                    }
                }
            }
        } catch (error) {
            console.warn(`Failed to scan base path ${basePath}:`, error);
        }

        return projectDirectories;
    }

    /**
     * Logs debug info when no project directories are found (helper method to reduce nesting)
     */
    private async logDebugInfo(projectPaths: string[], fs: typeof import('fs/promises')): Promise<void> {
        console.warn('No project directories found. Debug info:');
        console.warn('- Base paths scanned:', projectPaths);

        for (const basePath of projectPaths) {
            try {
                const entries = await fs.readdir(basePath, { withFileTypes: true });
                const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
                console.warn(`- Directory ${basePath} contains directories:`, dirs);
            } catch (error) {
                console.warn(`- Failed to read directory ${basePath}:`, error);
            }
        }
    }
}
