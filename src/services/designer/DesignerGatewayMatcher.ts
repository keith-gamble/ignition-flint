/**
 * @module DesignerGatewayMatcher
 * @description Matches discovered Designer instances to configured gateways
 */

import type { DesignerInstance } from './DesignerDiscoveryService';

import { ServiceContainer } from '@/core/ServiceContainer';
import { GatewayConfig } from '@/core/types/configuration';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { WorkspaceConfigService } from '@/services/config/WorkspaceConfigService';

/**
 * Result of matching a Designer to a gateway
 */
export interface GatewayMatchResult {
    /** The matched gateway ID, if any */
    readonly gatewayId: string | null;
    /** The matched gateway config, if any */
    readonly gateway: GatewayConfig | null;
    /** Whether the match is exact (host/port/ssl all match) */
    readonly isExactMatch: boolean;
    /** Whether the project is in the gateway's project list */
    readonly projectMatched: boolean;
    /** Mismatch details if not a perfect match */
    readonly mismatchReason: string | null;
}

/**
 * Service for matching discovered Designers to configured gateways.
 * This is used to determine which gateway a Designer is connected to,
 * enabling validation before debug sessions.
 */
export class DesignerGatewayMatcher implements IServiceLifecycle {
    private status: ServiceStatus = ServiceStatus.NOT_INITIALIZED;
    private configService: WorkspaceConfigService | null = null;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    initialize(): Promise<void> {
        this.status = ServiceStatus.INITIALIZING;
        try {
            this.configService = this.serviceContainer.get<WorkspaceConfigService>('WorkspaceConfigService');
            this.status = ServiceStatus.INITIALIZED;
        } catch {
            // Config service might not be available yet - that's ok
            this.status = ServiceStatus.INITIALIZED;
        }
        return Promise.resolve();
    }

    async start(): Promise<void> {
        if (this.status !== ServiceStatus.INITIALIZED && this.status !== ServiceStatus.STOPPED) {
            await this.initialize();
        }
        this.status = ServiceStatus.RUNNING;
    }

    stop(): Promise<void> {
        this.status = ServiceStatus.STOPPED;
        return Promise.resolve();
    }

    dispose(): Promise<void> {
        this.configService = null;
        return this.stop();
    }

    getStatus(): ServiceStatus {
        return this.status;
    }

    /**
     * Matches a Designer instance to a configured gateway.
     *
     * Matching logic:
     * 1. Match gateway host/port/ssl to Designer's gateway info
     * 2. Verify the Designer's project is in the gateway's project list (if configured)
     *
     * @param designer The Designer instance to match
     * @returns The match result with gateway info and match quality
     */
    async matchDesignerToGateway(designer: DesignerInstance): Promise<GatewayMatchResult> {
        if (!this.configService) {
            return this.createNoMatchResult('Configuration service not available');
        }

        try {
            const gateways = await this.configService.getGateways();
            return this.findBestMatch(designer, gateways);
        } catch {
            return this.createNoMatchResult('Failed to load gateway configuration');
        }
    }

    /**
     * Finds the best matching gateway for a Designer
     */
    private findBestMatch(designer: DesignerInstance, gateways: Record<string, GatewayConfig>): GatewayMatchResult {
        let bestMatch: GatewayMatchResult | null = null;

        for (const [gatewayId, gateway] of Object.entries(gateways)) {
            const match = this.evaluateMatch(designer, gatewayId, gateway);

            // Perfect match - return immediately
            if (match.isExactMatch && match.projectMatched) {
                return match;
            }

            // Track best partial match
            if (!bestMatch || this.isBetterMatch(match, bestMatch)) {
                bestMatch = match;
            }
        }

        return bestMatch ?? this.createNoMatchResult('No configured gateways match this Designer');
    }

