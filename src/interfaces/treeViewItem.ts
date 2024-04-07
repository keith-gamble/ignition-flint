import * as vscode from 'vscode';

export interface TreeViewItem {
    getTreeItem(): vscode.TreeItem;
}
