import * as vscode from 'vscode';
import { IgnitionProjectResource } from './projectResource';

export abstract class IgnitionFileResource extends vscode.TreeItem {
    disposables: vscode.Disposable[] = [];
	baseFilePath: string;

    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        public readonly parent: IgnitionFileResource | IgnitionProjectResource,
        public readonly command?: vscode.Command,
        public children?: IgnitionFileResource[],
		public parentResource?: IgnitionFileResource | IgnitionProjectResource
    ) {
        super(label, collapsibleState);
        this.command = command;
		this.baseFilePath = resourceUri.fsPath;
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}
