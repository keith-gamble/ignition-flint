import { GatewayConfig } from './gateway';

export interface FlintWorkspaceConfig {
    projectPaths: string[];
    gateways: Record<string, GatewayConfig>;
}
