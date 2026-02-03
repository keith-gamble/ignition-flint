/**
 * @module OpenProjectJsonCommand
 * @description Command to open project.json file for the active project
 */

import * as path from 'path';

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { COMMANDS } from '@/core/constants/commands';
import { FlintError } from '@/core/errors';
import { CommandContext } from '@/core/types/commands';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';
import { GatewayManagerService } from '@/services/gateways/GatewayManagerService';

/**
 * Command to open the project.json file for the currently active project
 */
export class OpenProjectJsonCommand extends Command {
    constructor(context: CommandContext) {
        super(COMMANDS.OPEN_PROJECT_JSON, context);
    }

    protected async executeImpl(): Promise<void> {
        try {
            const gatewayManager = this.getService<GatewayManagerService>('GatewayManagerService');
            const configService = this.getService<WorkspaceConfigService>('WorkspaceConfigService');

            // Check if project is selected
            const activeProject = gatewayManager.getSelectedProject();
            if (activeProject === null || activeProject.length === 0) {
                vscode.window.showWarningMessage('Please select a project first');
                return;
            }

            // Get project paths from workspace config
            let projectPaths: string[];
            try {
                projectPaths = await configService.getProjectPaths();
            } catch {
                console.warn('Failed to get resolved project paths, trying raw paths fallback');
                const rawPaths = await configService.getRawProjectPaths();
                // Manually resolve relative to workspace root
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? process.cwd();
                projectPaths = rawPaths.map((p: string) => (path.isAbsolute(p) ? p : path.resolve(workspaceRoot, p)));
            }

            // Find the actual project directory
            let projectBasePath: string | undefined;
            for (const basePath of projectPaths) {
                const candidatePath = path.join(basePath, activeProject);
                try {
                    await vscode.workspace.fs.stat(vscode.Uri.file(candidatePath));
                    projectBasePath = candidatePath;
                    break;
                } catch {
                    // Try next path
                }
            }

            if (projectBasePath === undefined || projectBasePath.length === 0) {
                throw new FlintError(`Project '${activeProject}' not found in configured paths`, 'PROJECT_NOT_FOUND');
            }

            // Build path to project.json
            const projectJsonPath = path.join(projectBasePath, 'project.json');

            // Check if project.json exists
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(projectJsonPath));
            } catch {
                vscode.window.showWarningMessage(`project.json not found at: ${projectJsonPath}`);
                return;
            }

            // Open project.json file
            const uri = vscode.Uri.file(projectJsonPath);
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (error) {
            console.error(`Failed to open project.json: ${String(error)}`);
            throw new FlintError(
                'Failed to open project.json',
                'PROJECT_JSON_OPEN_FAILED',
                'Unable to open the project.json file',
                error instanceof Error ? error : undefined
            );
        }
    }
}
