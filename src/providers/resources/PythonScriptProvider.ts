/**
 * @module PythonScriptProvider
 * @description Resource type provider for Project Python scripts
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import {
    BaseResourceTypeProvider,
    ResourceSearchConfig,
    ResourceEditorConfig,
    ResourceTemplateConfig
} from '@/core/types/resourceProviders';
import { ResourceValidationRule, ValidationRuleResult } from '@/core/types/validation';

/**
 * Provider for Python script resources
 */
export class PythonScriptProvider extends BaseResourceTypeProvider {
    constructor() {
        super('script-python', 'Project Scripts');
    }

    getSearchConfig(): ResourceSearchConfig {
        return {
            supportsContentSearch: true,
            searchableExtensions: ['.py'],
            directoryPaths: ['ignition/script-python'],
            category: null, // Project Scripts should be top-level
            categoryIcon: 'file-code', // Explicit icon for Python scripts
            isSingleton: false,
            maxSearchableFileSize: 5 * 1024 * 1024, // 5MB
            searchEncoding: 'utf8'
        };
    }

    getEditorConfig(): ResourceEditorConfig {
        return {
            editorType: 'text',
            priority: 100,
            primaryFile: 'code.py'
        };
    }

    getValidationRules(): readonly ResourceValidationRule[] {
        return [
            {
                id: 'python-syntax',
                name: 'Python Syntax Check',
                description: 'Basic Python syntax validation',
                severity: 'error',
                validate: (filePath: string, content: string): Promise<ValidationRuleResult> => {
                    // Basic Python syntax validation
                    const errors: string[] = [];
                    const warnings: string[] = [];

                    // Check for basic syntax issues
                    if (content.includes('print ')) {
                        warnings.push('Consider using print() function instead of print statement (Python 3 style)');
                    }

                    // Check for proper indentation (basic check)
                    const lines = content.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        if (line.trim().endsWith(':') && i < lines.length - 1) {
                            const nextLine = lines[i + 1];
                            if (nextLine.trim() !== '' && !nextLine.startsWith('\t') && !nextLine.startsWith('    ')) {
                                errors.push(`Line ${i + 2}: Expected indentation after line ${i + 1}`);
                            }
                        }
                    }

                    return Promise.resolve({
                        isValid: errors.length === 0,
                        errors,
                        warnings
                    });
                }
            },
            {
                id: 'python-imports',
                name: 'Python Import Check',
                description: 'Check for common import issues',
                severity: 'warning',
                validate: (filePath: string, content: string): Promise<ValidationRuleResult> => {
                    const warnings: string[] = [];

                    // Check for wildcard imports
                    if (content.includes('from * import')) {
                        warnings.push('Avoid wildcard imports (from * import) - be specific about what you import');
                    }

                    // Check for unused imports (basic check)
                    const importMatches = content.match(/^import\s+(\w+)/gm);
                    if (importMatches) {
                        importMatches.forEach(match => {
                            const moduleName = match.replace('import ', '');
                            if (!content.includes(`${moduleName}.`) && !content.includes(`${moduleName}(`)) {
                                warnings.push(`Imported module '${moduleName}' appears to be unused`);
                            }
                        });
                    }

                    return Promise.resolve({
                        isValid: true,
                        errors: [],
                        warnings
                    });
                }
            }
        ];
    }

    getTemplateConfig(): ResourceTemplateConfig {
        return {
            templates: [
                {
                    id: 'basic-python',
                    name: 'Basic Python Script',
                    resourceTypeId: 'script-python',
                    description: 'Empty Python script with basic structure',
                    files: {
                        'code.py':
                            '# New Python Script\n\n' +
                            'def main():\n    """Main function - add your code here"""\n    pass\n\n' +
                            'if __name__ == "__main__":\n    main()\n',
                        'resource.json': JSON.stringify(
                            {
                                scope: 'A',
                                version: 1,
                                restricted: false,
                                overridable: true,
                                files: ['code.py'],
                                attributes: {}
                            },
                            null,
                            2
                        )
                    }
                },
                {
                    id: 'gateway-script',
                    name: 'Gateway Event Script',
                    resourceTypeId: 'script-python',
                    description: 'Template for gateway event scripts',
                    files: {
                        'code.py':
                            '# Gateway Event Script\n\ndef runAction(self):\n    """Runs when the gateway event triggers"""\n    logger = system.util.getLogger("GatewayScript")\n    logger.info("Gateway event script executed")\n    \n    # Add your event handling code here\n    pass\n',
                        'resource.json': JSON.stringify(
                            {
                                scope: 'G',
                                version: 1,
                                restricted: false,
                                overridable: false,
                                files: ['code.py'],
                                attributes: {}
                            },
                            null,
                            2
                        )
                    }
                }
            ],
            defaultTemplateId: 'basic-python',
            generateDefaultContent: (templateId?: string): string => {
                switch (templateId) {
                    case 'gateway-script':
                        return '# Gateway Event Script\n\ndef runAction(self):\n    """Runs when the gateway event triggers"""\n    # Add your code here\n    pass\n';
                    case 'basic-python':
                    default:
                        return '# New Python Script\n\ndef main():\n    """Main function - add your code here"""\n    pass\n\nif __name__ == "__main__":\n    main()\n';
                }
            }
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
