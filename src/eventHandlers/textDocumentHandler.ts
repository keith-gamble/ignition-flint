import * as vscode from 'vscode';
import { createLineNumberToSymbolPathMapping } from '../encodedScriptEditing/documentParsing';
import { SubscriptionManager } from '../utils/subscriptionManager';
import { throttle } from '../utils/throttle';
import { DependencyContainer } from '../dependencyContainer';
import { updateEditedCode } from '../encodedScriptEditing/documentEditing';

const parsedJsonDocuments: Map<vscode.Uri, Map<number, string>> = new Map();

export function registerTextDocumentHandlers(context: vscode.ExtensionContext, subscriptionManager: SubscriptionManager, dependencyContainer: DependencyContainer) {
	subscriptionManager.add(vscode.workspace.onDidOpenTextDocument((document) => {
		if (document.languageId === 'json') {
			createLineNumberToSymbolPathMapping(document);
		}
	}));

	const throttledCreateLineNumberToSymbolPathMapping = throttle(createLineNumberToSymbolPathMapping, 500);

	subscriptionManager.add(vscode.workspace.onDidChangeTextDocument((event) => {
		if (event.document.languageId === 'json') {
			throttledCreateLineNumberToSymbolPathMapping(event.document);
		}
	}));

	subscriptionManager.add(vscode.workspace.onDidCloseTextDocument((document) => {
		if (document.languageId === 'json') {
			parsedJsonDocuments.delete(document.uri);
		}
	}));

	subscriptionManager.add(vscode.workspace.onDidSaveTextDocument(async (document) => {
		if (document.languageId === 'python') {
			const fileSystemService = dependencyContainer.getFileSystemService();
			const currentProject = fileSystemService.ignitionFileSystemProvider.getCurrentProjectResource(document.uri);
			if (currentProject) {
				await fileSystemService.ignitionFileSystemProvider.updateProjectInheritanceContext(currentProject);
				await fileSystemService.ignitionFileSystemProvider.triggerGatewayUpdatesForProjectPath(currentProject.relativePath);
			}
		}
		updateEditedCode(document);
	}));
}