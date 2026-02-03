/**
 * @module LspClientService
 * @description Client service for LSP (Language Server Protocol) functionality via Designer Bridge
 * Provides code completion, hover, and signature help from Ignition's ScriptManager
 */

import { ConnectionState, DesignerConnectionManager, LspCacheInvalidationData } from './DesignerConnectionManager';

import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * LSP completion item structure (matches the module-side CompletionItem.java)
 */
export interface LspCompletionItem {
    /** The label shown in the completion list */
    label: string;
    /** The kind of completion (function=3, module=9, etc.) */
    kind: number;
    /** Additional detail shown inline */
    detail?: string;
    /** Full documentation shown in hover */
    documentation?: string;
    /** Text to insert when selecting this item */
    insertText?: string;
    /** Insert text format: 1=PlainText, 2=Snippet */
    insertTextFormat?: number;
    /** Text used for sorting */
    sortText?: string;
    /** Text used for filtering */
    filterText?: string;
    /** Full path of the completion (e.g., system.tag.readBlocking) */
    path?: string;
    /** Whether the item is deprecated */
    deprecated?: boolean;
}

/**
 * LSP completion result structure
 */
export interface LspCompletionResult {
    /** Whether the result is incomplete and should be refreshed on further typing */
    isIncomplete: boolean;
    /** List of completion items */
    items: LspCompletionItem[];
}

/**
 * Cache entry for completion results
 */
interface CompletionCacheEntry {
    result: LspCompletionResult;
    timestamp: number;
}

/**
 * Client service for LSP functionality via Designer Bridge.
 * Wraps the DesignerConnectionManager to provide LSP-specific methods with caching.
 */
export class LspClientService implements IServiceLifecycle {
    private static readonly CACHE_TTL_MS = 2000; // 2 second cache - short for quick updates

    private status: ServiceStatus = ServiceStatus.NOT_INITIALIZED;
    private completionCache: Map<string, CompletionCacheEntry> = new Map();
    private connectionManager: DesignerConnectionManager | null = null;
    private cacheInvalidationHandler: ((data: LspCacheInvalidationData) => void) | null = null;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    initialize(): Promise<void> {
        this.status = ServiceStatus.INITIALIZING;
        this.status = ServiceStatus.INITIALIZED;
        return Promise.resolve();
    }

    async start(): Promise<void> {
        if (this.status !== ServiceStatus.INITIALIZED && this.status !== ServiceStatus.STOPPED) {
            await this.initialize();
        }
        this.status = ServiceStatus.RUNNING;
    }

    stop(): Promise<void> {
        this.status = ServiceStatus.STOPPING;
        this.completionCache.clear();
        this.status = ServiceStatus.STOPPED;
        return Promise.resolve();
    }

    async dispose(): Promise<void> {
        await this.stop();

        // Unregister cache invalidation handler
        if (this.connectionManager && this.cacheInvalidationHandler) {
            this.connectionManager.offLspCacheInvalidation(this.cacheInvalidationHandler);
        }
        this.cacheInvalidationHandler = null;
        this.connectionManager = null;
    }

    getStatus(): ServiceStatus {
        return this.status;
    }

    /**
     * Sets the connection manager to use for LSP requests.
     * This allows the service to be used without directly depending on DesignerBridgeService.
     */
    setConnectionManager(connectionManager: DesignerConnectionManager): void {
        // Unregister from previous connection manager if any
        if (this.connectionManager && this.cacheInvalidationHandler) {
            this.connectionManager.offLspCacheInvalidation(this.cacheInvalidationHandler);
        }

        this.connectionManager = connectionManager;

        // Clear cache when connection state changes
        connectionManager.onConnectionStateChanged((state: ConnectionState) => {
            if (state !== ConnectionState.CONNECTED) {
                this.completionCache.clear();
            }
        });

        // Subscribe to cache invalidation notifications from Designer
        this.cacheInvalidationHandler = (data: LspCacheInvalidationData): void => {
            console.log(`[LspClientService] Cache invalidation received: ${data.count} ${data.reason}`);
            this.invalidateCache();
        };
        connectionManager.onLspCacheInvalidation(this.cacheInvalidationHandler);
    }

    /**
     * Checks if the Designer is connected and LSP is available
     */
    isAvailable(): boolean {
        return (
            this.connectionManager !== null && this.connectionManager.getConnectionState() === ConnectionState.CONNECTED
        );
    }

    /**
     * Gets completion items for the given prefix.
     * Results are cached with a TTL to reduce round-trips.
     *
     * @param prefix The module path prefix (e.g., "system.tag" or "")
     * @returns CompletionResult containing matching items, or null if unavailable
     */
    async getCompletions(prefix: string): Promise<LspCompletionResult | null> {
        if (!this.isAvailable() || !this.connectionManager) {
            return null;
        }

        // Normalize prefix
        const normalizedPrefix = prefix?.trim() ?? '';

        // Check cache
        const cached = this.completionCache.get(normalizedPrefix);
        const now = Date.now();
        if (cached && now - cached.timestamp < LspClientService.CACHE_TTL_MS) {
            return cached.result;
        }

        try {
            const result = await this.connectionManager.sendRequest<LspCompletionResult>('lsp.completion', {
                prefix: normalizedPrefix
            });

            // Cache the result
            this.completionCache.set(normalizedPrefix, {
                result,
                timestamp: now
            });

            return result;
        } catch (error) {
            console.error('[LspClientService] Error getting completions:', error);
            return null;
        }
    }

    /**
     * Invalidates the completion cache locally.
     * Call this when project changes are detected that might affect completions.
     */
    invalidateCache(): void {
        this.completionCache.clear();
    }

    /**
     * Invalidates caches on both client and server side.
     * Use this after saving files to ensure fresh completions.
     */
    async invalidateCacheRemote(): Promise<void> {
        // Clear local cache
        this.completionCache.clear();

        // Tell Designer to clear its cache too
        if (this.isAvailable() && this.connectionManager) {
            try {
                await this.connectionManager.sendRequest('lsp.invalidateCache', {});
                console.log('[LspClientService] Remote cache invalidated');
            } catch (error) {
                console.error('[LspClientService] Error invalidating remote cache:', error);
            }
        }
    }

    /**
     * Cleans up expired cache entries.
     * Called periodically to prevent memory bloat.
     */
    cleanExpiredCache(): void {
        const now = Date.now();
        for (const [key, entry] of this.completionCache.entries()) {
            if (now - entry.timestamp >= LspClientService.CACHE_TTL_MS) {
                this.completionCache.delete(key);
            }
        }
    }
}
