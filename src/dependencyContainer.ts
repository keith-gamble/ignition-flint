import * as vscode from 'vscode';
import { FileSystemService, VIRTUAL_FS } from './services/fileSystemService';
import { VirtualFileSystemProvider } from './providers/virtualFileSystem';
import { IgnitionGatewayProvider } from './providers/ignitionGatewayProvider';

export class DependencyContainer {
	private static instance: DependencyContainer;
	private context: vscode.ExtensionContext;
	private fileSystemService: FileSystemService;
	private ignitionGatewayProvider: IgnitionGatewayProvider | undefined;
	private outputChannel: vscode.OutputChannel;



	private constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
		this.context = context;
		this.outputChannel = outputChannel;
		this.fileSystemService = this.createFileSystemService();

		if (vscode.workspace.workspaceFile) {
			this.ignitionGatewayProvider = this.createIgnitionGatewayProvider();
		}
	}

	static getInstance(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): DependencyContainer {
		if (!DependencyContainer.instance) {
			DependencyContainer.instance = new DependencyContainer(context, outputChannel);
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
		const ignitionGatewayProvider = new IgnitionGatewayProvider();
		this.context.subscriptions.push(ignitionGatewayProvider);
		return ignitionGatewayProvider;
	}

	getIgnitionGatewayProvider(): IgnitionGatewayProvider {
		if (!this.ignitionGatewayProvider) {
			throw new Error('Ignition Gateway Provider not available');
		}
		return this.ignitionGatewayProvider;
	}

	getOutputChannel(): vscode.OutputChannel {
		return this.outputChannel;
	}
}