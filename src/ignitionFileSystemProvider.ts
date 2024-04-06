import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a single Ignition project within the workspace.
 */
class IgnitionProjectResource extends vscode.TreeItem {
    children?: IgnitionFileSystemResource[];

    constructor(
        public readonly title: string,
        public readonly projectPath: string,
        public collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
        children?: IgnitionFileSystemResource[]
    ) {
        super(title, collapsibleState);
        this.tooltip = `${this.title} - ${this.projectPath}`;
        this.children = children;
        this.iconPath = new vscode.ThemeIcon("project");
    }

    /**
     * Initialize filesystem watching on this project's directory to dynamically update the tree view
     * for changes within the project.
     */
    watchProjectFiles(onChange: () => void): vscode.Disposable {
        const pattern = new vscode.RelativePattern(this.projectPath, "**/*.{py,json}");
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidChange(onChange);
        watcher.onDidCreate(onChange);
        watcher.onDidDelete(onChange);

        // Watch for project.json specifically to handle new projects or significant changes.
        const projectJsonWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.projectPath, "project.json"));
        projectJsonWatcher.onDidChange(onChange);
        projectJsonWatcher.onDidCreate(onChange);
        projectJsonWatcher.onDidDelete(onChange);

        return { dispose: () => { watcher.dispose(); projectJsonWatcher.dispose(); }};
    }
}

/**
 * File System Resource for files and directories within Ignition projects.
 */
export abstract class IgnitionFileSystemResource extends vscode.TreeItem {
	children?: IgnitionFileSystemResource[];
	parent: IgnitionFileSystemResource | IgnitionProjectResource;

    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
		parent: IgnitionFileSystemResource | IgnitionProjectResource,
        public readonly command?: vscode.Command,
		children?: IgnitionFileSystemResource[],
    ) {
        super(label, collapsibleState);
        this.command = command;
		this.parent = parent;
    }
}

class ScriptResource extends IgnitionFileSystemResource {
	filePath: string;

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
		this.filePath = resourceUri.fsPath;
		this.parsePythonFile();
    }

	async parsePythonFile(): Promise<void> {
		try {
			const stats = await fs.promises.stat(this.filePath);
			if (!stats.isFile()) {
				console.error(`Expected a file, but the path is a directory: ${this.filePath}`);
				return; // Exit the function if it's not a file
			}
	
			const content = await fs.promises.readFile(this.filePath, 'utf-8');
			const lines = content.split(/\r?\n/);
			const resources: IgnitionFileSystemResource[] = [];
		
			// Regex patterns to identify classes, functions, and constants
			const classPattern = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/;
			const functionPattern = /^def\s+([A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\))/;
			const constantPattern = /^([A-Z_][A-Z0-9_]*)\s*=/;
		
			lines.forEach((line, index) => {
				let match;
				const lineNumber = index + 1; // Adjust for 0-based index

				if (match = classPattern.exec(line)) {
					resources.push(new ClassResource(match[1], vscode.Uri.file(this.filePath), lineNumber, this));
				} else if (match = functionPattern.exec(line)) {
					const functionNameWithParams = match[1].trim();
					resources.push(new FunctionResource(functionNameWithParams, vscode.Uri.file(this.filePath), lineNumber, this));
				} else if (match = constantPattern.exec(line)) {
					resources.push(new ConstantResource(match[1], vscode.Uri.file(this.filePath), lineNumber, this));
				}
			});

			this.children = resources;
		} catch (error) {
			console.error(`Error reading file ${this.filePath}:`, error);
		}
	}
}


class FolderResource extends IgnitionFileSystemResource {
    children: IgnitionFileSystemResource[];

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

abstract class ScriptObjectResource extends IgnitionFileSystemResource {
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
		// Convert the file system path to a workspace-relative path and normalize separators
		let relativePath = vscode.workspace.asRelativePath(this.resourceUri, false).replace(/\\/g, '/');
	
		// Find the index of 'script-python' in the path and adjust to get the substring starting immediately after
		const scriptPythonIndex = relativePath.indexOf('script-python/');
		if (scriptPythonIndex !== -1) {
			relativePath = relativePath.substring(scriptPythonIndex + 'script-python/'.length);
		}
	
		// Now, 'relativePath' should be the path from 'script-python' onward without the filename
		// Split the remaining path and join with '.' to form the namespace, excluding the file name (usually 'code.py')
		let pathSections = relativePath.split('/');
		pathSections = pathSections.slice(0, -1); // Remove the last segment ('code.py')
	
