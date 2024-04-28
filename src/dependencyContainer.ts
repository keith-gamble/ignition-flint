import * as vscode from 'vscode';
import { FileSystemService, VIRTUAL_FS } from './services/fileSystemService';
import { VirtualFileSystemProvider } from './providers/virtualFileSystem';
import { IgnitionGatewayProvider } from './providers/ignitionGatewayProvider';

export class DependencyContainer {
	private static instance: DependencyContainer;
	private context: vscode.ExtensionContext;
	private fileSystemService: FileSystemService;
	private ignitionGatewayProvider: IgnitionGatewayProvider | undefined;

	private constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.fileSystemService = this.createFileSystemService();

		if (vscode.workspace.workspaceFile) {
			this.ignitionGatewayProvider = this.createIgnitionGatewayProvider();
		}
	}

	static getInstance(context: vscode.ExtensionContext): DependencyContainer {
		if (!DependencyContainer.instance) {
			DependencyContainer.instance = new DependencyContainer(context);
		}
		return DependencyContainer.instance;
	}

	getFileSystemService(): FileSystemService {
		return this.fileSystemService;
	}

	private createFileSystemService(): FileSystemService {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
		return new FileSystemService(this.context, workspaceRoot, this);
	}

	getVirtualFileSystemProvider(): VirtualFileSystemProvider {
		return VIRTUAL_FS;
	}

	private createIgnitionGatewayProvider(): IgnitionGatewayProvider {
		return new IgnitionGatewayProvider(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', this);
	}

	getIgnitionGatewayProvider(): IgnitionGatewayProvider {
		if (!this.ignitionGatewayProvider) {
			throw new Error('Ignition Gateway Provider not available');
		}
		return this.ignitionGatewayProvider;
	}
}