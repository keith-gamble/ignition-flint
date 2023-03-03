// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import { FlintFileSystemProvider } from './flintFileSystemProvider';
import * as flintUtils from './flintUtils';
import{
	CodeType,
	getCodeType,
	getCodeTypeFromPath,
	codeTypeMap,
	insertFunctionDefinition,
	removeFunctionDefinition,
	registerCommands
} from "./codeTypes";
import { parse } from 'path';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

const URI_SCHEME = 'flint';
const FLINT_FS = new FlintFileSystemProvider();
const parsedJsonDocuments: Map<vscode.Uri, Map<number, string>> = new Map();

export function activate(context: vscode.ExtensionContext) {
	// Create an output channel for showing the user data about the extension
	const outputChannel = vscode.window.createOutputChannel('Ignition Flint');
	context.subscriptions.push(outputChannel);
	outputChannel.appendLine('ignition-flint extension active');
	
	// Create the temporary file system used for editing scripts
	FLINT_FS.createDirectory(vscode.Uri.parse('flint:/flint'));
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider(URI_SCHEME, FLINT_FS, { isCaseSensitive: true }));

	// Register any commands found for the codetypes
	registerCommands(context, editScriptCode);
	
	// Add the quick actions for editing scripts
	context.subscriptions.push(vscode.languages.registerCodeActionsProvider('json', { provideCodeActions }));
	// After registering the actions, check to make sure if we should set any now

	// Create a handle here to capture debounce the text editor changing, limit it to every 100ms. Only run this on json files
	let textSelectionHandle: NodeJS.Timeout;
	context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(() => {
		if (textSelectionHandle) {
			clearTimeout(textSelectionHandle);
		}
		textSelectionHandle = setTimeout(() => checkSelectionForScripts(), 100);
	}));


	// After the symbols in the document have been created, parse all open documents



	// // Record any open documents
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
		// If the document is a json file, add it to the open documents
		if (document.languageId === 'json') {
			createLineNumberToSymbolPathMapping(document);
		}
	}));

	// Whenever a document is edited, parse it, but debounce it to every 100ms
	let textEditHandler: NodeJS.Timeout;
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
		if (textEditHandler) {
			clearTimeout(textEditHandler);
		}

		if (event.document.languageId === 'json') {
			textEditHandler = setTimeout(() => createLineNumberToSymbolPathMapping(event.document), 1000);
		}
	}));

	// When a document is closed, remove it from the open documents
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
		// If the document is a json file, remove it from the open documents
		if (document.languageId === 'json') {
			parsedJsonDocuments.delete(document.uri);
		}
	}));


	// Watch for the temporary FlintFS document to be saved, and then fire a command to update the original document
	vscode.workspace.onDidSaveTextDocument(updateEditedCode);
}

// Define a function that takes a document and returns a mapping from line numbers
// to symbol paths
async function createLineNumberToSymbolPathMapping(document: vscode.TextDocument) {
	// Create a new empty map
	const mapping = new Map<number, string>();
  
	// Retrieve the document symbols for the given document
	const symbols: vscode.DocumentSymbol[] = (await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri)) as vscode.DocumentSymbol[];
	
	// If symbols is empty, return an empty map
	if (!symbols) {
		parsedJsonDocuments.set(document.uri, mapping);
		return;
	}

	// Define a helper function that traverses the symbol tree and updates the
	// mapping
	function traverseSymbolTree(
	  symbols: vscode.DocumentSymbol[],
	  parentPath: string
	): void {
	  // Loop over the symbols
	  for (const symbol of symbols) {
		// Update the current symbol path by adding the symbol name to the
		// parent path
		// If the parent path is empty, just use the symbol name
		const currentPath = parentPath ? `${parentPath}.${symbol.name}` : symbol.name;
  
		// If the symbol corresponds to a line in the document, add an entry
		// to the mapping with the line number as the key and the current
		// symbol path as the value
		if (symbol.range.start.line === symbol.range.end.line) {
		  mapping.set(symbol.range.start.line, currentPath);
		}
  
		// Recurse into the symbol's children
		traverseSymbolTree(symbol.children, currentPath);
	  }
	}

	// Start traversing the symbol tree from the root symbols
	traverseSymbolTree(symbols, '');

	// Add the mapping to the parsedJsonDocuments
	parsedJsonDocuments.set(document.uri, mapping);
}

