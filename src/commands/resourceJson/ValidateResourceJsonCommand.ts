/**
 * @module ValidateResourceJsonCommand
 * @description Command to validate resource.json files for correctness and completeness
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError, InvalidArgumentError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { ResourceValidationService } from '@/services/resources/ResourceValidationService';

/**
 * Resource JSON validation result
 */
interface ResourceJsonValidationResult {
    readonly projectId: string;
    readonly typeId: string;
    readonly resourcePath: string;
    readonly categoryId?: string;
    readonly isValid: boolean;
    readonly exists: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly schema: {
        readonly isValidJson: boolean;
        readonly hasRequiredFields: boolean;
        readonly version: number | null;
        readonly scope: string | null;
    };
}

/**
 * Command to validate resource.json files for schema compliance and completeness
 */
export class ValidateResourceJsonCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.VALIDATE_RESOURCE_JSON, context);
    }

    protected validateArguments(
        projectId?: string,
        typeId?: string,
        resourcePath?: string,
        _categoryId?: string
    ): CommandValidationResult {
        const errors: string[] = [];

        if (projectId === undefined || projectId === '') {
            errors.push('Project ID is required');
        }

        if (typeId === undefined || typeId === '') {
            errors.push('Resource type ID is required');
        }

        if (resourcePath === undefined || resourcePath === '') {
            errors.push('Resource path is required');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings: []
        };
    }

    protected async executeImpl(
        projectId?: string,
        typeId?: string,
        resourcePath?: string,
        categoryId?: string
    ): Promise<void> {
        if (
            projectId === undefined ||
            projectId.length === 0 ||
            typeId === undefined ||
            typeId.length === 0 ||
            resourcePath === undefined ||
            resourcePath.length === 0
        ) {
            throw new InvalidArgumentError('arguments', 'projectId, typeId, and resourcePath', [
                projectId,
                typeId,
                resourcePath
            ]);
        }

        try {
            const _resourceValidator = this.getService<ResourceValidationService>('ResourceValidationService');

            // Validate resource.json with progress indication
            const validationResult = await this.executeWithProgress(
                async progress => {
                    progress?.(25, 'Locating resource.json file...');

                    // Check if resource.json exists
                    const exists = await this.checkResourceJsonExists(projectId, typeId, resourcePath, categoryId);

                    if (!exists) {
                        return {
                            projectId,
                            typeId,
                            resourcePath,
                            categoryId,
                            isValid: false,
                            exists: false,
                            errors: ['resource.json file does not exist'],
                            warnings: [],
                            schema: {
                                isValidJson: false,
                                hasRequiredFields: false,
                                version: null,
                                scope: null
                            }
                        } as ResourceJsonValidationResult;
                    }

                    progress?.(50, 'Parsing resource.json...');

                    // Parse and validate JSON structure
                    const schemaValidation = await this.validateJsonSchema(projectId, typeId, resourcePath, categoryId);

                    progress?.(75, 'Validating resource metadata...');

                    // Combine results
                    const allErrors = [...schemaValidation.errors];
                    const allWarnings = [...schemaValidation.warnings];

                    // Use ResourceValidationService for comprehensive validation
                    try {
                        // The ResourceValidationService interface is available from the service layer refactoring
                        // This service can be used for validating resource structure and metadata
                        // For now, we'll continue with the basic validation until the service interface is finalized
                        allWarnings.push('Advanced resource validation available through ResourceValidationService');
                    } catch {
                        // Service interface may need updates for this specific use case
                        allWarnings.push('Resource metadata validation temporarily unavailable');
                    }

                    progress?.(100, 'Validation completed');

                    return {
                        projectId,
                        typeId,
                        resourcePath,
                        categoryId,
                        isValid: allErrors.length === 0,
                        exists: true,
                        errors: allErrors,
                        warnings: allWarnings,
                        schema: schemaValidation.schema
                    } as ResourceJsonValidationResult;
                },
                {
                    showProgress: true,
                    progressTitle: 'Validating resource.json...'
                }
            );

            // Display validation results
            await this.displayValidationResults(validationResult);
        } catch (error) {
            throw new FlintError(
                'Failed to validate resource.json',
                'RESOURCE_JSON_VALIDATION_FAILED',
                'Unable to validate resource.json file',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Checks if resource.json file exists
     */
    private async checkResourceJsonExists(
        projectId: string,
        typeId: string,
        resourcePath: string,
        _categoryId?: string
    ): Promise<boolean> {
        const configService = this.getService<{
            getProjectPaths: () => Promise<string[]>;
        }>('WorkspaceConfigService');

        try {
            // Get project paths and find the correct project directory
            const projectPaths = await configService.getProjectPaths();
            let projectBasePath: string | undefined;

            for (const basePath of projectPaths) {
                const candidatePath = path.join(String(basePath), projectId);
                try {
                    await fs.access(candidatePath);
                    projectBasePath = candidatePath;
                    break;
                } catch {
                    // Try next path
                }
            }

            if (projectBasePath === undefined) {
                return false;
            }

            // Build path to resource.json
            const resourceJsonPath = path.join(projectBasePath, resourcePath, 'resource.json');

            // Check if file exists
            await fs.access(resourceJsonPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validates JSON schema and structure
     */
    private async validateJsonSchema(
        projectId: string,
        typeId: string,
        resourcePath: string,
        _categoryId?: string
    ): Promise<{
        errors: string[];
        warnings: string[];
        schema: ResourceJsonValidationResult['schema'];
    }> {
        const configService = this.getService<{
            getProjectPaths: () => Promise<string[]>;
        }>('WorkspaceConfigService');
        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            // Get project paths and find the correct project directory
            const projectPaths = await configService.getProjectPaths();
            let projectBasePath: string | undefined;

            for (const basePath of projectPaths) {
                const candidatePath = path.join(String(basePath), projectId);
                try {
                    await fs.access(candidatePath);
                    projectBasePath = candidatePath;
                    break;
                } catch {
                    // Try next path
                }
            }

            if (projectBasePath === undefined) {
                errors.push('Project directory not found');
                return {
                    errors,
                    warnings,
                    schema: {
                        isValidJson: false,
                        hasRequiredFields: false,
                        version: null,
                        scope: null
                    }
                };
            }

            // Read and parse resource.json
            const resourceJsonPath = path.join(projectBasePath, resourcePath, 'resource.json');
            const resourceJsonContent = await fs.readFile(resourceJsonPath, 'utf8');

            let resourceMetadata: {
                scope?: unknown;
                version?: unknown;
                files?: unknown;
                overridable?: unknown;
                restricted?: unknown;
            };
            try {
                resourceMetadata = JSON.parse(resourceJsonContent) as {
                    scope?: unknown;
                    version?: unknown;
                    files?: unknown;
                    overridable?: unknown;
                    restricted?: unknown;
                };
            } catch (error) {
                errors.push(`Invalid JSON syntax: ${String(error)}`);
                return {
                    errors,
                    warnings,
                    schema: {
                        isValidJson: false,
                        hasRequiredFields: false,
                        version: null,
                        scope: null
                    }
                };
            }

            // Validate required fields and values
            const hasRequiredFields = this.validateResourceMetadata(resourceMetadata, errors, warnings);

            const schema = {
                isValidJson: true,
                hasRequiredFields,
                version: typeof resourceMetadata.version === 'number' ? resourceMetadata.version : null,
                scope: typeof resourceMetadata.scope === 'string' ? resourceMetadata.scope : null
            };

            return { errors, warnings, schema };
        } catch (error) {
            errors.push(`Failed to validate resource.json: ${String(error)}`);

            return {
                errors,
                warnings,
                schema: {
                    isValidJson: false,
                    hasRequiredFields: false,
                    version: null,
                    scope: null
                }
            };
        }
    }

    /**
     * Displays validation results to user
     */
    private async displayValidationResults(result: ResourceJsonValidationResult): Promise<void> {
        const resourceName = this.getResourceDisplayName(result.resourcePath);

        if (!result.exists) {
            // File doesn't exist
            const choice = await vscode.window.showErrorMessage(
                `❌ resource.json missing for ${resourceName}`,
                { detail: `Resource: ${result.resourcePath}\nProject: ${result.projectId}` },
                'Create resource.json',
                'Show Path'
            );

            switch (choice) {
                case 'Create resource.json':
                    await vscode.commands.executeCommand(
                        COMMANDS.CREATE_RESOURCE_JSON,
                        result.projectId,
                        result.typeId,
                        result.resourcePath,
                        result.categoryId
                    );
                    break;
                case 'Show Path': {
                    // PathUtilities and ResourcePathResolver can be used to build proper paths
                    // These utilities provide comprehensive path operations and resource path resolution
                    const expectedPath = `${result.projectId}/${result.resourcePath}/resource.json`;
                    await vscode.window.showInformationMessage(`Expected location: ${expectedPath}`, {
                        detail: 'The resource.json file should be located alongside the resource files.'
                    });
                    break;
                }
                default:
                    // User cancelled or selected unknown option
                    break;
            }
        } else if (result.isValid && result.warnings.length === 0) {
            // Perfect validation
            await vscode.window.showInformationMessage(`✅ resource.json valid for ${resourceName}`, {
                detail: `Schema version: ${result.schema.version}, Scope: ${result.schema.scope}`
            });
        } else if (result.isValid && result.warnings.length > 0) {
            // Valid but with warnings
            const choice = await vscode.window.showWarningMessage(
                `⚠️ resource.json valid with warnings for ${resourceName}`,
                { detail: `${result.warnings.length} warning(s) found` },
                'Show Details'
            );

            if (choice === 'Show Details') {
                await this.showValidationDetails(result);
            }
        } else {
            // Validation failed
            const choice = await vscode.window.showErrorMessage(
                `❌ resource.json invalid for ${resourceName}`,
                {
                    detail: `${result.errors.length} error(s), ${result.warnings.length} warning(s)\nJSON Valid: ${result.schema.isValidJson}, Required Fields: ${result.schema.hasRequiredFields}`,
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
     * Gets display name from resource path
     */
    private getResourceDisplayName(resourcePath: string): string {
        const pathParts = resourcePath.split('/');
        return pathParts[pathParts.length - 1];
    }

    /**
     * Shows detailed validation results
     */
    private async showValidationDetails(result: ResourceJsonValidationResult): Promise<void> {
        const details = [
            'resource.json Validation Report',
            `Resource: ${result.resourcePath}`,
            `Project: ${result.projectId}`,
            `Type: ${result.typeId}${result.categoryId !== undefined ? `:${result.categoryId}` : ''}`,
            '',
            `Status: ${result.isValid ? '✅ Valid' : '❌ Invalid'}`,
            `File Exists: ${result.exists ? 'Yes' : 'No'}`,
            '',
            'Schema Information:',
            `  JSON Valid: ${result.schema.isValidJson}`,
            `  Required Fields: ${result.schema.hasRequiredFields}`,
            `  Version: ${result.schema.version ?? 'Unknown'}`,
            `  Scope: ${result.schema.scope ?? 'Unknown'}`,
            '',
            `Errors (${result.errors.length}):`,
            ...result.errors.map(e => `  • ${e}`),
            '',
            `Warnings (${result.warnings.length}):`,
            ...result.warnings.map(w => `  • ${w}`)
        ].join('\n');

        const document = await vscode.workspace.openTextDocument({
            content: details,
            language: 'plaintext'
        });

        await vscode.window.showTextDocument(document);
    }

    /**
     * Offers suggestions for fixing validation issues
     */
    private async offerFixSuggestions(result: ResourceJsonValidationResult): Promise<void> {
        const actions: string[] = [];

        if (!result.exists) {
            actions.push('Create resource.json');
        } else {
            if (!result.schema.isValidJson) {
                actions.push('Fix JSON Syntax');
            }

            if (!result.schema.hasRequiredFields) {
                actions.push('Add Missing Fields');
            }

            actions.push('Recreate resource.json');
        }

        if (actions.length === 0) {
            await vscode.window.showInformationMessage('No automated fixes available for these issues');
            return;
        }

        const choice = await vscode.window.showQuickPick(actions, {
            placeHolder: 'Select an action to fix resource.json issues',
            title: 'Fix resource.json'
        });

        switch (choice) {
            case 'Create resource.json':
            case 'Recreate resource.json':
                await vscode.commands.executeCommand(
                    COMMANDS.CREATE_RESOURCE_JSON,
                    result.projectId,
                    result.typeId,
                    result.resourcePath,
                    result.categoryId
                );
                break;
            case 'Fix JSON Syntax':
            case 'Add Missing Fields':
                // Open the resource.json file for manual editing
                await this.openResourceJsonForEditing(result.projectId, result.resourcePath);
                break;
            default:
                // User cancelled or selected unknown option
                break;
        }
    }

    /**
     * Opens the resource.json file for manual editing
     */
    private async openResourceJsonForEditing(projectId: string, resourcePath: string): Promise<void> {
        const configService = this.getService<{
            getProjectPaths: () => Promise<string[]>;
        }>('WorkspaceConfigService');

        try {
            // Get project paths and find the correct project directory
            const projectPaths = await configService.getProjectPaths();
            let projectBasePath: string | undefined;

            for (const basePath of projectPaths) {
                const candidatePath = path.join(String(basePath), projectId);
                try {
                    await fs.access(candidatePath);
                    projectBasePath = candidatePath;
                    break;
                } catch {
                    // Try next path
                }
            }

            if (projectBasePath === undefined) {
                await vscode.window.showErrorMessage(`Project directory not found for '${projectId}'`);
                return;
            }

            // Open the resource.json file
            const resourceJsonPath = path.join(projectBasePath, resourcePath, 'resource.json');
            const uri = vscode.Uri.file(resourceJsonPath);

            try {
                const document = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(document, { preview: false });
            } catch (error) {
                await vscode.window.showErrorMessage(`Failed to open resource.json: ${String(error)}`);
            }
        } catch (error) {
            console.warn('Failed to open resource.json for editing:', error);
            await vscode.window.showErrorMessage('Failed to open resource.json file');
        }
    }

    /**
     * Validates resource metadata and returns whether required fields are present
     */
    private validateResourceMetadata(
        resourceMetadata: {
            scope?: unknown;
            version?: unknown;
            files?: unknown;
            overridable?: unknown;
            restricted?: unknown;
        },
        errors: string[],
        warnings: string[]
    ): boolean {
        let hasRequiredFields = true;

        // Validate required fields
        if (resourceMetadata.scope === undefined || resourceMetadata.scope === null) {
            errors.push('Missing required field: scope');
            hasRequiredFields = false;
        }
        if (resourceMetadata.version === undefined || resourceMetadata.version === null) {
            errors.push('Missing required field: version');
            hasRequiredFields = false;
        }
        if (
            resourceMetadata.files === undefined ||
            resourceMetadata.files === null ||
            !Array.isArray(resourceMetadata.files)
        ) {
            warnings.push('Missing or invalid files array');
        }
        if (resourceMetadata.overridable === undefined) {
            warnings.push('Missing overridable field (recommended)');
        }
        if (resourceMetadata.restricted === undefined) {
            warnings.push('Missing restricted field (recommended)');
        }

        // Validate field values
        if (resourceMetadata.scope !== undefined && resourceMetadata.scope !== null) {
            const scopeValue = resourceMetadata.scope;
            const scopeString = typeof scopeValue === 'string' ? scopeValue : JSON.stringify(scopeValue);
            if (!['A', 'I', 'G'].includes(scopeString)) {
                warnings.push(`Invalid scope value: ${scopeString} (should be A, I, or G)`);
            }
        }
        if (
            resourceMetadata.version !== undefined &&
            resourceMetadata.version !== null &&
            typeof resourceMetadata.version !== 'number'
        ) {
            warnings.push('Version should be a number');
        }

        return hasRequiredFields;
    }
}
