import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IgnitionProjectResource } from '../resources/projectResource';
import { IgnitionFileResource } from '../resources/ignitionFileResource';
import { ScriptResource } from '../resources/scriptResource';
import { FolderResource } from '../resources/folderResource';
import { debounce } from '../utils/debounce';
import { AbstractContentElement } from '../resources/abstractContentElement';
import { AbstractResourceContainer } from '../resources/abstractResourceContainer';

export class IgnitionFileSystemProvider implements vscode.TreeDataProvider<IgnitionFileResource> {
	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;
	private _projects: { id: string, title: string, parentProjectId: string, path: string, relativePath: string }[] = [];
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
		// Create a new tree root
		const newTreeRoot: IgnitionProjectResource[] = [];
	
		// Iterate over the existing projects and refresh each one
		for (const project of this._projects) {
			const existingProjectResource = this.treeRoot.find(p => p.baseFilePath === project.path);
			if (existingProjectResource) {
				// Reuse the existing project resource instance
				existingProjectResource.children = [];
	
				existingProjectResource.watchProjectFiles(this);
	
				const scriptsPath = path.join(project.path, 'ignition/script-python');
				const children = await this.processDirectory(scriptsPath, existingProjectResource);
	
				// Update the children of the existing project resource
				existingProjectResource.children = this.updateChildResources(existingProjectResource.children, children);
	
				newTreeRoot.push(existingProjectResource);
			} else {
				// Create a new project resource instance
				const projectResource = new IgnitionProjectResource(project.id, project.title, project.parentProjectId, project.path);
	
				// Set the parent project based on searching the existing tree
				if (project.parentProjectId) {
					const parentProjectResource = this.treeRoot.find(p => project.parentProjectId === p.id);
					if (parentProjectResource) {
						projectResource.parentProject = parentProjectResource;
					}
				}
	
				projectResource.watchProjectFiles(this);
	
				const scriptsPath = path.join(project.path, 'ignition/script-python');
				const children = await this.processDirectory(scriptsPath, projectResource);
				projectResource.children = children;
	
				newTreeRoot.push(projectResource);
			}
		}
	
		// Dispose of any unused project resource instances from the old tree root
		for (const existingProject of this.treeRoot) {
			if (!newTreeRoot.includes(existingProject)) {
				existingProject.dispose();
			}
		}
	
		// Replace the tree root with the new tree root
		this.treeRoot = newTreeRoot;
	
