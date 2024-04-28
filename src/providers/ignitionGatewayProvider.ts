import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { getAxiosInstance } from '../utils/httpUtils';
import { DependencyContainer } from '../dependencyContainer';


interface ComposeData {
	services: {
		[key: string]: {
			image?: string;
			hostname?: string;
			container_name?: string;
			volumes?: string[];
			labels?: {
				[key: string]: string;
			};
		};
	};
}

export interface IgnitionGatewayConfigElement {
	label: string;
	address: string;
	projectPaths: string[];
	updateDesignerOnSave: boolean;
	forceUpdateDesigner: boolean;
	supportsProjectScanEndpoint: boolean;
}

export class IgnitionGatewayProvider implements vscode.TreeDataProvider<IgnitionGateway> {
	private _onDidChangeTreeData: vscode.EventEmitter<IgnitionGateway | undefined> = new vscode.EventEmitter<IgnitionGateway | undefined>();
	readonly onDidChangeTreeData: vscode.Event<IgnitionGateway | undefined> = this._onDidChangeTreeData.event;
	private dependencyContainer: DependencyContainer;

	constructor(private workspaceRoot: string, dependencyContainer: DependencyContainer) {
		this.dependencyContainer = dependencyContainer;
	 }

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: IgnitionGateway): vscode.TreeItem {
		return element;
	}

	async getChildren(): Promise<IgnitionGateway[]> {
		const composePaths = vscode.workspace.getConfiguration('ignitionFlint').get<string[]>('composePaths');
		let gatewayConfigs = vscode.workspace.getConfiguration('ignitionFlint').get<IgnitionGatewayConfigElement[]>('ignitionGateways');

		if (!composePaths || composePaths.length === 0) {
			await this.identifyComposeFiles();
		}


		if (!gatewayConfigs || gatewayConfigs.length === 0) {
			await this.identifyGateways();
			gatewayConfigs = vscode.workspace.getConfiguration('ignitionFlint').get<IgnitionGatewayConfigElement[]>('ignitionGateways');
		}


		if (!gatewayConfigs || gatewayConfigs.length === 0) {
			return [];
		}

		return gatewayConfigs.map(config => new IgnitionGateway(config));
	}

	async supportsProjectScanEndpoint(address: string): Promise<boolean> {
		const url = `${address}/data/project-scan-endpoint/confirm-support`;

		try {
			const response = await getAxiosInstance().then(instance => instance.get(url));
			return response.data.supported;
		} catch (error: any) {
			if (error.response && error.response.status === 404) {
				return false;
			}

			if (error.response) {
				console.error('Error checking project scan endpoint support:', error.response.status, error.response.statusText);
			} else {
				if (error.message.includes('certificate')) {
					const disableSslVerify = await vscode.window.showInformationMessage(
						'Unable to verify the SSL certificate. Do you want to disable SSL verification for Flint in this workspace?',
						'Yes',
						'No'
					);

					if (disableSslVerify === 'Yes') {
						await vscode.workspace.getConfiguration('ignitionFlint').update('sslVerify', false, vscode.ConfigurationTarget.Workspace);
						getAxiosInstance(true); // Force recreate axiosInstance with updated SSL verification setting
						try {
							const response = await getAxiosInstance().then(instance => instance.get(url));
							return response.data.supported;
						} catch (retryError: any) {
							console.error('Error checking project scan endpoint support after disabling SSL verification:', retryError.message);
						}
					}
				} else {
					console.error('Error checking project scan endpoint support:', error.message);
				}
			}
			return false;
		}
	}

	async requestProjectScan(gateway: IgnitionGateway): Promise<void> {
		if (!gateway.supportsProjectScanEndpoint) {
			vscode.window.showInformationMessage('The gateway does not support the project scan endpoint.');
			return;
		}
	
		let url = `${gateway.config.address}/data/project-scan-endpoint/scan`;
	
		if (gateway.updateDesignerOnSave) {
			url += '?updateDesigners=true';
	
			if (gateway.forceUpdateDesigner) {
				url += '&forceUpdate=true';
			}
		}
	
		try {
			const response = await getAxiosInstance().then(instance => instance.post(url));
			vscode.window.showInformationMessage(`Project scan requested for ${gateway.config.label}.`);
		} catch (error: any) {
			if (error.response) {
				console.error('Error requesting project scan:', error.response.status, error.response.statusText);
			} else {
				console.error('Error requesting project scan:', error.message);
			}
		}
	}

	async identifyComposeFiles(): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		const composeFiles: string[] = [];

		if (workspaceFolders) {
			for (const workspaceFolder of workspaceFolders) {
				// Search for any docker-compose files in the workspace, and add their relative paths to the list
				const composeFileUris = await vscode.workspace.findFiles(
					new vscode.RelativePattern(workspaceFolder, '**/docker-compose*.yml'),
					new vscode.RelativePattern(workspaceFolder, '**/node_modules/**')
				);

				composeFileUris.forEach(composeFileUri => {
					const composeFilePath = path.relative(workspaceFolder.uri.fsPath, composeFileUri.fsPath);
					composeFiles.push(composeFilePath);
				});

				const composeFileUris2 = await vscode.workspace.findFiles(
					new vscode.RelativePattern(workspaceFolder, '**/docker-compose*.yaml'),
					new vscode.RelativePattern(workspaceFolder, '**/node_modules/**')
				);

				composeFileUris2.forEach(composeFileUri => {
					const composeFilePath = path.relative(workspaceFolder.uri.fsPath, composeFileUri.fsPath);
					composeFiles.push(composeFilePath);
				});
			}
		}

		if (composeFiles.length === 0) {
			vscode.window.showInformationMessage('No Docker Compose files found in the workspace.');
			return;
		}

		const composePaths = vscode.workspace.getConfiguration('ignitionFlint').get<string[]>('composePaths');

		if (composePaths && composePaths.length > 0) {
			const replaceComposePaths = await vscode.window.showInformationMessage(
				'Docker Compose files found. Do you want to replace the existing compose paths in the settings?',
				'Yes',
				'No'
			);

			if (replaceComposePaths === 'Yes') {
				await vscode.workspace.getConfiguration('ignitionFlint').update('composePaths', composeFiles, vscode.ConfigurationTarget.Workspace);
				vscode.window.showInformationMessage(`${composeFiles.length} Docker Compose file(s) set in the workspace.`);
			}
		} else {
			const updateComposePaths = await vscode.window.showInformationMessage(
				`${composeFiles.length} Docker Compose file(s) files found. Do you want to add them to the workspace?`,
				'Yes',
				'No'
			);

			if (updateComposePaths === 'Yes') {
				await vscode.workspace.getConfiguration('ignitionFlint').update('composePaths', composeFiles, vscode.ConfigurationTarget.Workspace);
			}
		}
	}

	async identifyGateways(): Promise<void> {
		const composePaths = vscode.workspace.getConfiguration('ignitionFlint').get<string[]>('composePaths');

		if (!(composePaths && composePaths.length > 0)) {
			vscode.window.showInformationMessage('No Docker Compose files found in the workspace settings.');
			return;
		}

		const gatewayConfigs: IgnitionGatewayConfigElement[] = [];

		for (const composePath of composePaths) {
			const composeFilePath = path.join(this.workspaceRoot, composePath);
			const composeContent = fs.readFileSync(composeFilePath, 'utf-8');
			const composeData = yaml.load(composeContent) as ComposeData | undefined;

			if (composeData && composeData.services) {
				for (const [serviceName, serviceConfig] of Object.entries(composeData.services)) {
					if (serviceConfig.image && serviceConfig.image.includes('ignition')) {
						const traefikHostname = serviceConfig.labels?.['traefik.hostname'];
						const containerHostname = serviceConfig.hostname;
						const containerName = serviceConfig.container_name;
						const label = traefikHostname || containerHostname || containerName || serviceName;

						if (traefikHostname) {
							const address = `https://${traefikHostname}.localtest.me`;
							const projectPaths: string[] = [];

							if (serviceConfig.volumes) {
								serviceConfig.volumes.forEach((volume: string) => {
									const [hostPath, containerPath] = volume.split(':');
									if (containerPath === '/workdir/projects' || containerPath.startsWith('/workdir/projects/')) {
										projectPaths.push(path.join(hostPath));
									} else if (containerPath === '/usr/local/bin/ignition/data/projects' || containerPath.startsWith('/usr/local/bin/ignition/data/projects/')) {
										projectPaths.push(path.join(hostPath));
									} else if (containerPath === '/workdir') {
										projectPaths.push(path.join(hostPath, 'projects'));
									}
								});
							}

							const updateDesignerOnSave = true;
							const forceUpdateDesigner = false;
							const supportsProjectScanEndpoint = await this.supportsProjectScanEndpoint(address);

							gatewayConfigs.push({
								label,
								address,
								projectPaths,
								updateDesignerOnSave,
								forceUpdateDesigner,
								supportsProjectScanEndpoint
							});
						}
					}
				}
			}
		}

		if (gatewayConfigs.length === 0) {
			vscode.window.showInformationMessage('No Ignition gateways found in the Docker Compose files.');
			return;
		}

		const existingGatewayConfigs = vscode.workspace.getConfiguration('ignitionFlint').get<IgnitionGatewayConfigElement[]>('ignitionGateways');

		if (existingGatewayConfigs && existingGatewayConfigs.length > 0) {
			const overwriteConfig = await vscode.window.showInformationMessage(
				'Existing gateway configurations found. Do you want to overwrite them with the new values?',
				'Yes',
				'No'
			);

			if (overwriteConfig === 'Yes') {
				await vscode.workspace.getConfiguration('ignitionFlint').update('ignitionGateways', gatewayConfigs, vscode.ConfigurationTarget.Workspace);
				vscode.window.showInformationMessage(`${gatewayConfigs.length} Ignition gateway(s) set in the workspace settings.`);
				this.refresh();
			}
		} else {
			const updateGateways = await vscode.window.showInformationMessage(
				`${gatewayConfigs.length} Ignition gateway(s) found. Do you want to add them to the workspace settings?`,
				'Yes',
				'No'
			);

			if (updateGateways === 'Yes') {
				await vscode.workspace.getConfiguration('ignitionFlint').update('ignitionGateways', gatewayConfigs, vscode.ConfigurationTarget.Workspace);
				vscode.window.showInformationMessage(`${gatewayConfigs.length} Ignition gateway(s) set in the workspace settings.`);
				this.refresh();
			}
		}
	}

	getRelevantGatewaysForProjectPath(projectPath: string): IgnitionGateway[] {
		const relevantGateways: IgnitionGateway[] = [];
		const gatewayConfigs = vscode.workspace.getConfiguration('ignitionFlint').get<IgnitionGatewayConfigElement[]>('ignitionGateways');
	
		if (gatewayConfigs) {
			for (const config of gatewayConfigs) {
				// Check if any of the list items in projectPaths match part of the projectPath
				if (config.projectPaths.some((path) => { return projectPath.includes(path) || path.includes(projectPath)} )) {
					relevantGateways.push(new IgnitionGateway(config));
				}
			}
		}
	
		return relevantGateways;
	}
}

export class IgnitionGateway extends vscode.TreeItem {
	public contextValue = 'ignitionGateway';
	public readonly updateDesignerOnSave: boolean;
	public readonly forceUpdateDesigner: boolean;
	public readonly supportsProjectScanEndpoint: boolean;

	constructor(public readonly config: IgnitionGatewayConfigElement) {
		super(config.label, vscode.TreeItemCollapsibleState.None);
		this.description = config.address;
		this.updateDesignerOnSave = config.updateDesignerOnSave;
		this.forceUpdateDesigner = config.forceUpdateDesigner;
		this.supportsProjectScanEndpoint = config.supportsProjectScanEndpoint;

		if (this.supportsProjectScanEndpoint) {
			this.contextValue = 'ignitionGateway.supportsProjectScanEndpoint';
		}

		this.command = {
			command: 'ignition-flint.openGatewayUrl',
			title: 'Open Gateway URL',
			arguments: [config.address]
		};
	}
}