import * as vscode from 'vscode';
import { Uri, FileSystemWatcher, ProviderResult, EventEmitter, FileChangeEvent, FileStat, FileType } from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

class IgnitionProjectResource extends vscode.TreeItem {
    constructor(
        public readonly title: string,
        public readonly projectPath: string,
        public collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
        public children?: IgnitionFileSystemResource[]
    ) {
        super(title, collapsibleState);
        this.tooltip = `${this.title} - ${this.projectPath}`;
        this.iconPath = new vscode.ThemeIcon("project");
    }

    watchProjectFiles(onChange: () => void): vscode.Disposable {
        const filePattern = new vscode.RelativePattern(this.projectPath, "**/*.{py,json}");
        const projectJsonPattern = new vscode.RelativePattern(this.projectPath, "project.json");

        const fileWatcher = vscode.workspace.createFileSystemWatcher(filePattern);
        const projectJsonWatcher = vscode.workspace.createFileSystemWatcher(projectJsonPattern);

        const watcherDisposables = [
            fileWatcher.onDidChange(onChange),
            fileWatcher.onDidCreate(onChange),
            fileWatcher.onDidDelete(onChange),
            projectJsonWatcher.onDidChange(onChange),
            projectJsonWatcher.onDidCreate(onChange),
            projectJsonWatcher.onDidDelete(onChange)
        ];

        return vscode.Disposable.from(...watcherDisposables);
    }
}

export abstract class IgnitionFileSystemResource extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        public readonly parent: IgnitionFileSystemResource | IgnitionProjectResource,
        public readonly command?: vscode.Command,
        public children?: IgnitionFileSystemResource[],
    ) {
        super(label, collapsibleState);
        this.command = command;
    }
}

class ScriptResource extends IgnitionFileSystemResource {
	private disposables: vscode.Disposable[] = [];

    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly command: vscode.Command,
        parent: IgnitionFileSystemResource | IgnitionProjectResource,
        children?: IgnitionFileSystemResource[]
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.Collapsed, parent, command);
        this.children = children;
        this.iconPath = new vscode.ThemeIcon('file-code');
        this.parsePythonFile();
        this.setupFileWatcher();
    }

    async parsePythonFile(): Promise<void> {
		try {
			const content = await fs.promises.readFile(this.resourceUri.fsPath, 'utf-8');
			const lines = content.split(/\r?\n/);
			const resources: IgnitionFileSystemResource[] = [];
			const classPattern = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\(.*\)\s*)?:/i;
			const functionPattern = /^def\s+([A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\))/;
			const constantPattern = /^([A-Z_][A-Z0-9_]*)\s*=/;
	
			lines.forEach((line, index) => {
				let match;
				const lineNumber = index + 1;
	
				if (match = classPattern.exec(line)) {
					resources.push(new ClassResource(match[1], this.resourceUri, lineNumber, this));
				} else if (match = functionPattern.exec(line)) {
					const functionNameWithParams = match[1].trim();
					resources.push(new FunctionResource(functionNameWithParams, this.resourceUri, lineNumber, this));
				} else if (match = constantPattern.exec(line)) {
					resources.push(new ConstantResource(match[1], this.resourceUri, lineNumber, this));
				}
			});
	
			this.children = resources;
		} catch (error) {
			console.error(`Error reading file ${this.resourceUri.fsPath}:`, error);
		}
	}
	
	setupFileWatcher(): void {
        const fileWatcher = vscode.workspace.createFileSystemWatcher(this.resourceUri.fsPath);
        this.disposables.push(
            fileWatcher.onDidChange(() => this.parsePythonFile()),
            fileWatcher.onDidDelete(() => this.dispose())
        );
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}

class FolderResource extends IgnitionFileSystemResource {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        parent: IgnitionFileSystemResource | IgnitionProjectResource,
        children?: IgnitionFileSystemResource[]
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.Collapsed, parent);
        this.children = children || [];
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

