import * as vscode from 'vscode';
import { IgnitionFileResource } from './ignitionFileResource';
import { AbstractContentElement } from './abstractContentElement';

export abstract class ScriptElement extends AbstractContentElement {
	public iconPath: vscode.ThemeIcon = new vscode.ThemeIcon('symbol-namespace');
	public lineNumber: number | undefined = undefined;

    constructor(
        label: string,
        resourceUri: vscode.Uri,
        command: vscode.Command,
        parent: IgnitionFileResource
    ) {
		super(label, resourceUri, command, parent);
        this.contextValue = 'scriptElementObject';
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
        this.iconPath = new vscode.ThemeIcon('symbol-method');
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
