import * as vscode from 'vscode';
import { IgnitionFileResource } from './ignitionFileResource';
import { AbstractResourceContainer } from './abstractResourceContainer';
import { IgnitionProjectResource } from './projectResource';

export class FolderResource extends AbstractResourceContainer {
    baseFilePath: string;
    public children: IgnitionFileResource[] = [];
	public visibleProject: IgnitionProjectResource;
	public contextValue: string = 'folderObject';
	
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        parent: AbstractResourceContainer,
        children: IgnitionFileResource[] = [],
        public isInherited: boolean = false
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.Collapsed, parent, undefined, isInherited);
        this.children = children || [];
        this.baseFilePath = resourceUri.fsPath;
		this.visibleProject = this.getParentProject();

        if (this.isInherited) {
            this.iconPath = new vscode.ThemeIcon('file-symlink-directory');
        }
    }
}