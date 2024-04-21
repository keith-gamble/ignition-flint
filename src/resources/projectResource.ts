import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IgnitionFileResource } from './ignitionFileResource';
import { IgnitionFileSystemProvider } from '../providers/ignitionFileSystem';
import { AbstractResourceContainer } from './abstractResourceContainer';

export class IgnitionProjectResource extends AbstractResourceContainer {
	public parentProject?: IgnitionProjectResource;
	public inheritedChildren: IgnitionFileResource[] = [];
	public contextValue: string = 'projectObject';

	disposables: vscode.Disposable[] = [];
	description: string;

	constructor(
        public projectId: string,
        public title: string,
        public parentProjectId: string,
        public baseFilePath: string,
        public collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
        public children: IgnitionFileResource[] = [],
        public projectIndex: number = 1
    ) {
        super(title, vscode.Uri.file(baseFilePath), collapsibleState, undefined);
        this.label = this.getUniqueProjectLabel();
        this.tooltip = `${this.title} - ${this.baseFilePath}`;
        this.iconPath = new vscode.ThemeIcon("project");
        this.description = path.relative(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', this.baseFilePath);
    }

    private getUniqueProjectLabel(): string {
        if (this.projectIndex > 1) {
            return `${this.title} ${this.projectIndex}`;
        }
        return this.title;
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

	async getScriptPaths(): Promise<string[]> {
		const scriptPaths: string[] = [];
		const scriptPythonDir = path.join(this.baseFilePath, 'ignition', 'script-python');

		const traverseDirectory = async (dir: string) => {
			const entries = await fs.promises.readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await traverseDirectory(fullPath);
				} else if (entry.isFile() && entry.name === 'code.py') {
					const relativePath = path.relative(scriptPythonDir, fullPath);
					scriptPaths.push(relativePath);
				}
			}
		};

		await traverseDirectory(scriptPythonDir);
		return scriptPaths;
	}


	dispose(): void {
		this.disposables.forEach(disposable => disposable.dispose());
	}
}
