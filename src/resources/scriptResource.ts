import * as vscode from 'vscode';
import * as fs from 'fs';
import { IgnitionFileResource } from './ignitionFileResource';
import { IgnitionProjectResource } from './projectResource';
import { ClassResource, FunctionResource, ConstantResource } from './scriptElements';

export class ScriptResource extends IgnitionFileResource {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly command: vscode.Command,
        parent: IgnitionFileResource | IgnitionProjectResource,
        children?: IgnitionFileResource[]
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.Collapsed, parent, command);
        this.children = children;
        this.iconPath = new vscode.ThemeIcon('file-code');
        this.parsePythonFile();
        this.setupFileWatcher();
        this.contextValue = 'scriptObject';
    }

    async parsePythonFile(): Promise<void> {
		try {
			const content = await fs.promises.readFile(this.resourceUri.fsPath, 'utf-8');
			const lines = content.split(/\r?\n/);
			const resources: IgnitionFileResource[] = [];
			const classPattern = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\(.*\)\s*)?:/i;
			const functionPattern = /^def\s+([A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\))/;
			const constantPattern = /^([A-Z_][A-Z0-9_]*)\s*=/;
	
			lines.forEach((line, index) => {
				let match;
				const lineNumber = index + 1;
	
				if (match = classPattern.exec(line)) {
					resources.push(new ClassResource(match[1], this.resourceUri, lineNumber, this));
				} else if (match = functionPattern.exec(line)) {
					const functionNameWithParams = match[1].trim();
					resources.push(new FunctionResource(functionNameWithParams, this.resourceUri, lineNumber, this));
				} else if (match = constantPattern.exec(line)) {
					resources.push(new ConstantResource(match[1], this.resourceUri, lineNumber, this));
				}
			});
	
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
}