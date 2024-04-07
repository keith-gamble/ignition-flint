import * as vscode from 'vscode';
import * as fs from 'fs';
import { AbstractResourceContainer } from './abstractResourceContainer';
import { AbstractContentElement } from './abstractContentElement';
import { TreeViewItem } from '../interfaces/treeViewItem';
import { IgnitionFileResource } from './ignitionFileResource';
import { ClassElement, ConstantElement, FunctionElement } from './scriptElements';

export class ScriptResource extends IgnitionFileResource implements TreeViewItem {
    public scriptElements: AbstractContentElement[] = [];
	public qualifiedScriptPath: string;

    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly command: vscode.Command,
        parentResource: AbstractResourceContainer,
        children?: AbstractContentElement[]
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.Collapsed, parentResource, command);
        this.children = children;
        this.iconPath = new vscode.ThemeIcon('file-code');
        this.parsePythonFile();
        this.setupFileWatcher();
        this.contextValue = 'scriptObject';
		this.qualifiedScriptPath = this.getQualifiedScriptPath();
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

            lines.forEach((line, index) => {
                let match;
                const lineNumber = index + 1;

                if (match = classPattern.exec(line)) {
                    resources.push(new ClassElement(match[1], this.resourceUri, lineNumber, this));
                } else if (match = functionPattern.exec(line)) {
                    const functionNameWithParams = match[1].trim();
                    resources.push(new FunctionElement(functionNameWithParams, this.resourceUri, lineNumber, this));
                } else if (match = constantPattern.exec(line)) {
                    resources.push(new ConstantElement(match[1], this.resourceUri, lineNumber, this));
                }
            });

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

	private getQualifiedScriptPath(): string {
		let relativePath = vscode.workspace.asRelativePath(this.resourceUri, false).replace(/\\/g, '/');
		const scriptPythonIndex = relativePath.indexOf('script-python/');
		if (scriptPythonIndex !== -1) {
			relativePath = relativePath.substring(scriptPythonIndex + 'script-python/'.length);
		}
	
		const referencePath = relativePath.split('/').slice(0, -1).join('/'); // Remove the 'code.py' part
		return referencePath;
	}
}