export abstract class ScriptObjectResource extends IgnitionFileSystemResource {
    constructor(
        label: string,
        resourceUri: vscode.Uri,
        collapsibleState: vscode.TreeItemCollapsibleState,
        command: vscode.Command,
        parent: IgnitionFileSystemResource | IgnitionProjectResource
    ) {
        super(label, resourceUri, collapsibleState, parent, command);
        this.contextValue = 'scriptObject';
    }

    getFullyQualifiedPath(): string {
        let relativePath = vscode.workspace.asRelativePath(this.resourceUri, false).replace(/\\/g, '/');
        const scriptPythonIndex = relativePath.indexOf('script-python/');
        if (scriptPythonIndex !== -1) {
            relativePath = relativePath.substring(scriptPythonIndex + 'script-python/'.length);
        }

        let pathSections = relativePath.split('/');
        pathSections = pathSections.slice(0, -1);

        let qualifiedName = pathSections.join('.');
        if (qualifiedName.length > 0) {
            qualifiedName += '.';
        }
        qualifiedName += `${this.label}`;

        return qualifiedName;
    }
}

export class ClassResource extends ScriptObjectResource {
    constructor(
        label: string,
        resourceUri: vscode.Uri,
        lineNumber: number,
        parent: IgnitionFileSystemResource
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.None, {
            command: 'vscode.open',
            title: "Open Class",
            arguments: [resourceUri, { selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0) }]
        }, parent);
        this.iconPath = new vscode.ThemeIcon('symbol-class');
    }
}

export class FunctionResource extends ScriptObjectResource {
    constructor(
        label: string,
        resourceUri: vscode.Uri,
        lineNumber: number,
        parent: IgnitionFileSystemResource
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.None, {
            command: 'vscode.open',
            title: "Open Function",
            arguments: [resourceUri, { selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0) }]
        }, parent);
        this.iconPath = new vscode.ThemeIcon('symbol-method');
    }
}

export class ConstantResource extends ScriptObjectResource {
    constructor(
        label: string,
        resourceUri: vscode.Uri,
        lineNumber: number,
        parent: IgnitionFileSystemResource
    ) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.None, {
            command: 'vscode.open',
            title: "Open Constant",
            arguments: [resourceUri, { selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0) }]
        }, parent);
        this.iconPath = new vscode.ThemeIcon('symbol-constant');
    }
}

export class IgnitionFileSystemProvider implements vscode.TreeDataProvider<IgnitionFileSystemResource | IgnitionProjectResource> {
    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;
    private treeRoot: IgnitionProjectResource[] = [];
    private treeView: vscode.TreeView<IgnitionFileSystemResource | IgnitionProjectResource> | undefined;

    constructor(private workspaceRoot: string | undefined) {
        this.discoverProjectsAndWatch();
    }

    refresh(data?: any): void {
		console.log('refreshing tree data');
        this._onDidChangeTreeData.fire(data);
    }

    setTreeView(treeView: vscode.TreeView<IgnitionFileSystemResource | IgnitionProjectResource>) {
        this.treeView = treeView;
    }

    getParent(element: IgnitionFileSystemResource | IgnitionProjectResource): vscode.ProviderResult<IgnitionFileSystemResource | IgnitionProjectResource> {
        if (element instanceof IgnitionProjectResource) {
            return null;
        } else {
            return element.parent;
        }
    }

