/**
 * @module Designer Services
 * @description Services for Designer bridge functionality
 */

export { DesignerBridgeService } from './DesignerBridgeService';
export {
    ConnectionState,
    type DebugEventData,
    DesignerConnectionManager,
    type ExecuteScriptOptions,
    type LspCacheInvalidationData,
    type ProjectScanOptions,
    type ProjectScanResult
} from './DesignerConnectionManager';
export { DesignerDiscoveryService, type DesignerInstance } from './DesignerDiscoveryService';
export { DesignerGatewayMatcher, type GatewayMatchResult } from './DesignerGatewayMatcher';
export { LspClientService, type LspCompletionItem, type LspCompletionResult } from './LspClientService';
