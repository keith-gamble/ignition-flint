/**
 * @module DesignerStatusBarItem
 * @description Status bar item for displaying Designer connection status
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import {
    ConnectionState,
    DesignerBridgeService,
    type DesignerInstance,
    type GatewayMatchResult
} from '@/services/designer';

/**
 * Status bar item that displays Designer connection status
 */
export class DesignerStatusBarItem implements IServiceLifecycle {
    private statusBarItem?: vscode.StatusBarItem;
    private bridgeService?: DesignerBridgeService;
    private isInitialized = false;
    private isVisible = false;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly _context: vscode.ExtensionContext
    ) {}

    initialize(): Promise<void> {
        try {
            // Get the bridge service
            this.bridgeService = this.serviceContainer.get<DesignerBridgeService>('DesignerBridgeService');

            // Create the status bar item
            this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

            // Set command to trigger message prompt when clicked
            this.statusBarItem.command = 'flint.sendMessageToDesigner';

            // Listen for connection state changes
            this.bridgeService.onConnectionStateChanged((state, designer) => {
                this.updateDisplay(state, designer);
            });

            // Listen for discovered designers changes
            this.bridgeService.onDesignersChanged(designers => {
                // Update display if we're not connected
                if (this.bridgeService?.getConnectionState() === ConnectionState.DISCONNECTED) {
                    this.updateDisplay(ConnectionState.DISCONNECTED, null, designers.length);
                }
            });

            this.isInitialized = true;
            return Promise.resolve();
        } catch (error) {
            throw new FlintError(
                'Failed to initialize designer status bar item',
                'DESIGNER_STATUS_BAR_INIT_FAILED',
                'Designer status bar item could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        // Initial display update
        const state = this.bridgeService?.getConnectionState() ?? ConnectionState.DISCONNECTED;
        const designer = this.bridgeService?.getConnectedDesigner() ?? null;
        const designerCount = this.bridgeService?.getDiscoveredDesigners().length ?? 0;
        this.updateDisplay(state, designer, designerCount);

        this.show();
    }

    stop(): Promise<void> {
        this.hide();
        return Promise.resolve();
    }

    async dispose(): Promise<void> {
        await this.stop();
        if (this.statusBarItem) {
            this.statusBarItem.dispose();
            this.statusBarItem = undefined;
        }
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Shows the status bar item
     */
    show(): void {
        if (this.statusBarItem && !this.isVisible) {
            this.statusBarItem.show();
            this.isVisible = true;
        }
    }

    /**
     * Hides the status bar item
     */
    hide(): void {
        if (this.statusBarItem && this.isVisible) {
            this.statusBarItem.hide();
            this.isVisible = false;
        }
    }

    /**
     * Updates the status bar display based on connection state
     */
    private updateDisplay(state: ConnectionState, designer: DesignerInstance | null, availableCount?: number): void {
        if (!this.statusBarItem) return;

        const count = availableCount ?? this.bridgeService?.getDiscoveredDesigners().length ?? 0;
        const matchResult = this.bridgeService?.getGatewayMatchResult() ?? null;

        switch (state) {
            case ConnectionState.CONNECTED:
                this.updateConnectedDisplay(designer, matchResult);
                break;

            case ConnectionState.CONNECTING:
                this.statusBarItem.text = '$(sync~spin) Designer: Connecting...';
                this.statusBarItem.tooltip = 'Connecting to Designer...';
                this.statusBarItem.backgroundColor = undefined;
                break;

            case ConnectionState.AUTHENTICATING:
                this.statusBarItem.text = '$(key) Designer: Authenticating...';
                this.statusBarItem.tooltip = 'Authenticating with Designer...';
                this.statusBarItem.backgroundColor = undefined;
                break;

            case ConnectionState.ERROR:
                this.statusBarItem.text = '$(error) Designer: Error';
                this.statusBarItem.tooltip = 'Connection error - click to reconnect';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;

            case ConnectionState.DISCONNECTED:
            default:
                if (count > 0) {
                    this.statusBarItem.text = `$(debug-disconnect) Designer (${count} available)`;
                    this.statusBarItem.tooltip = `${count} Designer instance(s) found - click to connect`;
                } else {
                    this.statusBarItem.text = '$(debug-disconnect) Designer: None';
                    this.statusBarItem.tooltip =
                        'No Designer instances found\n\nMake sure:\n• Flint Designer Bridge module is installed\n• A Designer is running';
                }
                this.statusBarItem.backgroundColor = undefined;
                break;
        }
    }

    /**
     * Updates the display for connected state, including gateway match indicator
     */
    private updateConnectedDisplay(designer: DesignerInstance | null, matchResult: GatewayMatchResult | null): void {
        if (!this.statusBarItem) return;

        const projectName = designer?.project.name ?? 'Connected';

        // Determine match status icon
        let matchIcon: string;
        if (!matchResult) {
            matchIcon = '$(plug)'; // No match info available
        } else if (matchResult.isExactMatch && matchResult.projectMatched) {
            matchIcon = '$(check)'; // Perfect match
        } else if (matchResult.isExactMatch) {
            matchIcon = '$(warning)'; // Gateway matches but project not in list
        } else {
            matchIcon = '$(warning)'; // Gateway doesn't match
        }

        this.statusBarItem.text = `${matchIcon} Designer: ${projectName}`;
        this.statusBarItem.tooltip = this.buildConnectedTooltip(designer, matchResult);

        // Set background color based on match status
        if (matchResult && (!matchResult.isExactMatch || !matchResult.projectMatched)) {
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            this.statusBarItem.backgroundColor = undefined;
        }
    }

    /**
     * Builds the tooltip for connected state
     */
    private buildConnectedTooltip(designer: DesignerInstance | null, matchResult?: GatewayMatchResult | null): string {
        if (!designer) {
            return 'Connected to Designer\n\nClick to send a message';
        }

        const lines = ['Connected to Designer', ''];

        // Add match status
        if (matchResult) {
            if (matchResult.isExactMatch && matchResult.projectMatched) {
                lines.push('✓ Gateway configuration matched');
                if (matchResult.gatewayId) {
                    lines.push(`  Gateway: ${matchResult.gatewayId}`);
                }
            } else if (matchResult.isExactMatch) {
                lines.push('⚠ Gateway matched, but project not in configuration');
                if (matchResult.gatewayId) {
                    lines.push(`  Gateway: ${matchResult.gatewayId}`);
                }
            } else {
                lines.push('⚠ No matching gateway configuration');
            }
            if (matchResult.mismatchReason) {
                lines.push(`  ${matchResult.mismatchReason}`);
            }
            lines.push('');
        }

        lines.push(
            `Project: ${designer.project.name}`,
            `Gateway: ${designer.gateway.host}:${designer.gateway.port}`,
            `User: ${designer.user.username}`,
            `PID: ${designer.pid}`,
            '',
            'Click to send a message to Designer'
        );

        return lines.join('\n');
    }
}
