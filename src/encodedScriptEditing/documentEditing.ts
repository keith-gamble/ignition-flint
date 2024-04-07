import * as vscode from 'vscode';
import * as flintUtils from '../utils/textEncoding';
import { CodeType, getCodeType, insertFunctionDefinition, removeFunctionDefinition } from '../utils/codeTypes';
import * as fs from 'fs';
import { VirtualFileSystemProvider } from '../providers/virtualFileSystem';

export async function openIgnitionCode(fileSystem: VirtualFileSystemProvider, documentUri: vscode.Uri, lineNumber: number, codeType: CodeType) {
    let filePath = documentUri.path;
    if (!filePath) {
        vscode.window.showErrorMessage('Invalid document URI path: ' + documentUri.path);
        return;
    }
    filePath = flintUtils.normalizeWindowsFilePath(filePath);

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
    const { parentObject } = await getParentObjectFromDocument(document, lineNumber);

    // Create the URI for the new `.py` document
    // e.g. flint:/myFolder/myFile.py?filePath=myFolder/myFile.json&line=5&codeType=transform
    const uri = vscode.Uri.parse(`flint:/${codeType.getFileName(parentObject)}.py?filePath=${filePath}&line=${lineNumber}&codeType=${codeType.codeKey}`);

    // Insert the function definition into the code
    code = insertFunctionDefinition(code, codeType, parentObject);

    // Write the code to the temporary file using the VirtualFileSystemProvider
    await fileSystem.writeFile(uri, Buffer.from(code), { create: true, overwrite: true });

    // Open the temporary file in the editor
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

export async function updateEditedCode(document: vscode.TextDocument) {
    // Check if the `TextDocument` is in the `flint` scheme
    if (document.uri.scheme === 'flint') {
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
        const lineNumber = parseInt(flintUtils.getUriQueryParameter(document.uri, 'line') || '0', 10);

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
        const { parentObject } = await getParentObjectFromDocument(originalDocument, lineNumber);

        // Remove the function definition from the `documentCode`
        documentCode = removeFunctionDefinition(documentCode, codeType, parentObject);

        // Encode the `documentCode`
        const encodedCode = flintUtils.encodeCodeText(documentCode);

        // Get the text of the line to replace
        const lineText = getLine(filePath, lineNumber);

        // Replace the value after the jsonKey with the encoded code
        const jsonKey = codeType.getJsonKey();
        const newLineText = lineText.replace(new RegExp(`"${jsonKey}":\\s"(.*)"`, 'i'), `"${jsonKey}": "${encodedCode}"`);

        // If the line text has been modified, replace the line in the original document
        if (lineText !== newLineText) {
            replaceLine(filePath, lineNumber, newLineText);
        }
    }
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

export async function getParentObjectFromDocument(document: vscode.TextDocument, lineNumber: number): Promise<{ symbolPath: string, parentObject: object }> {
    const symbols: vscode.DocumentSymbol[] = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri) as vscode.DocumentSymbol[];
    const symbolStack = getSymbolStack(symbols, lineNumber);

    if (!symbolStack) {
        return { symbolPath: '', parentObject: {} };
    }

    const parentSymbol = symbolStack[symbolStack.length - 2];
    let parentSymbolContent = '';
    let parentSymbolObject = {};

    if (parentSymbol && parentSymbol.range) {
        parentSymbolContent = document.getText(parentSymbol.range);

        if (parentSymbolContent.startsWith(`"${parentSymbol.name}"`)) {
            parentSymbolContent = parentSymbolContent.substring(parentSymbol.name.length + 3);
        }

        try {
            parentSymbolObject = JSON.parse(parentSymbolContent);
        } catch (error) {
            // Handle the case where the parentSymbolContent is not a valid JSON string
            vscode.window.showErrorMessage(`Invalid JSON content: ${parentSymbolContent}`);
        }
    }

    const symbolPath = symbolStack.map((s) => s.name).join('.');

    return { symbolPath, parentObject: parentSymbolObject };
}