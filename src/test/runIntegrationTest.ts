import * as path from 'path';

import { runTests } from '@vscode/test-electron';

/**
 * Run integration tests with the test-fixtures workspace open
 */
async function main(): Promise<void> {
    try {
        // The folder containing the Extension Manifest package.json
        // __dirname is out/src/test, so go up to get to project root
        const extensionDevelopmentPath = path.resolve(__dirname, '../../../');

        // The path to the extension test script - point to integration tests only
        const extensionTestsPath = path.resolve(__dirname, './suite/integration');

        // The path to the test workspace with fixtures
        // __dirname is out/src/test, so we need to go up 3 levels to get to root
        const testWorkspace = path.resolve(__dirname, '../../../test-fixtures');

        console.log('Running integration tests with test workspace:', testWorkspace);

        // Download VS Code, unzip it and run the integration tests
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                testWorkspace, // Open the test fixtures workspace
                '--disable-extensions' // Disable other extensions during testing
            ]
        });
    } catch (error) {
        console.error('Failed to run integration tests:', error);
        process.exit(1);
    }
}

void main();
