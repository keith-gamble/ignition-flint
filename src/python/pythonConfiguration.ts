import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IgnitionProjectResource } from '../resources/projectResource';
import { FileSystemService } from '../services/fileSystemService';
import { ClassResource, ConstantResource, FunctionResource, ScriptElement } from '../resources/scriptElements';
import { ScriptResource } from '../resources/scriptResource';
import { IgnitionFileResource } from '../resources/ignitionFileResource';
import { FolderResource } from '../resources/folderResource';

export async function registerPythonScriptCompletionProvider(context: vscode.ExtensionContext, fileSystemService: FileSystemService): Promise<void> {

    const completionItemProvider = vscode.languages.registerCompletionItemProvider('*', { 
		provideCompletionItems: async (document, position, token, context) => {
			return provideCompletionItems(fileSystemService, document, position, token, context);
		}
	}, '.');

    context.subscriptions.push(completionItemProvider);
}

async function provideCompletionItems(fileSystemService: FileSystemService, document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionList | undefined>{
    const projectResource = fileSystemService.ignitionFileSystemProvider.getCurrentProjectResource(document.uri);
    // If there's no project resource, don't interfere with default completions
    if (!projectResource) {
        return undefined;
    }

    const linePrefix = document.lineAt(position).text.substring(0, position.character);
    const splitPath = linePrefix.split('.');
    const basePath = splitPath.slice(0, -1).join('.'); // Get everything except the last segment

    let suggestions: vscode.CompletionItem[] = [];

    if (basePath === '') {
        // Suggest top-level project children (Folders or Scripts)
        suggestions = projectResource.children?.map(child => createCompletionItemForResource(child)) || [];
    } else {
        // Find the resource corresponding to the basePath to suggest its children
        const resource = findResourceByPath(projectResource, basePath.split('.'));
        if (resource) {
            if (resource instanceof ScriptResource) {
                // If it's a ScriptResource, suggest its script elements
                suggestions = resource.scriptElements.map(element => createCompletionItemForScriptElement(element));
            } else {
                // Otherwise, it's a FolderResource or ProjectResource; suggest its children
                suggestions = resource.children?.map(child => createCompletionItemForResource(child)) || [];
            }
        }
    }

    // If there are no custom completions, return undefined to allow VS Code to provide its defaults
    if (suggestions.length === 0) {
        return undefined;
    }

    const completionList = new vscode.CompletionList(suggestions, true);
    return completionList;
}

function createCompletionItemForResource(resource: IgnitionFileResource): vscode.CompletionItem {
    const completionItem = new vscode.CompletionItem(resource.label, resource instanceof ScriptResource ? vscode.CompletionItemKind.File : vscode.CompletionItemKind.Folder);
    completionItem.detail = resource instanceof ScriptResource ? 'Script' : 'Folder';
    return completionItem;
}

function createCompletionItemForScriptElement(element: ScriptElement): vscode.CompletionItem {
    const completionItem = new vscode.CompletionItem(element.label, element instanceof ClassResource ? vscode.CompletionItemKind.Class : element instanceof FunctionResource ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Constant);
    completionItem.detail = element instanceof ClassResource ? 'Class' : element instanceof FunctionResource ? 'Function' : 'Constant';
    return completionItem;
}

function findResourceByPath(resource: IgnitionFileResource | IgnitionProjectResource, pathParts: string[]): IgnitionFileResource | undefined {
    
	if (resource instanceof IgnitionFileResource && pathParts.length === 0) { 
		return resource;
	}
    const nextPart = pathParts.shift();
    const nextResource = resource.children?.find(child => child.label === nextPart);
    if (nextResource && pathParts.length > 0) {
        return findResourceByPath(nextResource, pathParts);
    }
    return nextResource;
}
