import * as vscode from 'vscode';
import { IgnitionFileResource } from './ignitionFileResource';
import { AbstractContentElement } from './abstractContentElement';

export abstract class ScriptElement extends AbstractContentElement {
	public iconPath: vscode.ThemeIcon = new vscode.ThemeIcon('symbol-namespace');
	public lineNumber: number | undefined = undefined;
	public contextValue: string = 'scriptElementObject';

	constructor(
		label: string,
		resourceUri: vscode.Uri,
		command: vscode.Command,
		parent: IgnitionFileResource | AbstractContentElement
	) {
		super(label, resourceUri, command, parent);
	}

	getFullyQualifiedPath(includeInitializationValues: boolean = false): string {
		let relativePath = vscode.workspace.asRelativePath(this.resourceUri, false).replace(/\\/g, '/');
		const scriptPythonIndex = relativePath.indexOf('script-python/');
		if (scriptPythonIndex !== -1) {
			relativePath = relativePath.substring(scriptPythonIndex + 'script-python/'.length);
		}

		let pathSections = relativePath.split('/');
		pathSections = pathSections.slice(0, -1);

		let qualifiedName = pathSections.join('.');
		if (qualifiedName.length > 0) {
			qualifiedName += '.';
		}

		if (includeInitializationValues) {
			qualifiedName += `${this.label}`;
		} else {
			qualifiedName += `${this.label.split('(')[0]}`;
		}

		return qualifiedName;
	}
}

export class ClassElement extends ScriptElement {
	public children: AbstractContentElement[] = [];

	constructor(
		label: string,
		resourceUri: vscode.Uri,
		lineNumber: number,
		parent: IgnitionFileResource
	) {
		super(label, resourceUri, {
			command: 'vscode.open',
			title: "Open Class",
			arguments: [resourceUri, { selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0) }]
		}, parent);
		this.iconPath = new vscode.ThemeIcon('symbol-class');
	}

	getTreeItem(): vscode.TreeItem {
		const treeItem = super.getTreeItem();
		treeItem.iconPath = new vscode.ThemeIcon('symbol-class');
		treeItem.collapsibleState = this.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
		return treeItem;
	}

	getFullyQualifiedPath(includeInitializationValues: boolean = false): string {
		let qualifiedPath = super.getFullyQualifiedPath(false);
		if (includeInitializationValues) {
			const initMethod = this.children.find(child => child instanceof MethodElement && child.label.startsWith('__init__')) as MethodElement | undefined;
			if (initMethod) {
				qualifiedPath = initMethod.getFullyQualifiedPath();
			}
		}
		return qualifiedPath;
	}
}

export class FunctionElement extends ScriptElement {
	constructor(
		label: string,
		resourceUri: vscode.Uri,
		lineNumber: number,
		parent: IgnitionFileResource
	) {
		super(label, resourceUri, {
			command: 'vscode.open',
			title: "Open Function",
			arguments: [resourceUri, { selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0) }]
		}, parent);
		this.iconPath = new vscode.ThemeIcon('symbol-function');
	}
}

export class ConstantElement extends ScriptElement {
	constructor(
		label: string,
		resourceUri: vscode.Uri,
		lineNumber: number,
		parent: IgnitionFileResource
	) {
		super(label, resourceUri, {
			command: 'vscode.open',
			title: "Open Constant",
			arguments: [resourceUri, { selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0) }]
		}, parent);
		this.iconPath = new vscode.ThemeIcon('symbol-constant');
	}
}

export class MethodElement extends ScriptElement {
	constructor(
		label: string,
		resourceUri: vscode.Uri,
		lineNumber: number,
		parent: ClassElement
	) {
		super(label, resourceUri, {
			command: 'vscode.open',
			title: "Open Method",
			arguments: [resourceUri, { selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0) }]
		}, parent);
		this.iconPath = new vscode.ThemeIcon('symbol-method');
	}

	getFullyQualifiedPath(): string {
		const parentClass = this.parentResource as ClassElement;
		const qualifiedPath = `${parentClass.getFullyQualifiedPath()}.${this.label}`;
	
		return qualifiedPath.replace('.__init__', '');
	}
}