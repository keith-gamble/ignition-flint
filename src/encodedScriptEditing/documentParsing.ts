// src/utils/codeUtils.ts
import * as vscode from 'vscode';
import { getCodeTypeFromPath, CodeType, codeTypeMap } from '../utils/codeTypes';
import { getParentObjectFromDocument } from './documentEditing';

export const parsedJsonDocuments: Map<vscode.Uri, Map<number, string>> = new Map();

export async function createLineNumberToSymbolPathMapping(document: vscode.TextDocument) {
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

export async function setCodeContextFromLineNumber(editor: vscode.TextEditor, lineNumber: number) {
  const { symbolPath } = await getParentObjectFromDocument(editor.document, lineNumber);

  let lineCodeType = getCodeTypeFromPath(symbolPath);
  setCodeContext(lineCodeType as CodeType);
}

function setCodeContext(codeTypeArg: CodeType) {
  for (let codeType of codeTypeMap.values()) {
    vscode.commands.executeCommand('setContext', codeType.contextKey, codeType === codeTypeArg);
  }
}
