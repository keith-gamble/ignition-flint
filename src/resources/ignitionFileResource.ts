import * as vscode from 'vscode';
import { IgnitionProjectResource } from './projectResource';
import { AbstractResourceContainer } from './abstractResourceContainer';
import { AbstractContentElement } from './abstractContentElement';
import { TreeViewItem } from '../interfaces/treeViewItem';

export abstract class IgnitionFileResource extends vscode.TreeItem implements TreeViewItem {
    disposables: vscode.Disposable[] = [];
	baseFilePath: string;
	public isOverridden: boolean = false;

    constructor(
        public label: string,
        public readonly resourceUri: vscode.Uri,
        public collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        public readonly parentResource: AbstractResourceContainer | undefined,
        public readonly command?: vscode.Command,
        public children?: IgnitionFileResource[] | AbstractContentElement[],
		public isInherited: boolean = false
    ) {
        super(label, collapsibleState);
        this.command = command;
        this.baseFilePath = resourceUri.fsPath;

        // Set the iconPath based on the isInherited property
        if (this.isInherited) {
            this.iconPath = new vscode.ThemeIcon('file-symlink-file');
        }
    }

	getParentProject(): IgnitionProjectResource {
		if (this instanceof IgnitionProjectResource) {
			return this;
		} else if (this.parentResource instanceof IgnitionProjectResource) {
			return this.parentResource;
		} else if (this.parentResource) {
			return this.parentResource.getParentProject();
		} else {
			throw new Error('Could not find parent project');
		}
	}

	getTreeItem(): vscode.TreeItem {
		return this;
	}

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}
