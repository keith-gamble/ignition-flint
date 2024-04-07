import * as vscode from 'vscode';
import { createLineNumberToSymbolPathMapping } from '../encodedScriptEditing/documentParsing';
import { SubscriptionManager } from '../utils/subscriptionManager';
import { throttle } from '../utils/throttle';
import { FileSystemService } from '../services/fileSystemService';

const parsedJsonDocuments: Map<vscode.Uri, Map<number, string>> = new Map();

export function registerTextDocumentHandlers(context: vscode.ExtensionContext, subscriptionManager: SubscriptionManager, fileSystemService: FileSystemService) {
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

	// subscriptionManager.add(vscode.workspace.onDidOpenTextDocument(async (document) => {
	// 	if (document.uri.scheme === 'file' && document.fileName.endsWith('code.py')) {
	// 	const projectResource = fileSystemService.ignitionFileSystemProvider.treeRoot.find(project =>
	// 		document.uri.fsPath.startsWith(project.baseFilePath)
	// 	);
	// 	if (projectResource) {
	// 		await confirmPythonExtensionIsEnabled();
	// 	}
	// 	}
	// }));

	// subscriptionManager.add(vscode.workspace.onDidSaveTextDocument(async (document) => {
	// 	if (document.uri.scheme === 'file' && document.fileName.endsWith('code.py')) {
	// 		fileSystemService.ignitionFileSystemProvider.refresh();
	// 		const projectResource = fileSystemService.ignitionFileSystemProvider.treeRoot.find(project =>
	// 			document.uri.fsPath.startsWith(project.baseFilePath)
	// 		);
	// 		if (projectResource) {
	// 			await confirmPythonExtensionIsEnabled();
	// 		}
	// 	}
	// }));

	subscriptionManager.add(vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor && editor.document.languageId === 'python') {
			fileSystemService.ignitionFileSystemProvider.revealTreeItemForResourceUri(editor.document.uri);
		}
	}, null, context.subscriptions));
}