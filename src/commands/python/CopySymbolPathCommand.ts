/**
 * @module CopySymbolPathCommand
 * @description Command to copy the fully qualified path of a Python symbol from the tree view
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { CommandContext } from '@/core/types/commands';
import { TreeNode } from '@/core/types/tree';

/**
 * Command to copy the qualified path of a Python symbol from the project browser tree
 */
export class CopySymbolPathCommand extends Command {
    static readonly ID = 'flint.copySymbolPath';

    constructor(context: CommandContext) {
        super(CopySymbolPathCommand.ID, context);
    }

    protected async executeImpl(treeNode?: TreeNode): Promise<void> {
        if (!treeNode?.metadata) {
            vscode.window.showErrorMessage('No symbol selected');
            return;
        }

        const metadata = treeNode.metadata as any;
        const qualifiedName = metadata.qualifiedName;

        if (!qualifiedName) {
            vscode.window.showErrorMessage('Symbol does not have a qualified path');
            return;
        }

        // For functions and methods, include the parameters
        let textToCopy = qualifiedName;
        if (metadata.symbolType === 'function' || metadata.symbolType === 'method') {
            if (metadata.signature) {
                // Extract just the parameter part from the signature
                const paramsMatch = metadata.signature.match(/\((.*)\)/);
                if (paramsMatch) {
                    textToCopy = `${qualifiedName}(${paramsMatch[1]})`;
                }
            } else if (metadata.parameters && Array.isArray(metadata.parameters)) {
                // Build parameter list from parameters array
                const paramList = metadata.parameters
                    .map((p: any) => {
                        if (p.defaultValue) {
                            return `${p.name}=${p.defaultValue}`;
                        }
                        return p.name as string;
                    })
                    .join(', ');
                textToCopy = `${qualifiedName}(${paramList})`;
            }
        }

        // Copy to clipboard
        await vscode.env.clipboard.writeText(textToCopy);
        vscode.window.showInformationMessage(`Copied: ${textToCopy}`);
    }
}
