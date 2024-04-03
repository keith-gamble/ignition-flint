import * as vscode from 'vscode';
import { exec } from 'child_process';
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

/**
 * The URI scheme used for Flint files.
 */
const URI_SCHEME = 'flint';

/**
 * The Flint file system provider.
 */
const FLINT_FS = new FlintFileSystemProvider();

/**
 * Map that keeps track of parsed JSON documents and their corresponding line number to symbol path mapping.
 */
const parsedJsonDocuments: Map<vscode.Uri, Map<number, string>> = new Map();

/**
 * Activates the extension.
 */
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

	// Register the command to open the file with Kindling
	context.subscriptions.push(vscode.commands.registerCommand('ignition-flint.open-with-kindling', openWithKindling));
	
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

	// Record any open documents
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

/**
 * Creates a mapping from line numbers to symbol paths for the given document.
 * 
 * @param document The document to create the mapping for.
 */
async function createLineNumberToSymbolPathMapping(document: vscode.TextDocument) {
	// Create a new empty map
	const mapping = new Map<number, string>();
  
	// Retrieve the document symbols for the given document
	const symbols: vscode.DocumentSymbol[] = (await vscode.commands.executeCommand(
	  'vscode.executeDocumentSymbolProvider',
	  document.uri
	)) as vscode.DocumentSymbol[];
  
	// If symbols is empty, return an empty map
	if (!symbols) {
	  parsedJsonDocuments.set(document.uri, mapping);
	  return;
	}
  
	/**
	 * Define a helper function that traverses the symbol tree and updates the mapping.
	 * @param symbols The symbols to traverse.
	 * @param parentPath The parent path of the symbols to traverse.
	 */
	function traverseSymbolTree(symbols: vscode.DocumentSymbol[], parentPath: string): void {
	  // Loop over the symbols
	  for (const symbol of symbols) {
		// Update the current symbol path by adding the symbol name to the parent path
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
  

/**
 * Get the stack of symbols that contain a given line number.
 * @param symbols The symbols to search through.
 * @param lineNumber The line number to find symbols for.
 * @returns An array of symbols representing the path to the symbol that contains the given line number.
 */
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

/**
 * Returns details about the symbol on a given line in a given document.
 * @param document The document to get details from.
 * @param lineNumber The line number to get details for.
 * @returns A promise that resolves to an object containing the symbol, symbolStack, symbolPath, and parentObject.
 */
async function getLineDetails(document: vscode.TextDocument, lineNumber: number): Promise<{ symbol: vscode.DocumentSymbol, symbolStack: vscode.DocumentSymbol[], symbolPath: string, parentObject: object }> {
	// Get all document symbols
	const symbols: vscode.DocumentSymbol[] = (await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri)) as vscode.DocumentSymbol[];

	// Recursively search through each symbol to find the one that matches the current line number
	// Each symbol will contain more symbols, so we need to recursively search through them
	const symbolStack = getSymbolStack(symbols, lineNumber) as vscode.DocumentSymbol[];

	// Look at the current symbol, and get its content
	const currentSymbol = symbolStack[symbolStack.length - 1];
	const parentSymbol = symbolStack[symbolStack.length - 2];
	let parentSymbolContent = document.getText(parentSymbol.range);

	// If the parentSymbolContent contains the parentSymbol name in quotes, then it includes the JSON key. We need to remove it
	if (parentSymbolContent.startsWith(`"${parentSymbol.name}"`)) {
		// Remove the first instance of the key from the parentSymbolContent
		let keyLength = parentSymbol.name.length + 3;
		parentSymbolContent = parentSymbolContent.substring(keyLength);
	}

	// Parse the current symbol into an object
	const parentSymbolObject = JSON.parse(parentSymbolContent);

	const symbolPath = symbolStack.map((s) => s.name).join('.');

	return { symbol: currentSymbol, symbolStack: symbolStack, symbolPath: symbolPath, parentObject: parentSymbolObject };
}

/**
 * This method is called when the extension is deactivated.
 */
export function deactivate() { }

/**
 * Provides code actions for the given document.
 * @param document The document to provide code actions for.
 * @returns A promise that resolves to an array of code actions.
 */
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

/**
 * Sets the code context for the given CodeType. This means that the context key
 * for the code type is set to true, while all other context keys for the other
 * code types are set to false.
 * @param codeTypeArg The CodeType to set the context for.
 */
function setCodeContext(codeTypeArg: CodeType) {
	// Loop through all code types and execute the setContext command for each one
	for (let codeType of codeTypeMap.values()) {
		vscode.commands.executeCommand('setContext', codeType.contextKey, codeType === codeTypeArg);
	}
}

/**
 * Sets the code context based on the given line number and document editor. This
 * function retrieves the symbol path for the given line number, finds the CodeType
 * for the symbol path, and sets the code context for that CodeType.
 * @param editor The VS Code editor instance.
 * @param lineNumber The line number to set the code context for.
 */
async function setCodeContextFromLineNumber(editor: vscode.TextEditor, lineNumber: number) {
	// Get the parsed line key for the current line
	const { symbolPath } = await getLineDetails(editor.document, lineNumber);

	// Get the code type from the symbol path and set the context for it
	let lineCodeType = getCodeTypeFromPath(symbolPath);
	setCodeContext(lineCodeType as CodeType);
}

/**
 * Checks the current selection in the editor to see if it corresponds to a
 * script, and sets the code context accordingly. This function is debounced
 * to run at most once every 100ms to prevent excessive calls.
 */
async function checkSelectionForScripts(): Promise<void> {
	// Get the current editor
	const editor = vscode.window.activeTextEditor as vscode.TextEditor;

	// If there is no editor, or the document is not a JSON file, return
	if (!editor || editor.document.languageId !== 'json') {
		return;
	}

	// If the current document is not in the parsed documents, add it
	if (!parsedJsonDocuments.has(editor.document.uri)) {
		createLineNumberToSymbolPathMapping(editor.document);
	}

	// Set the code context based on the current selection
	const line = editor.selection.active.line;
	setCodeContextFromLineNumber(editor, line);
}


/**
 * Returns the active line number of the current document or `undefined` if no document is active.
 * @returns The active line number or `undefined`.
 */
function getLineNumberFromActiveDocument(): number | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return undefined;
	}

	let lineNumber = editor.selection.active.line;
	return lineNumber;
}


