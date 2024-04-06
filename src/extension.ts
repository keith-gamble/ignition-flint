import * as vscode from 'vscode';
import { openIgnitionCode, updateEditedCode, getLineDetails, getParentObjectFromDocument } from './encodedScriptEditing';
import { IgnitionFileSystemProvider, ScriptObjectResource } from './projectScriptOutline';
import { VirtualFileSystemProvider } from './virtualFileSystemProvider';
import { openWithKindling } from './kindlingIntegration';
import { pasteAsJson } from './jsonPaste';
import { registerCommands, getCodeTypeFromPath, CodeType, codeTypeMap } from './utils/codeTypes';

const FLINT_FS = new VirtualFileSystemProvider();

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Ignition Flint');
    outputChannel.clear();

    context.subscriptions.push(outputChannel);
    outputChannel.appendLine(`[${new Date().toISOString()}] - ignition-flint extension activated`);

    context.subscriptions.push(vscode.workspace.registerFileSystemProvider('flint', FLINT_FS, { isCaseSensitive: true }));
	
    registerCommands(context, FLINT_FS, openIgnitionCode);
    outputChannel.appendLine(`[${new Date().toISOString()}] - Registered commands for code types`);

    context.subscriptions.push(vscode.commands.registerCommand('ignition-flint.open-with-kindling', openWithKindling));
    outputChannel.appendLine(`[${new Date().toISOString()}] - Registered command to open with Kindling`);

    context.subscriptions.push(vscode.commands.registerCommand('ignition-flint.paste-as-json', pasteAsJson));

    context.subscriptions.push(vscode.languages.registerCodeActionsProvider('json', { provideCodeActions }));
    outputChannel.appendLine(`[${new Date().toISOString()}] - Registered code actions provider`);

    let textSelectionHandle: NodeJS.Timeout;
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(() => {
        if (textSelectionHandle) {
            clearTimeout(textSelectionHandle);
        }
        textSelectionHandle = setTimeout(() => checkSelectionForScripts(), 100);
    }));

    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.languageId === 'json') {
            createLineNumberToSymbolPathMapping(document);
        }
    }));

    let textEditHandler: NodeJS.Timeout;
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (textEditHandler) {
            clearTimeout(textEditHandler);
        }

        if (event.document.languageId === 'json') {
            textEditHandler = setTimeout(() => createLineNumberToSymbolPathMapping(event.document), 1000);
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.languageId === 'json') {
            parsedJsonDocuments.delete(document.uri);
        }
    }));

    vscode.workspace.onDidSaveTextDocument(updateEditedCode);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    const ignitionFileSystemProvider = new IgnitionFileSystemProvider(workspaceRoot);
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.fileName === 'code.py') {
            ignitionFileSystemProvider.refresh();
        }
    }));
    const ignitionTreeView = vscode.window.createTreeView('ignitionFileSystem', {
        treeDataProvider: ignitionFileSystemProvider
    });
	context.subscriptions.push(
        vscode.workspace.onDidCreateFiles((event) => ignitionFileSystemProvider.handleFileCreation(event)),
		vscode.workspace.onDidDeleteFiles((event) => ignitionFileSystemProvider.handleFileDeletion(event))
    );
    ignitionFileSystemProvider.setTreeView(ignitionTreeView);
    context.subscriptions.push(ignitionTreeView);

    context.subscriptions.push(vscode.commands.registerCommand('ignition-flint.copy-script-object-path-to-clipboard', (node: ScriptObjectResource) => {
        const qualifiedPath = node.getFullyQualifiedPath();
        vscode.env.clipboard.writeText(qualifiedPath).then(() => {
            vscode.window.showInformationMessage(`Copied to clipboard: ${qualifiedPath}`);
        });
    }));

    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && editor.document.languageId === 'python') {
            ignitionFileSystemProvider.revealTreeItemForResourceUri(editor.document.uri);
        }
    }, null, context.subscriptions);

    outputChannel.appendLine(`[${new Date().toISOString()}] - ignition-flint extension activated successfully`);
}

const parsedJsonDocuments: Map<vscode.Uri, Map<number, string>> = new Map();

async function createLineNumberToSymbolPathMapping(document: vscode.TextDocument) {
    const mapping = new Map<number, string>();

    const symbols: vscode.DocumentSymbol[] = (await vscode.commands.executeCommand(
        'vscode.executeDocumentSymbolProvider',
        document.uri
    )) as vscode.DocumentSymbol[];

    if (!symbols) {
        parsedJsonDocuments.set(document.uri, mapping);
        return;
    }

    function traverseSymbolTree(symbols: vscode.DocumentSymbol[], parentPath: string): void {
        for (const symbol of symbols) {
            const currentPath = parentPath ? `${parentPath}.${symbol.name}` : symbol.name;

            if (symbol.range.start.line === symbol.range.end.line) {
                mapping.set(symbol.range.start.line, currentPath);
            }

            traverseSymbolTree(symbol.children, currentPath);
        }
    }

    traverseSymbolTree(symbols, '');

    parsedJsonDocuments.set(document.uri, mapping);
}

export function deactivate() { }

async function provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.CodeAction[]> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        return [];
    }

    const { symbolPath } = await getParentObjectFromDocument(document, range.start.line);
    const codeType = getCodeTypeFromPath(symbolPath);

    if (!codeType) {
        return [];
    }

    return [codeType.getCodeAction(document, range.start.line)];
}

function setCodeContext(codeTypeArg: CodeType) {
    for (let codeType of codeTypeMap.values()) {
        vscode.commands.executeCommand('setContext', codeType.contextKey, codeType === codeTypeArg);
    }
}

async function setCodeContextFromLineNumber(editor: vscode.TextEditor, lineNumber: number) {
    const { symbolPath } = await getParentObjectFromDocument(editor.document, lineNumber);

    let lineCodeType = getCodeTypeFromPath(symbolPath);
    setCodeContext(lineCodeType as CodeType);
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

