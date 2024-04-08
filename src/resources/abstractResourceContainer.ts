import * as vscode from 'vscode';
import { IgnitionFileResource } from './ignitionFileResource';
import { AbstractContentElement } from './abstractContentElement';

export abstract class AbstractResourceContainer extends IgnitionFileResource {
	public children: IgnitionFileResource[] | AbstractContentElement[] = [];

	constructor(
		public readonly label: string,
		public readonly resourceUri: vscode.Uri,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly parentResource: AbstractResourceContainer | undefined,
		public readonly command?: vscode.Command,
		public isInherited: boolean = false
	) {
		super(label, resourceUri, collapsibleState, parentResource, command);
		this.isInherited = isInherited;
	}
}