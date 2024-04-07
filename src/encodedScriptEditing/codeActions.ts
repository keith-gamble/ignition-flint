import * as vscode from 'vscode';
import { getParentObjectFromDocument } from './documentEditing';
import { getCodeTypeFromPath } from '../utils/codeTypes';

export async function provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.CodeAction[]> {
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