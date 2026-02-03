/**
 * @module PerspectiveViewProvider
 * @description Resource type provider for Perspective Views
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
 * Provider for Perspective View resources
 * Handles JSON-based UI views for the Perspective module
 */
export class PerspectiveViewProvider extends BaseResourceTypeProvider {
    constructor() {
        super('perspective-view', 'Views');
    }

    getSearchConfig(): ResourceSearchConfig {
        return {
            supportsContentSearch: true,
            searchableExtensions: ['.json'],
            directoryPaths: ['com.inductiveautomation.perspective/views'],
            category: 'Perspective',
            categoryIcon: 'layout', // Specific icon for view layouts
            isSingleton: false,
            maxSearchableFileSize: 10 * 1024 * 1024, // 10MB
            searchEncoding: 'utf8'
        };
    }

    getEditorConfig(): ResourceEditorConfig {
        return {
            editorType: 'json',
            priority: 100,
            primaryFile: 'view.json'
        };
    }

    getValidationRules(): readonly ResourceValidationRule[] {
        return [
            {
                id: 'perspective-view-structure',
                name: 'Perspective View Structure',
                description: 'Validates Perspective view JSON structure',
                severity: 'error',
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
                        const viewData = JSON.parse(content);

                        // Check required structure
                        if (!viewData.meta) {
                            errors.push('View missing required "meta" object');
                        }

                        if (!viewData.root) {
                            errors.push('View missing required "root" component');
                        } else {
                            // Check root component structure
                            if (!viewData.root.type) {
                                errors.push('Root component missing "type" property');
                            }
                        }

                        // Check for common structure elements
                        if (!viewData.custom) {
                            warnings.push('View missing "custom" object - may affect property binding');
                        }

                        if (!viewData.params) {
                            warnings.push('View missing "params" object - no view parameters defined');
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
                    id: 'basic-view',
                    name: 'Basic View',
                    description: 'A simple Perspective view with container',
                    resourceTypeId: 'perspective-view',
                    files: {
                        'view.json': JSON.stringify(
                            {
                                meta: {
                                    name: '{resourceName}'
                                },
                                custom: {},
                                params: {},
                                propConfig: {},
                                props: {},
                                root: {
                                    type: 'ia.container.coord',
                                    version: 0,
                                    props: {
                                        style: {
                                            height: '100vh',
                                            width: '100vw'
                                        }
                                    },
                                    meta: {
                                        name: 'root'
                                    },
                                    children: []
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
                                files: ['view.json'],
                                attributes: {}
                            },
                            null,
                            2
                        )
                    }
                },
                {
                    id: 'parameterized-view',
                    name: 'Parameterized View',
                    description: 'View with input parameters',
                    resourceTypeId: 'perspective-view',
                    files: {
                        'view.json': JSON.stringify(
                            {
                                meta: {
                                    name: '{resourceName}'
                                },
                                custom: {},
                                params: {
                                    title: {
                                        dataType: 'String',
                                        value: 'Default Title'
                                    },
                                    showHeader: {
                                        dataType: 'Boolean',
                                        value: true
                                    }
                                },
                                propConfig: {},
                                props: {},
                                root: {
                                    type: 'ia.container.coord',
                                    version: 0,
                                    props: {
                                        style: {
                                            height: '100vh',
                                            width: '100vw'
                                        }
                                    },
                                    meta: {
                                        name: 'root'
                                    },
                                    children: []
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
                                files: ['view.json'],
                                attributes: {}
                            },
                            null,
                            2
                        )
                    }
                }
            ],
            defaultTemplateId: 'basic-view'
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
