import * as vscode from 'vscode';
import { IgnitionFileResource } from './ignitionFileResource';
import { IgnitionProjectResource } from './projectResource';

export abstract class ScriptElement extends IgnitionFileResource {
    constructor(
        label: string,
        resourceUri: vscode.Uri,
        collapsibleState: vscode.TreeItemCollapsibleState,
        command: vscode.Command,
        parent: IgnitionFileResource | IgnitionProjectResource
    ) {
        super(label, resourceUri, collapsibleState, parent, command);
        this.contextValue = 'scriptElementObject';
    }

    getFullyQualifiedPath(): string {
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
        qualifiedName += `${this.label}`;

        return qualifiedName;
    }
}

export class ClassResource extends ScriptElement {
    constructor(
        label: string,
        resourceUri: vscode.Uri,
        lineNumber: number,
        parent: IgnitionFileResource
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.None, {
            command: 'vscode.open',
            title: "Open Class",
            arguments: [resourceUri, { selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0) }]
        }, parent);
        this.iconPath = new vscode.ThemeIcon('symbol-class');
    }
}

export class FunctionResource extends ScriptElement {
    constructor(
        label: string,
        resourceUri: vscode.Uri,
        lineNumber: number,
        parent: IgnitionFileResource
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.None, {
            command: 'vscode.open',
            title: "Open Function",
            arguments: [resourceUri, { selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0) }]
        }, parent);
        this.iconPath = new vscode.ThemeIcon('symbol-method');
    }
}

export class ConstantResource extends ScriptElement {
    constructor(
        label: string,
        resourceUri: vscode.Uri,
        lineNumber: number,
        parent: IgnitionFileResource
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.None, {
            command: 'vscode.open',
            title: "Open Constant",
            arguments: [resourceUri, { selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0) }]
        }, parent);
        this.iconPath = new vscode.ThemeIcon('symbol-constant');
    }
}
