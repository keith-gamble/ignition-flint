import * as vscode from 'vscode';
import { FileSystemService, VIRTUAL_FS } from './services/fileSystemService';
import { VirtualFileSystemProvider } from './providers/virtualFileSystem';

export class DependencyContainer {
  private static instance: DependencyContainer;
  private context: vscode.ExtensionContext;
  private fileSystemService: FileSystemService;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.fileSystemService = this.createFileSystemService();
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
    return new FileSystemService(this.context, workspaceRoot);
  }

  getVirtualFileSystemProvider(): VirtualFileSystemProvider {
	return VIRTUAL_FS;
  }
}