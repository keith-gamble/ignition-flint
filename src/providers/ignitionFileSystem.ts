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
import { ClassElement, MethodElement, ScriptElement } from '../resources/scriptElements';
import { IgnitionGateway, IgnitionGatewayConfigElement } from './ignitionGatewayProvider';
import { DependencyContainer } from '../dependencyContainer';


export class IgnitionFileSystemProvider implements vscode.TreeDataProvider<IgnitionFileResource | AbstractContentElement> {
	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;
	private _projects: { projectId: string, title: string, parentProjectId: string, path: string, relativePath: string }[] = [];
	public treeRoot: IgnitionProjectResource[] = [];
	private treeView: vscode.TreeView<vscode.TreeItem> | undefined;
	private refreshTreeViewDebounced = debounce(this._refreshTreeView.bind(this), 500); // Debounce refreshTreeView by 500ms
	private projectPathMap: Map<string, IgnitionProjectResource> = new Map();
	private dependencyContainer: DependencyContainer;

	constructor(private workspaceRoot: string | undefined, dependencyContainer: DependencyContainer) {
		this.discoverProjectsAndWatch();
		this.dependencyContainer = dependencyContainer;
	}

	refresh(data?: any): void {
		const newTreeRoot = this.sortProjects(this.treeRoot);
		this.treeRoot = newTreeRoot;
		this._onDidChangeTreeData.fire(undefined);
	}

	private logError(message: string): void {
		this.dependencyContainer.getOutputChannel().appendLine(`[${new Date().toISOString()}] ERROR: ${message}`);
	}

	public async refreshTreeView(): Promise<void> {
		this._onDidChangeTreeData.fire(undefined);
		return this.refreshTreeViewDebounced();
	}

