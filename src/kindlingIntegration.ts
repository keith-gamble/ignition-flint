import * as vscode from 'vscode';
import { exec } from 'child_process';

export function openWithKindling(uri: vscode.Uri) {
    if (!uri) {
        vscode.window.showWarningMessage('No file selected.');
        return;
    }

    const filePath = uri.fsPath;
    const command = getKindlingCommand(filePath);

    exec(command, (error) => {
        if (error) {
            vscode.window.showErrorMessage(`Failed to open file with Kindling: ${error.message}`);
        }
    });
}

function getKindlingCommand(filePath: string): string {
    switch (process.platform) {
        case 'win32':
            return `start Kindling "${filePath}"`;
        case 'darwin':
            return `open -a Kindling "${filePath}"`;
        default:
            return `kindling "${filePath}"`;
    }
}