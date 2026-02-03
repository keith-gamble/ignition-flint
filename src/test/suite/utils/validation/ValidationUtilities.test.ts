/**
 * @module ValidationUtilities.test
 * @description Unit tests for ValidationUtilities class
 */

import * as assert from 'assert';

import {
    ValidationUtilities,
    ValidationSeverity,
    ValidationCategory,
    ValidationRule,
    ValidationResult
} from '../../../../utils/validation/ValidationUtilities';

suite('ValidationUtilities Test Suite', () => {
    let validationUtils: ValidationUtilities;

    setup(() => {
        // Create ValidationUtilities without service container (standalone mode)
        validationUtils = new ValidationUtilities();
        // Note: We don't call initialize() as it requires vscode workspace
        // Tests will work with the uninitialized state for basic functionality
    });

    // ============================================================================
    // RULE REGISTRATION TESTS
    // ============================================================================

    suite('Rule Registration', () => {
        test('Should register a custom rule', () => {
            const rule: ValidationRule = {
                name: 'test-rule',
                description: 'A test validation rule',
                category: ValidationCategory.SYNTAX,
                severity: ValidationSeverity.ERROR,
                validator: () => ({ isValid: true, messages: [] })
            };

            validationUtils.registerRule(rule);
            const rules = validationUtils.getRules();

            assert.ok(rules.some(r => r.name === 'test-rule'));
        });

        test('Should unregister a rule', () => {
            const rule: ValidationRule = {
                name: 'temp-rule',
                description: 'Temporary rule',
                category: ValidationCategory.SYNTAX,
                severity: ValidationSeverity.WARNING,
                validator: () => ({ isValid: true, messages: [] })
            };

            validationUtils.registerRule(rule);
            validationUtils.unregisterRule('temp-rule');
            const rules = validationUtils.getRules();

            assert.ok(!rules.some(r => r.name === 'temp-rule'));
        });

        test('Should get rules by category', () => {
            const syntaxRule: ValidationRule = {
                name: 'syntax-rule',
                description: 'Syntax rule',
                category: ValidationCategory.SYNTAX,
                severity: ValidationSeverity.ERROR,
                validator: () => ({ isValid: true, messages: [] })
            };

            const styleRule: ValidationRule = {
                name: 'style-rule',
                description: 'Style rule',
                category: ValidationCategory.STYLE,
                severity: ValidationSeverity.INFO,
                validator: () => ({ isValid: true, messages: [] })
            };

            validationUtils.registerRule(syntaxRule);
            validationUtils.registerRule(styleRule);

            const syntaxRules = validationUtils.getRulesByCategory(ValidationCategory.SYNTAX);
            const styleRules = validationUtils.getRulesByCategory(ValidationCategory.STYLE);

            assert.ok(syntaxRules.some(r => r.name === 'syntax-rule'));
            assert.ok(styleRules.some(r => r.name === 'style-rule'));
        });

        test('Should return empty array for category with no rules', () => {
            const rules = validationUtils.getRulesByCategory(ValidationCategory.PERFORMANCE);

            assert.ok(Array.isArray(rules));
        });
    });

    // ============================================================================
    // VALIDATION TESTS
    // ============================================================================

    suite('validate()', () => {
        setup(async () => {
            // Initialize with manual setup for tests
            validationUtils = new ValidationUtilities();
            await validationUtils.initialize();

            // Register test rules manually
            validationUtils.registerRule({
                name: 'not-empty',
                description: 'Value should not be empty',
                category: ValidationCategory.SYNTAX,
                severity: ValidationSeverity.ERROR,
                validator: (value: string): ValidationResult => {
                    if (!value || value.trim().length === 0) {
                        return {
                            isValid: false,
                            messages: [
                                {
                                    severity: ValidationSeverity.ERROR,
                                    category: ValidationCategory.SYNTAX,
                                    message: 'Value cannot be empty'
                                }
                            ]
                        };
                    }
                    return { isValid: true, messages: [], score: 100 };
                }
            });

            validationUtils.registerRule({
                name: 'max-length',
                description: 'Value should not exceed max length',
                category: ValidationCategory.SYNTAX,
                severity: ValidationSeverity.WARNING,
                validator: (value: string): ValidationResult => {
                    if (value && value.length > 100) {
                        return {
                            isValid: true,
                            messages: [
                                {
                                    severity: ValidationSeverity.WARNING,
                                    category: ValidationCategory.SYNTAX,
                                    message: 'Value exceeds recommended length'
                                }
                            ],
                            score: 80
                        };
                    }
                    return { isValid: true, messages: [], score: 100 };
                }
            });

            // Enable the rules
            validationUtils.updateConfiguration({
                enabledRules: ['not-empty', 'max-length'],
                categoryFilters: Object.values(ValidationCategory)
            });
        });

        test('Should validate value against rules', () => {
            const result = validationUtils.validate('valid value');

            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.messages.length, 0);
        });

        test('Should detect validation errors', () => {
            const result = validationUtils.validate('');

            assert.strictEqual(result.isValid, false);
            assert.ok(result.messages.some(m => m.severity === ValidationSeverity.ERROR));
        });

        test('Should include warnings', () => {
            const longValue = 'a'.repeat(150);
            const result = validationUtils.validate(longValue);

            assert.ok(result.messages.some(m => m.severity === ValidationSeverity.WARNING));
        });

        test('Should calculate score', () => {
            const result = validationUtils.validate('valid');

            assert.ok(result.score !== undefined);
            assert.ok(typeof result.score === 'number');
        });

        test('Should apply rule filter', () => {
            const result = validationUtils.validate('valid value', undefined, rule => rule.name === 'not-empty');

            // Only not-empty rule should be applied
            assert.strictEqual(result.isValid, true);
        });

        test('Should include context in validation', () => {
            const context = {
                source: 'test',
                filePath: '/test/path',
                projectId: 'test-project'
            };

            const result = validationUtils.validate('value', context);

            assert.ok(result !== undefined);
        });
    });

    // ============================================================================
    // BATCH VALIDATION TESTS
    // ============================================================================

    suite('validateBatch()', () => {
        setup(async () => {
            validationUtils = new ValidationUtilities();
            await validationUtils.initialize();

            validationUtils.registerRule({
                name: 'positive-number',
                description: 'Value should be positive',
                category: ValidationCategory.SEMANTICS,
                severity: ValidationSeverity.ERROR,
                validator: (value: number): ValidationResult => {
                    if (typeof value !== 'number' || value < 0) {
                        return {
                            isValid: false,
                            messages: [
                                {
                                    severity: ValidationSeverity.ERROR,
                                    category: ValidationCategory.SEMANTICS,
                                    message: 'Value must be a positive number'
                                }
                            ]
                        };
                    }
                    return { isValid: true, messages: [] };
                }
            });

            validationUtils.updateConfiguration({
                enabledRules: ['positive-number'],
                categoryFilters: Object.values(ValidationCategory)
            });
        });

        test('Should validate multiple items', async () => {
            const items = [{ value: 1 }, { value: 2 }, { value: 3 }];

            const results = await validationUtils.validateBatch(items);

            assert.strictEqual(results.length, 3);
            assert.ok(results.every(r => r.isValid));
        });

        test('Should report errors in batch', async () => {
            const items = [{ value: 1 }, { value: -1 }, { value: 2 }];

            const results = await validationUtils.validateBatch(items);

            assert.strictEqual(results.length, 3);
            assert.ok(results[1].isValid === false);
        });

        test('Should call progress callback', async () => {
            const items = [{ value: 1 }, { value: 2 }];
            let progressCalled = false;

            await validationUtils.validateBatch(items, {
                progressCallback: progress => {
                    progressCalled = true;
                    assert.ok(progress.total === 2);
                }
            });

            assert.strictEqual(progressCalled, true);
        });

        test('Should respect concurrency option', async () => {
            const items = Array.from({ length: 10 }, (_, i) => ({ value: i }));

            const results = await validationUtils.validateBatch(items, {
                concurrency: 2
            });

            assert.strictEqual(results.length, 10);
        });

        test('Should stop on error when configured', async () => {
            const items = [{ value: 1 }, { value: -1 }, { value: 2 }];

            try {
                await validationUtils.validateBatch(items, { stopOnError: true });
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(error instanceof Error);
            }
        });
    });

    // ============================================================================
    // RESULT FORMATTING TESTS
    // ============================================================================

    suite('formatResults()', () => {
        test('Should format results as text', () => {
            const results: ValidationResult[] = [
                {
                    isValid: true,
                    messages: [],
                    score: 100
                }
            ];

            const formatted = validationUtils.formatResults(results, 'text');

            assert.ok(formatted.includes('Valid'));
            assert.ok(formatted.includes('100'));
        });

        test('Should format results as markdown', () => {
            const results: ValidationResult[] = [
                {
                    isValid: false,
                    messages: [
                        {
                            severity: ValidationSeverity.ERROR,
                            category: ValidationCategory.SYNTAX,
                            message: 'Test error'
                        }
                    ]
                }
            ];

            const formatted = validationUtils.formatResults(results, 'markdown');

            assert.ok(formatted.includes('#'));
            assert.ok(formatted.includes('Test error'));
        });

        test('Should format results as JSON', () => {
            const results: ValidationResult[] = [{ isValid: true, messages: [] }];

            const formatted = validationUtils.formatResults(results, 'json');
            const parsed = JSON.parse(formatted);

            assert.ok(Array.isArray(parsed));
            assert.strictEqual(parsed[0].isValid, true);
        });

        test('Should include suggestions in output', () => {
            const results: ValidationResult[] = [
                {
                    isValid: false,
                    messages: [],
                    suggestions: [
                        {
                            message: 'Try this fix',
                            action: 'fix'
                        }
                    ]
                }
            ];

            const formatted = validationUtils.formatResults(results, 'text');

            assert.ok(formatted.includes('Try this fix'));
        });
    });

    // ============================================================================
    // CONFIGURATION TESTS
    // ============================================================================

    suite('Configuration', () => {
        test('Should update configuration', () => {
            validationUtils.updateConfiguration({ maxMessages: 50 });
            const config = validationUtils.getCurrentConfiguration();

            assert.strictEqual(config.maxMessages, 50);
        });

        test('Should get current configuration', () => {
            const config = validationUtils.getCurrentConfiguration();

            assert.ok('enabledRules' in config);
            assert.ok('maxMessages' in config);
        });

        test('Should limit messages based on config', async () => {
            await validationUtils.initialize();
            // Register a rule that generates many messages
            validationUtils.registerRule({
                name: 'many-messages',
                description: 'Generates many messages',
                category: ValidationCategory.SYNTAX,
                severity: ValidationSeverity.INFO,
                validator: (): ValidationResult => ({
                    isValid: true,
                    messages: Array.from({ length: 200 }, (_, i) => ({
                        severity: ValidationSeverity.INFO,
                        category: ValidationCategory.SYNTAX,
                        message: `Message ${i}`
                    }))
                })
            });

            validationUtils.updateConfiguration({
                enabledRules: ['many-messages'],
                maxMessages: 10,
                categoryFilters: Object.values(ValidationCategory)
            });

            const result = validationUtils.validate('test');

            assert.ok(result.messages.length <= 10);
        });
    });

    // ============================================================================
    // SERVICE LIFECYCLE TESTS
    // ============================================================================

    suite('Service Lifecycle', () => {
        test('Should return STOPPED status before initialization', () => {
            const newUtils = new ValidationUtilities();
            assert.strictEqual(newUtils.getStatus(), 'stopped');
        });

        test('Should handle stop and dispose', async () => {
            const newUtils = new ValidationUtilities();
            await newUtils.stop();
            await newUtils.dispose();
            // Should not throw
        });

        test('toString should return descriptive string', () => {
            const str = validationUtils.toString();
            assert.ok(str.includes('ValidationUtilities'));
        });
    });

    // ============================================================================
    // SEVERITY TESTS
    // ============================================================================

    suite('Severity Handling', () => {
        setup(async () => {
            validationUtils = new ValidationUtilities();
            await validationUtils.initialize();
        });

        test('Should detect errors correctly', () => {
            validationUtils.registerRule({
                name: 'error-rule',
                description: 'Always errors',
                category: ValidationCategory.SYNTAX,
                severity: ValidationSeverity.ERROR,
                validator: (): ValidationResult => ({
                    isValid: false,
                    messages: [
                        {
                            severity: ValidationSeverity.ERROR,
                            category: ValidationCategory.SYNTAX,
                            message: 'Error'
                        }
                    ]
                })
            });

            validationUtils.updateConfiguration({
                enabledRules: ['error-rule'],
                categoryFilters: Object.values(ValidationCategory)
            });

            const result = validationUtils.validate('test');

            assert.strictEqual(result.isValid, false);
        });

        test('Should detect critical errors', () => {
            validationUtils.registerRule({
                name: 'critical-rule',
                description: 'Critical error',
                category: ValidationCategory.SECURITY,
                severity: ValidationSeverity.CRITICAL,
                validator: (): ValidationResult => ({
                    isValid: false,
                    messages: [
                        {
                            severity: ValidationSeverity.CRITICAL,
                            category: ValidationCategory.SECURITY,
                            message: 'Critical'
                        }
                    ]
                })
            });

            validationUtils.updateConfiguration({
                enabledRules: ['critical-rule'],
                categoryFilters: Object.values(ValidationCategory)
            });

            const result = validationUtils.validate('test');

            assert.strictEqual(result.isValid, false);
        });

        test('Should allow warnings without failing validation', () => {
            validationUtils.registerRule({
                name: 'warning-rule',
                description: 'Always warns',
                category: ValidationCategory.STYLE,
                severity: ValidationSeverity.WARNING,
                validator: (): ValidationResult => ({
                    isValid: true,
                    messages: [
                        {
                            severity: ValidationSeverity.WARNING,
                            category: ValidationCategory.STYLE,
                            message: 'Warning'
                        }
                    ]
                })
            });

            validationUtils.updateConfiguration({
                enabledRules: ['warning-rule'],
                categoryFilters: Object.values(ValidationCategory)
            });

            const result = validationUtils.validate('test');

            assert.strictEqual(result.isValid, true);
            assert.ok(result.messages.some(m => m.severity === ValidationSeverity.WARNING));
        });
    });
});