    /**
     * Evaluates how well a Designer matches a gateway configuration
     */
    private evaluateMatch(designer: DesignerInstance, gatewayId: string, gateway: GatewayConfig): GatewayMatchResult {
        const designerGateway = designer.gateway;

        // If gateway host is not configured, it can't match
        if (!gateway.host) {
            return this.createNoMatchResult(`Gateway '${gatewayId}' has no host configured`);
        }

        // Normalize hosts for comparison
        const designerHost = this.normalizeHost(designerGateway.host);
        const gatewayHost = this.normalizeHost(gateway.host);

        // Check host match
        const hostMatches = designerHost === gatewayHost;

        // Check port match
        const portMatches = designerGateway.port === gateway.port;

        // Check SSL match (default to false if not specified)
        const designerSsl = designerGateway.ssl ?? false;
        const gatewaySsl = gateway.ssl ?? false;
        const sslMatches = designerSsl === gatewaySsl;

        const isExactMatch = hostMatches && portMatches && sslMatches;

        // Check if project is in gateway's project list
        const projectMatched = this.isProjectInGateway(designer.project.name, gateway);

        // Build mismatch reason if not perfect
        let mismatchReason: string | null = null;
        if (!isExactMatch || !projectMatched) {
            const reasons: string[] = [];
            if (!hostMatches) {
                reasons.push(`host mismatch (Designer: ${designerHost}, Config: ${gatewayHost})`);
            }
            if (!portMatches) {
                reasons.push(`port mismatch (Designer: ${designerGateway.port}, Config: ${gateway.port})`);
            }
            if (!sslMatches) {
                reasons.push(`SSL mismatch (Designer: ${designerSsl}, Config: ${gatewaySsl})`);
            }
            if (isExactMatch && !projectMatched) {
                reasons.push(`project '${designer.project.name}' not in gateway's project list`);
            }
            mismatchReason = reasons.join('; ');
        }

        return {
            gatewayId: isExactMatch ? gatewayId : null,
            gateway: isExactMatch ? gateway : null,
            isExactMatch,
            projectMatched,
            mismatchReason
        };
    }

    /**
     * Checks if a project is in a gateway's project list
     */
    private isProjectInGateway(projectName: string, gateway: GatewayConfig): boolean {
        // If no projects configured, consider it a match
        if (!gateway.projects || gateway.projects.length === 0) {
            return true;
        }

        // Case-insensitive comparison
        const normalizedProject = projectName.toLowerCase();
        return gateway.projects.some(p => p.toLowerCase() === normalizedProject);
    }

    /**
     * Normalizes a host string for comparison
     */
    private normalizeHost(host: string): string {
        let normalized = host.toLowerCase().trim();

        // Strip protocol prefix if present
        normalized = normalized.replace(/^https?:\/\//, '');

        // Remove trailing slash
        normalized = normalized.replace(/\/$/, '');

        // Treat localhost and 127.0.0.1 as equivalent
        if (normalized === 'localhost' || normalized === '127.0.0.1') {
            return 'localhost';
        }

        return normalized;
    }

    /**
     * Compares two match results to determine which is better
     */
    private isBetterMatch(a: GatewayMatchResult, b: GatewayMatchResult): boolean {
        // Exact match with project is best
        if (a.isExactMatch && a.projectMatched) return true;
        if (b.isExactMatch && b.projectMatched) return false;

        // Exact match without project is next
        if (a.isExactMatch && !b.isExactMatch) return true;
        if (b.isExactMatch && !a.isExactMatch) return false;

        // Prefer matches with project in list
        if (a.projectMatched && !b.projectMatched) return true;
        if (b.projectMatched && !a.projectMatched) return false;

        return false;
    }

    /**
     * Creates a no-match result
     */
    private createNoMatchResult(reason: string): GatewayMatchResult {
        return {
            gatewayId: null,
            gateway: null,
            isExactMatch: false,
            projectMatched: false,
            mismatchReason: reason
        };
    }

    /**
     * Validates that a Designer matches the currently selected gateway.
     * Returns validation warnings if there's a mismatch.
     *
     * @param designer The Designer to validate
     * @param selectedGatewayId The currently selected gateway ID
     * @returns Validation warnings, or empty array if valid
     */
    async validateDesignerForGateway(designer: DesignerInstance, selectedGatewayId: string | null): Promise<string[]> {
        const warnings: string[] = [];

        if (!selectedGatewayId) {
            return warnings; // No gateway selected, nothing to validate
        }

        const match = await this.matchDesignerToGateway(designer);

        if (!match.isExactMatch) {
            warnings.push(
                `Designer gateway (${designer.gateway.host}:${designer.gateway.port}) ` +
                    'does not match selected gateway configuration'
            );
        }

        if (match.isExactMatch && !match.projectMatched) {
            warnings.push(`Project '${designer.project.name}' is not in the selected gateway's project list`);
        }

        if (match.gatewayId && match.gatewayId !== selectedGatewayId) {
            warnings.push(`Designer matches gateway '${match.gatewayId}' but '${selectedGatewayId}' is selected`);
        }

        return warnings;
    }
}
