import * as vscode from 'vscode';
import { TreeViewItem } from '../interfaces/treeViewItem';
import { IgnitionFileResource } from './ignitionFileResource';

export abstract class AbstractContentElement extends vscode.TreeItem  implements TreeViewItem {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly command?: vscode.Command,
		public readonly parentResource?: IgnitionFileResource,
		public contextValue?: string
    ) {
		super(label);
	}

    getTreeItem(): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(this.label);
        treeItem.command = this.command;
        treeItem.resourceUri = this.resourceUri;
        return treeItem;
    }
	
}