		// Trigger a refresh of the tree view
		this._onDidChangeTreeData.fire(undefined);
	}

	private updateChildResources(existingChildren: IgnitionFileResource[], newChildren: IgnitionFileResource[]): IgnitionFileResource[] {
		const updatedChildren: IgnitionFileResource[] = [];

		for (const newChild of newChildren) {
			const existingChild = existingChildren.find(c => c.label === newChild.label);
			if (existingChild) {
				// Update the existing child resource
				existingChild.children = newChild.children;
				updatedChildren.push(existingChild);
			} else {
				// Add the new child resource
				updatedChildren.push(newChild);
			}
		}


		// Dispose of any unused child resource instances
		for (const existingChild of existingChildren) {
			if (!updatedChildren.includes(existingChild)) {
				existingChild.dispose();
			}
		}

		return updatedChildren;
	}

	setTreeView(treeView: vscode.TreeView<vscode.TreeItem>) {
		this.treeView = treeView;
	}

	getParent(element: IgnitionFileResource): vscode.ProviderResult<IgnitionFileResource> {
		if (element instanceof IgnitionProjectResource) {
			return null;
		} else {
			return element.parentResource;
		}
	}

	getTreeItem(element: IgnitionFileResource): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: IgnitionFileResource): Promise<IgnitionFileResource[] | undefined> {
		if (!element) {
			return this.treeRoot;
		} else {
			// Ensure only IgnitionFileResource types are returned
			const filteredChildren = element.children?.filter(child => child instanceof IgnitionFileResource) as IgnitionFileResource[];
			return filteredChildren.length > 0 ? filteredChildren : undefined;
		}
	}
	

	private async getIgnitionProjects(workspaceRoot: string): Promise<{ id: string, title: string, parentProjectId: string, path: string, relativePath: string }[]> {
        const projects: { id: string, title: string, parentProjectId: string, path: string, relativePath: string }[] = [];
        const files = await vscode.workspace.findFiles('**/project.json');

        for (const file of files) {
            const projectJsonPath = file.fsPath;
            const projectDir = path.dirname(projectJsonPath);
            const scriptPythonPath = path.join(projectDir, 'ignition', 'script-python');

            if (fs.existsSync(scriptPythonPath)) {
                const relativePath = path.relative(workspaceRoot, projectDir);
                const projectJson = JSON.parse(await fs.promises.readFile(projectJsonPath, 'utf-8'));
                if (projectJson.title) {
                    projects.push({ id: path.basename(projectDir), title: projectJson.title, parentProjectId: projectJson.parent, path: projectDir, relativePath });
                }
            }
        }

        // Sort the project by their title and inheritance from the parent, with the parent project first
        projects.sort((a, b) => {
            if (a.parentProjectId === b.id) {
                return -1;
            } else if (b.parentProjectId === a.id) {
                return 1;
            } else {
                return a.title.localeCompare(b.title);
            }
        });

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
	
		const projectStack: typeof projects = [...projects];
		const createdProjects = new Set<string>();
	
		while (projectStack.length > 0) {
			const project = projectStack.shift()!;
	
			if (createdProjects.has(project.id)) {
				continue;
			}
	
			if (project.parentProjectId && !createdProjects.has(project.parentProjectId)) {
				// If the parent project is not yet created, push the current project back onto the stack
				projectStack.unshift(project);
				const parentProject = projects.find(p => p.id === project.parentProjectId);
				if (parentProject) {
					projectStack.unshift(parentProject);
				}
				continue;
			}
	
			const projectResource = new IgnitionProjectResource(project.id, project.title, project.parentProjectId, project.path);
	
			if (project.parentProjectId) {
				const parentProjectResource = this.treeRoot.find(p => p.id === project.parentProjectId);
				if (parentProjectResource) {
					projectResource.parentProject = parentProjectResource;
				}
			}
	
			this.treeRoot.push(projectResource);
	
			projectResource.watchProjectFiles(this);
	
			const scriptsPath = path.join(project.path, 'ignition/script-python');
			const children = await this.processDirectory(scriptsPath, projectResource);
			projectResource.children = children;
	
			createdProjects.add(project.id);
		}
	
		await this.updateProjectInheritanceContext();
	
		this.refresh();
	}

	private async processDirectory(directoryPath: string, parentResource: AbstractResourceContainer): Promise<IgnitionFileResource[]> {
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

	private async findMatchingTreeItemForResourceUri(resourceUri: vscode.Uri, items: IgnitionFileResource[] | AbstractContentElement[]): Promise<IgnitionFileResource | undefined> {
		for (const item of items) {
			if (item instanceof IgnitionFileResource && item.resourceUri.fsPath === resourceUri.fsPath) {
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

	private async getParentResourceForUri(uri: vscode.Uri): Promise<AbstractResourceContainer | undefined> {
		const relativePath = vscode.workspace.asRelativePath(uri, false);
		const pathSegments = relativePath.split('/');

		let parentResource: IgnitionFileResource | undefined = undefined;
		for (let i = 1; i < pathSegments.length; i++) {
			const parentPath = pathSegments.slice(0, i).join('/');
			const parentUri = vscode.Uri.file(path.join(this.workspaceRoot || '', parentPath));
			parentResource = await this.findMatchingTreeItemForResourceUri(parentUri, this.treeRoot);

			if (parentResource) {
				break;
			}
		}

		if (parentResource instanceof AbstractResourceContainer) {
			return parentResource;
		}
	
		return undefined
	}

	private async createScriptResourceForFile(uri: vscode.Uri, parentResource: AbstractResourceContainer): Promise<ScriptResource> {
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
								this._onDidChangeTreeData.fire(parentResource.parentResource); // Fire the event for the parent of the parent resource
							}
						} else {
							const newResource = new FolderResource(path.basename(uri.fsPath), uri, parentResource);
							if (parentResource instanceof IgnitionProjectResource) {
								parentResource.children?.push(newResource);
								this._onDidChangeTreeData.fire(parentResource); // Fire the event for the project resource
							} else if (parentResource instanceof FolderResource || parentResource instanceof ScriptResource) {
								parentResource.children?.push(newResource);
								this._onDidChangeTreeData.fire(parentResource.parentResource); // Fire the event for the parent of the parent resource
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
							this._onDidChangeTreeData.fire(parentResource.parentResource); // Fire the event for the parent of the parent resource
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
						const parentResource = resourceToRemove.parentResource;
						if (parentResource instanceof IgnitionProjectResource) {
							const updatedChildren = parentResource.children?.filter(child => child !== resourceToRemove);
							parentResource.children = updatedChildren;
							this._onDidChangeTreeData.fire(parentResource); // Fire the event for the project resource
						} else if (parentResource instanceof FolderResource || parentResource instanceof ScriptResource) {
							const updatedChildren = parentResource.children?.filter(child => child !== resourceToRemove);
							parentResource.children = updatedChildren;
							this._onDidChangeTreeData.fire(parentResource.parentResource); // Fire the event for the parent of the parent resource
						}
						if (resourceToRemove instanceof ScriptResource || resourceToRemove instanceof FolderResource) {
							resourceToRemove.dispose(); // Call the dispose method on the removed resource
						}
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

	private findScriptResourceForFile(rootResource: AbstractResourceContainer, fileUri: vscode.Uri): ScriptResource | undefined {
		if (rootResource instanceof ScriptResource && rootResource.resourceUri.fsPath === fileUri.fsPath) {
			return rootResource;
		}

		if (rootResource.children) {
			for (const child of rootResource.children) {
				if (child instanceof AbstractResourceContainer) {
					const foundResource = this.findScriptResourceForFile(child, fileUri);
					if (foundResource) {
						return foundResource;
					}
				} else if (child instanceof ScriptResource && child.resourceUri.fsPath === fileUri.fsPath) {
					return child;
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

	private findScriptResourceByQualifiedPath(resource: IgnitionFileResource, inputPath: string): ScriptResource | undefined {
		if (resource instanceof ScriptResource && resource.qualifiedScriptPath === inputPath) {
			return resource;
		}
	
		// Iterate only over IgnitionFileResource instances
		const childResources = resource.children?.filter(child => child instanceof IgnitionFileResource) as IgnitionFileResource[];
		for (const child of childResources ?? []) {
			const foundResource = this.findScriptResourceByQualifiedPath(child, inputPath);
			if (foundResource) {
				return foundResource;
			}
		}
	
		return undefined;
	}
	
	

	public getParentResources(resource: ScriptResource | undefined, inputPath: string): ScriptResource[] {
		if (!resource) {
			return [];
		}

		const parentResources: ScriptResource[] = [];
		let currentResource: IgnitionFileResource | undefined = resource.parentResource;

		while (currentResource) {
			if (currentResource instanceof ScriptResource && currentResource.resourceUri.fsPath.startsWith(path.join(inputPath))) {
				parentResources.push(currentResource);
			}
			if (currentResource instanceof IgnitionProjectResource) {
				break;
			}
			currentResource = currentResource.parentResource;
		}

		return parentResources;
	}


	/**
	 * Updates or verifies the project inheritance context for the specified project.
	 * @param currentProject The current project resource to update the inheritance context for.
	 */
	public async updateProjectInheritanceContext(currentProject?: IgnitionProjectResource, holdRefresh?: boolean): Promise<void> {
		// If we did not pass a currentProject, we should update the inheritance for all of the avialable projects
		if (!currentProject) {
			for (const project of this.treeRoot) {
				await this.updateProjectInheritanceContext(project);
			}
			this.refreshTreeView();
			return;
		}

		// Find the corresponding project in the _projects array
		const projectData = this._projects.find(p => p.id === currentProject.id);

		if (projectData) {
			// Update the current project resource with the latest data
			currentProject.title = projectData.title;
			currentProject.parentProjectId = projectData.parentProjectId;

			// Update the parent project reference
			if (currentProject.parentProjectId) {
				const parentProjectResource = this.treeRoot.find(p => p.id === currentProject.parentProjectId);
				if (parentProjectResource) {
					currentProject.parentProject = parentProjectResource;
				} else {
					currentProject.parentProject = undefined;
				}
			} else {
				currentProject.parentProject = undefined;
			}

			// Trigger a refresh of the tree view or other UI components as necessary.
			if (!holdRefresh) {
				this.refreshTreeView();
			}
		}
	}
}