	private async _refreshTreeView(): Promise<void> {
		// Create a new tree root
		const newTreeRoot: IgnitionProjectResource[] = [];

		const projectTitleCounts: { [title: string]: number } = {};

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
				const projectResource = new IgnitionProjectResource(
					project.projectId,
					project.title,
					project.parentProjectId,
					project.path,
					project.relativePath,
					vscode.TreeItemCollapsibleState.Collapsed,
					[],
					projectTitleCounts[project.title] ? ++projectTitleCounts[project.title] : (projectTitleCounts[project.title] = 1)
				);


				// Set the parent project based on searching the existing tree
				if (project.parentProjectId) {
					const parentProjectResource = this.treeRoot.find(p => project.parentProjectId === p.projectId);
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
		this.treeRoot = this.sortProjects(newTreeRoot);

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

	getTreeItem(element: IgnitionFileResource | AbstractContentElement): vscode.TreeItem {
		return element.getTreeItem();
	}

	async getChildren(element?: IgnitionFileResource | AbstractResourceContainer): Promise<(IgnitionFileResource | AbstractContentElement)[] | undefined> {
		const showInheritedResources = vscode.workspace.getConfiguration('ignitionFlint').get('showInheritedResources', false);


		if (!element) {
			return this.treeRoot;
		} else if (element instanceof IgnitionProjectResource) {
			const inheritedChildren: IgnitionFileResource[] = [];
			if (element.parentProject && showInheritedResources) {
				// If the project has a parent project, get the inherited children
				const parentScriptsPath = path.join(element.parentProject.baseFilePath, 'ignition', 'script-python');
				inheritedChildren.push(...await this.processDirectory(parentScriptsPath, element, true, element));
			}

			// Process the current project's directory
			const scriptsPath = path.join(element.baseFilePath, 'ignition', 'script-python');
			const currentChildren = await this.processDirectory(scriptsPath, element);

			// Merge the inherited children and current children
			const mergedChildren = [...inheritedChildren, ...currentChildren];

			return mergedChildren;
		} else if (element instanceof FolderResource) {
			return element.children;
		} else if (element instanceof ScriptResource && !element.isInherited) {
			return element.scriptElements;
		} else if (element instanceof ClassElement) {
			return element.children;
		} else {
			return undefined;
		}
	}

	async getScriptElements(element: IgnitionFileResource): Promise<AbstractContentElement[] | undefined> {
		if (element instanceof ScriptResource) {
			return element.scriptElements;
		}
		return undefined;
	}


	private async getIgnitionProjects(workspaceRoot: string): Promise<{ projectId: string, title: string, parentProjectId: string, path: string, relativePath: string }[]> {
		const projects: { projectId: string, title: string, parentProjectId: string, path: string, relativePath: string }[] = [];
		const files = await vscode.workspace.findFiles('**/project.json');
		for (const file of files) {
			const projectJsonPath = file.fsPath;
			const projectDir = path.dirname(projectJsonPath);
			const scriptPythonPath = path.join(projectDir, 'ignition', 'script-python');

			if (fs.existsSync(scriptPythonPath)) {
				const relativePath = path.relative(workspaceRoot, projectDir);
				const projectJson = JSON.parse(await fs.promises.readFile(projectJsonPath, 'utf-8'));

				let title = projectJson.title;

				if (!title) {
					title = path.basename(projectDir);
				}

				projects.push({ projectId: path.basename(projectDir), title: title, parentProjectId: projectJson.parent, path: projectDir, relativePath });
				
			}
		}

		// sort the projects by inheritance so they are first
		projects.sort((a, b) => {
			if (a.parentProjectId === b.projectId) {
				return -1;
			} else if (b.parentProjectId === a.projectId) {
				return 1;
			} else {
				return 0;
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
		const projectTitleCounts: { [title: string]: number } = {};
	
		while (projectStack.length > 0) {
			const project = projectStack.shift()!;
	
			if (createdProjects.has(project.projectId)) {
				continue;
			}
	
			if (project.parentProjectId && !createdProjects.has(project.parentProjectId)) {
				const parentProject = projects.find(p => p.projectId === project.parentProjectId);
				if (parentProject) {
					projectStack.unshift(project);
					projectStack.unshift(parentProject);
					continue;
				} else {
					// Log the missing parent project and continue with the current project
					this.logError(`Parent project '${project.parentProjectId}' not found for project '${project.projectId}'. Continuing without parent.`);
				}
			}
	
			const projectResource = new IgnitionProjectResource(
				project.projectId,
				project.title,
				project.parentProjectId,
				project.path,
				project.relativePath,
				vscode.TreeItemCollapsibleState.Collapsed,
				[],
				projectTitleCounts[project.title] ? ++projectTitleCounts[project.title] : (projectTitleCounts[project.title] = 1)
			);
			this.projectPathMap.set(project.path, projectResource);
	
			if (project.parentProjectId) {
				const parentProjectResource = this.treeRoot.find(p => p.projectId === project.parentProjectId);
				if (parentProjectResource) {
					projectResource.parentProject = parentProjectResource;
				} else {
					// Log the missing parent project resource
					this.logError(`Parent project resource '${project.parentProjectId}' not found for project '${project.projectId}'. Continuing without parent.`);
				}
			}
	
			projectResource.watchProjectFiles(this);
	
			const scriptsPath = path.join(project.path, 'ignition/script-python');
			const children = await this.processDirectory(scriptsPath, projectResource, false);
			projectResource.children = children;
			await this.updateProjectInheritance(projectResource);
	
			// Insert the project resource at the correct position based on its parent-child relationship
			const parentIndex = this.treeRoot.findIndex(p => p.projectId === project.parentProjectId);
			if (parentIndex !== -1) {
				this.treeRoot.splice(parentIndex + 1, 0, projectResource);
			} else {
				this.treeRoot.push(projectResource);
			}
	
			createdProjects.add(project.projectId);
		}
	
		await this.updateProjectInheritanceContext();
		this.treeRoot = this.sortProjects(this.treeRoot);
		this.refresh();
	}


	private sortProjects(projects: IgnitionProjectResource[]): IgnitionProjectResource[] {
		const sortedProjects: IgnitionProjectResource[] = [];
		const projectMap = new Map<string, IgnitionProjectResource>();

		// Create a map of project IDs to project resources
		for (const project of projects) {
			projectMap.set(project.projectId, project);
		}

		// Recursively sort the projects based on their parent-child relationship, making sure parents are first
		const sortProjectsRecursive = (project: IgnitionProjectResource) => {
			if (project.parentProject) {
				sortProjectsRecursive(project.parentProject);
			}

			if (!sortedProjects.includes(project)) {
				sortedProjects.push(project);
			}
		};

		for (const project of projects) {
			sortProjectsRecursive(project);

			// Add any projects that were not included in the recursive sorting
			if (!sortedProjects.includes(project)) {
				sortedProjects.push(project);
			}
		}

		return sortedProjects;
	}

	private async processDirectory(directoryPath: string, parentResource: AbstractResourceContainer, isInherited: boolean = false, visibleParentProject: IgnitionProjectResource | undefined = undefined): Promise<IgnitionFileResource[]> {
		let resources: IgnitionFileResource[] = [];
		const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });

		const folderResources: IgnitionFileResource[] = [];
		const scriptResources: IgnitionFileResource[] = [];

		if (!visibleParentProject) {
			visibleParentProject = parentResource.getParentProject();
		}

		if (isInherited) {
		}

		for (const entry of entries) {
			const fullPath = path.join(directoryPath, entry.name);
			if (entry.isDirectory()) {
				if (await this.isDirectoryScriptResource(fullPath)) {
					if (isInherited) {
					}
					const codePyPath = path.join(fullPath, 'code.py');
					const scriptResource = new ScriptResource(entry.name, vscode.Uri.file(codePyPath), {
						command: 'vscode.open',
						title: 'Open Script',
						arguments: [vscode.Uri.file(codePyPath)],
					}, parentResource, undefined, isInherited);

					if (isInherited && visibleParentProject) {
						scriptResource.visibleProject = visibleParentProject;
						scriptResource.collapsibleState = vscode.TreeItemCollapsibleState.None;
						scriptResource.iconPath = new vscode.ThemeIcon('file-symlink-file');
					} else {
						await scriptResource.parsePythonFile();
					}

					scriptResources.push(scriptResource);
				} else {
					if (isInherited) {
					}
					const folderResource = new FolderResource(entry.name, vscode.Uri.file(fullPath), parentResource, [], isInherited);
					folderResource.visibleProject = visibleParentProject;
					folderResource.children = await this.processDirectory(fullPath, folderResource, isInherited, visibleParentProject);
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

	private findScriptElementByQualifiedPath(qualifiedPath: string): ScriptResource | ScriptElement | undefined {
		for (const project of this.treeRoot) {
			const scriptElement = this.findScriptElementByQualifiedPathRecursive(project, qualifiedPath);
			if (scriptElement) {
				return scriptElement;
			}
		}
	
		return undefined;
	}
	
	private findScriptElementByQualifiedPathRecursive(resource: IgnitionFileResource, qualifiedPath: string): ScriptResource | ScriptElement | undefined {
		if (resource instanceof ScriptResource) {
		  if (resource.getFullyQualifiedPath() === qualifiedPath) {
			return resource;
		  }
	  
		  for (const scriptElement of resource.scriptElements) {
			if (!(scriptElement instanceof ScriptElement)) {
			  continue;
			}
			
			if (scriptElement instanceof ScriptElement && scriptElement.getFullyQualifiedPath(false) === qualifiedPath) {
			  return scriptElement;
			}
	  
			// Handle the case of method elements
			if (scriptElement instanceof ClassElement) {
			  for (const methodElement of scriptElement.children) {
				if (methodElement instanceof MethodElement && methodElement.getFullyQualifiedPath() === qualifiedPath) {
				  return methodElement;
				}
			  }
			}
		  }
		}
	  
		const childResources = resource.children?.filter(child => child instanceof IgnitionFileResource) as IgnitionFileResource[];
		for (const child of childResources ?? []) {
		  const foundElement = this.findScriptElementByQualifiedPathRecursive(child, qualifiedPath);
		  if (foundElement) {
			return foundElement;
		  }
		}
	  
		return undefined;
	  }

	public getScriptResourceForPath(inputPath: string): ScriptResource | ScriptElement | undefined {
		for (const project of this.treeRoot) {
			const scriptResource = this.findScriptResourceByQualifiedPath(project, inputPath);
			if (scriptResource) {
				return scriptResource;
			}
		}

		return undefined;
	}

	private findScriptResourceByQualifiedPath(resource: IgnitionFileResource, inputPath: string): ScriptResource | ScriptElement | undefined {
		if (resource instanceof ScriptResource) {
			if (resource.qualifiedScriptFilePath === inputPath) {
				return resource;
			}
	
			// Search for ScriptElement instances within the ScriptResource
			for (const scriptElement of resource.scriptElements) {
				if (scriptElement instanceof ScriptElement) {
					const qualifiedName = scriptElement.getFullyQualifiedPath();
					if (qualifiedName === inputPath) {
						return scriptElement;
					}
				}
			}
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

	private async updateProjectInheritance(project: IgnitionProjectResource): Promise<void> {
		if (project.parentProject) {
			try {
				await this.updateProjectInheritance(project.parentProject);
	
				// Create a map of the project's own children by their resource URI
				const ownChildrenMap = new Map<string, IgnitionFileResource>();
				for (const child of project.children || []) {
					ownChildrenMap.set(child.resourceUri.fsPath, child);
				}
	
				// Merge the inherited children with the project's own children
				const mergedChildren: IgnitionFileResource[] = [];
				for (const inheritedChild of project.parentProject.children || []) {
					const ownChild = ownChildrenMap.get(inheritedChild.resourceUri.fsPath);
					if (ownChild) {
						// If the child exists in both the inherited and the project, use the project's version
						mergedChildren.push(ownChild);
						ownChildrenMap.delete(inheritedChild.resourceUri.fsPath);
					} else {
						// If the child only exists in the inherited, clone it and add it to the merged children
						const clonedChild = this.cloneResource(inheritedChild, project);
						mergedChildren.push(clonedChild);
					}
				}
	
				// Add any remaining own children that didn't exist in the inherited
				for (const ownChild of ownChildrenMap.values()) {
					mergedChildren.push(ownChild);
				}
	
				project.inheritedChildren = mergedChildren;
			} catch (error) {
				// Log the error and continue without inherited children
				this.logError(`Error updating project inheritance for '${project.projectId}': ${error}. Continuing without inherited children.`);
				project.inheritedChildren = [];
			}
		} else {
			project.inheritedChildren = [];
		}
	}

	private cloneResource(resource: IgnitionFileResource, parentResource: IgnitionProjectResource): IgnitionFileResource {
		if (resource instanceof ScriptResource) {
			const clonedResource = new ScriptResource(
				resource.label,
				resource.resourceUri,
				resource.command,
				parentResource,
				[],
				true
			);
			clonedResource.iconPath = new vscode.ThemeIcon('file-symlink-file');
			return clonedResource;
		} else if (resource instanceof FolderResource) {
			const clonedResource = new FolderResource(
				resource.label,
				resource.resourceUri,
				parentResource,
				[],
				true
			);
			clonedResource.iconPath = new vscode.ThemeIcon('file-symlink-directory');
			clonedResource.children = resource.children.map(child => this.cloneResource(child, parentResource));
			return clonedResource;
		} else {
			throw new Error(`Unsupported resource type: ${resource.constructor.name}`);
		}
	}

	async triggerGatewayUpdatesForProjectPath(projectPath: string): Promise<void> {
		const ignitionGatewayProvider = this.dependencyContainer.getIgnitionGatewayProvider();
		const relevantGateways = ignitionGatewayProvider.getRelevantGatewaysForProjectPath(projectPath);
	
		for (const gateway of relevantGateways) {
			await ignitionGatewayProvider.requestProjectScan(gateway);
		}
	}

	/**
	 * Updates or verifies the project inheritance context for the specified project.
	 * @param currentProject The current project resource to update the inheritance context for.
	 */
	public async updateProjectInheritanceContext(currentProject?: IgnitionProjectResource): Promise<void> {
		if (!currentProject) {
			for (const project of this.treeRoot) {
				await this.updateProjectInheritance(project);
			}
		} else {
			await this.updateProjectInheritance(currentProject);
		}
		this.refreshTreeView();
	}

	public async overrideInheritedResource(resource: ScriptResource) {
		// 1. Get the path of the inherited resource
		const inheritedResourcePath = resource.resourceUri.fsPath;
		// 2. Get the current project resource
		const selectedProject = resource.visibleProject;

		if (!selectedProject) {
			vscode.window.showErrorMessage('Failed to override inherited resource: Could not find the current project resource.');
			return;
		}

		if (!resource.parentResource) {
			vscode.window.showErrorMessage('Failed to override inherited resource: The resource does not have a parent resource.');
			return;
		}

		const relativePath = path.relative(path.dirname(selectedProject.baseFilePath), inheritedResourcePath).split(path.sep).slice(1).join(path.sep);

		const newResourcePath = path.join(selectedProject.baseFilePath, relativePath);
		await fs.promises.mkdir(path.dirname(newResourcePath), { recursive: true });
		await fs.promises.copyFile(path.join(path.dirname(inheritedResourcePath), 'code.py'), path.join(path.dirname(newResourcePath), 'code.py'));
		await fs.promises.copyFile(path.join(path.dirname(inheritedResourcePath), 'resource.json'), path.join(path.dirname(newResourcePath), 'resource.json'));

		// 4. Mark the new resource as overridden
		const newResource = this.getScriptResourceForPath(newResourcePath);
		if (newResource && newResource instanceof ScriptResource) {
			newResource.isOverridden = true;
		}

		// 5. Refresh the tree view to show the new overridden resource
		this.refreshTreeView();
	}

	public async discardOverriddenResource(resource: ScriptResource | FolderResource) {
		// 1. Delete the overridden resource from the file system
		await fs.promises.rm(resource.resourceUri.fsPath, { recursive: true, force: true });

		// 2. Mark the resource as not overridden
		resource.isOverridden = false;

		// 3. Refresh the tree view to show the inherited resource again
		this.refreshTreeView();
	}

	public async expandScriptResource(resource: ScriptResource): Promise<void> {
		if (this.treeView) {
			// Find the parent resources of the script resource
			const parentResources = await this.findParentResources(resource);

			// Expand each parent resource in the tree view
			for (const parentResource of parentResources) {
				await this.treeView.reveal(parentResource, { expand: true });
			}

			// Reveal the script resource in the tree view without selecting it
			await this.treeView.reveal(resource, { select: false, focus: false });
		}
	}

	private async findParentResources(resource: ScriptResource): Promise<IgnitionFileResource[]> {
		const parentResources: IgnitionFileResource[] = [];
		let currentResource: IgnitionFileResource | undefined = resource.parentResource;

		while (currentResource) {
			parentResources.unshift(currentResource);
			currentResource = currentResource.parentResource;
		}

		return parentResources;
	}

	public async navigateToScriptElement(elementPath: string) {
		if (elementPath) {
			const elementPathParts = elementPath.split('(');
			const qualifiedPath = elementPathParts[0];
			
			const scriptElement = this.findScriptElementByQualifiedPath(qualifiedPath);
	
			if (scriptElement instanceof ScriptResource) {
				// Expand the tree item
				await this.expandScriptResource(scriptElement);
	
				// Open the document and focus on the element
				const document = await vscode.workspace.openTextDocument(scriptElement.resourceUri);
				await vscode.window.showTextDocument(document);
			} else if (scriptElement instanceof ScriptElement) {
				// Open the document and focus on the script element
				const document = await vscode.workspace.openTextDocument(scriptElement.resourceUri);
				if (scriptElement.lineNumber === undefined) {
					throw new Error(`Failed to find line number for script element: ${elementPath}`);
				}
	
				await vscode.window.showTextDocument(document, {
					selection: new vscode.Range(scriptElement.lineNumber - 1, 0, scriptElement.lineNumber - 1, 0)
				});
			} else {
				throw new Error(`Failed to find script resource or element for path: ${elementPath}`);
			}
		}
	}
}

