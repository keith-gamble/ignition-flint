import * as vscode from 'vscode';
import { DependencyContainer } from './dependencyContainer';
import { ScriptResource } from './resources/scriptResource';
import { FolderResource } from './resources/folderResource';
import { ScriptElement } from './resources/scriptElements';
import { buildResourceFileContents } from './utils/resourceFileUtils';
import { openWithKindling } from './commands/kindlingIntegration';
import { pasteAsJson } from './commands/jsonPaste';
import { provideCodeActions } from './encodedScriptEditing/codeActions';
import { CodeType, codeTypeMap } from './utils/codeTypes';
import * as fs from 'fs';
import * as path from 'path';
import { VirtualFileSystemProvider } from './providers/virtualFileSystem';
import { openIgnitionCode } from './encodedScriptEditing/documentEditing';
import { IgnitionProjectResource } from './resources/projectResource';

function registerCodeTypeCommands(
	context: vscode.ExtensionContext,
	fileSystemProvider: VirtualFileSystemProvider,
	callable: (fileSystem: VirtualFileSystemProvider, documentUri: vscode.Uri, lineNumber: number, codeType: CodeType) => void | Promise<void>,
) {
	for (const codeType of codeTypeMap.values()) {
		context.subscriptions.push(
			vscode.commands.registerCommand(codeType.codeActionDetails.command, (documentUri: vscode.Uri, lineNumber: number) =>
				callable(fileSystemProvider, documentUri, lineNumber, codeType)
			)
		);
	}
}

export function registerCommands(context: vscode.ExtensionContext, dependencyContainer: DependencyContainer, subscriptionManager: any) {
	const fileSystemService = dependencyContainer.getFileSystemService();

	subscriptionManager.add(vscode.commands.registerCommand('ignition-flint.open-with-kindling', openWithKindling));
	subscriptionManager.add(vscode.commands.registerCommand('ignition-flint.paste-as-json', pasteAsJson));
	subscriptionManager.add(vscode.languages.registerCodeActionsProvider('json', { provideCodeActions }));

	registerCodeTypeCommands(context, dependencyContainer.getVirtualFileSystemProvider(), openIgnitionCode);

	subscriptionManager.add(vscode.commands.registerCommand('ignition-flint.copy-script-object-path-to-clipboard', async (node: ScriptElement) => {
		const qualifiedPath = node.getFullyQualifiedPath();
		await vscode.env.clipboard.writeText(qualifiedPath);
		vscode.window.showInformationMessage(`Copied to clipboard: ${qualifiedPath}`);
	}));

	subscriptionManager.add(vscode.commands.registerCommand('ignition-flint.refresh-tree-view', () => {
		fileSystemService.ignitionFileSystemProvider.refreshTreeView();
	}));

	subscriptionManager.add(vscode.commands.registerCommand('ignition-flint.add-script-module', async (fileResource: IgnitionProjectResource | FolderResource) => {
		const scriptName = await vscode.window.showInputBox({
			prompt: 'Enter the name of the new script module:',
		});

		if (scriptName) {
			let scriptDirectory;

			if (fileResource instanceof IgnitionProjectResource) {
				console.log("IgnitionProjectResource.baseFilePath: ", fileResource.baseFilePath);
				scriptDirectory = path.join(fileResource.baseFilePath, 'ignition', 'script-python', scriptName);
			} else {
				scriptDirectory = path.join(fileResource.baseFilePath, scriptName);
			}
			try {
				await fs.promises.mkdir(scriptDirectory);
				await fs.promises.writeFile(path.join(scriptDirectory, 'code.py'), '');
				const resourceFileContents = await buildResourceFileContents(context);
				await fs.promises.writeFile(path.join(scriptDirectory, 'resource.json'), resourceFileContents);

				fileSystemService.ignitionFileSystemProvider.refreshTreeView();

				const codePyPath = path.join(scriptDirectory, 'code.py');
				const codePyUri = vscode.Uri.file(codePyPath);
				vscode.window.showTextDocument(codePyUri);
			} catch (error: any) {
				vscode.window.showErrorMessage(`Failed to create script module: ${error.message}`);
			}
		}
	}));

	subscriptionManager.add(vscode.commands.registerCommand('ignition-flint.add-script-package', async (projectResource: IgnitionProjectResource | FolderResource) => {
		const packageName = await vscode.window.showInputBox({
			prompt: 'Enter the name of the new script package:',
		});

		if (packageName) {
			let packageDirectory;
			if (projectResource instanceof IgnitionProjectResource) {
				packageDirectory = path.join(projectResource.baseFilePath, 'ignition', 'script-python', packageName);
			} else {
				packageDirectory = path.join(projectResource.baseFilePath, packageName);
			}

			try {
				await fs.promises.mkdir(packageDirectory);
				fileSystemService.ignitionFileSystemProvider.refreshTreeView();
			} catch (error: any) {
				vscode.window.showErrorMessage(`Failed to create script package: ${error.message}`);
			}
		}
	}));

	subscriptionManager.add(vscode.commands.registerCommand('ignition-flint.delete-script-module', async (resource: ScriptResource | FolderResource) => {
		const confirmDelete = await vscode.window.showWarningMessage(`Are you sure you want to delete "${resource.label}"?`, { modal: true }, 'Delete');

		if (confirmDelete === 'Delete') {
			try {
				if (resource instanceof ScriptResource) {
					const folderPath = path.dirname(resource.resourceUri.fsPath);
					await fs.promises.rm(folderPath, { recursive: true, force: true });

					const parentResource = resource.parent;
					if (parentResource instanceof FolderResource) {
						parentResource.children = parentResource.children?.filter(child => child !== resource);
					}
				} else if (resource instanceof FolderResource) {
					await fs.promises.rm(resource.resourceUri.fsPath, { recursive: true, force: true });

					const parentResource = resource.parent;
					if (parentResource instanceof FolderResource) {
						parentResource.children = parentResource.children?.filter(child => child !== resource);
					}
				}

				fileSystemService.ignitionFileSystemProvider.refresh();
			} catch (error: any) {
				vscode.window.showErrorMessage(`Failed to delete script module: ${error.message}`);
			}
		}
	}));

	subscriptionManager.add(vscode.commands.registerCommand('ignition-flint.rename-resource', async (resource: ScriptResource | FolderResource) => {
		if (resource instanceof ScriptResource || resource instanceof FolderResource) {
			let oldPath = resource.resourceUri.fsPath;
			let oldName;

			if (resource instanceof ScriptResource) {
				oldName = path.basename(path.dirname(oldPath));
				oldPath = path.dirname(oldPath);
			} else if (resource instanceof FolderResource) {
				oldName = path.basename(oldPath);
			}

			const newName = await vscode.window.showInputBox({
				prompt: `Enter the new name for "${oldName}":`,
				value: oldName,
			});

			if (newName && newName !== oldName) {
				const newPath = path.join(path.dirname(oldPath), newName);

				try {
					await fs.promises.rename(oldPath, newPath);
					fileSystemService.ignitionFileSystemProvider.refreshTreeView();

					if (resource instanceof ScriptResource) {
						const newCodePyPath = path.join(newPath, 'code.py');
						const newCodePyUri = vscode.Uri.file(newCodePyPath);
						vscode.window.showTextDocument(newCodePyUri);
					}
				} catch (error: any) {
					vscode.window.showErrorMessage(`Failed to rename resource: ${error.message}`);
				}
			}
		}
	}));
}