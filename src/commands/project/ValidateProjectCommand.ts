/**
 * @module ValidateProjectCommand
 * @description Command to validate project structure and resources
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { Command, CommandContext, CommandValidationResult } from '@/commands/base';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { ProjectScannerService } from '@/services/config/ProjectScannerService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';
import { ResourceValidationService } from '@/services/resources/ResourceValidationService';

/**
 * Validation result for project validation
 */
interface ProjectValidationResult {
    readonly projectId: string;
    readonly isValid: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly resourceCount: number;
    readonly missingResourceJson: number;
    readonly invalidResources: number;
}

/**
 * Command to validate project structure, resources, and metadata
 */
export class ValidateProjectCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.VALIDATE_PROJECT, context);
    }

    protected validateArguments(_projectId?: string): CommandValidationResult {
        return {
            isValid: true, // projectId is optional - will validate current project if not provided
            errors: [],
            warnings: []
        };
    }

    protected async executeImpl(projectId?: string): Promise<void> {
        try {
            const projectScanner = this.getService<ProjectScannerService>('ProjectScannerService');
            const resourceValidator = this.getService<ResourceValidationService>('ResourceValidationService');
            const gatewayManager = this.getService<GatewayManagerService>('GatewayManagerService');

            // Determine which project to validate
            let targetProjectId = projectId;
            if (targetProjectId === undefined || targetProjectId.length === 0) {
                targetProjectId = gatewayManager.getSelectedProject() ?? undefined;
                if (targetProjectId === undefined || targetProjectId.length === 0) {
                    await vscode.window
                        .showWarningMessage('No project selected for validation', 'Select Project')
                        .then(choice => {
                            if (choice === 'Select Project') {
                                vscode.commands.executeCommand(COMMANDS.SELECT_PROJECT);
                            }
                        });
                    return;
                }
            }

            // Validate project with progress indication
            const validationResult = await this.executeWithProgress(
                async progress => {
                    progress?.(0, 'Starting project validation...');

                    // Phase 1: Basic project structure validation
                    progress?.(20, 'Validating project structure...');
                    const structureErrors = await this.validateProjectStructure(targetProjectId);

                    // Phase 2: Resource scanning and validation
                    progress?.(40, 'Scanning project resources...');
                    await projectScanner.scanProject(targetProjectId);

                    // Phase 3: Resource validation
                    progress?.(60, 'Validating resources...');
                    const resourceErrors = await this.validateProjectResources(targetProjectId, resourceValidator);

                    // Phase 4: Resource JSON validation
                    progress?.(80, 'Validating resource.json files...');
                    const jsonErrors = await this.validateResourceJsonFiles(targetProjectId);

                    progress?.(100, 'Validation completed');

                    // Compile validation result
                    const allErrors = [...structureErrors, ...resourceErrors, ...jsonErrors.errors];
                    const allWarnings = [...jsonErrors.warnings];

                    return {
                        projectId: targetProjectId,
                        isValid: allErrors.length === 0,
                        errors: allErrors,
                        warnings: allWarnings,
                        resourceCount: resourceErrors.length, // Simplified for now
                        missingResourceJson: jsonErrors.missingCount,
                        invalidResources: resourceErrors.length
                    } as ProjectValidationResult;
                },
                {
                    showProgress: true,
                    progressTitle: `Validating ${targetProjectId}...`,
                    timeoutMs: 30000 // 30 second timeout for validation
                }
            );

            // Display validation results
            await this.displayValidationResults(validationResult);
        } catch (error) {
            throw new FlintError(
                'Failed to validate project',
                'PROJECT_VALIDATION_FAILED',
                'Unable to validate project structure and resources',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Validates basic project structure
     */
    private async validateProjectStructure(projectId: string): Promise<string[]> {
        const errors: string[] = [];

        const configService = this.getService<{
            getProjectPaths: () => Promise<string[]>;
        }>('WorkspaceConfigService');

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
                errors.push(`Project directory not found for '${projectId}'`);
                return errors;
            }

            // Check if project.json exists and is valid
            const projectJsonPath = path.join(projectBasePath, 'project.json');
            try {
                const projectJsonContent = await fs.readFile(projectJsonPath, 'utf8');
                const projectMetadata = JSON.parse(projectJsonContent) as {
                    title?: unknown;
                    enabled?: unknown;
                };

                // Basic validation of project.json structure
                if (projectMetadata.title === undefined || projectMetadata.title === null) {
                    errors.push('project.json is missing required "title" field');
                }
                if (projectMetadata.enabled !== undefined && typeof projectMetadata.enabled !== 'boolean') {
                    errors.push('project.json "enabled" field must be a boolean');
                }
            } catch (error) {
                errors.push(`Invalid or missing project.json: ${String(error)}`);
            }

            // Check resource directories using ResourceTypeProviderRegistry
            try {
                const providerRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');
                const discoveredDirectories: string[] = [];

                // Handle case where provider registry might not be available
                if (providerRegistry && typeof providerRegistry === 'object') {
                    // Get directories directly from providers
                    const allProviders = providerRegistry.getAllProviders();

                    allProviders.forEach(provider => {
                        const searchConfig = provider.getSearchConfig();

                        // Add directory paths directly from provider configuration
                        const directoryPaths = searchConfig.directoryPaths;
                        if (directoryPaths && Array.isArray(directoryPaths) && directoryPaths.length > 0) {
                            discoveredDirectories.push(...searchConfig.directoryPaths);
                        }
                    });

                    // Remove duplicates
                    const uniqueDirectories = [...new Set(discoveredDirectories)];

                    await this.validateDirectories(uniqueDirectories, projectBasePath, errors);
                } else {
                    // No fallback - ResourceTypeProviderRegistry is required for project validation
                    console.warn(
                        '⚠️ ResourceTypeProviderRegistry not available, skipping resource directory validation'
                    );
                    errors.push('ResourceTypeProviderRegistry is unavailable - cannot validate resource directories');
                }
            } catch (error) {
                console.warn('Failed to get directories from provider registry, skipping directory validation:', error);
            }
        } catch (error) {
            errors.push(`Project structure validation failed: ${String(error)}`);
        }

        return errors;
    }

    /**
     * Helper method to validate a single resource directory
     */
    private async validateResourceDirectory(projectBasePath: string, dir: string, errors: string[]): Promise<void> {
        const dirPath = path.join(projectBasePath, dir);
        try {
            const stat = await fs.stat(dirPath);
            if (!stat.isDirectory()) {
                errors.push(`Expected directory '${dir}' is not a directory`);
            }
        } catch {
            // Directory doesn't exist, which is okay - just note it
            console.log(`Optional directory '${dir}' not found in project`);
        }
    }

    /**
     * Validates project resources
     */
    private async validateProjectResources(
        projectId: string,
        _validator: ResourceValidationService
    ): Promise<string[]> {
        const errors: string[] = [];

        const configService = this.getService<{
            getProjectPaths: () => Promise<string[]>;
        }>('WorkspaceConfigService');
        const resourceTypeService = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

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
                errors.push(`Project directory not found for validation: ${projectId}`);
                return errors;
            }

            // Get all resource providers for validation
            const resourceProviders = resourceTypeService.getAllProviders();

            // Validate each resource type's structure
            for (const resourceProvider of resourceProviders) {
                await this.validateResourceType(projectBasePath, resourceProvider, errors);
            }
        } catch (error) {
            errors.push(`Resource validation failed: ${String(error)}`);
        }

        return errors;
    }

    /**
     * Validates resource.json files
     */
    private async validateResourceJsonFiles(
        projectId: string
    ): Promise<{ errors: string[]; warnings: string[]; missingCount: number }> {
        const errors: string[] = [];
        const warnings: string[] = [];
        let missingCount = 0;

        const configService = this.getService<{
            getProjectPaths: () => Promise<string[]>;
        }>('WorkspaceConfigService');

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
                errors.push(`Project directory not found for resource.json validation: ${projectId}`);
                return { errors, warnings, missingCount };
            }

            // Recursively find all resource directories and check for resource.json files
            const missingCountRef = { value: missingCount };
            await this.validateResourceJsonInDirectory(projectBasePath, '', errors, warnings, missingCountRef);
            missingCount = missingCountRef.value;
        } catch (error) {
            errors.push(`Resource JSON validation failed: ${String(error)}`);
        }

        return { errors, warnings, missingCount };
    }

    /**
     * Displays validation results to user
     */
    private async displayValidationResults(result: ProjectValidationResult): Promise<void> {
        const { projectId, isValid, errors, warnings, resourceCount, missingResourceJson, invalidResources } = result;

        if (isValid && warnings.length === 0) {
            // Perfect validation
            await vscode.window.showInformationMessage(`✅ Project '${projectId}' validation passed`, {
                detail: `${resourceCount} resources validated successfully`
            });
        } else if (isValid && warnings.length > 0) {
            // Valid but with warnings
            const choice = await vscode.window.showWarningMessage(
                `⚠️ Project '${projectId}' validation passed with warnings`,
                { detail: `${warnings.length} warning(s), ${resourceCount} resources checked` },
                'Show Details'
            );

            if (choice === 'Show Details') {
                await this.showValidationDetails(result);
            }
        } else {
            // Validation failed
            const choice = await vscode.window.showErrorMessage(
                `❌ Project '${projectId}' validation failed`,
                {
                    detail:
                        `${errors.length} error(s), ${warnings.length} warning(s)\n` +
                        `${invalidResources} invalid resources, ${missingResourceJson} missing resource.json files`,
                    modal: true
                },
                'Show Details',
                'Fix Issues'
            );

            switch (choice) {
                case 'Show Details':
                    await this.showValidationDetails(result);
                    break;
                case 'Fix Issues':
                    await this.offerFixSuggestions(result);
                    break;
                default:
                    // User cancelled or selected unknown option
                    break;
            }
        }
    }

    /**
     * Shows detailed validation results
     */
    private async showValidationDetails(result: ProjectValidationResult): Promise<void> {
        const details = [
            `Project: ${result.projectId}`,
            `Status: ${result.isValid ? '✅ Valid' : '❌ Invalid'}`,
            '',
            `Errors (${result.errors.length}):`,
            ...result.errors.map(e => `  • ${e}`),
            '',
            `Warnings (${result.warnings.length}):`,
            ...result.warnings.map(w => `  • ${w}`)
        ].join('\n');

        // Create and show document with details
        const document = await vscode.workspace.openTextDocument({
            content: details,
            language: 'plaintext'
        });

        await vscode.window.showTextDocument(document);
    }

    /**
     * Offers suggestions for fixing validation issues
     */
    private async offerFixSuggestions(result: ProjectValidationResult): Promise<void> {
        const actions: string[] = [];

        if (result.missingResourceJson > 0) {
            actions.push('Create Missing resource.json');
        }

        if (result.invalidResources > 0) {
            actions.push('Show Invalid Resources');
        }

        if (actions.length === 0) {
            await vscode.window.showInformationMessage('No automated fixes available for these issues');
            return;
        }

        const choice = await vscode.window.showQuickPick(actions, {
            placeHolder: 'Select an action to help fix validation issues',
            title: 'Fix Project Issues'
        });

        switch (choice) {
            case 'Create Missing resource.json':
                await vscode.commands.executeCommand(COMMANDS.CREATE_ALL_MISSING_RESOURCE_JSON, result.projectId);
                break;
            case 'Show Invalid Resources':
                // Show invalid resources in a new document
                await this.showInvalidResources(result);
                break;
            default:
                // User cancelled or selected unknown option
                break;
        }
    }

    /**
     * Validates a specific resource type within the project
     */
    private async validateResourceType(
        projectBasePath: string,
        resourceProvider: {
            getSearchConfig: () => {
                directoryPaths?: readonly string[];
            };
            resourceTypeId: string;
        },
        errors: string[]
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
                        // Validate resources in this directory
                        const resourceDirs = await fs.readdir(fullPath);
                        await this.validateResourceDirectories(resourceDirs, fullPath, resourceProvider, errors);
                    }
                } catch {
                    // Resource type directory doesn't exist, which is okay
                    console.log(`Resource type directory '${resourceTypePath}' not found`);
                }
            }
        } catch (error) {
            errors.push(`Failed to validate resource type '${resourceProvider.resourceTypeId}': ${String(error)}`);
        }
    }

    /**
     * Validates an individual resource directory
     */
    private async validateIndividualResource(
        resourcePath: string,
        resourceProvider: {
            resourceTypeId: string;
        },
        errors: string[]
    ): Promise<void> {
        try {
            // Check for primary file based on resource provider
            const expectedPrimaryFile = this.getPrimaryFileForResourceType(resourceProvider.resourceTypeId);
            const primaryFilePath = path.join(resourcePath, expectedPrimaryFile);

            try {
                await fs.access(primaryFilePath);
            } catch {
                errors.push(
                    `Resource '${path.basename(resourcePath)}' is missing primary file '${expectedPrimaryFile}'`
                );
            }

            // Check for resource.json
            const resourceJsonPath = path.join(resourcePath, 'resource.json');
            try {
                const resourceJsonContent = await fs.readFile(resourceJsonPath, 'utf8');
                const resourceMetadata = JSON.parse(resourceJsonContent) as {
                    scope?: unknown;
                    version?: unknown;
                };

                // Validate resource.json structure
                if (resourceMetadata.scope === undefined || resourceMetadata.version === undefined) {
                    errors.push(`Resource '${path.basename(resourcePath)}' has invalid resource.json structure`);
                }
            } catch {
                // Missing resource.json will be caught by the other validation method
            }
        } catch (error) {
            errors.push(`Failed to validate resource '${path.basename(resourcePath)}': ${String(error)}`);
        }
    }

    /**
     * Gets the expected primary file name for a resource type using ResourceTypeProviderRegistry
     */
    private getPrimaryFileForResourceType(typeId: string): string {
        try {
            const providerRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            const provider = providerRegistry.getProvider(typeId);
            if (!provider) {
                throw new FlintError(
                    `No provider found for resource type '${typeId}' - provider registry or provider unavailable`,
                    'RESOURCE_PROVIDER_NOT_FOUND'
                );
            }

            // Get primary file directly from provider's editor configuration - NO INFERENCE
            const editorConfig = provider.getEditorConfig();
            if (!editorConfig.primaryFile) {
                throw new FlintError(
                    `Provider for resource type '${typeId}' does not define a primary file - explicit definition required`,
                    'NO_PRIMARY_FILE_DEFINED'
                );
            }

            return editorConfig.primaryFile;
        } catch (error) {
            console.error(`Failed to get primary file from provider registry for ${typeId}:`, error);
            throw new FlintError(
                `Cannot get primary file for resource type '${typeId}' - ResourceTypeProviderRegistry failed`,
                'RESOURCE_PROVIDER_REGISTRY_FAILED',
                'Unable to determine primary file',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Recursively validates resource.json files in a directory
     */
    private async validateResourceJsonInDirectory(
        basePath: string,
        relativePath: string,
        errors: string[],
        warnings: string[],
        missingCount: { value: number }
    ): Promise<void> {
        try {
            const currentPath = path.join(basePath, relativePath);
            const items = await fs.readdir(currentPath);

            for (const item of items) {
                const itemPath = path.join(currentPath, item);
                const stat = await fs.stat(itemPath);

                if (stat.isDirectory()) {
                    await this.processResourceDirectory(itemPath, basePath, relativePath, item, {
                        errors,
                        warnings,
                        missingCount
                    });
                }
            }
        } catch (error) {
            errors.push(`Failed to validate directory '${relativePath}': ${String(error)}`);
        }
    }

    /**
     * Checks if a directory contains resource files based on provider registry
     */
    private hasResourceFiles(files: string[]): boolean {
        try {
            const providerRegistry = this.getService<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

            // Use fallback detection if registry is unavailable
            const hasRegistry = Boolean(providerRegistry && typeof providerRegistry === 'object');
            if (!hasRegistry) {
                return files.some(file => file === 'resource.json' || file.includes('.'));
            }

            const allProviders = providerRegistry.getAllProviders();
            const allSearchableExtensions = new Set<string>();

            // Collect all searchable extensions from providers
            allProviders.forEach(provider => {
                const searchConfig = provider.getSearchConfig();
                searchConfig.searchableExtensions.forEach(ext => allSearchableExtensions.add(ext));
            });

            // Check if any files match the searchable extensions or is resource.json
            return files.some(file => {
                if (file === 'resource.json') {
                    return true;
                }

                const fileExtension = path.extname(file).toLowerCase();
                return allSearchableExtensions.has(fileExtension);
            });
        } catch (error) {
            console.warn('Failed to check resource files using provider registry, using basic detection:', error);
            // Basic fallback - look for resource.json or any file with extension
            return files.some(file => file === 'resource.json' || file.includes('.'));
        }
    }

    /**
     * Shows invalid resources in a detailed view
     */
    private async showInvalidResources(result: ProjectValidationResult): Promise<void> {
        const details = [
            `Invalid Resources in Project: ${result.projectId}`,
            '='.repeat(50),
            '',
            ...result.errors.filter(e => e.includes('missing') || e.includes('invalid')).map(e => `• ${e}`),
            '',
            'Suggestions:',
            '• Run "Create Missing resource.json" command to fix missing metadata files',
            '• Check resource file permissions and accessibility',
            '• Verify resource file naming follows Ignition conventions'
        ].join('\n');

        // Create and show document with details
        const document = await vscode.workspace.openTextDocument({
            content: details,
            language: 'plaintext'
        });

        await vscode.window.showTextDocument(document);
    }

    /**
     * Helper method to validate multiple directories
     */
    private async validateDirectories(directories: string[], projectBasePath: string, errors: string[]): Promise<void> {
        for (const dir of directories) {
            await this.validateResourceDirectory(projectBasePath, dir, errors);
        }
    }

    /**
     * Helper method to validate resource directories
     */
    private async validateResourceDirectories(
        resourceDirs: string[],
        fullPath: string,
        resourceProvider: { resourceTypeId: string },
        errors: string[]
    ): Promise<void> {
        for (const resourceDir of resourceDirs) {
            const resourcePath = path.join(fullPath, resourceDir);
            const resourceStat = await fs.stat(resourcePath);

            if (resourceStat.isDirectory()) {
                await this.validateIndividualResource(resourcePath, resourceProvider, errors);
            }
        }
    }

    /**
     * Helper method to process a single resource directory during JSON validation
     */
    private async processResourceDirectory(
        itemPath: string,
        basePath: string,
        relativePath: string,
        item: string,
        validationContext: {
            errors: string[];
            warnings: string[];
            missingCount: { value: number };
        }
    ): Promise<void> {
        // Check if this looks like a resource directory using provider registry
        const resourceFiles = await fs.readdir(itemPath);
        const hasResourceFiles = this.hasResourceFiles(resourceFiles);

        if (hasResourceFiles) {
            await this.validateResourceJsonFile(itemPath, relativePath, item, validationContext);
        } else {
            // Recurse into subdirectory
            await this.validateResourceJsonInDirectory(
                basePath,
                path.join(relativePath, item),
                validationContext.errors,
                validationContext.warnings,
                validationContext.missingCount
            );
        }
    }

    /**
     * Helper method to validate a single resource.json file
     */
    private async validateResourceJsonFile(
        itemPath: string,
        relativePath: string,
        item: string,
        validationContext: {
            errors: string[];
            warnings: string[];
            missingCount: { value: number };
        }
    ): Promise<void> {
        const resourceJsonPath = path.join(itemPath, 'resource.json');
        try {
            const resourceJsonContent = await fs.readFile(resourceJsonPath, 'utf8');
            const resourceMetadata = JSON.parse(resourceJsonContent) as {
                scope?: unknown;
                version?: unknown;
                files?: unknown;
            };

            // Validate resource.json schema
            this.validateResourceMetadata(resourceMetadata, relativePath, item, validationContext.warnings);
        } catch (error: unknown) {
            if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'ENOENT') {
                validationContext.missingCount.value++;
                validationContext.warnings.push(`Missing resource.json in '${path.join(relativePath, item)}'`);
            } else {
                validationContext.errors.push(
                    `Invalid resource.json in '${path.join(relativePath, item)}': ${String(error)}`
                );
            }
        }
    }

    /**
     * Helper method to validate resource metadata
     */
    private validateResourceMetadata(
        resourceMetadata: {
            scope?: unknown;
            version?: unknown;
            files?: unknown;
        },
        relativePath: string,
        item: string,
        warnings: string[]
    ): void {
        if (resourceMetadata.scope === undefined || resourceMetadata.scope === null) {
            warnings.push(`resource.json in '${path.join(relativePath, item)}' is missing 'scope' field`);
        }
        if (resourceMetadata.version === undefined || resourceMetadata.version === null) {
            warnings.push(`resource.json in '${path.join(relativePath, item)}' is missing 'version' field`);
        }
        if (
            resourceMetadata.files === undefined ||
            resourceMetadata.files === null ||
            !Array.isArray(resourceMetadata.files)
        ) {
            warnings.push(
                `resource.json in '${path.join(relativePath, item)}' is missing or has invalid 'files' array`
            );
        }
    }
}
