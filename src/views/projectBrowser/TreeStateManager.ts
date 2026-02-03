/**
 * @module TreeStateManager
 * @description Manages tree view state including expansion, cache, and performance optimization
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { TreeNode } from '@/core/types/tree';

/**
 * Cache entry for tree nodes
 */
interface TreeCacheEntry {
    readonly nodes: readonly TreeNode[];
    readonly timestamp: number;
    readonly hash: string;
    readonly parentId: string;
}

/**
 * Tree state configuration
 */
interface TreeStateConfig {
    readonly cacheEnabled: boolean;
    readonly cacheExpirationMs: number;
    readonly maxCacheEntries: number;
    readonly persistExpansionState: boolean;
    readonly autoCollapseDepth: number;
}

/**
 * Tree expansion state
 */
interface ExpansionState {
    readonly nodeId: string;
    readonly isExpanded: boolean;
    readonly timestamp: number;
    readonly depth: number;
}

/**
 * Manages tree view state, caching, and expansion behavior
 */
export class TreeStateManager implements IServiceLifecycle {
    private static readonly CACHE_KEY_PREFIX = 'flint.tree.cache';
    private static readonly EXPANSION_KEY = 'flint.tree.expansion';
    private static readonly DEFAULT_CONFIG: TreeStateConfig = {
        cacheEnabled: true,
        cacheExpirationMs: 300000, // 5 minutes
        maxCacheEntries: 100,
        persistExpansionState: true,
        autoCollapseDepth: 3
    };

    private treeCache = new Map<string, TreeCacheEntry>();
    private expandedNodes = new Set<string>();
    private config: TreeStateConfig = TreeStateManager.DEFAULT_CONFIG;
    private isInitialized = false;

    private readonly stateChangeEmitter = new vscode.EventEmitter<{
        type: 'expansion' | 'cache' | 'config';
        nodeId?: string;
        data?: unknown;
    }>();
    public readonly onStateChanged = this.stateChangeEmitter.event;

    constructor(
        private readonly serviceContainer: ServiceContainer,
        private readonly context: vscode.ExtensionContext
    ) {}

