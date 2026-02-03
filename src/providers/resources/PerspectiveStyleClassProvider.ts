/**
 * @module PerspectiveStyleClassProvider
 * @description Resource type provider for Perspective Style Classes
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
 * Provider for Perspective Style Class resources
 * Handles JSON-based CSS styling for Perspective components
 */
export class PerspectiveStyleClassProvider extends BaseResourceTypeProvider {
    constructor() {
        super('perspective-style-class', 'Style Classes');
    }

    getSearchConfig(): ResourceSearchConfig {
        return {
            supportsContentSearch: true,
            searchableExtensions: ['.json'],
            directoryPaths: ['com.inductiveautomation.perspective/style-classes'],
            category: 'Perspective',
            categoryIcon: 'symbol-color', // Specific icon for style classes
            isSingleton: false,
            maxSearchableFileSize: 1024 * 1024, // 1MB
            searchEncoding: 'utf8'
        };
    }

    getEditorConfig(): ResourceEditorConfig {
        return {
            editorType: 'json',
            priority: 100,
            primaryFile: 'style.json'
        };
    }

    getValidationRules(): readonly ResourceValidationRule[] {
        return [
            {
                id: 'style-class-structure',
                name: 'Style Class Structure',
                description: 'Validates Perspective style class JSON structure',
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
                        const styleData = JSON.parse(content);

                        // Style classes should typically have CSS-like properties
                        if (Object.keys(styleData).length === 0) {
                            warnings.push('Style class appears to be empty');
                        }

                        // Check for common CSS properties
                        const commonCssProps = [
                            'color',
                            'background',
                            'fontSize',
                            'width',
                            'height',
                            'margin',
                            'padding'
                        ];
                        const hasCommonProps = commonCssProps.some(prop => styleData[prop] !== undefined);

                        if (!hasCommonProps && Object.keys(styleData).length > 0) {
                            warnings.push(
                                'Style class does not contain common CSS properties - verify this is intended'
                            );
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
                    id: 'basic-style',
                    name: 'Basic Style Class',
                    description: 'A basic style class with common properties',
                    resourceTypeId: 'perspective-style-class',
                    files: {
                        'style.json': JSON.stringify(
                            {
                                backgroundColor: '#ffffff',
                                color: '#333333',
                                fontSize: '14px',
                                padding: '8px',
                                borderRadius: '4px'
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
                                files: ['style.json'],
                                attributes: {}
                            },
                            null,
                            2
                        )
                    }
                },
                {
                    id: 'button-style',
                    name: 'Button Style Class',
                    description: 'Style class optimized for buttons',
                    resourceTypeId: 'perspective-style-class',
                    files: {
                        'style.json': JSON.stringify(
                            {
                                backgroundColor: '#007bff',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '10px 16px',
                                fontSize: '14px',
                                fontWeight: '500',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease-in-out',
                                ':hover': {
                                    backgroundColor: '#0056b3'
                                },
                                ':active': {
                                    transform: 'scale(0.98)'
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
                                files: ['style.json'],
                                attributes: {}
                            },
                            null,
                            2
                        )
                    }
                }
            ],
            defaultTemplateId: 'basic-style'
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
