import * as vscode from 'vscode';
import * as fs from 'fs';
import { AbstractResourceContainer } from './abstractResourceContainer';
import { AbstractContentElement } from './abstractContentElement';
import { TreeViewItem } from '../interfaces/treeViewItem';
import { IgnitionFileResource } from './ignitionFileResource';
import { ClassElement, ConstantElement, FunctionElement, MethodElement } from './scriptElements';
import { IgnitionProjectResource } from './projectResource';

const BASE_FILE_ICON = new vscode.ThemeIcon('file-code');

export class ScriptResource extends IgnitionFileResource implements TreeViewItem {
	public scriptElements: AbstractContentElement[] = [];
	public qualifiedScriptFilePath: string;
	public qualifiedScriptPath: string;
	public visibleProject: IgnitionProjectResource;
	public contextValue: string = 'scriptObject';

	constructor(
		public readonly label: string,
		public readonly resourceUri: vscode.Uri,
		public readonly command: vscode.Command,
		parentResource: AbstractResourceContainer,
		children?: AbstractContentElement[],
		public isInherited: boolean = false,
		public isOverridden: boolean = false
	) {
		super(label, resourceUri, vscode.TreeItemCollapsibleState.Collapsed, parentResource, command, children, isInherited);
		this.isOverridden = isOverridden;
		this.children = children;
		this.iconPath = BASE_FILE_ICON
		this.parsePythonFile();
		this.setupFileWatcher();
		this.qualifiedScriptFilePath = this.getqualifiedScriptFilePath();
		this.qualifiedScriptPath = this.getFullyQualifiedPath();
		this.visibleProject = this.getParentProject();

		if (this.isInherited) {
			this.iconPath = new vscode.ThemeIcon('file-symlink-file');
		} else if (this.isOverridden) {
			this.iconPath = BASE_FILE_ICON;
		}
	}


	// Method to add a script element
	addScriptElement(element: AbstractContentElement): void {
		this.scriptElements.push(element);
	}

	// Override getTreeItem to handle script elements
	getTreeItem(): vscode.TreeItem {
		const treeItem = super.getTreeItem(); // Assuming super.getTreeItem exists and returns a vscode.TreeItem
		treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed; // Or dynamically determine based on scriptElements
		return treeItem;
	}

	async parsePythonFile(): Promise<void> {
		try {
			const content = await fs.promises.readFile(this.resourceUri.fsPath, 'utf-8');
			const lines = content.split(/\r?\n/);
			const resources: (AbstractContentElement)[] = [];
			const classPattern = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\(.*\)\s*)?:/i;
			const functionPattern = /^def\s+([A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\))/;
			const constantPattern = /^([A-Z_][A-Z0-9_]*)\s*=/;
			const methodPattern = /^\s+def\s+([A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\))/;
			// const propertyPattern = /^(?!def\s)(?:\s+)([A-Za-z_][A-Za-z0-9_]*)\s*=/;

			let currentClass: ClassElement | null = null;
			let currentFunction: FunctionElement | null = null;

			lines.forEach((line, index) => {
				let match;
				const lineNumber = index + 1;

				if (match = classPattern.exec(line)) {
					const classElement = new ClassElement(match[1], this.resourceUri, lineNumber, this);
					classElement.lineNumber = lineNumber;
					resources.push(classElement);
					currentClass = classElement;
					currentFunction = null;
				} else if (match = functionPattern.exec(line)) {
					const functionNameWithParams = match[1].trim();
					const functionElement = new FunctionElement(functionNameWithParams, this.resourceUri, lineNumber, this);
					functionElement.lineNumber = lineNumber;
					resources.push(functionElement);
					currentFunction = functionElement;
				} else if (match = constantPattern.exec(line)) {
					const constantElement = new ConstantElement(match[1], this.resourceUri, lineNumber, this);
					constantElement.lineNumber = lineNumber;
					resources.push(constantElement);
				} else if (currentClass && (match = methodPattern.exec(line))) {
					const methodNameWithParams = match[1].trim();
					const methodElement = new MethodElement(methodNameWithParams, this.resourceUri, lineNumber, currentClass);
					methodElement.lineNumber = lineNumber;
					currentClass.children.push(methodElement);

					if (methodElement.label.startsWith('__init__')) {
						currentClass.setInitMethod(methodElement);
					}

					currentFunction = null;
				}
			});

			// Sort script elements alphabetically if setting is enabled
			const sortAlphabetically = vscode.workspace.getConfiguration('ignitionFlint').get('sortProjectScripts', false);
			if (sortAlphabetically) {
				resources.sort((a, b) => a.label.localeCompare(b.label));

				// Also sort methods within classes
				resources.forEach(element => {
					if (element instanceof ClassElement && element.children) {
						element.children.sort((a, b) => a.label.localeCompare(b.label));
					}
				});
			}

			this.scriptElements = resources;
			this.children = resources;
		} catch (error) {
			console.error(`Error reading file ${this.resourceUri.fsPath}:`, error);
		}
	}

	setupFileWatcher(): void {
		const fileWatcher = vscode.workspace.createFileSystemWatcher(this.resourceUri.fsPath);
		this.disposables.push(
			fileWatcher.onDidChange(() => this.parsePythonFile()),
			fileWatcher.onDidDelete(() => this.dispose())
		);
	}

	private getqualifiedScriptFilePath(): string {
		let relativePath = vscode.workspace.asRelativePath(this.resourceUri, false).replace(/\\/g, '/');
		const scriptPythonIndex = relativePath.indexOf('script-python/');
		if (scriptPythonIndex !== -1) {
			relativePath = relativePath.substring(scriptPythonIndex + 'script-python/'.length);
		}

		const referencePath = relativePath.split('/').slice(0, -1).join('/'); // Remove the 'code.py' part
		return referencePath;
	}


	public getFullyQualifiedPath(): string {
		return this.qualifiedScriptFilePath.replace(/\//g, '.');
	}
}