import * as vscode from 'vscode';
import { IgnitionProjectResource } from './projectResource';
import { AbstractResourceContainer } from './abstractResourceContainer';
import { AbstractContentElement } from './abstractContentElement';
import { TreeViewItem } from '../interfaces/treeViewItem';

export abstract class IgnitionFileResource extends vscode.TreeItem implements TreeViewItem {
    disposables: vscode.Disposable[] = [];
	baseFilePath: string;

    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        public readonly parentResource: AbstractResourceContainer | undefined,
        public readonly command?: vscode.Command,
        public children?: IgnitionFileResource[] | AbstractContentElement[]
    ) {
        super(label, collapsibleState);
        this.command = command;
		this.baseFilePath = resourceUri.fsPath;
    }
	
	getTreeItem(): vscode.TreeItem {
		throw new Error('Method not implemented.');
	}

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}
