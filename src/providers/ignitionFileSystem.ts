import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IgnitionProjectResource } from '../resources/projectResource';
import { IgnitionFileResource } from '../resources/ignitionFileResource';
import { ScriptResource } from '../resources/scriptResource';
import { FolderResource } from '../resources/folderResource';
import { debounce } from '../utils/debounce';

export class IgnitionFileSystemProvider implements vscode.TreeDataProvider<IgnitionFileResource | IgnitionProjectResource> {
	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;
	private _projects: { title: string, path: string, relativePath: string }[] = [];
	public treeRoot: IgnitionProjectResource[] = [];
	private treeView: vscode.TreeView<vscode.TreeItem> | undefined;
	private refreshTreeViewDebounced = debounce(this._refreshTreeView.bind(this), 500); // Debounce refreshTreeView by 500ms

	constructor(private workspaceRoot: string | undefined) {
		this.discoverProjectsAndWatch();
	}

	refresh(data?: any): void {
		this._onDidChangeTreeData.fire(data);
	  }

	public async refreshTreeView(): Promise<void> {
		return this.refreshTreeViewDebounced();
	}

	private async _refreshTreeView(): Promise<void> {
		// Clear the existing tree root
		this.treeRoot = [];

		console.log('Refreshing tree view');

		// Iterate over the existing projects and refresh each one
		const updatedProjects = new Map<string, IgnitionProjectResource>();

		for (const project of this._projects) {
			const existingProjectResource = this.treeRoot.find(p => p.baseFilePath === project.path);
			if (existingProjectResource) {
				// Reuse the existing project resource instance
				updatedProjects.set(project.path, existingProjectResource);
				existingProjectResource.children = [];

				existingProjectResource.watchProjectFiles(this);

				const scriptsPath = path.join(project.path, 'ignition/script-python');
				const children = await this.processDirectory(scriptsPath, existingProjectResource);
				existingProjectResource.children = children;
			} else {
				// Create a new project resource instance
				const projectResource = new IgnitionProjectResource(project.title, project.path);
				updatedProjects.set(project.path, projectResource);

				projectResource.watchProjectFiles(this);

				const scriptsPath = path.join(project.path, 'ignition/script-python');
				const children = await this.processDirectory(scriptsPath, projectResource);
				projectResource.children = children;
			}
		}

		// Dispose of any unused project resource instances
		for (const existingProject of this.treeRoot) {
			if (!updatedProjects.has(existingProject.baseFilePath)) {
				existingProject.dispose();
			}
		}

		// Update the treeRoot with the updated project instances
		this.treeRoot = Array.from(updatedProjects.values());

		// Trigger a refresh of the tree view
		this._onDidChangeTreeData.fire(undefined);
	}

	setTreeView(treeView: vscode.TreeView<vscode.TreeItem>) {
		this.treeView = treeView;
	}

	getParent(element: IgnitionFileResource | IgnitionProjectResource): vscode.ProviderResult<IgnitionFileResource | IgnitionProjectResource> {
		if (element instanceof IgnitionProjectResource) {
			return null;
		} else {
			return element.parent;
		}
	}