		let qualifiedName = pathSections.join('.'); // Join remaining sections with '.'
		if (qualifiedName.length > 0) {
			qualifiedName += '.'; // Add a dot only if there are preceding sections
		}
		qualifiedName += `${this.label}`; // Append the label with its parameters included
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
            arguments: [resourceUri, { selection: new vscode.Range(lineNumber, 0, lineNumber, 0) }]},
			parent);
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
            title: "Open Class",
            arguments: [resourceUri, { selection: new vscode.Range(lineNumber, 0, lineNumber, 0) }]},
			parent);
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
            title: "Open Class",
            arguments: [resourceUri, { selection: new vscode.Range(lineNumber, 0, lineNumber, 0) }]},
			parent);
        this.iconPath = new vscode.ThemeIcon('symbol-variable');
    }
}


/**
 * Tree Data Provider Implementation for Ignition projects.
 */
export class IgnitionFileSystemProvider implements vscode.TreeDataProvider<IgnitionFileSystemResource | IgnitionProjectResource> {
    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;
    private treeRoot: IgnitionProjectResource[] = [];
	private treeView: vscode.TreeView<IgnitionFileSystemResource | IgnitionProjectResource> | undefined;

    constructor(private workspaceRoot: string | undefined) {
        this.discoverProjectsAndWatch();
    }

	/**
     * Refresh the tree view.
     */
	refresh(data?: any): void {
		this._onDidChangeTreeData.fire(data);
	}

	setTreeView(treeView: vscode.TreeView<IgnitionFileSystemResource | IgnitionProjectResource>) {
		this.treeView = treeView;
	}

	public getParent(element: IgnitionFileSystemResource | IgnitionProjectResource): vscode.ProviderResult<IgnitionFileSystemResource | IgnitionProjectResource> {
        if (element instanceof IgnitionProjectResource) {
            // Projects are at the root, so they have no parent
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
			return this.treeRoot; // Return projects at the root
		} else if (element instanceof IgnitionProjectResource || element instanceof FolderResource) {
			// Handle Project and Folder resources, which may have children
			return element.children || [];
		} else if (element instanceof ScriptResource) {
			// Additionally handle ScriptResource objects that have children
			return element.children || [];
		} else {
			// This case handles any other IgnitionFileSystemResource instances that might not have children
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
			// Check if the 'ignition/script-python' directory exists within the project
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
	

    /**
     * Discovers Ignition projects within the workspace and initializes watching on them.
     */
    private async discoverProjectsAndWatch(): Promise<void> {
		if (!this.workspaceRoot) return;
	
		const projects = await this.getIgnitionProjects(this.workspaceRoot);
		for (const project of projects) {
			const projectResource = new IgnitionProjectResource(project.title, project.path);
			this.treeRoot.push(projectResource);
	
			// Immediately start watching the project's files
			projectResource.watchProjectFiles(() => this.refresh());
	
			// Now, populate each project with its script structure
			const scriptsPath = path.join(project.path, 'ignition/script-python');
			const children = await this.processDirectory(scriptsPath, projectResource);
			projectResource.children = children; // Assuming children is IgnitionFileSystemResource[]
		}
	
		// Initial refresh to display projects and their scripts
		this.refresh();
	}

	private async processDirectory(directoryPath: string, parentResource: IgnitionFileSystemResource | IgnitionProjectResource): Promise<IgnitionFileSystemResource[]> {
		let resources: IgnitionFileSystemResource[] = [];
		const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
	
		for (const entry of entries) {
			const fullPath = path.join(directoryPath, entry.name);
			if (entry.isDirectory()) {
				// Distinguish between script directories and regular directories
				if (await this.isDirectoryScriptResource(fullPath)) {
					// Construct the path to code.py since this directory qualifies as a ScriptResource
					const codePyPath = path.join(fullPath, 'code.py');
					const scriptCommand: vscode.Command = {
						command: 'vscode.open',
						title: 'Open Script',
						arguments: [vscode.Uri.file(codePyPath)],
					};
					// Create the ScriptResource with the path to code.py
					const scriptResource = new ScriptResource(entry.name, vscode.Uri.file(codePyPath), scriptCommand, parentResource);
					resources.push(scriptResource);
				} else {
					// It's a regular directory, process its contents as FolderResource
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
			// The item directly matches the resourceUri
			if ('resourceUri' in item && item.resourceUri && item.resourceUri.fsPath === resourceUri.fsPath) {
				return item;
			}
			// Dive into children if they exist
			if ('children' in item && item.children && item.children.length > 0) {
				const foundInChildren = await this.findMatchingTreeItemForResourceUri(resourceUri, item.children);
				if (foundInChildren) {
					return foundInChildren;
				}
			}
		}
		return undefined; // No matching item found
	}
}