/**
 * Returns the line at a specified line number in a file path.
 * @param filePath The file path.
 * @param lineNumber The line number.
 * @returns The line at the specified line number in the file.
 */
function getLine(filePath: string, lineNumber: number): string {
	// If the filePath is currently open, get the line from the editor
	const editor = vscode.window.visibleTextEditors.find((editor) => editor.document.fileName === filePath);
	if (editor) {
		return editor.document.lineAt(lineNumber).text;
	}

	const text = fs.readFileSync(filePath, 'utf8');

	// Split the file into lines
	const lines = text.split('\n');

	// Get the line of code
	return lines[lineNumber];
}



/**
 * Returns the code of a specified `CodeType` from a line number in a file path.
 * @param filePath The file path.
 * @param lineNumber The line number.
 * @param codeType The `CodeType` to get the code for.
 * @returns The code of the specified `CodeType` at the specified line number in the file.
 */
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

/**
 * Opens the code for the specified `codeType` in Ignition Designer by creating and opening a new `.py` document
 * with the function definition for the code.
 * 
 * @param documentUri The URI of the document containing the code to be opened
 * @param lineNumber The line number of the code to be opened
 * @param codeType The type of code to be opened
 */
async function openIgnitionCode(documentUri: vscode.Uri, lineNumber: number, codeType: CodeType) {
	// Convert the URI path to the correct format for Windows
	let filePath = documentUri.path;
	filePath = flintUtils.normalizeWindowsFilePath(filePath)

	// Get the code for the specified `codeType`
	let code = getLineCode(filePath, lineNumber, codeType);
	
	// Decode the code
	code = flintUtils.decodeCodeText(code);
	
	// Get the document by the URI
	const document = vscode.workspace.textDocuments.find((doc) => doc.uri === documentUri);

	if (!document) {
		vscode.window.showErrorMessage(`Could not find document ${documentUri.path}`);
		return;
	}
	
	// Get the details of the parent symbol to provide context to the function definition
	const { parentObject } = await getLineDetails(document, lineNumber);
	
	// Create the URI for the new `.py` document
	// e.g. flint:/myFolder/myFile.py?filePath=myFolder/myFile.json&line=5&codeType=transform
	const uri = vscode.Uri.parse(`${URI_SCHEME}:/${codeType.getFileName(parentObject)}.py?filePath=${filePath}&line=${lineNumber}&codeType=${codeType.codeKey}`);
	
	// Insert the function definition into the code
	code = insertFunctionDefinition(code, codeType, parentObject);

	// Create the new `.py` document and open it in the editor
	console.log("ignition-flint.openIgnitionCode: " + uri);
	try {
		FLINT_FS.writeFile(uri, Buffer.from(code), { create: true, overwrite: true });
	} catch (error) {
		console.log("ignition-flint.openIgnitionCode: " + error);
	}

	vscode.workspace.openTextDocument(uri).then(doc => {
		vscode.window.showTextDocument(doc, {preview: false, viewColumn: vscode.ViewColumn.Beside});
	});
}


