import * as vscode from 'vscode';
import { IgnitionFileResource } from './ignitionFileResource';
import { IgnitionProjectResource } from './projectResource';
import { AbstractResourceContainer } from './abstractResourceContainer';

export class FolderResource extends AbstractResourceContainer {
    baseFilePath: string;
	public children: IgnitionFileResource[] = [];

    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        parent: AbstractResourceContainer,
        children: IgnitionFileResource[] = [],
		public isInherited: boolean = false
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.Collapsed, parent, undefined, isInherited);
        this.children = children || [];
        this.contextValue = 'folderObject';
        this.baseFilePath = resourceUri.fsPath;

        if (this.isInherited) {
            this.iconPath = new vscode.ThemeIcon('file-symlink-directory');
        }
    }
}