    getTreeItem(element: IgnitionFileSystemResource | IgnitionProjectResource): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: IgnitionFileSystemResource | IgnitionProjectResource): Promise<IgnitionFileSystemResource[] | IgnitionProjectResource[]> {
        if (!element) {
            return this.treeRoot;
        } else if (element instanceof IgnitionProjectResource || element instanceof FolderResource || element instanceof ScriptResource) {
            return element.children || [];
        } else {
            return [];
        }
    }

    private async getIgnitionProjects(workspaceRoot: string): Promise<{ title: string, path: string, relativePath: string }[]> {
        const projects: { title: string, path: string, relativePath: string }[] = [];
        const files = await vscode.workspace.findFiles('**/project.json');

        for (const file of files) {
            const projectJsonPath = file.fsPath;
            const projectDir = path.dirname(projectJsonPath);
            const scriptPythonPath = path.join(projectDir, 'ignition', 'script-python');

            if (fs.existsSync(scriptPythonPath)) {
                const relativePath = path.relative(workspaceRoot, projectDir);
                const projectJson = JSON.parse(await fs.promises.readFile(projectJsonPath, 'utf-8'));
                if (projectJson.title) {
                    projects.push({ title: projectJson.title, path: projectDir, relativePath });
                }
            }
        }

        return projects;
    }

    private async discoverProjectsAndWatch(): Promise<void> {
        if (!this.workspaceRoot) return;

        const projects = await this.getIgnitionProjects(this.workspaceRoot);
        for (const project of projects) {
            const projectResource = new IgnitionProjectResource(project.title, project.path);
            this.treeRoot.push(projectResource);

            projectResource.watchProjectFiles(() => this.refresh());

            const scriptsPath = path.join(project.path, 'ignition/script-python');
            const children = await this.processDirectory(scriptsPath, projectResource);
            projectResource.children = children;
        }

        this.refresh();
    }

    private async processDirectory(directoryPath: string, parentResource: IgnitionFileSystemResource | IgnitionProjectResource): Promise<IgnitionFileSystemResource[]> {
        let resources: IgnitionFileSystemResource[] = [];
        const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(directoryPath, entry.name);
            if (entry.isDirectory()) {
                if (await this.isDirectoryScriptResource(fullPath)) {
                    const codePyPath = path.join(fullPath, 'code.py');
                    const scriptResource = new ScriptResource(entry.name, vscode.Uri.file(codePyPath), {
                        command: 'vscode.open',
                        title: 'Open Script',
                        arguments: [vscode.Uri.file(codePyPath)],
                    }, parentResource);
                    resources.push(scriptResource);
                } else {
                    const folderResource = new FolderResource(entry.name, vscode.Uri.file(fullPath), parentResource);
                    folderResource.children = await this.processDirectory(fullPath, folderResource);
                    resources.push(folderResource);
                }
            }
        }

        return resources;
    }

    private async isDirectoryScriptResource(directoryPath: string): Promise<boolean> {
        const requiredFiles = ['code.py', 'resource.json'];
        const files = await fs.promises.readdir(directoryPath);
        return requiredFiles.every(file => files.includes(file));
    }

    async revealTreeItemForResourceUri(resourceUri: vscode.Uri) {
        const matchingItem = await this.findMatchingTreeItemForResourceUri(resourceUri, this.treeRoot);
        if (matchingItem) {
            (this.treeView?.reveal(matchingItem, { select: true, focus: true, expand: 3 }) as Promise<void>)
                .catch(err => console.error("Failed to reveal item:", err));
        }
    }

    private async findMatchingTreeItemForResourceUri(resourceUri: vscode.Uri, items: IgnitionFileSystemResource[] | IgnitionProjectResource[]): Promise<IgnitionFileSystemResource | IgnitionProjectResource | undefined> {
        for (const item of items) {
            if ('resourceUri' in item && item.resourceUri && item.resourceUri.fsPath === resourceUri.fsPath) {
                return item;
            }
            if ('children' in item && item.children && item.children.length > 0) {
                const foundInChildren = await this.findMatchingTreeItemForResourceUri(resourceUri, item.children);
                if (foundInChildren) {
                    return foundInChildren;
                }
            }
        }
        return undefined;
    }

	private async getParentResourceForUri(uri: Uri): Promise<IgnitionFileSystemResource | IgnitionProjectResource | undefined> {
		const relativePath = vscode.workspace.asRelativePath(uri, false);
		const pathSegments = relativePath.split('/');
	
		let parentResource: IgnitionFileSystemResource | IgnitionProjectResource | undefined = undefined;
		for (let i = 1; i < pathSegments.length; i++) {
			const parentPath = pathSegments.slice(0, i).join('/');
			const parentUri = vscode.Uri.file(path.join(this.workspaceRoot || '', parentPath));
			parentResource = await this.findMatchingTreeItemForResourceUri(parentUri, this.treeRoot);
			if (parentResource) {
				break;
			}
		}
	
		return parentResource;
	}

	private async createScriptResourceForFile(uri: Uri, parentResource: IgnitionFileSystemResource | IgnitionProjectResource): Promise<ScriptResource> {
		const codePyPath = path.join(uri.fsPath, 'code.py');
		const scriptResource = new ScriptResource(path.basename(uri.fsPath), vscode.Uri.file(codePyPath), {
			command: 'vscode.open',
			title: 'Open Script',
			arguments: [vscode.Uri.file(codePyPath)],
		}, parentResource);
	
		return scriptResource;
	}

	async handleFileCreation(event: vscode.FileCreateEvent): Promise<void> {
		for (const uri of event.files) {
			if (uri.fsPath.includes('script-python')) {
				const parentResource = await this.getParentResourceForUri(uri);
				if (parentResource) {
					const isDirectory = (await vscode.workspace.fs.stat(uri)).type === FileType.Directory;
					if (isDirectory) {
						if (await this.isDirectoryScriptResource(uri.fsPath)) {
							const codePyPath = path.join(uri.fsPath, 'code.py');
							const newResource = new ScriptResource(path.basename(uri.fsPath), vscode.Uri.file(codePyPath), {
								command: 'vscode.open',
								title: 'Open Script',
								arguments: [vscode.Uri.file(codePyPath)],
							}, parentResource);
	
							if (parentResource instanceof FolderResource || parentResource instanceof ScriptResource) {
								parentResource.children?.push(newResource);
							} else if (parentResource instanceof IgnitionProjectResource) {
								parentResource.children?.push(newResource);
							}
						} else {
							const newResource = new FolderResource(path.basename(uri.fsPath), uri, parentResource);
							if (parentResource instanceof FolderResource || parentResource instanceof ScriptResource) {
								parentResource.children?.push(newResource);
							} else if (parentResource instanceof IgnitionProjectResource) {
								parentResource.children?.push(newResource);
							}
						}
					} else {
						// It would not hurt to confirm that the parent directory of the file is a script resource directory
						const scriptResource = await this.createScriptResourceForFile(uri, parentResource);
						if (parentResource instanceof FolderResource || parentResource instanceof ScriptResource) {
							parentResource.children?.push(scriptResource);
						} else if (parentResource instanceof IgnitionProjectResource) {
							parentResource.children?.push(scriptResource);
						}
					}
	
					this.refresh(parentResource);
				}
			}
		}
	}

	async handleFileDeletion(event: vscode.FileDeleteEvent): Promise<void> {
		for (const uri of event.files) {
			if (uri.fsPath.includes('script-python')) {
				const resourceToRemove = await this.findMatchingTreeItemForResourceUri(uri, this.treeRoot);
				if (resourceToRemove) {
					if (resourceToRemove instanceof IgnitionFileSystemResource) {
						const parentResource = resourceToRemove.parent;
						if (parentResource instanceof FolderResource || parentResource instanceof ScriptResource) {
							const updatedChildren = parentResource.children?.filter(child => child !== resourceToRemove);
							parentResource.children = updatedChildren;
						} else if (parentResource instanceof IgnitionProjectResource) {
							const updatedChildren = parentResource.children?.filter(child => child !== resourceToRemove);
							parentResource.children = updatedChildren;
						}
						this.refresh(parentResource);
					}
				}
			}
		}
	}
}