export interface GatewayConfig {
    id: string;
    host: string;
    port?: number;
    ssl?: boolean;
    projects: string[];
    enabled?: boolean;
    displayName?: string;
    description?: string;
}

export interface GatewayStatus {
    id: string;
    name: string;
    error?: string;
}
