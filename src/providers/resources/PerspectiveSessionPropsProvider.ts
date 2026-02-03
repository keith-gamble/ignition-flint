/**
 * @module PerspectiveSessionPropsProvider
 * @description Resource type provider for Perspective Session Properties (singleton)
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
 * Provider for Perspective Session Properties resource
 * Handles JSON-based session property definitions (singleton)
 */
export class PerspectiveSessionPropsProvider extends BaseResourceTypeProvider {
    constructor() {
        super('perspective-session-props', 'Session Props');
    }

    getSearchConfig(): ResourceSearchConfig {
        return {
            supportsContentSearch: true,
            searchableExtensions: ['.json'],
            directoryPaths: ['com.inductiveautomation.perspective/session-props'],
            category: 'Perspective',
            categoryIcon: 'settings', // Specific icon for session properties
            isSingleton: true, // Only one session props per project
            maxSearchableFileSize: 1024 * 1024, // 1MB
            searchEncoding: 'utf8'
        };
    }

    getEditorConfig(): ResourceEditorConfig {
        return {
            editorType: 'json',
            priority: 100,
            primaryFile: 'props.json'
        };
    }

    getValidationRules(): readonly ResourceValidationRule[] {
        return [
            {
                id: 'session-props-structure',
                name: 'Session Props Structure',
                description: 'Validates Perspective session properties structure',
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
                        const propsData = JSON.parse(content);

                        // Session props should typically be an object with property definitions
                        if (typeof propsData !== 'object' || propsData === null) {
                            errors.push('Session props must be a JSON object');
                            return Promise.resolve({
                                isValid: false,
                                errors,
                                warnings: [],
                                info: [],
                                summary: {
                                    totalIssues: 1,
                                    errorCount: 1,
                                    warningCount: 0,
                                    infoCount: 0
                                }
                            });
                        }

                        // Check if props have proper structure
                        Object.entries(propsData).forEach(([propName, propValue]: [string, any]) => {
                            if (typeof propValue === 'object' && propValue !== null) {
                                if (
                                    !Object.prototype.hasOwnProperty.call(propValue, 'value') &&
                                    !Object.prototype.hasOwnProperty.call(propValue, 'dataType')
                                ) {
                                    warnings.push(`Property '${propName}' should have 'value' or 'dataType' field`);
                                }
                            }
                        });

                        if (Object.keys(propsData).length === 0) {
                            warnings.push('No session properties defined');
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
                    id: 'basic-session-props',
                    name: 'Basic Session Properties',
                    description: 'Basic session properties template',
                    resourceTypeId: 'perspective-session-props',
                    files: {
                        'props.json': JSON.stringify(
                            {
                                currentUser: {
                                    dataType: 'String',
                                    value: ''
                                },
                                userRoles: {
                                    dataType: 'DataSet',
                                    value: null
                                },
                                theme: {
                                    dataType: 'String',
                                    value: 'light'
                                },
                                locale: {
                                    dataType: 'String',
                                    value: 'en-US'
                                },
                                timezone: {
                                    dataType: 'String',
                                    value: 'UTC'
                                }
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
                                files: ['props.json'],
                                attributes: {}
                            },
                            null,
                            2
                        )
                    }
                }
            ],
            defaultTemplateId: 'basic-session-props'
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
