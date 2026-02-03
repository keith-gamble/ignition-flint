/**
 * @module PerspectivePageConfigProvider
 * @description Resource type provider for Perspective Page Configuration (singleton)
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import {
    BaseResourceTypeProvider,
    ResourceSearchConfig,
    ResourceEditorConfig,
    ResourceTemplateConfig
} from '@/core/types/resourceProviders';
import { ResourceValidationRule } from '@/core/types/validation';

/**
 * Provider for Perspective Page Configuration resource
 * Handles JSON-based page configuration settings (singleton)
 */
export class PerspectivePageConfigProvider extends BaseResourceTypeProvider {
    constructor() {
        super('perspective-page-config', 'Page Config');
    }

    getSearchConfig(): ResourceSearchConfig {
        return {
            supportsContentSearch: true,
            searchableExtensions: ['.json'],
            directoryPaths: ['com.inductiveautomation.perspective/page-config'],
            category: 'Perspective',
            categoryIcon: 'gear', // Specific icon for page configuration
            isSingleton: true, // Only one page config per project
            maxSearchableFileSize: 1024 * 1024, // 1MB
            searchEncoding: 'utf8'
        };
    }

    getEditorConfig(): ResourceEditorConfig {
        return {
            editorType: 'json',
            priority: 100,
            primaryFile: 'config.json'
        };
    }

    getValidationRules(): readonly ResourceValidationRule[] {
        return [
            {
                id: 'page-config-structure',
                name: 'Page Config Structure',
                description: 'Validates Perspective page configuration structure',
                severity: 'warning',
                validate: (
                    _filePath: string,
                    content: string
                ): Promise<{
                    isValid: boolean;
                    errors: string[];
                    warnings: string[];
                    info: string[];
                    summary: {
                        totalIssues: number;
                        errorCount: number;
                        warningCount: number;
                        infoCount: number;
                    };
                }> => {
                    const errors: string[] = [];
                    const warnings: string[] = [];

                    try {
                        const configData = JSON.parse(content);

                        // Check for common page config properties
                        if (!configData.homePageUrl) {
                            warnings.push('No homePageUrl defined - users may not have a default landing page');
                        }

                        if (!configData.primaryPages && !configData.pages) {
                            warnings.push('No pages configuration found');
                        }

                        // Check for authentication settings
                        if (!configData.authenticationMode && !configData.loginPageUrl) {
                            warnings.push('No authentication configuration found');
                        }
                    } catch (parseError) {
                        errors.push(
                            `Invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
                        );
                    }

                    return Promise.resolve({
                        isValid: errors.length === 0,
                        errors,
                        warnings,
                        info: [],
                        summary: {
                            totalIssues: errors.length + warnings.length,
                            errorCount: errors.length,
                            warningCount: warnings.length,
                            infoCount: 0
                        }
                    });
                }
            }
        ];
    }

    getTemplateConfig(): ResourceTemplateConfig {
        return {
            templates: [
                {
                    id: 'basic-page-config',
                    name: 'Basic Page Configuration',
                    description: 'Basic Perspective page configuration',
                    resourceTypeId: 'perspective-page-config',
                    files: {
                        'config.json': JSON.stringify(
                            {
                                homePageUrl: '/',
                                loginPageUrl: '/login',
                                authenticationMode: 'perspective',
                                pages: [],
                                primaryPages: [],
                                errorPages: {
                                    '404': '/error/404',
                                    '500': '/error/500'
                                },
                                sessionTimeout: 3600,
                                maxConcurrentSessions: 100
                            },
                            null,
                            2
                        ),
                        'resource.json': JSON.stringify(
                            {
                                scope: 'G',
                                version: 1,
                                restricted: false,
                                overridable: true,
                                files: ['config.json'],
                                attributes: {}
                            },
                            null,
                            2
                        )
                    }
                }
            ],
            defaultTemplateId: 'basic-page-config'
        };
    }

    async createResource(resourcePath: string, templateId?: string, _context?: any): Promise<void> {
        const templateConfig = this.getTemplateConfig();
        const template = templateConfig.templates.find(t => t.id === templateId) || templateConfig.templates[0];

        // Ensure directory exists
        await fs.mkdir(resourcePath, { recursive: true });

        // Write template files
        for (const [fileName, content] of Object.entries(template.files)) {
            const filePath = path.join(resourcePath, fileName);
            await fs.writeFile(filePath, content, 'utf8');
        }
    }
}
