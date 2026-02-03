/**
 * @module FlintDebugConfigurationProvider
 * @description Provides debug configurations for Flint debugging
 */

import * as vscode from 'vscode';

import { SourcePathMapper } from './SourcePathMapper';

import { ServiceContainer } from '@/core/ServiceContainer';
import { ConnectionState, DesignerBridgeService } from '@/services/designer';

/**
 * Provides debug configurations for Flint/Ignition Python debugging.
 */
export class FlintDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(private readonly serviceContainer: ServiceContainer) {}

    /**
     * Provides initial debug configurations for the launch.json file.
     */
    provideDebugConfigurations(
        _folder: vscode.WorkspaceFolder | undefined,
        _token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return [
            {
                type: 'flint',
                name: 'Debug Ignition Script (Designer)',
                request: 'launch',
                program: '${file}',
                stopOnEntry: false,
                scope: 'designer'
            },
            {
                type: 'flint',
                name: 'Debug Ignition Script (Gateway)',
                request: 'launch',
                program: '${file}',
                stopOnEntry: false,
                scope: 'gateway'
            },
            {
                type: 'flint',
                name: 'Debug Perspective Script',
                request: 'launch',
                program: '${file}',
                stopOnEntry: false,
                scope: 'perspective',
                perspectiveSessionId: '',
                perspectivePageId: '',
                perspectiveViewInstanceId: '',
                perspectiveComponentPath: ''
            }
        ];
    }

    /**
     * Resolves a debug configuration before launching.
     * This is called when the user starts debugging without a launch.json.
     */
    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | undefined> {
        // If no config provided, create a default one for the current file
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'python') {
                config.type = 'flint';
                config.name = 'Debug Current File';
                config.request = 'launch';
                config.program = '${file}';
                config.stopOnEntry = false;
            }
        }

        // Validate that we have a program
        if (!config.program) {
            await vscode.window.showErrorMessage('No program specified. Please open a Python file to debug.');
            return undefined;
        }

        // Resolve ${file} and other variables
        if (config.program === '${file}') {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                config.program = editor.document.uri.fsPath;
            } else {
                await vscode.window.showErrorMessage('No file is open. Please open a Python file to debug.');
                return undefined;
            }
        }

        // Validate that this is an Ignition script file
        if (!SourcePathMapper.isIgnitionScriptFile(config.program)) {
            const proceed = await vscode.window.showWarningMessage(
                'The selected file does not appear to be in an Ignition script-python directory. Debugging may not work correctly.',
                'Continue Anyway',
                'Cancel'
            );
            if (proceed !== 'Continue Anyway') {
                return undefined;
            }
        }

        // Check Designer connection
        try {
            const bridgeService = this.serviceContainer.get<DesignerBridgeService>('DesignerBridgeService');
            if (bridgeService.getConnectionState() !== ConnectionState.CONNECTED) {
                const connect = await vscode.window.showWarningMessage(
                    'Not connected to Designer. Would you like to connect?',
                    'Connect',
                    'Cancel'
                );

                if (connect === 'Connect') {
                    const connected = await bridgeService.selectAndConnect();
                    if (!connected) {
                        return undefined;
                    }
                } else {
                    return undefined;
                }
            }

            // Check gateway match
            const matchResult = bridgeService.getGatewayMatchResult();
            if (matchResult && (!matchResult.isExactMatch || !matchResult.projectMatched)) {
                const proceed = await vscode.window.showWarningMessage(
                    `Designer gateway configuration mismatch: ${matchResult.mismatchReason}. Debugging may not work correctly.`,
                    'Continue Anyway',
                    'Cancel'
                );
                if (proceed !== 'Continue Anyway') {
                    return undefined;
                }
            }
        } catch {
            await vscode.window.showErrorMessage(
                'Designer Bridge service not available. Please ensure the extension is fully loaded.'
            );
            return undefined;
        }

        return config;
    }

    /**
     * Resolves a debug configuration after all variables have been substituted.
     */
    resolveDebugConfigurationWithSubstitutedVariables(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        // Final validation after variable substitution
        return config;
    }

    dispose(): void {
        // Nothing to dispose
    }
}
