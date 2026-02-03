/**
 * @module CreateAllMissingCommand
 * @description Command to create all missing resource.json files in a project
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { ProjectScannerService } from '@/services/config/ProjectScannerService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';
import { ResourceValidationService } from '@/services/resources/ResourceValidationService';

/**
 * Missing resource information
 */
interface MissingResourceInfo {
    readonly projectId: string;
    readonly typeId: string;
    readonly resourcePath: string;
    readonly categoryId?: string;
    readonly displayName: string;
}

/**
 * Command to create all missing resource.json files in a project
 * Scans project and creates resource.json for resources that don't have them
 */
export class CreateAllMissingCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.CREATE_ALL_MISSING_RESOURCE_JSON, context);
    }

    protected validateArguments(_projectId?: string): CommandValidationResult {
        return {
            isValid: true, // projectId is optional - will use selected project if not provided
            errors: [],
            warnings: []
        };
    }

    protected async executeImpl(projectId?: string): Promise<void> {
        try {
            const _resourceValidator = this.getService<ResourceValidationService>('ResourceValidationService');
            const projectScanner = this.getService<ProjectScannerService>('ProjectScannerService');
            const gatewayManager = this.getService<GatewayManagerService>('GatewayManagerService');

            // Determine which project to process
            let targetProjectId = projectId;
            if (targetProjectId === undefined || targetProjectId.length === 0) {
                targetProjectId = gatewayManager.getSelectedProject() ?? undefined;
                if (targetProjectId === undefined || targetProjectId.length === 0) {
                    await vscode.window
                        .showWarningMessage('No project selected for resource.json creation', 'Select Project')
                        .then(choice => {
                            if (choice === 'Select Project') {
                                vscode.commands.executeCommand(COMMANDS.SELECT_PROJECT);
                            }
                        });
                    return;
                }
            }

            // Scan for missing resource.json files with progress
            const missingResources = await this.executeWithProgress(
                async progress => {
                    progress?.(25, 'Scanning project...');

                    // Refresh project scan first
                    await projectScanner.scanProject(targetProjectId);

                    progress?.(50, 'Analyzing missing resource.json files...');

                    // Find all resources missing resource.json
                    const missing = await this.findMissingResourceJsonFiles(targetProjectId);

                    progress?.(100, 'Scan completed');

                    return missing;
                },
                {
                    showProgress: true,
                    progressTitle: `Scanning ${targetProjectId}...`
                }
            );

            if (missingResources.length === 0) {
                await vscode.window.showInformationMessage(
                    `✅ All resources in '${targetProjectId}' have resource.json files`
                );
                return;
            }

            // Show confirmation dialog with details
            const confirmed = await this.confirmBulkCreation(targetProjectId, missingResources);
            if (!confirmed) return;

            // Create all missing resource.json files
            const results = await this.executeWithProgress(
                async progress => {
                    const totalResources = missingResources.length;
                    const successfulCreations: string[] = [];
                    const failedCreations: Array<{ resource: MissingResourceInfo; error: string }> = [];

                    for (let i = 0; i < missingResources.length; i++) {
                        const resource = missingResources[i];
                        const progressPercent = Math.floor((i / totalResources) * 100);

                        progress?.(progressPercent, `Creating resource.json for ${resource.displayName}...`);

                        try {
                            await this.createResourceJsonForResource(resource);
                            successfulCreations.push(resource.displayName);
                        } catch (error) {
                            console.warn(`Failed to create resource.json for ${resource.displayName}:`, error);
                            failedCreations.push({
                                resource,
                                error: error instanceof Error ? error.message : String(error)
                            });
                        }
                    }

                    progress?.(100, 'Bulk creation completed');

                    return { successfulCreations, failedCreations };
                },
                {
                    showProgress: true,
                    progressTitle: 'Creating resource.json files...',
                    timeoutMs: 120000 // 2 minute timeout for bulk operations
                }
            );

            // Show completion results
            await this.displayBulkCreationResults(
                targetProjectId,
                results.successfulCreations,
                results.failedCreations
            );
        } catch (error) {
            throw new FlintError(
                'Failed to create missing resource.json files',
                'BULK_RESOURCE_JSON_CREATION_FAILED',
                'Unable to create all missing resource.json files',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Finds all resources missing resource.json files
     */
    private async findMissingResourceJsonFiles(projectId: string): Promise<MissingResourceInfo[]> {
        const configService = this.getService<{
            getProjectPaths: () => Promise<string[]>;
        }>('WorkspaceConfigService');
        const resourceTypeService = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
        const missingResources: MissingResourceInfo[] = [];

        try {
            // Get project paths and find the correct project directory
            const projectPaths = await configService.getProjectPaths();
            let projectBasePath: string | undefined;

            for (const basePath of projectPaths) {
                const candidatePath = path.join(basePath, projectId);
                try {
                    await fs.access(candidatePath);
                    projectBasePath = candidatePath;
                    break;
                } catch {
                    // Try next path
                }
            }

            if (projectBasePath === undefined) {
                throw new FlintError(`Project directory not found for '${projectId}'`, 'PROJECT_DIR_NOT_FOUND');
            }

            // Get all resource providers
            const resourceProviders = resourceTypeService.getAllProviders();

            // Scan each resource type for missing resource.json files
            for (const resourceProvider of resourceProviders) {
                await this.scanResourceTypeForMissing(projectBasePath, projectId, resourceProvider, missingResources);
            }

            return missingResources;
        } catch (error) {
            if (error instanceof FlintError) {
                throw error;
            }
            throw new FlintError(
                'Failed to scan for missing resource.json files',
                'RESOURCE_SCAN_FAILED',
                'Unable to analyze project for missing resource.json files',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Shows confirmation dialog for bulk creation
     */
    private async confirmBulkCreation(projectId: string, missingResources: MissingResourceInfo[]): Promise<boolean> {
        const resourceList = missingResources
            .slice(0, 10) // Show first 10 resources
            .map(r => `  • ${r.displayName} (${r.typeId})`)
            .join('\n');

        const moreText = missingResources.length > 10 ? `\n  ... and ${missingResources.length - 10} more` : '';

        const choice = await vscode.window.showWarningMessage(
            `Create resource.json for ${missingResources.length} resources?`,
            {
                detail:
                    `Project: ${projectId}\n\nMissing resource.json files:\n` +
                    `${resourceList}${moreText}\n\n` +
                    "This will create resource.json files for all resources that don't have them.",
                modal: true
            },
            'Create All',
            'Show Details'
        );

        if (choice === 'Show Details') {
            // Show detailed list in a new document
            const details = [
                `Missing resource.json files in project: ${projectId}`,
                `Total count: ${missingResources.length}`,
                '',
                'Resources:',
                ...missingResources.map(
                    r =>
                        `  • ${r.displayName} (${r.typeId}${r.categoryId !== undefined ? `:${r.categoryId}` : ''}) - ${r.resourcePath}`
                )
            ].join('\n');

            const document = await vscode.workspace.openTextDocument({
                content: details,
                language: 'plaintext'
            });

            await vscode.window.showTextDocument(document);

            // Ask again after showing details
            const confirmed = await vscode.window.showWarningMessage(
                `Create resource.json for ${missingResources.length} resources?`,
                { modal: true },
                'Create All'
            );

            return confirmed === 'Create All';
        }

        return choice === 'Create All';
    }

    /**
     * Creates resource.json for a single resource
     */
    private async createResourceJsonForResource(resource: MissingResourceInfo): Promise<void> {
        // Delegate to the single resource creation command
        await vscode.commands.executeCommand(
            COMMANDS.CREATE_RESOURCE_JSON,
            resource.projectId,
            resource.typeId,
            resource.resourcePath,
            resource.categoryId
        );
    }

    /**
     * Displays results of bulk creation operation
     */
    private async displayBulkCreationResults(
        projectId: string,
        successful: string[],
        failed: Array<{ resource: MissingResourceInfo; error: string }>
    ): Promise<void> {
        const totalAttempted = successful.length + failed.length;

        if (failed.length === 0) {
            // All successful
            await vscode.window.showInformationMessage(
                `✅ Created resource.json for all ${successful.length} resources in '${projectId}'`
            );
        } else if (successful.length === 0) {
            // All failed
            await vscode.window
                .showErrorMessage(
                    `❌ Failed to create resource.json for all ${failed.length} resources in '${projectId}'`,
                    'Show Details'
                )
                .then(choice => {
                    if (choice === 'Show Details') {
                        void this.showFailureDetails(failed);
                    }
                });
        } else {
            // Mixed results
            const choice = await vscode.window.showWarningMessage(
                `⚠️ Created resource.json for ${successful.length}/${totalAttempted} resources in '${projectId}'`,
                { detail: `${failed.length} resource(s) failed to create` },
                'Show Details',
                'Retry Failed'
            );

            switch (choice) {
                case 'Show Details':
                    await this.showFailureDetails(failed);
                    break;
                case 'Retry Failed': {
                    // Retry failed resources by re-running the command with just the failed resources
                    const failedResourceInfos = failed.map(f => f.resource);
                    await this.retryFailedCreations(failedResourceInfos);
                    break;
                }
                default:
                    // User cancelled or selected unknown option
                    break;
            }
        }
    }

    /**
     * Shows detailed failure information
     */
    private async showFailureDetails(failed: Array<{ resource: MissingResourceInfo; error: string }>): Promise<void> {
        const details = [
            'Failed resource.json creations:',
            '',
            ...failed.map(f => `• ${f.resource.displayName}: ${f.error}`)
        ].join('\n');

        const document = await vscode.workspace.openTextDocument({
            content: details,
            language: 'plaintext'
        });

        await vscode.window.showTextDocument(document);
    }

    /**
     * Scans a specific resource type for missing resource.json files
     */
    private async scanResourceTypeForMissing(
        projectBasePath: string,
        projectId: string,
        resourceProvider: {
            getSearchConfig: () => {
                directoryPaths?: readonly string[];
            };
            resourceTypeId: string;
            displayName: string;
        },
        missingResources: MissingResourceInfo[]
    ): Promise<void> {
        try {
            // Get expected paths for this resource type from provider
            const searchConfig = resourceProvider.getSearchConfig();
            const resourceTypePaths = searchConfig.directoryPaths ?? [];

            for (const resourceTypePath of resourceTypePaths) {
                const fullPath = path.join(projectBasePath, resourceTypePath);

                try {
                    const stat = await fs.stat(fullPath);
                    if (stat.isDirectory()) {
                        // Scan resources in this directory
                        await this.scanResourceTypeDirectory(
                            fullPath,
                            projectBasePath,
                            projectId,
                            resourceProvider,
                            missingResources
                        );
                    }
                } catch {
                    // Resource type directory doesn't exist, which is okay
                    console.log(`Resource type directory '${resourceTypePath}' not found`);
                }
            }
        } catch (error) {
            console.warn(`Failed to scan resource type '${resourceProvider.resourceTypeId}':`, error);
        }
    }

    /**
     * Helper method to scan a single resource type directory
     */
    private async scanResourceTypeDirectory(
        fullPath: string,
        projectBasePath: string,
        projectId: string,
        resourceProvider: {
            resourceTypeId: string;
            displayName: string;
        },
        missingResources: MissingResourceInfo[]
    ): Promise<void> {
        const resourceDirs = await fs.readdir(fullPath);
        for (const resourceDir of resourceDirs) {
            const resourcePath = path.join(fullPath, resourceDir);
            const resourceStat = await fs.stat(resourcePath);

            if (resourceStat.isDirectory()) {
                await this.checkResourceJsonExists(resourcePath, resourceDir, {
                    projectBasePath,
                    projectId,
                    resourceProvider,
                    missingResources
                });
            }
        }
    }

    /**
     * Helper method to check if resource.json exists for a resource
     */
    private async checkResourceJsonExists(
        resourcePath: string,
        resourceDir: string,
        context: {
            projectBasePath: string;
            projectId: string;
            resourceProvider: {
                resourceTypeId: string;
                displayName: string;
            };
            missingResources: MissingResourceInfo[];
        }
    ): Promise<void> {
        const resourceJsonPath = path.join(resourcePath, 'resource.json');
        try {
            await fs.access(resourceJsonPath);
        } catch {
            // resource.json is missing
            const relativeResourcePath = path.relative(context.projectBasePath, resourcePath);
            context.missingResources.push({
                projectId: context.projectId,
                typeId: context.resourceProvider.resourceTypeId,
                resourcePath: relativeResourcePath,
                categoryId: context.resourceProvider.resourceTypeId,
                displayName: `${resourceDir} (${context.resourceProvider.displayName})`
            });
        }
    }

    /**
     * Retries creation for failed resources
     */
    private async retryFailedCreations(failedResources: MissingResourceInfo[]): Promise<void> {
        const results = await this.executeWithProgress(
            async progress => {
                const totalResources = failedResources.length;
                const successfulCreations: string[] = [];
                const failedCreations: Array<{ resource: MissingResourceInfo; error: string }> = [];

                for (let i = 0; i < failedResources.length; i++) {
                    const resource = failedResources[i];
                    const progressPercent = Math.floor((i / totalResources) * 100);

                    progress?.(progressPercent, `Retrying ${resource.displayName}...`);

                    try {
                        await this.createResourceJsonForResource(resource);
                        successfulCreations.push(resource.displayName);
                    } catch (error) {
                        console.warn(`Retry failed for ${resource.displayName}:`, error);
                        failedCreations.push({
                            resource,
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }

                progress?.(100, 'Retry completed');

                return { successfulCreations, failedCreations };
            },
            {
                showProgress: true,
                progressTitle: 'Retrying failed resource.json creations...'
            }
        );

        // Show retry results
        if (results.failedCreations.length === 0) {
            await vscode.window.showInformationMessage(
                `✅ Successfully created resource.json for all ${results.successfulCreations.length} retried resources`
            );
        } else {
            await vscode.window
                .showWarningMessage(
                    `⚠️ Retry completed: ${results.successfulCreations.length} succeeded, ${results.failedCreations.length} still failed`,
                    'Show Details'
                )
                .then(choice => {
                    if (choice === 'Show Details') {
                        void this.showFailureDetails(results.failedCreations);
                    }
                });
        }
    }
}
