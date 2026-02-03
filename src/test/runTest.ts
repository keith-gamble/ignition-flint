import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
    try {
        // The folder containing the Extension Manifest package.json
        // __dirname is out/src/test, so go up 3 levels to get to project root
        const extensionDevelopmentPath = path.resolve(__dirname, '../../../');

        // The path to the extension test script
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        // The path to the test workspace
        // __dirname is out/src/test, so go up 3 levels to get to root, then into test-fixtures
        const testWorkspace = path.resolve(__dirname, '../../../test-fixtures');

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                testWorkspace, // Open the test fixtures workspace
                '--disable-extensions' // Disable other extensions during testing
            ]
        });
    } catch {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

void main();
