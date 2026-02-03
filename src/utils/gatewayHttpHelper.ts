/**
 * @module GatewayHttpHelper
 * @description HTTP utilities for communicating with Ignition Gateway APIs
 */

import * as fs from 'fs/promises';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';

import { GatewayConfig } from '@/core/types/configuration';
import { ResolvedEnvironmentConfig } from '@/services/environments/EnvironmentService';

/**
 * Requests a project scan on an Ignition Gateway
 * For 8.3+: Hits both Gateway API endpoint and module endpoint
 * For 8.1: Hits only module endpoint
 * @param gatewayConfig Gateway configuration
 * @param projectName Name of the project to scan
 * @param environmentConfig Resolved environment configuration (from EnvironmentService)
 * @param workspaceRoot Workspace root path for resolving relative token file paths
 * @throws Error if scan request fails
 */
export async function requestProjectScan(
    gatewayConfig: GatewayConfig,
    projectName: string,
    environmentConfig: ResolvedEnvironmentConfig,
    workspaceRoot?: string
): Promise<void> {
    const version = environmentConfig.ignitionVersion ?? gatewayConfig.ignitionVersion ?? '8.1.0';
    const is83Plus = compareVersion(version, '8.3.0') >= 0;

    const requestContext = await buildRequestContext(gatewayConfig, environmentConfig, projectName, workspaceRoot);
    await executeScans(is83Plus, requestContext);
}

/**
 * Context for making scan requests
 */
interface ScanRequestContext {
    protocol: typeof http | typeof https;
    host: string;
    port: number;
    ignoreSSLErrors: boolean;
    headers: Record<string, string>;
    body: string;
    moduleEnabled: boolean;
    forceUpdateDesigner: boolean;
}

/**
 * Builds the request context for scanning
 */
async function buildRequestContext(
    gatewayConfig: GatewayConfig,
    environmentConfig: ResolvedEnvironmentConfig,
    projectName: string,
    workspaceRoot?: string
): Promise<ScanRequestContext> {
    const body = JSON.stringify({ projectName });
    const connectionConfig = buildConnectionConfig(gatewayConfig, environmentConfig);
    const moduleConfig = getModuleConfig(environmentConfig);
    const headers = await buildHeaders(body, moduleConfig.apiTokenFilePath, workspaceRoot);

    return {
        ...connectionConfig,
        headers,
        body,
        moduleEnabled: moduleConfig.enabled,
        forceUpdateDesigner: moduleConfig.forceUpdateDesigner
    };
}

/**
 * Builds connection configuration
 */
function buildConnectionConfig(
    gatewayConfig: GatewayConfig,
    environmentConfig: ResolvedEnvironmentConfig
): Pick<ScanRequestContext, 'protocol' | 'host' | 'port' | 'ignoreSSLErrors'> {
    const protocol = (environmentConfig.ssl ?? true) ? 'https' : 'http';
    return {
        protocol: protocol === 'https' ? https : http,
        host: environmentConfig.host,
        port: environmentConfig.port ?? (protocol === 'https' ? 8043 : 8088),
        ignoreSSLErrors: environmentConfig.ignoreSSLErrors ?? gatewayConfig.ignoreSSLErrors ?? false
    };
}

/**
 * Gets project scan module configuration from environment config
 * Note: 'project-scan-endpoint' is defined in the type system (ResolvedModules)
 * To add new modules, update modules.ts types and add similar helper functions
 */
function getModuleConfig(environmentConfig: ResolvedEnvironmentConfig): {
    enabled: boolean;
    apiTokenFilePath: string | undefined;
    forceUpdateDesigner: boolean;
} {
    const module = environmentConfig.modules?.['project-scan-endpoint'];
    return {
        enabled: module?.enabled ?? false,
        apiTokenFilePath: module?.apiTokenFilePath,
        forceUpdateDesigner: module?.forceUpdateDesigner ?? false
    };
}

/**
 * Builds HTTP headers for the request
 */
async function buildHeaders(
    body: string,
    apiTokenFilePath: string | undefined,
    workspaceRoot?: string
): Promise<Record<string, string>> {
    const baseHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString()
    };

    if (!apiTokenFilePath) {
        return baseHeaders;
    }

    const authHeaders = await getAuthHeaders(apiTokenFilePath, workspaceRoot);
    return { ...baseHeaders, ...authHeaders };
}

/**
 * Executes the appropriate scans based on version
 */
async function executeScans(is83Plus: boolean, context: ScanRequestContext): Promise<void> {
    if (is83Plus) {
        await scanFor83Plus(context);
    } else {
        await scanForLegacy(context);
    }
}

/**
 * Executes scans for Ignition 8.3+
 */
async function scanFor83Plus(context: ScanRequestContext): Promise<void> {
    // Always hit Gateway API endpoint
    await makeGatewayRequest({
        protocol: context.protocol,
        host: context.host,
        port: context.port,
        path: '/data/api/v1/scan/projects',
        headers: context.headers,
        body: context.body,
        ignoreSSLErrors: context.ignoreSSLErrors
    });

    // Hit module endpoint if enabled
    if (context.moduleEnabled) {
        const moduleEndpoint = `/data/project-scan-endpoint/scan?updateDesigners=true&forceUpdate=${context.forceUpdateDesigner}`;
        await makeGatewayRequest({
            protocol: context.protocol,
            host: context.host,
            port: context.port,
            path: moduleEndpoint,
            headers: context.headers,
            body: context.body,
            ignoreSSLErrors: context.ignoreSSLErrors
        });
    }
}

