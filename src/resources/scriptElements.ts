import * as vscode from 'vscode';
import { IgnitionFileResource } from './ignitionFileResource';
import { AbstractContentElement } from './abstractContentElement';

export abstract class ScriptElement extends AbstractContentElement {
	public iconPath: vscode.ThemeIcon = new vscode.ThemeIcon('symbol-namespace');
	public lineNumber: number | undefined = undefined;
	public contextValue: string = 'scriptElementObject';
	public definition: string = '';
	public parameters: string = '';

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
		  qualifiedName += `${this.definition}`;
		} else {
		  qualifiedName += `${this.label}`;
		}
	
		return qualifiedName;
	  }
}

export class FunctionElement extends ScriptElement {
	constructor(
		definition: string,
		resourceUri: vscode.Uri,
		lineNumber: number,
		parent: IgnitionFileResource
	) {
		const functionName = definition.split('(')[0].trim();
		super(functionName, resourceUri, {
			command: 'vscode.open',
			title: "Open Function",
			arguments: [resourceUri, { selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0) }]
		}, parent);
		this.iconPath = new vscode.ThemeIcon('symbol-function');
		this.definition = definition;
		this.parameters = definition.split('(')[1].split(')')[0];
	}

	getFullyQualifiedPath(includeInitializationValues: boolean = true): string {
		return super.getFullyQualifiedPath(includeInitializationValues);
	}
}

export class MethodElement extends ScriptElement {
	constructor(
	  definition: string,
	  resourceUri: vscode.Uri,
	  lineNumber: number,
	  parent: ClassElement
	) {
	  const methodName = definition.split('(')[0].trim();
	  super(methodName, resourceUri, {
		command: 'vscode.open',
		title: "Open Method",
		arguments: [resourceUri, { selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0) }]
	  }, parent);
	  this.iconPath = new vscode.ThemeIcon('symbol-method');
	  this.definition = definition;
	  this.parameters = definition.split('(')[1].split(')')[0];
	}
  
	getFullyQualifiedPath(includeInitializationValues: boolean = false): string {
	  const parentClass = this.parentResource as ClassElement;
	  let qualifiedPath = `${parentClass.getFullyQualifiedPath(false)}.${this.label}`;
  
	  if (includeInitializationValues && this.parameters) {
		qualifiedPath += `(${this.parameters})`;
	  }
  
	  return qualifiedPath;
	}
  }

export class ClassElement extends ScriptElement {
	public children: AbstractContentElement[] = [];
	private initMethod: MethodElement | undefined;

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

	setInitMethod(initMethod: MethodElement): void {
		this.initMethod = initMethod;
	}

	getInitParameters(): string | undefined {
		let initParams = this.initMethod?.parameters;

		if (initParams?.startsWith('self,')) {
			initParams = initParams.substring(5);
		}
		return initParams?.trim();
	}

	getFullyQualifiedPath(includeInitializationValues: boolean = true): string {
		let qualifiedPath = super.getFullyQualifiedPath(false);
	
		if (includeInitializationValues) {
		  const initParameters = this.getInitParameters() || '';
		  qualifiedPath += `(${initParameters})`;
		}
	
		return qualifiedPath;
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