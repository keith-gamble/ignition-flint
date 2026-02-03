/**
 * @module OpenInDesignerCommand
 * @description Command to open resources in the connected Ignition Designer
 */

import * as vscode from 'vscode';

import { Command } from '@/commands/base/Command';
import { FlintError } from '@/core/errors';
import { CommandContext, CommandValidationResult } from '@/core/types/commands';
import { TreeNode } from '@/core/types/tree';
import { DesignerBridgeService } from '@/services/designer/DesignerBridgeService';
import { ConnectionState } from '@/services/designer/DesignerConnectionManager';

/**
 * Type guard to check if argument is a TreeNode with resource info
 */
function isResourceTreeNode(arg: unknown): arg is TreeNode {
    return (
        typeof arg === 'object' && arg !== null && 'resourcePath' in arg && ('typeId' in arg || 'resourceType' in arg)
    );
}

/**
 * Command to open a resource in the connected Ignition Designer
 * Sends a JSON-RPC message to the Designer to navigate to and open the specified resource
 */
export class OpenInDesignerCommand extends Command {
    constructor(context: CommandContext) {
        super('flint.openInDesigner', context);
    }

    protected validateArguments(nodeOrResourceType?: TreeNode | string): CommandValidationResult {
        const errors: string[] = [];

        if (!nodeOrResourceType) {
            errors.push('A resource must be selected to open in Designer');
        }

        if (typeof nodeOrResourceType === 'object' && !isResourceTreeNode(nodeOrResourceType)) {
            errors.push('Selected item is not a valid resource');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings: []
        };
    }

    /**
     * Checks if we can execute this command (Designer must be connected)
     */
    canExecute(nodeOrResourceType?: TreeNode | string): boolean {
        // We can always attempt to execute - we'll prompt for connection if needed
        return nodeOrResourceType !== undefined;
    }

    protected async executeImpl(
        nodeOrResourceType?: TreeNode | string,
        resourcePath?: string,
        categoryId?: string
    ): Promise<void> {
        // Get the Designer bridge service
        const designerBridge = this.getService<DesignerBridgeService>('DesignerBridgeService');

        // Extract resource info from TreeNode or parameters
        let typeId: string | undefined;
        let actualResourcePath: string | undefined;
        let actualCategoryId: string | undefined;

        if (isResourceTreeNode(nodeOrResourceType)) {
            // Called with TreeNode object (from context menu)
            typeId = nodeOrResourceType.typeId ?? nodeOrResourceType.resourceType;
            actualResourcePath = nodeOrResourceType.resourcePath;
            actualCategoryId = nodeOrResourceType.categoryId;
        } else if (typeof nodeOrResourceType === 'string') {
            // Called with individual parameters
            typeId = nodeOrResourceType;
            actualResourcePath = resourcePath;
            actualCategoryId = categoryId;
        }

        if (!typeId || !actualResourcePath) {
            throw new FlintError(
                'Resource type and path are required',
                'INVALID_RESOURCE_INFO',
                'Cannot open resource without type and path information'
            );
        }

        // Check connection state
        const connectionState = designerBridge.getConnectionState();

        if (connectionState !== ConnectionState.CONNECTED) {
            // Prompt user to connect
            const connect = await vscode.window.showInformationMessage(
                'Not connected to a Designer. Would you like to connect?',
                'Connect',
                'Cancel'
            );

            if (connect === 'Connect') {
                const connected = await designerBridge.selectAndConnect();
                if (!connected) {
                    return; // User cancelled or connection failed
                }
            } else {
                return; // User cancelled
            }
        }

        // Send the open resource request to Designer
        try {
            const connectionManager = designerBridge.getConnectionManager();
            const result = await connectionManager.sendRequest<{
                success: boolean;
                resourceType: string;
                resourcePath: string;
            }>('designer.openResource', {
                resourceType: typeId,
                resourcePath: actualResourcePath,
                categoryId: actualCategoryId
            });

            if (result.success) {
                void vscode.window.showInformationMessage(
                    `Opened ${this.formatResourceName(actualResourcePath)} in Designer`
                );
            } else {
                throw new FlintError(
                    'Designer failed to open resource',
                    'DESIGNER_OPEN_FAILED',
                    'The Designer could not open the requested resource'
                );
            }
        } catch (error) {
            // Handle specific error cases
            if (error instanceof FlintError) {
                throw error;
            }

            const errorMessage = error instanceof Error ? error.message : String(error);

            // Check for common errors
            if (errorMessage.includes('Unsupported resource type')) {
                throw new FlintError(
                    `Resource type '${typeId}' is not supported for opening in Designer`,
                    'UNSUPPORTED_RESOURCE_TYPE',
                    'This resource type cannot be opened via Designer Bridge'
                );
            }

            throw new FlintError(
                'Failed to open resource in Designer',
                'DESIGNER_COMMUNICATION_ERROR',
                errorMessage,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Formats a resource path for display
     */
    private formatResourceName(resourcePath: string): string {
        // Get the last segment of the path as the display name
        const segments = resourcePath.split('/');
        return segments[segments.length - 1] || resourcePath;
    }
}
