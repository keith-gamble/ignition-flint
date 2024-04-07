import * as vscode from 'vscode';
import { createLineNumberToSymbolPathMapping, setCodeContextFromLineNumber } from '../encodedScriptEditing/documentParsing';
import { SubscriptionManager } from '../utils/subscriptionManager';
import { debounce } from '../utils/debounce';

const parsedJsonDocuments: Map<vscode.Uri, Map<number, string>> = new Map();

export function registerTextEditorSelectionHandler(context: vscode.ExtensionContext, subscriptionManager: SubscriptionManager) {
	const debouncedCheckSelectionForScripts = debounce(checkSelectionForScripts, 200);

	subscriptionManager.add(vscode.window.onDidChangeTextEditorSelection(debouncedCheckSelectionForScripts));
}

async function checkSelectionForScripts(): Promise<void> {
	const editor = vscode.window.activeTextEditor as vscode.TextEditor;

	if (!editor || editor.document.languageId !== 'json') {
		return;
	}

	if (!parsedJsonDocuments.has(editor.document.uri)) {
		createLineNumberToSymbolPathMapping(editor.document);
	}

	const line = editor.selection.active.line;
	setCodeContextFromLineNumber(editor, line);
}