	getTreeItem(element: IgnitionFileResource | IgnitionProjectResource): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: IgnitionFileResource | IgnitionProjectResource): Promise<IgnitionFileResource[] | IgnitionProjectResource[]> {
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

		// Sort projects by their title
		projects.sort((a, b) => a.title.localeCompare(b.title));

		return projects;
	}

	/**
     * Find the Ignition project resource that the given file URI belongs to.
     * @param fileUri The URI of the file for which to find the containing project.
     * @returns The IgnitionProjectResource that contains the file, or undefined if not found.
     */
    public getCurrentProjectResource(fileUri: vscode.Uri): IgnitionProjectResource | undefined {
        // Convert the file URI to a file system path
        const filePath = fileUri.fsPath;

        // Look through all projects to see which one contains this file
        for (const project of this.treeRoot) {
            // Check if the file path starts with the project's base file path
            if (filePath.startsWith(project.baseFilePath)) {
                return project;
            }
        }

        // If no project was found that contains the file, return undefined
        return undefined;
    }

	private async discoverProjectsAndWatch(): Promise<void> {
		if (!this.workspaceRoot) return;

		const projects = await this.getIgnitionProjects(this.workspaceRoot);
		this._projects = projects;

		for (const project of projects) {
			const projectResource = new IgnitionProjectResource(project.title, project.path);
			this.treeRoot.push(projectResource);

			projectResource.watchProjectFiles(this);

			const scriptsPath = path.join(project.path, 'ignition/script-python');
			const children = await this.processDirectory(scriptsPath, projectResource);
			projectResource.children = children;
		}

		this.refresh();
	}

	private async processDirectory(directoryPath: string, parentResource: IgnitionFileResource | IgnitionProjectResource): Promise<IgnitionFileResource[]> {
		let resources: IgnitionFileResource[] = [];
		const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });

		const folderResources: IgnitionFileResource[] = [];
		const scriptResources: IgnitionFileResource[] = [];

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
					scriptResources.push(scriptResource);
				} else {
					const folderResource = new FolderResource(entry.name, vscode.Uri.file(fullPath), parentResource);
					folderResource.children = await this.processDirectory(fullPath, folderResource);
					folderResources.push(folderResource);
				}
			}
		}

		resources = [...folderResources, ...scriptResources];

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

	private async findMatchingTreeItemForResourceUri(resourceUri: vscode.Uri, items: IgnitionFileResource[] | IgnitionProjectResource[]): Promise<IgnitionFileResource | IgnitionProjectResource | undefined> {
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

	private async getParentResourceForUri(uri: vscode.Uri): Promise<IgnitionFileResource | IgnitionProjectResource | undefined> {
		const relativePath = vscode.workspace.asRelativePath(uri, false);
		const pathSegments = relativePath.split('/');

		let parentResource: IgnitionFileResource | IgnitionProjectResource | undefined = undefined;
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

	private async createScriptResourceForFile(uri: vscode.Uri, parentResource: IgnitionFileResource | IgnitionProjectResource): Promise<ScriptResource> {
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
			  const isDirectory = (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.Directory;
			  if (isDirectory) {
				if (await this.isDirectoryScriptResource(uri.fsPath)) {
				  const codePyPath = path.join(uri.fsPath, 'code.py');
				  const newResource = new ScriptResource(path.basename(uri.fsPath), vscode.Uri.file(codePyPath), {
					command: 'vscode.open',
					title: 'Open Script',
					arguments: [vscode.Uri.file(codePyPath)],
				  }, parentResource);
	  
				  if (parentResource instanceof IgnitionProjectResource) {
					parentResource.children?.push(newResource);
					this._onDidChangeTreeData.fire(parentResource); // Fire the event for the project resource
				  } else if (parentResource instanceof FolderResource || parentResource instanceof ScriptResource) {
					parentResource.children?.push(newResource);
					this._onDidChangeTreeData.fire(parentResource.parent); // Fire the event for the parent of the parent resource
				  }
				} else {
				  const newResource = new FolderResource(path.basename(uri.fsPath), uri, parentResource);
				  if (parentResource instanceof IgnitionProjectResource) {
					parentResource.children?.push(newResource);
					this._onDidChangeTreeData.fire(parentResource); // Fire the event for the project resource
				  } else if (parentResource instanceof FolderResource || parentResource instanceof ScriptResource) {
					parentResource.children?.push(newResource);
					this._onDidChangeTreeData.fire(parentResource.parent); // Fire the event for the parent of the parent resource
				  }
				}
			  } else {
				// It would not hurt to confirm that the parent directory of the file is a script resource directory
				const scriptResource = await this.createScriptResourceForFile(uri, parentResource);
				if (parentResource instanceof IgnitionProjectResource) {
				  parentResource.children?.push(scriptResource);
				  this._onDidChangeTreeData.fire(parentResource); // Fire the event for the project resource
				} else if (parentResource instanceof FolderResource || parentResource instanceof ScriptResource) {
				  parentResource.children?.push(scriptResource);
				  this._onDidChangeTreeData.fire(parentResource.parent); // Fire the event for the parent of the parent resource
				}
			  }
			}
		  }
		}
		this.refreshTreeView();
	  }
	  
	  async handleFileDeletion(event: vscode.FileDeleteEvent): Promise<void> {
		for (const uri of event.files) {
		  if (uri.fsPath.includes('script-python')) {
			const resourceToRemove = await this.findMatchingTreeItemForResourceUri(uri, this.treeRoot);
			if (resourceToRemove) {
			  if (resourceToRemove instanceof IgnitionFileResource) {
				const parentResource = resourceToRemove.parent;
				if (parentResource instanceof IgnitionProjectResource) {
				  const updatedChildren = parentResource.children?.filter(child => child !== resourceToRemove);
				  parentResource.children = updatedChildren;
				  this._onDidChangeTreeData.fire(parentResource); // Fire the event for the project resource
				} else if (parentResource instanceof FolderResource || parentResource instanceof ScriptResource) {
				  const updatedChildren = parentResource.children?.filter(child => child !== resourceToRemove);
				  parentResource.children = updatedChildren;
				  this._onDidChangeTreeData.fire(parentResource.parent); // Fire the event for the parent of the parent resource
				}
				if (resourceToRemove instanceof ScriptResource || resourceToRemove instanceof FolderResource) {
				  resourceToRemove.dispose(); // Call the dispose method on the removed resource
				}
			  } else if (resourceToRemove instanceof IgnitionProjectResource) {
				// If an entire project is deleted, refresh the root
				this.treeRoot = this.treeRoot.filter(project => project !== resourceToRemove);
				this._onDidChangeTreeData.fire(undefined); // Fire the event without any data to refresh the root
			  }
			}
		  }
		}
		this.refreshTreeView();
	  }

	  public getCurrentScriptResource(fileUri: vscode.Uri): ScriptResource | undefined {
		// Convert the file URI to a file system path
		const filePath = fileUri.fsPath;
	
		// Look through all projects to see which one contains this file
		for (const project of this.treeRoot) {
			// Check if the file path starts with the project's base file path
			if (filePath.startsWith(project.baseFilePath)) {
				// Find the ScriptResource instance for this file
				const scriptResource = this.findScriptResourceForFile(project, fileUri);
				if (scriptResource) {
					return scriptResource;
				}
			}
		}
	
		// If no ScriptResource was found, return undefined
		return undefined;
	}
	
	private findScriptResourceForFile(rootResource: IgnitionProjectResource | FolderResource | ScriptResource, fileUri: vscode.Uri): ScriptResource | undefined {
		if (rootResource instanceof ScriptResource && rootResource.resourceUri.fsPath === fileUri.fsPath) {
			return rootResource;
		}
	
		if (rootResource.children) {
			for (const child of rootResource.children) {
				const foundResource = this.findScriptResourceForFile(child, fileUri);
				if (foundResource) {
					return foundResource;
				}
			}
		}
	
		return undefined;
	}

	public getScriptResourceForPath(inputPath: string): ScriptResource | undefined {
		for (const project of this.treeRoot) {
			const scriptResource = this.findScriptResourceByQualifiedPath(project, inputPath);
			if (scriptResource) {
				return scriptResource;
			}
		}
	
		return undefined;
	}
	
	private findScriptResourceByQualifiedPath(rootResource: IgnitionProjectResource | FolderResource | ScriptResource, inputPath: string): ScriptResource | undefined {
		if (rootResource instanceof ScriptResource && rootResource.qualifiedScriptPath === inputPath) {
			return rootResource;
		}
	
		if (rootResource.children) {
			for (const child of rootResource.children) {
				const foundResource = this.findScriptResourceByQualifiedPath(child, inputPath);
				if (foundResource) {
					return foundResource;
				}
			}
		}
	
		return undefined;
	}

	public getParentResources(resource: ScriptResource | undefined, inputPath: string): ScriptResource[] {
		if (!resource) {
			return [];
		}
	
		const parentResources: ScriptResource[] = [];
		let currentResource: IgnitionFileResource | IgnitionProjectResource | undefined = resource.parent;
	
		while (currentResource) {
			if (currentResource instanceof ScriptResource && currentResource.resourceUri.fsPath.startsWith(path.join(inputPath))) {
				parentResources.push(currentResource);
			}
			if (currentResource instanceof IgnitionProjectResource) {
				break;
			}
			currentResource = currentResource.parent;
		}
	
		return parentResources;
	}
}