function getSymbolStack(symbols: vscode.DocumentSymbol[], lineNumber: number): vscode.DocumentSymbol[] | undefined {
	// Recursively search through all symbols and symbol children to find the symbol that contains the line number
	for (let i = 0; i < symbols.length; i++) {
		const symbol = symbols[i];
		if (symbol.range.start.line <= lineNumber && symbol.range.end.line >= lineNumber) {
			// If the symbol contains the line number, check if it has children
			if (symbol.children) {
				// If it has children, check if any of them contain the line number
				const childSymbol = getSymbolStack(symbol.children, lineNumber);
				if (childSymbol) {
					// If a child symbol contains the line number, return it
					return [symbol, ...childSymbol];
				} else {
					// If no child symbol contains the line number, return the parent symbol
					return [symbol];
				}
			} else {
				// If the symbol doesn't have children, return it
				return [symbol];
			}
		}
	}
}

async function getLineDetails(document: vscode.TextDocument, lineNumber: number): 
	Promise<{ symbol: vscode.DocumentSymbol, symbolStack: vscode.DocumentSymbol[], symbolPath: string, symbolParent: vscode.DocumentSymbol[] }> {
	// TODO: After document parsing is re-enabled, use the document symbols to find the line key
	const symbols: vscode.DocumentSymbol[] = (await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri)) as vscode.DocumentSymbol[];
	
	// Recursively search through each symbol to find the one that matches the current line number
	// Each symbol will contain more symbols, so we need to recursively search through them
	const symbolStack = getSymbolStack(symbols, lineNumber) as vscode.DocumentSymbol[];

	// Look at the current symbol, and get its content
	const currentSymbol = symbolStack[symbolStack.length - 1];
	const parentSymbol = symbolStack[symbolStack.length - 2];
	const parentSymbolContent = document.getText(parentSymbol.range);

	
	// Parse the current symbol into an object
	const parentSymbolObject = JSON.parse(parentSymbolContent);

	const symbolPath = symbolStack.map((s) => s.name).join('.');

	return { symbol: currentSymbol, symbolStack: symbolStack, symbolPath: symbolPath, symbolParent: parentSymbolObject };
}


// function parseDocument(document) {
// 	if (document.languageId !== 'json') {
// 		return;
// 	}


// 	openDocuments[document.fileName] = { jsonLines: parse(document.getText())};
// }

// This method is called when your extension is deactivated
export function deactivate() { }

async function provideCodeActions(document: vscode.TextDocument): Promise<vscode.CodeAction[]> {
	// Get the current line of text
	const editor = vscode.window.activeTextEditor;

	if (!editor) {
		return [];
	}

	const position = editor.selection.active;
	const lineNumber = position.line;
	const { symbolPath } = await getLineDetails(document, lineNumber);

	let codeType = getCodeTypeFromPath(symbolPath);

	if (codeType === undefined) {
		return [];
	}

	return [codeType.getCodeAction(document)];

}

function setCodeContext(codeTypeArg: CodeType) {
	for (let codeType of codeTypeMap.values()) {
		vscode.commands.executeCommand('setContext', codeType.contextKey, codeType === codeTypeArg);
	}
}

async function setCodeContextFromLineNumber(editor: vscode.TextEditor, lineNumber: number) {
	// Get the parsed line key for the current line
	const { symbolPath } = await getLineDetails(editor.document, lineNumber);

	let lineCodeType = getCodeTypeFromPath(symbolPath);
	setCodeContext(lineCodeType as CodeType);
}


async function checkSelectionForScripts(): Promise<void> {
	// Get the current line of text
	const editor = vscode.window.activeTextEditor as vscode.TextEditor;

	if (!editor) {
		return;
	}
	if (editor.document.languageId !== 'json') {
		return;
	}

	// If the current document is not in the parsed documents, add it
	if (!parsedJsonDocuments.has(editor.document.uri)) {
		createLineNumberToSymbolPathMapping(editor.document);
	}

	
	const line = editor.selection.active.line;
	setCodeContextFromLineNumber(editor, line);
}

function getLineNumberFromActiveDocument(): number | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return undefined;
	}

	let lineNumber = editor.selection.active.line + 1;
	return lineNumber;
}

function getLine(filePath: string, lineNumber: number): string {
	// If the filePath is currently open, get the line from the editor
	const editor = vscode.window.visibleTextEditors.find((editor) => editor.document.fileName === filePath);
	if (editor) {
		return editor.document.lineAt(lineNumber - 1).text;
	}

	let text = fs.readFileSync(filePath, 'utf8');

	// Split the file into lines
	const lines = text.split('\n');

	// Get the line of code
	return lines[lineNumber - 1];
}


