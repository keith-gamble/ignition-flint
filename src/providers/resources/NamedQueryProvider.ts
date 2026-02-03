/**
 * @module NamedQueryProvider
 * @description Resource type provider for Ignition Named Queries
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
 * Provider for Named Query resources
 * Handles SQL-based database queries with parameters
 */
export class NamedQueryProvider extends BaseResourceTypeProvider {
    constructor() {
        super('named-query', 'Named Queries');
    }

    getSearchConfig(): ResourceSearchConfig {
        return {
            supportsContentSearch: true,
            searchableExtensions: ['.sql'],
            directoryPaths: ['ignition/named-query'],
            category: null, // Named Queries should be top-level
            categoryIcon: 'database', // Explicit icon for SQL queries
            isSingleton: false,
            maxSearchableFileSize: 1024 * 1024, // 1MB
            searchEncoding: 'utf8'
        };
    }

    getEditorConfig(): ResourceEditorConfig {
        return {
            editorType: 'text',
            priority: 100,
            primaryFile: 'query.sql'
        };
    }

    getValidationRules(): readonly ResourceValidationRule[] {
        return [
            {
                id: 'sql-syntax',
                name: 'SQL Syntax Validation',
                description: 'Validates basic SQL syntax in named queries',
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

                    // Basic SQL validation
                    if (!content.trim()) {
                        warnings.push('Query is empty');
                    } else {
                        // Check for common SQL keywords
                        const sqlKeywords = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|EXEC|EXECUTE)\b/i;
                        if (!sqlKeywords.test(content)) {
                            warnings.push('Query does not contain recognized SQL keywords');
                        }

                        // Check for unbalanced parentheses
                        const openParens = (content.match(/\(/g) || []).length;
                        const closeParens = (content.match(/\)/g) || []).length;
                        if (openParens !== closeParens) {
                            warnings.push('Unbalanced parentheses in query');
                        }
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
                    id: 'basic-select',
                    name: 'Basic SELECT Query',
                    description: 'A simple SELECT query template',
                    resourceTypeId: 'named-query',
                    files: {
                        'query.sql': `-- Named Query: {resourceName}
-- Description: Add description here

SELECT 
    -- Add columns here
    *
FROM 
    -- Add table name here
    your_table
WHERE 
    -- Add conditions here
    1 = 1;`,
                        'resource.json': JSON.stringify(
                            {
                                scope: 'G',
                                version: 1,
                                restricted: false,
                                overridable: true,
                                files: ['query.sql'],
                                attributes: {}
                            },
                            null,
                            2
                        )
                    }
                },
                {
                    id: 'parameterized-query',
                    name: 'Parameterized Query',
                    description: 'Query with parameters',
                    resourceTypeId: 'named-query',
                    files: {
                        'query.sql': `-- Named Query: {resourceName}
-- Description: Add description here

SELECT 
    -- Add columns here
    *
FROM 
    -- Add table name here
    your_table
WHERE 
    -- Use parameters with :paramName syntax
    column_name = :paramValue;`,
                        'resource.json': JSON.stringify(
                            {
                                scope: 'G',
                                version: 1,
                                restricted: false,
                                overridable: true,
                                files: ['query.sql'],
                                attributes: {}
                            },
                            null,
                            2
                        )
                    }
                }
            ],
            defaultTemplateId: 'basic-select'
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
