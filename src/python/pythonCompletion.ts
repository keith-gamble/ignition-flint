import * as vscode from 'vscode';
import { IgnitionProjectResource } from '../resources/projectResource';
import { FileSystemService } from '../services/fileSystemService';
import { ClassElement, FunctionElement, ScriptElement } from '../resources/scriptElements';
import { ScriptResource } from '../resources/scriptResource';
import { IgnitionFileResource } from '../resources/ignitionFileResource';
import { FolderResource } from '../resources/folderResource';
import { AbstractContentElement } from '../resources/abstractContentElement';
import { AbstractResourceContainer } from '../resources/abstractResourceContainer';

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
		// First get the currently typed resource, and trip any whitespace, then split by dot
		const pathParts = basePath.trim().split('.');
		const resource = findResourceByPath(projectResource, pathParts);
		if (resource) {
			if (resource instanceof ScriptResource) {
				suggestions = resource.scriptElements.map(element => createCompletionItemForScriptElement(element));
			} else if (resource instanceof AbstractResourceContainer) {
				suggestions = resource.children?.filter(child => child instanceof IgnitionFileResource).map(child => createCompletionItemForResource(child as IgnitionFileResource)) || [];
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

	const collectSuggestionsRecursive = (currentProject: IgnitionProjectResource) => {
		currentProject.children?.forEach(child => {
			if (!suggestions.some(s => s.label === child.label)) {
				if (child instanceof ScriptElement) {
					const completionItem = createCompletionItemForScriptElement(child);
					suggestions.push(completionItem);
				} else if (child instanceof IgnitionFileResource) {
					const completionItem = createCompletionItemForResource(child);
					suggestions.push(completionItem);
				}
			}
		});

		currentProject.inheritedChildren?.forEach(child => {
			if (!suggestions.some(s => s.label === child.label)) {
				if (child instanceof ScriptElement) {
					const completionItem = createCompletionItemForScriptElement(child);
					suggestions.push(completionItem);
				} else if (child instanceof IgnitionFileResource) {
					const completionItem = createCompletionItemForResource(child);
					suggestions.push(completionItem);
				}
			}
		});
	};

	collectSuggestionsRecursive(projectResource);
	let currentProject: IgnitionProjectResource | undefined = projectResource.parentProject;

	while (currentProject) {
		collectSuggestionsRecursive(currentProject);
		currentProject = currentProject.parentProject;
	}

	// Sort the suggestions to prioritize folders over variables
	suggestions.sort((a, b) => {
		if (a.kind === vscode.CompletionItemKind.Folder && b.kind !== vscode.CompletionItemKind.Folder) {
			return -1;
		} else if (a.kind !== vscode.CompletionItemKind.Folder && b.kind === vscode.CompletionItemKind.Folder) {
			return 1;
		} else {
			return 0;
		}
	});

	return suggestions;
}

function createCompletionItemForResource(resource: IgnitionFileResource): vscode.CompletionItem {
    const completionItem = new vscode.CompletionItem(resource.label, resource instanceof ScriptResource ? vscode.CompletionItemKind.File : vscode.CompletionItemKind.Folder);
    completionItem.detail = resource instanceof ScriptResource ? 'Script' : 'Folder';

    // Set the isInherited property
    resource.isInherited = resource.parentResource instanceof IgnitionProjectResource && resource.parentResource.inheritedChildren.includes(resource);

    // Set a higher sortText for folder resources to prioritize them
    if (resource instanceof FolderResource) {
        completionItem.sortText = `0_${resource.label}`;
    }

    return completionItem;
}

function createCompletionItemForScriptElement(element: AbstractContentElement): vscode.CompletionItem {
	const completionItem = new vscode.CompletionItem(element.label, element instanceof ClassElement ? vscode.CompletionItemKind.Class : element instanceof FunctionElement ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Constant);
	completionItem.detail = element instanceof ClassElement ? 'Class' : element instanceof FunctionElement ? 'Function' : 'Constant';
	return completionItem;
}

function findResourceByPath(resource: IgnitionFileResource, pathParts: string[]): IgnitionFileResource | undefined {

	if (pathParts.length === 0) {
		return resource;
	}
	const nextPart = pathParts.shift();
	if (!nextPart) return undefined;

	let nextResource: IgnitionFileResource | AbstractContentElement | undefined = resource.children?.find((child: IgnitionFileResource | AbstractContentElement) => (child instanceof IgnitionFileResource || child instanceof AbstractContentElement) && child.label === nextPart);

	if (!nextResource && resource instanceof IgnitionProjectResource) {
		nextResource = resource.inheritedChildren?.find((child: IgnitionFileResource | AbstractContentElement) => (child instanceof IgnitionFileResource || child instanceof AbstractContentElement) && child.label === nextPart);
	}

	if (nextResource && pathParts.length > 0) {
		return findResourceByPath(nextResource as IgnitionFileResource, pathParts);
	} else if (nextResource && pathParts.length === 0) {
		return nextResource as IgnitionFileResource;
	}

	return undefined;
}



