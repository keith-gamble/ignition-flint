import * as vscode from 'vscode';
import { VirtualFileSystemProvider } from '../providers/virtualFileSystem';
import { IgnitionFileSystemProvider } from '../providers/ignitionFileSystem';
import { DependencyContainer } from '../dependencyContainer';

export const VIRTUAL_FS = new VirtualFileSystemProvider();

export class FileSystemService {
  public ignitionFileSystemProvider: IgnitionFileSystemProvider;
  public ignitionTreeView: vscode.TreeView<vscode.TreeItem>;

  constructor(context: vscode.ExtensionContext, workspaceRoot: string, dependencyContainer: DependencyContainer) {
    this.ignitionFileSystemProvider = new IgnitionFileSystemProvider(workspaceRoot, dependencyContainer);
    this.ignitionTreeView = vscode.window.createTreeView('ignitionFileSystem', {
      treeDataProvider: this.ignitionFileSystemProvider
    });

    context.subscriptions.push(this.ignitionTreeView);
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider('flint', VIRTUAL_FS, { isCaseSensitive: true }));
    context.subscriptions.push(
      vscode.workspace.onDidCreateFiles((event) => this.ignitionFileSystemProvider.handleFileCreation(event)),
      vscode.workspace.onDidDeleteFiles((event) => this.ignitionFileSystemProvider.handleFileDeletion(event))
    );

    this.ignitionFileSystemProvider.setTreeView(this.ignitionTreeView);
  }

  refreshTreeView() {
    this.ignitionFileSystemProvider.refreshTreeView();
  }

  revealTreeItemForResourceUri(uri: vscode.Uri) {
    this.ignitionFileSystemProvider.revealTreeItemForResourceUri(uri);
  }
}