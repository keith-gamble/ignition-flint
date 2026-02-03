/**
 * @module FlintDebugAdapterFactory
 * @description Factory for creating Flint debug adapter instances
 */

import * as vscode from 'vscode';

import { FlintDebugAdapter } from './FlintDebugAdapter';

import { ServiceContainer } from '@/core/ServiceContainer';

/**
 * Factory for creating FlintDebugAdapter instances.
 * VS Code uses this factory to create debug adapters when a debug session starts.
 */
export class FlintDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    constructor(private readonly serviceContainer: ServiceContainer) {}

    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
        _executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        // Create an inline debug adapter
        const adapter = new FlintDebugAdapter(this.serviceContainer);
        return new vscode.DebugAdapterInlineImplementation(adapter);
    }

    dispose(): void {
        // Nothing to dispose
    }
}
