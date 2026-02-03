import js from '@eslint/js';
import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import unusedImports from 'eslint-plugin-unused-imports';
import importPlugin from 'eslint-plugin-import';
import stylisticPlugin from '@stylistic/eslint-plugin';

export default [
    // Base ESLint recommended rules
    js.configs.recommended,

    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: 'module',
                project: './tsconfig.json'
            },
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                require: 'readonly',
                module: 'readonly',
                exports: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                NodeJS: 'readonly'
            }
        },

        plugins: {
            '@typescript-eslint': typescriptPlugin,
            'unused-imports': unusedImports,
            import: importPlugin,
            '@stylistic': stylisticPlugin
        },

        rules: {
            // TypeScript-specific rules
            ...typescriptPlugin.configs.recommended.rules,
            ...typescriptPlugin.configs['recommended-requiring-type-checking'].rules,

            // Unused code detection
            'unused-imports/no-unused-imports': 'error',
            'unused-imports/no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'after-used',
                    argsIgnorePattern: '^_'
                }
            ],

            // Import organization
            'import/order': [
                'error',
                {
                    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
                    'newlines-between': 'always',
                    alphabetize: {
                        order: 'asc',
                        caseInsensitive: true
                    }
                }
            ],
            'import/no-duplicates': 'error',
            'import/no-unused-modules': 'error',
            'import/no-cycle': 'error',

            // TypeScript overrides
            '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-return': 'warn',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/restrict-template-expressions': 'warn',
            '@typescript-eslint/explicit-function-return-type': 'warn',
            '@typescript-eslint/no-inferrable-types': 'off',
            '@typescript-eslint/prefer-nullish-coalescing': 'off',
            '@typescript-eslint/prefer-optional-chain': 'error',
            '@typescript-eslint/strict-boolean-expressions': 'off',
            '@typescript-eslint/no-unnecessary-condition': 'off',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/require-await': 'error',
            '@typescript-eslint/no-misused-promises': [
                'error',
                {
                    checksVoidReturn: false
                }
            ],

            // Code quality rules
            'no-console': 'off', // Allow console in VS Code extension
            'no-debugger': 'error',
            'no-alert': 'error',
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-script-url': 'error',
            'no-return-await': 'off', // Use TS version instead
            '@typescript-eslint/return-await': 'error',

            // Prefer modern JavaScript features
            'prefer-const': 'error',
            'prefer-arrow-callback': 'error',
            'prefer-template': 'error',
            'prefer-rest-params': 'error',
            'prefer-spread': 'error',
            'object-shorthand': 'error',

            // Code style (basic - more handled by stylistic plugin)
            // '@stylistic/indent': ['error', 4], // Disabled - let Prettier handle indentation
            '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
            '@stylistic/semi': ['error', 'always'],
            '@stylistic/comma-dangle': ['error', 'never'],
            '@stylistic/no-trailing-spaces': 'error',
            '@stylistic/eol-last': 'error',

            // Error prevention
            'no-duplicate-imports': 'error',
            'no-unreachable': 'error',
            'no-unreachable-loop': 'error',
            'no-constant-condition': 'error',
            'no-dupe-keys': 'error',
            'no-dupe-args': 'error',
            'no-func-assign': 'error',
            'no-inner-declarations': 'error',

            // Best practices
            eqeqeq: ['error', 'always'],
            curly: 'off',
            'default-case': 'error',
            'no-else-return': 'error',
            'no-empty-function': 'error',
            'no-multi-spaces': 'error',
            'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 0 }],
            'no-var': 'error',

            // Accessibility and readability
            complexity: ['warn', 20],
            'max-depth': 'off',
            'max-nested-callbacks': ['warn', 5],
            'max-params': ['warn', 5],
            'max-len': [
                'error',
                {
                    code: 120,
                    tabWidth: 4,
                    ignoreUrls: true,
                    ignoreStrings: true,
                    ignoreTemplateLiterals: true,
                    ignoreRegExpLiterals: true
                }
            ]
        }
    },

    // Configuration for declaration files
    {
        files: ['**/*.d.ts'],
        rules: {
            'unused-imports/no-unused-imports': 'off',
            '@typescript-eslint/no-explicit-any': 'off'
        }
    },

    // Configuration for test files
    {
        files: ['**/*.test.ts', '**/test/**/*.ts'],
        languageOptions: {
            globals: {
                suite: 'readonly',
                test: 'readonly',
                setup: 'readonly',
                teardown: 'readonly',
                suiteSetup: 'readonly',
                suiteTeardown: 'readonly',
                before: 'readonly',
                after: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
                describe: 'readonly',
                it: 'readonly'
            }
        }
    },

    // Ignore patterns
    {
        ignores: [
            'out/**/*',
            'node_modules/**/*',
            'dist/**/*',
            'build/**/*',
            'docs/**/*',
            '*.js',
            '*.mjs',
            '*.d.ts',
            'coverage/**/*',
            'schemas/**/*',
            '.vscode-test/**/*',
            'temp/**/*',
            'media/**/*'
        ]
    }
];
