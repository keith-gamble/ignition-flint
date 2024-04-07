import * as vscode from 'vscode';
import * as path from 'path';
import { IgnitionFileResource } from './ignitionFileResource';
import { IgnitionFileSystemProvider } from '../providers/ignitionFileSystem';

export class IgnitionProjectResource extends vscode.TreeItem {
    disposables: vscode.Disposable[] = [];
    description: string;

    constructor(
        public readonly title: string,
        public readonly baseFilePath: string,
        public collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
        public children?: IgnitionFileResource[]
    ) {
        super(title, collapsibleState);
        this.tooltip = `${this.title} - ${this.baseFilePath}`;
        this.iconPath = new vscode.ThemeIcon("project");
        this.description = path.relative(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', this.baseFilePath);
        this.contextValue = 'projectObject';
    }

    watchProjectFiles(provider: IgnitionFileSystemProvider): vscode.Disposable {
		const filePattern = new vscode.RelativePattern(this.baseFilePath, "**/*.{py,json}");
		const projectJsonPattern = new vscode.RelativePattern(this.baseFilePath, "project.json");
		const directoryPattern = new vscode.RelativePattern(this.baseFilePath, "**");
	
		const fileWatcher = vscode.workspace.createFileSystemWatcher(filePattern);
		const projectJsonWatcher = vscode.workspace.createFileSystemWatcher(projectJsonPattern);
		const directoryWatcher = vscode.workspace.createFileSystemWatcher(directoryPattern, true, true, false);
	
		const watcherDisposables = [
			fileWatcher.onDidChange(() => provider.refreshTreeView()),
			fileWatcher.onDidCreate(() => provider.refreshTreeView()),
			fileWatcher.onDidDelete(() => provider.refreshTreeView()),
			projectJsonWatcher.onDidChange(() => provider.refreshTreeView()),
			projectJsonWatcher.onDidCreate(() => provider.refreshTreeView()),
			projectJsonWatcher.onDidDelete(() => provider.refreshTreeView()),
			directoryWatcher.onDidCreate(() => provider.refreshTreeView()),
			directoryWatcher.onDidDelete(() => provider.refreshTreeView())
		];
	
		return vscode.Disposable.from(...watcherDisposables);
	}

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}
