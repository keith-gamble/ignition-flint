import * as vscode from 'vscode';
import { IgnitionFileResource } from './ignitionFileResource';
import { IgnitionProjectResource } from './projectResource';

export class FolderResource extends IgnitionFileResource {
    baseFilePath: string;

    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        parent: IgnitionFileResource | IgnitionProjectResource,
        children?: IgnitionFileResource[]
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.Collapsed, parent);
        this.children = children || [];
        this.contextValue = 'folderObject';
        this.baseFilePath = resourceUri.fsPath;
    }
}
