import * as vscode from 'vscode';
import { DependencyContainer } from './dependencyContainer';
import { SubscriptionManager } from './utils/subscriptionManager';
import { registerTextEditorSelectionHandler } from './eventHandlers/textEditorSelectionHandler';
import { registerTextDocumentHandlers } from './eventHandlers/textDocumentHandler';
import { registerPythonScriptCompletionProvider } from './python/pythonCompletion';
import { registerCommands } from './commandRegistration';


export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('Ignition Flint');
	outputChannel.clear();

	context.subscriptions.push(outputChannel);
	outputChannel.appendLine(`[${new Date().toISOString()}] - ignition-flint extension activated`);

	try {
		// Set the vscode.workspace.workspaceFile locally 
		if (vscode.workspace.workspaceFile) {
			vscode.commands.executeCommand('setContext', 'usingWorkspaceFile', true);
		}

		const dependencyContainer = DependencyContainer.getInstance(context, outputChannel);
		const subscriptionManager = new SubscriptionManager();
		const fileSystemService = dependencyContainer.getFileSystemService();
		subscriptionManager.add(outputChannel);

		registerCommands(context, dependencyContainer, subscriptionManager);
		registerTextEditorSelectionHandler(context, subscriptionManager);
		registerTextDocumentHandlers(context, subscriptionManager, dependencyContainer);
		registerPythonScriptCompletionProvider(context, fileSystemService);

		if (vscode.workspace.workspaceFile) {
			vscode.window.registerTreeDataProvider('ignitionGateways', dependencyContainer.getIgnitionGatewayProvider());
		}

		context.subscriptions.push(subscriptionManager);
		outputChannel.appendLine(`[${new Date().toISOString()}] - ignition-flint extension activated successfully`);
	} catch (error) {
		outputChannel.appendLine(`[${new Date().toISOString()}] - ignition-flint extension failed to activate: ${error}`);
		vscode.window.showErrorMessage(`Ignition Flint failed to activate: ${error}`);
	}
}

export function deactivate(context: vscode.ExtensionContext) {
	// Clean up subscriptions
	const disposableSubscriptions = context.subscriptions.filter(subscription => subscription instanceof SubscriptionManager);
	disposableSubscriptions.forEach(subscription => subscription.dispose());
}