/**
 * Edits a script code for a given document and code type. If the document is undefined,
 * it prompts the user to select a document to edit. If the user is not on a code line
 * and the code type requires a specific context key, it prompts the user to select a
 * line number to edit. It then opens the code editor for the selected document and line number.
 * 
 * @param document - The document to edit. If undefined, the user will be prompted to select a document.
 * @param codeType - The type of code to edit found in the `codeTypes` module.
 */
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

/**
 * Replaces a line of text in a given file.
 *
 * @param filePath - The file path of the file to modify.
 * @param lineNumber - The line number of the line to replace (0-based).
 * @param lineText - The new text to replace the line with.
 * @throws Error if the file is not open.
 */
function replaceLine(filePath: string, lineNumber: number, lineText: string) {
	// Check if the file is currently open in the workspace
	const openDocument = vscode.workspace.textDocuments.find(doc => flintUtils.normalizeWindowsFilePath(doc.uri.path) === filePath);
	if (openDocument) {
		// If the file is open, retrieve the line to replace and its range
		const line = openDocument.lineAt(lineNumber);
		const range = new vscode.Range(line.range.start, line.range.end);

		// Create a WorkspaceEdit object and replace the old line with the new line
		let edit = new vscode.WorkspaceEdit();
		edit.replace(openDocument.uri, range, lineText);

		// Apply the edit to the workspace
		vscode.workspace.applyEdit(edit);
	} else {
		// If the file is not open, throw an error
		throw new Error('File is not open');
	}
}

/**
 * Updates the edited code for a given `TextDocument`.
 *
 * @param document - The `TextDocument` to update.
 */
async function updateEditedCode(document: vscode.TextDocument) {
	// Check if the `TextDocument` is in the `URI_SCHEME` scheme
	if (document.uri.scheme === URI_SCHEME) {
		// Get the text of the `TextDocument`
		let documentCode = document.getText();
		
		// Get the code key from the URI query parameters
		const codeKey = flintUtils.getUriQueryParameter(document.uri, 'codeType');

		if (!codeKey) {
			return;
		}

		// Get the `CodeType` object for the `codeKey`
		const codeType = getCodeType(codeKey);

		if (!codeType) {
			return;
		}
		
		// Get the line number from the URI query parameters and parse it as a number
		const lineNumber = flintUtils.getUriQueryParameter(document.uri, 'line') as string;
		const line = parseInt(lineNumber, 10);

		// Get the file path from the URI query parameters
		const filePath = flintUtils.getUriQueryParameter(document.uri, 'filePath');

		if (!filePath) {
			return;
		}

		// Find the original `TextDocument` for the `filePath`
		const originalDocument = vscode.workspace.textDocuments.find(doc => flintUtils.normalizeWindowsFilePath(doc.uri.path) === filePath);

		if (!originalDocument) {
			// The original document is not open, so we can't update the code
			vscode.window.showErrorMessage(`Could not find document ${filePath}, is it open?`);
			return;
		}

		// Get the details of the parent symbol to provide context to the function definition
		const { parentObject } = await getLineDetails(originalDocument, line);
		
		// Remove the function definition from the `documentCode`
		documentCode = removeFunctionDefinition(documentCode, codeType, parentObject);

		// Encode the `documentCode`
		const encodedCode = flintUtils.encodeCodeText(documentCode);
		
		// Get the text of the line to replace
		const lineText = getLine(filePath, line);

		// Replace the value after the jsonKey with the encoded code
		const jsonKey = codeType.getJsonKey();
		const newLineText = lineText.replace(new RegExp(`"${jsonKey}":\\s"(.*)"`, 'i'), `"${jsonKey}": "${encodedCode}"`);

		// If the line text has been modified, replace the line in the original document
		if (lineText !== newLineText) {
			replaceLine(filePath, line, newLineText);
		}
	}
}


function openWithKindling(uri: vscode.Uri) {
    // Retrieve the path of the file to open
    const filePath = uri.fsPath;

    // Determine the command to open Kindling depending on the user's OS
    let command: string;

    if (process.platform === 'win32') {
        // Windows command (adjust if needed)
        command = `start Kindling "${filePath}"`;
    } else if (process.platform === 'darwin') {
        // macOS command (adjust if needed)
        command = `open -a Kindling "${filePath}"`;
    } else {
        // Linux command (adjust if needed)
        command = `kindling "${filePath}"`;
    }

    // Execute the command
    exec(command, (error) => {
        if (error) {
            vscode.window.showErrorMessage(`Failed to open file with Kindling: ${error.message}`);
        }
    });
}