// CodeType implements flintUtils.CodeType
function getLineCode(filePath: string, lineNumber: number, codeType: CodeType): string {

	const line = getLine(filePath, lineNumber);

	// Get the value of the code type from the flintUtils.CODE_TYPE enum
	const jsonKey = codeType.getJsonKey();

	// Get the code from the key (codeTypeValue) in the line
	// Example line: \t\t"script":\s"\tprint(\"Hello world\")"
	const codeRegex = new RegExp(`\\s*"${jsonKey}":\\s"(.*)"`);
	const codeMatch = line.match(codeRegex);

	if (!codeMatch) {
		return '';
	}

	return codeMatch[1];
}



function openIgnitionCode(documentUri: vscode.Uri, lineNumber: number, codeType: CodeType) {
	
	const filePath = documentUri.path;

	// flint:transform.py?filePath=//myFolder/myFile.json&line=5
	const uri = vscode.Uri.parse(`${URI_SCHEME}:/flint/${codeType.fileName}.py?filePath=${filePath}&line=${lineNumber}&codeType=${codeType.codeKey}`);

	let code = getLineCode(filePath, lineNumber, codeType);

	// Decode the code
	code = flintUtils.decodeCodeText(code);

	// Insert the function definition
	code = insertFunctionDefinition(code, codeType);

	// Create a new document and open it in the editor
	console.log("ignition-flint.openIgnitionCode: " + uri);
	try {
		// vscode.workspace.fs.writeFile
		FLINT_FS.writeFile(uri, Buffer.from(code), { create: true, overwrite: true });

	} catch (error) {
		console.log("ignition-flint.openIgnitionCode: " + error);
	}

	vscode.workspace.openTextDocument(uri).then(doc => {
		vscode.window.showTextDocument(doc, {preview: false, viewColumn: vscode.ViewColumn.Beside});
	});
}


async function editScriptCode(document: vscode.TextDocument, codeType: CodeType) {
	let lineNumber;

	// If document is undefined, then the command was called from the command palette
	if (document === undefined) {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		// If you are not on a code line, request a line number from the user
		if (!(await vscode.commands.executeCommand('setContext', codeType.contextKey))) {
			lineNumber = await getLineNumberFromActiveDocument();
			if (lineNumber === undefined) {
				return;
			}
		}
	
		document = editor.document;
	} 

	if (lineNumber === undefined) {
		lineNumber = await getLineNumberFromActiveDocument();
	}

	// If the user cancelled the input box, return
	if (lineNumber === undefined) {
		return;
	}

	openIgnitionCode(document.uri, lineNumber, codeType);
}

function replaceLine(filePath: string, lineNumber: number, lineText: string) {
	// If the filePath is currently open, then replace the line in the open document
	const openDocument = vscode.workspace.textDocuments.find(doc => doc.uri.path === filePath);
	if (openDocument) {
		
		const line = openDocument.lineAt(lineNumber - 1);
		const range = new vscode.Range(line.range.start, line.range.end);
		
		let edit = new vscode.WorkspaceEdit();
		edit.replace(openDocument.uri, range, lineText);
		vscode.workspace.applyEdit(edit);
	
	} else {
		throw new Error('File is not open');
	} 
}

function updateEditedCode(document: vscode.TextDocument) {
	if (document.uri.scheme === URI_SCHEME) {
		let documentCode = document.getText();
		let codeKey = flintUtils.getUriQueryParameter(document.uri, 'codeType');

		if (!codeKey) {
			return;
		}

		let codeType = getCodeType(codeKey);

		if (!codeType) {
			return;
		}
		
		documentCode = removeFunctionDefinition(documentCode, codeType);

		console.log("ignition-flint.updateEditedCode: " + documentCode);
		const filePath = flintUtils.getUriQueryParameter(document.uri, 'filePath');

		if (!filePath) {
			return;
		}

		let lineNumber = flintUtils.getUriQueryParameter(document.uri, 'line') as string;
		// Cast lineNumber to a number
		let line = parseInt(lineNumber, 10);

	
		// Encode the code
		const encodedCode = flintUtils.encodeCodeText(documentCode);
		
		// The line is a key in json, with an abstract number of tabs
		// like this: \t\t"code": "print('\tHello World')",
		// So we need to replace the line with the same number of tabs
		const lineText = getLine(filePath, line);

		// Replace the value after the jsonKey
		const jsonKey = codeType.getJsonKey();
		const newLineText = lineText.replace(new RegExp(`"${jsonKey}":\\s"(.*)"`, 'i'), `"${jsonKey}": "${encodedCode}"`);

		if (lineText !== newLineText) {
			replaceLine(filePath, line, newLineText);
		}
	}
}