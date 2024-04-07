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

async function provideCompletionItems(fileSystemService: FileSystemService, document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionList | undefined> {
    const projectResource = fileSystemService.ignitionFileSystemProvider.getCurrentProjectResource(document.uri);
    if (!projectResource) {
        return undefined; // No project resource found, don't provide custom completions
    }

    const linePrefix = document.lineAt(position).text.substring(0, position.character);
    const splitPath = linePrefix.split('.');
    const basePath = splitPath.slice(0, -1).join('.'); // Exclude the current typing part

    let suggestions: vscode.CompletionItem[] = [];
    // Check if typing at the root level
    if (basePath === '') {
        // Collect suggestions from the current project and its parents
        suggestions = collectSuggestionsFromProjectAndParents(projectResource);
    } else {
        // Find the specific resource based on the basePath to suggest its children or related items
        const resource = findResourceByPath(projectResource, basePath.split('.'));
        if (resource) {
            if (resource instanceof ScriptResource) {
                suggestions = resource.scriptElements.map(element => createCompletionItemForScriptElement(element));
            } else {
                suggestions = resource.children?.map(child => createCompletionItemForResource(child)) || [];
            }
        }
    }

    if (suggestions.length === 0) {
        return undefined; // Allow VS Code to provide its default completions
    }

    return new vscode.CompletionList(suggestions, true); // Return the collected suggestions
}

function collectSuggestionsFromProjectAndParents(projectResource: IgnitionProjectResource): vscode.CompletionItem[] {
    const suggestions: vscode.CompletionItem[] = [];
    const visitedProjects = new Set<string>();
    const folderSuggestions: vscode.CompletionItem[] = [];
    const variableSuggestions: vscode.CompletionItem[] = [];

    let currentProject: IgnitionProjectResource | undefined = projectResource;
    while (currentProject) {
        if (!visitedProjects.has(currentProject.baseFilePath)) {
            visitedProjects.add(currentProject.baseFilePath);
            currentProject.children?.forEach(child => {
                if (!suggestions.some(s => s.label === child.label)) {
                    const completionItem = createCompletionItemForResource(child);
                    if (child instanceof FolderResource) {
                        folderSuggestions.push(completionItem);
                    } else {
                        variableSuggestions.push(completionItem);
                    }
                }
            });
        }
        currentProject = currentProject.parentProject;
    }

    // Prioritize folder suggestions over variable suggestions
    return [...folderSuggestions, ...variableSuggestions];
}

function createCompletionItemForResource(resource: IgnitionFileResource): vscode.CompletionItem {
    const completionItem = new vscode.CompletionItem(resource.label, resource instanceof ScriptResource ? vscode.CompletionItemKind.File : vscode.CompletionItemKind.Folder);
    completionItem.detail = resource instanceof ScriptResource ? 'Script' : 'Folder';
    
    // Set a higher sortText for folder resources to prioritize them
    if (resource instanceof FolderResource) {
        completionItem.sortText = `0_${resource.label}`;
    }
    
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
    if (!nextPart) return undefined;

    let nextResource = resource.children?.find(child => child.label === nextPart);

    // If the resource was not found in the current scope and the current resource is a project with a parent, try finding in the parent project
    if (!nextResource && resource instanceof IgnitionProjectResource && resource.parentProject) {
        nextResource = findResourceByPath(resource.parentProject, [nextPart].concat(pathParts));
    } else if (nextResource && pathParts.length > 0) {
        // If a resource was found and there are more parts to the path, continue searching within it
        return findResourceByPath(nextResource, pathParts);
    } else if (nextResource && pathParts.length === 0 && nextResource instanceof ScriptResource) {
        // If the found resource is a ScriptResource and there are no more parts to the path, return it so its elements can be suggested
        return nextResource;
    }

    // If a FolderResource was found but no more parts are left, suggesting its children (this prevents recommending the same folder content repeatedly)
    if (nextResource && pathParts.length === 0 && nextResource instanceof FolderResource) {
        return nextResource;
    }

    return nextResource;
}