/**
 * Executes scans for Ignition 8.1
 */
async function scanForLegacy(context: ScanRequestContext): Promise<void> {
    if (!context.moduleEnabled) {
        return;
    }

    const moduleEndpoint = `/data/project-scan-endpoint/scan?updateDesigners=true&forceUpdate=${context.forceUpdateDesigner}`;
    await makeGatewayRequest({
        protocol: context.protocol,
        host: context.host,
        port: context.port,
        path: moduleEndpoint,
        headers: context.headers,
        body: context.body,
        ignoreSSLErrors: context.ignoreSSLErrors
    });
}

/**
 * Options for making a gateway request
 */
interface GatewayRequestOptions {
    protocol: typeof http | typeof https;
    host: string;
    port: number;
    path: string;
    headers: Record<string, string>;
    body: string;
    ignoreSSLErrors: boolean;
}

/**
 * Makes a single HTTP request to a gateway endpoint
 */
async function makeGatewayRequest(options: GatewayRequestOptions): Promise<void> {
    const { protocol, host, port, path, headers, body, ignoreSSLErrors } = options;
    const requestOptions: http.RequestOptions = {
        hostname: host,
        port,
        path,
        method: 'POST',
        headers
    };

    if (protocol === https) {
        (requestOptions as https.RequestOptions).rejectUnauthorized = !ignoreSSLErrors;
    }

    try {
        const response = await makeHttpRequest(protocol, requestOptions, body);

        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            // Clean up error message based on status code
            let errorMessage: string;

            if (response.statusCode === 401) {
                // Authentication failure - likely missing API token
                errorMessage =
                    'Authentication failed (401). For Ignition 8.3+, add "apiTokenFilePath" to your environment configuration.';
            } else if (response.statusCode === 404) {
                errorMessage =
                    'Endpoint not found (404). The project scan module may not be installed on this gateway.';
            } else if (response.statusCode === 500) {
                // Strip HTML from error body for 500 errors
                const cleanBody = response.body
                    .replace(/<[^>]*>/g, '')
                    .trim()
                    .substring(0, 200);
                errorMessage = `Gateway internal error (500): ${cleanBody}`;
            } else {
                // Generic error - strip HTML if present
                const isHtml = response.body.includes('<html>') || response.body.includes('<!DOCTYPE');
                const cleanBody = isHtml ? `HTTP ${response.statusCode}` : response.body.substring(0, 200);
                errorMessage = `Gateway returned status ${response.statusCode}: ${cleanBody}`;
            }

            throw new Error(errorMessage);
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes('Authentication failed')) {
            // Already a formatted auth error from above, just rethrow
            throw error;
        }

        if (error instanceof Error && error.message.includes('Gateway returned status')) {
            // Already a formatted error from above, just rethrow
            throw error;
        }

        console.error('[GatewayHttpHelper] Request failed:', error);
        throw new Error(`Failed to connect to gateway: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Compares two version strings (e.g., '8.1.0' vs '8.3.0')
 * @returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersion(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;

        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }

    return 0;
}

/**
 * Reads API token from file and returns auth headers
 * Supports two formats:
 *   - Plain text: ignition_token=<token>
 *   - .env style: IGNITION_API_TOKEN=<token>
 * @param apiTokenFilePath Path to API token file (absolute or relative to workspace root)
 * @param workspaceRoot Workspace root path for resolving relative paths
 * @returns Headers object with X-Ignition-Api-Token
 * @throws Error if file format is invalid
 */
async function getAuthHeaders(apiTokenFilePath: string, workspaceRoot?: string): Promise<Record<string, string>> {
    try {
        // Resolve relative paths relative to workspace root
        let resolvedPath = apiTokenFilePath;
        if (!path.isAbsolute(apiTokenFilePath) && workspaceRoot) {
            resolvedPath = path.join(workspaceRoot, apiTokenFilePath);
        }

        const content = await fs.readFile(resolvedPath, 'utf8');

        // Try plain text format: ignition_token=<token>
        let match = content.match(/ignition_token=(.+)/);

        // Try .env format: IGNITION_API_TOKEN=<token>
        if (!match) {
            match = content.match(/IGNITION_API_TOKEN=(.+)/);
        }

        if (!match) {
            throw new Error(
                'Invalid API token file format. Expected: "ignition_token=<token>" or "IGNITION_API_TOKEN=<token>"'
            );
        }

        const token = match[1].trim();
        return {
            'X-Ignition-Api-Token': token
        };
    } catch (error) {
        if (error instanceof Error && error.message.includes('ENOENT')) {
            throw new Error(
                `API token file not found at "${apiTokenFilePath}". Use an absolute path or path relative to workspace root.`
            );
        }
        throw new Error(
            `Failed to read API token from ${apiTokenFilePath}: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Wraps Node.js http/https request in a Promise
 * @param protocol http or https module
 * @param options Request options
 * @param data Optional request body data
 * @returns Promise resolving to response status and body
 */
function makeHttpRequest(
    protocol: typeof http | typeof https,
    options: http.RequestOptions,
    data?: string
): Promise<{ statusCode?: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = protocol.request(options, res => {
            let body = '';

            res.on('data', chunk => {
                body += chunk;
            });

            res.on('end', () => {
                resolve({ statusCode: res.statusCode, body });
            });
        });

        req.on('error', err => {
            reject(err);
        });

        if (data) {
            req.write(data);
        }

        req.end();
    });
}