    async initialize(): Promise<void> {
        try {
            // Load configuration
            this.loadConfiguration();

            // Restore expansion state if enabled
            if (this.config.persistExpansionState) {
                this.restoreExpansionState();
            }

            // Setup cache cleanup
            this.setupCacheCleanup();

            this.isInitialized = true;

            // Ensure Promise compliance for interface
            await Promise.resolve();
        } catch (error) {
            throw new FlintError(
                'Failed to initialize tree state manager',
                'TREE_STATE_INIT_FAILED',
                'Tree state management could not start properly',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async stop(): Promise<void> {
        // Save expansion state if persistence is enabled
        if (this.config.persistExpansionState) {
            await this.saveExpansionState();
        }

        // Clear cache
        this.treeCache.clear();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.stateChangeEmitter.dispose();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Caches tree nodes for a parent
     */
    cacheNodes(parentId: string, nodes: TreeNode[], contentHash?: string): void {
        if (!this.config.cacheEnabled) return;

        // Remove oldest entries if cache is full
        if (this.treeCache.size >= this.config.maxCacheEntries) {
            this.evictOldestCacheEntries();
        }

        const cacheEntry: TreeCacheEntry = {
            nodes: Object.freeze(nodes),
            timestamp: Date.now(),
            hash: contentHash ?? this.generateNodeHash(nodes),
            parentId
        };

        this.treeCache.set(parentId, cacheEntry);

        this.stateChangeEmitter.fire({
            type: 'cache',
            nodeId: parentId,
            data: { cached: nodes.length }
        });
    }

    /**
     * Retrieves cached nodes for a parent
     */
    getCachedNodes(parentId: string, currentHash?: string): TreeNode[] | null {
        if (!this.config.cacheEnabled) return null;

        const entry = this.treeCache.get(parentId);
        if (!entry) return null;

        // Check if cache is expired
        const age = Date.now() - entry.timestamp;
        if (age > this.config.cacheExpirationMs) {
            this.treeCache.delete(parentId);
            return null;
        }

        // Check if content hash matches (if provided)
        if (currentHash && entry.hash !== currentHash) {
            this.treeCache.delete(parentId);
            return null;
        }

        return [...entry.nodes];
    }

    /**
     * Invalidates cache for a specific parent or all cache
     */
    invalidateCache(parentId?: string): void {
        if (parentId) {
            this.treeCache.delete(parentId);
            this.stateChangeEmitter.fire({
                type: 'cache',
                nodeId: parentId,
                data: { invalidated: true }
            });
        } else {
            const count = this.treeCache.size;
            this.treeCache.clear();
            this.stateChangeEmitter.fire({
                type: 'cache',
                data: { clearedEntries: count }
            });
        }
    }

    /**
     * Checks if a node is expanded
     */
    isNodeExpanded(nodeId: string): boolean {
        return this.expandedNodes.has(nodeId);
    }

    /**
     * Sets expansion state for a node
     */
    setNodeExpanded(nodeId: string, expanded: boolean, depth: number = 0): void {
        const wasExpanded = this.expandedNodes.has(nodeId);

        if (expanded) {
            this.expandedNodes.add(nodeId);
        } else {
            this.expandedNodes.delete(nodeId);
        }

        // Auto-collapse deeply nested nodes if configured
        if (expanded && depth > this.config.autoCollapseDepth) {
            setTimeout(() => {
                if (this.expandedNodes.has(nodeId)) {
                    this.setNodeExpanded(nodeId, false, depth);
                }
            }, 30000); // Collapse after 30 seconds
        }

        if (wasExpanded !== expanded) {
            this.stateChangeEmitter.fire({
                type: 'expansion',
                nodeId,
                data: { expanded, depth }
            });
        }
    }

    /**
     * Gets all expanded node IDs
     */
    getExpandedNodes(): string[] {
        return Array.from(this.expandedNodes);
    }

    /**
     * Collapses all nodes
     */
    collapseAll(): void {
        const expandedCount = this.expandedNodes.size;
        this.expandedNodes.clear();

        this.stateChangeEmitter.fire({
            type: 'expansion',
            data: { collapsedAll: true, count: expandedCount }
        });
    }

    /**
     * Expands nodes to a specific depth
     */
    expandToDepth(maxDepth: number, rootNodes: TreeNode[]): void {
        const nodesToExpand: string[] = [];

        const processNodes = (nodes: TreeNode[], currentDepth: number): void => {
            if (currentDepth >= maxDepth) return;

            for (const node of nodes) {
                if (node.children && node.children.length > 0) {
                    nodesToExpand.push(node.id);
                    processNodes([...node.children], currentDepth + 1);
                }
            }
        };

        processNodes(rootNodes, 0);

        for (const nodeId of nodesToExpand) {
            this.setNodeExpanded(nodeId, true);
        }
    }

    /**
     * Updates tree state configuration
     */
    updateConfiguration(newConfig: Partial<TreeStateConfig>): void {
        this.config = { ...this.config, ...newConfig };

        // If caching was disabled, clear cache
        if (!this.config.cacheEnabled) {
            this.invalidateCache();
        }

        this.stateChangeEmitter.fire({
            type: 'config',
            data: { config: this.config }
        });
    }

    /**
     * Gets current configuration
     */
    getConfiguration(): Readonly<TreeStateConfig> {
        return Object.freeze({ ...this.config });
    }

    /**
     * Gets cache statistics
     */
    getCacheStatistics(): {
        readonly entryCount: number;
        readonly totalNodes: number;
        readonly oldestEntryAge: number;
        readonly averageAge: number;
        readonly hitRate: number;
    } {
        const now = Date.now();
        let totalNodes = 0;
        let oldestAge = 0;
        let totalAge = 0;

        for (const entry of this.treeCache.values()) {
            totalNodes += entry.nodes.length;
            const age = now - entry.timestamp;
            if (age > oldestAge) oldestAge = age;
            totalAge += age;
        }

        return {
            entryCount: this.treeCache.size,
            totalNodes,
            oldestEntryAge: oldestAge,
            averageAge: this.treeCache.size > 0 ? totalAge / this.treeCache.size : 0,
            hitRate: this.calculateHitRate()
        };
    }

    /**
     * Calculates cache hit rate
     */
    private calculateHitRate(): number {
        // For now return 0 as we would need to track hits/misses over time
        // This would require adding hit/miss counters to the service
        return 0;
    }

    /**
     * Calculates the depth of a node based on its ID structure
     */
    private calculateNodeDepth(nodeId: string): number {
        // Node IDs typically follow patterns like:
        // - "gateway-selector" (depth 0)
        // - "resource-type-{typeId}" (depth 1)
        // - "folder::{projectId}::{typeId}::{categoryId}::{path}" (depth varies by path)

        if (nodeId.includes('::')) {
            const parts = nodeId.split('::');
            const path = parts[parts.length - 1]; // Last part is usually the path
            if (path?.includes('/')) {
                return path.split('/').length;
            }
            return Math.max(0, parts.length - 4); // Subtract project, type, category base parts
        }

        // Simple node IDs are usually at root level
        return 0;
    }

    /**
     * Loads configuration from VS Code settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('flint.ui.treeView');

        this.config = {
            cacheEnabled: config.get<boolean>('cacheEnabled') ?? TreeStateManager.DEFAULT_CONFIG.cacheEnabled,
            cacheExpirationMs:
                config.get<number>('cacheExpirationMs') ?? TreeStateManager.DEFAULT_CONFIG.cacheExpirationMs,
            maxCacheEntries: config.get<number>('maxCacheEntries') ?? TreeStateManager.DEFAULT_CONFIG.maxCacheEntries,
            persistExpansionState:
                config.get<boolean>('persistExpansionState') ?? TreeStateManager.DEFAULT_CONFIG.persistExpansionState,
            autoCollapseDepth:
                config.get<number>('autoCollapseDepth') ?? TreeStateManager.DEFAULT_CONFIG.autoCollapseDepth
        };
    }

    /**
     * Restores expansion state from storage
     */
    private restoreExpansionState(): void {
        try {
            const storedState = this.context.globalState.get<ExpansionState[]>(TreeStateManager.EXPANSION_KEY);

            if (storedState && Array.isArray(storedState)) {
                const now = Date.now();
                const validStates = storedState.filter(
                    state => now - state.timestamp < 24 * 60 * 60 * 1000 // Keep for 24 hours
                );

                this.expandedNodes.clear();
                for (const state of validStates) {
                    if (state.isExpanded) {
                        this.expandedNodes.add(state.nodeId);
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to restore tree expansion state:', error);
        }
    }

    /**
     * Saves expansion state to storage
     */
    private async saveExpansionState(): Promise<void> {
        try {
            const now = Date.now();
            const expansionStates: ExpansionState[] = [];

            for (const nodeId of this.expandedNodes) {
                expansionStates.push({
                    nodeId,
                    isExpanded: true,
                    timestamp: now,
                    depth: this.calculateNodeDepth(nodeId)
                });
            }

            await this.context.globalState.update(TreeStateManager.EXPANSION_KEY, expansionStates);
        } catch (error) {
            console.warn('Failed to save tree expansion state:', error);
        }
    }

    /**
     * Sets up periodic cache cleanup
     */
    private setupCacheCleanup(): void {
        // Clean cache every 5 minutes
        setInterval(
            () => {
                this.cleanupExpiredCache();
            },
            5 * 60 * 1000
        );
    }

    /**
     * Removes expired cache entries
     */
    private cleanupExpiredCache(): void {
        const now = Date.now();
        let cleanupCount = 0;

        for (const [parentId, entry] of this.treeCache.entries()) {
            const age = now - entry.timestamp;
            if (age > this.config.cacheExpirationMs) {
                this.treeCache.delete(parentId);
                cleanupCount++;
            }
        }

        if (cleanupCount > 0) {
            console.log(`TreeStateManager: Cleaned up ${cleanupCount} expired cache entries`);
        }
    }

    /**
     * Evicts oldest cache entries when cache is full
     */
    private evictOldestCacheEntries(): void {
        const entries = Array.from(this.treeCache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

        const entriesToRemove = Math.floor(this.config.maxCacheEntries * 0.2); // Remove 20%
        for (let i = 0; i < entriesToRemove && i < entries.length; i++) {
            this.treeCache.delete(entries[i][0]);
        }
    }

    /**
     * Generates a hash for node content
     */
    private generateNodeHash(nodes: TreeNode[]): string {
        const content = nodes.map(node => `${node.id}:${node.label}:${node.children?.length ?? 0}`).join('|');
        return Buffer.from(content).toString('base64').substring(0, 16);
    }
}
