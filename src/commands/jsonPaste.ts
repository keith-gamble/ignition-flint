import * as vscode from 'vscode';

export async function pasteAsJson() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const clipboard = await vscode.env.clipboard.readText();
    const convertedJson = convertToJson(clipboard);

    await editor.edit((editBuilder) => {
        editBuilder.insert(editor.selection.active, convertedJson);
    });

    await vscode.commands.executeCommand('editor.action.formatDocument');
}

function convertToJson(input: string): string {
    // Replace double quotes with a temporary placeholder
    input = input.replace(/"/g, '§§§');

    // Remove 'u' prefix from keys and values
    input = input.replace(/u'/g, "'");

    // Replace single quotes with double quotes
    input = input.replace(/'/g, '"');

    // Replace the temporary placeholder back to double quotes
    input = input.replace(/§§§/g, '\\"');

    // Replace True and False with true and false
    input = input.replace(/True/g, 'true').replace(/False/g, 'false');

    // Wrap unquoted keys in quotes
    input = input.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');

    // Wrap values containing brackets (but not arrays) in quotes
    input = input.replace(/:\s*([^"\[\]]*\[[^\[\]]+\][^"\[\]]*)(?=[,}])/g, ': "$1"');

    // Wrap standalone strings in quotes
    input = input.replace(/:\s*([^"\[\]{},]+)(?=[},])/g, ': "$1"');

    return input;
}