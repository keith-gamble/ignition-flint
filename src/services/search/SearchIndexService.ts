/**
 * @module SearchIndexService
 * @description Service for building and maintaining search indexes for fast resource discovery
 * Provides full-text indexing, metadata extraction, and efficient search capabilities
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Search index document representing an indexed resource
 */
export interface SearchIndexDocument {
    readonly id: string;
    readonly resourcePath: string;
    readonly projectId: string;
    readonly resourceType: string;
    readonly displayName: string;
    readonly content?: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly lastModified: number;
    readonly size: number;
    readonly tags: readonly string[];
}

/**
 * Search index entry for efficient lookups
 */
interface SearchIndexEntry {
    readonly document: SearchIndexDocument;
    readonly tokens: readonly string[];
    readonly ngrams: readonly string[];
}

/**
 * Index update operation
 */
interface IndexUpdateOperation {
    readonly type: 'add' | 'update' | 'delete';
    readonly documentId: string;
    readonly document?: SearchIndexDocument;
    readonly timestamp: number;
}

/**
 * Index statistics
 */
export interface IndexStatistics {
    readonly totalDocuments: number;
    readonly totalTokens: number;
    readonly documentsByType: Readonly<Record<string, number>>;
    readonly documentsByProject: Readonly<Record<string, number>>;
    readonly indexSize: number;
    readonly lastUpdated: string;
    readonly updateOperations: number;
}

/**
 * Search index query options
 */
export interface IndexQueryOptions {
    readonly projectIds?: readonly string[];
    readonly resourceTypes?: readonly string[];
    readonly tags?: readonly string[];
    readonly limit?: number;
    readonly offset?: number;
    readonly sortBy?: 'relevance' | 'name' | 'modified' | 'type';
    readonly sortOrder?: 'asc' | 'desc';
}

/**
 * Search index query result
 */
export interface IndexQueryResult {
    readonly documents: readonly SearchIndexDocument[];
    readonly totalCount: number;
    readonly queryTime: number;
    readonly facets?: Readonly<Record<string, Record<string, number>>>;
}

/**
 * High-performance search indexing service
 */
export class SearchIndexService implements IServiceLifecycle {
    private static readonly MAX_CONTENT_SIZE = 1024 * 1024; // 1MB
    private static readonly INDEX_VERSION = '1.0';
    private static readonly NGRAM_SIZE = 3;
    private static readonly UPDATE_BATCH_SIZE = 100;

    private searchIndex = new Map<string, SearchIndexEntry>();
    private tokenIndex = new Map<string, Set<string>>(); // token -> document IDs
    private ngramIndex = new Map<string, Set<string>>(); // ngram -> document IDs
    private pendingUpdates: IndexUpdateOperation[] = [];
    private isInitialized = false;
    private indexFilePath: string | null = null;
    private updateTimer: NodeJS.Timeout | null = null;

    private readonly indexUpdatedEmitter = new vscode.EventEmitter<{
        operation: 'add' | 'update' | 'delete';
        documentId: string;
        document?: SearchIndexDocument;
    }>();
    public readonly onIndexUpdated = this.indexUpdatedEmitter.event;

    private readonly indexRebuildEmitter = new vscode.EventEmitter<{
        totalDocuments: number;
        duration: number;
    }>();
    public readonly onIndexRebuilt = this.indexRebuildEmitter.event;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    async initialize(): Promise<void> {
        await this.setupIndexStorage();
        await this.loadSearchIndex();
        this.setupPeriodicUpdates();
        this.isInitialized = true;
        // console.log(`SearchIndexService initialized with ${this.searchIndex.size} documents`);
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            throw new FlintError('SearchIndexService must be initialized before starting', 'SERVICE_NOT_INITIALIZED');
        }
        // console.log('SearchIndexService started');
        return Promise.resolve();
    }

    async stop(): Promise<void> {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }

        // Process any remaining updates
        this.processPendingUpdates();

        // Save index
        await this.saveSearchIndex();

        console.log('SearchIndexService stopped');
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.searchIndex.clear();
        this.tokenIndex.clear();
        this.ngramIndex.clear();
        this.pendingUpdates = [];
        this.indexUpdatedEmitter.dispose();
        this.indexRebuildEmitter.dispose();
        this.isInitialized = false;
        console.log('SearchIndexService disposed');
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Adds or updates a document in the search index
     */
    indexDocument(document: SearchIndexDocument): void {
        const operation: IndexUpdateOperation = {
            type: this.searchIndex.has(document.id) ? 'update' : 'add',
            documentId: document.id,
            document,
            timestamp: Date.now()
        };

        this.pendingUpdates.push(operation);

        // Process immediately if batch size reached
        if (this.pendingUpdates.length >= SearchIndexService.UPDATE_BATCH_SIZE) {
            this.processPendingUpdates();
        }

        console.log(`Queued document for indexing: ${document.id} (${operation.type})`);
    }

    /**
     * Removes a document from the search index
     */
    removeDocument(documentId: string): void {
        const operation: IndexUpdateOperation = {
            type: 'delete',
            documentId,
            timestamp: Date.now()
        };

        this.pendingUpdates.push(operation);

        console.log(`Queued document for removal: ${documentId}`);
    }

    /**
     * Queries the search index with advanced options
     */
    queryIndex(query: string, options: IndexQueryOptions = {}): IndexQueryResult {
        const queryStartTime = Date.now();

        try {
            // Tokenize query
            const queryTokens = this.tokenizeText(query.toLowerCase());
            const queryNgrams = this.generateNgrams(query.toLowerCase());

            // Find candidate documents
            const candidateIds = this.findCandidateDocuments(queryTokens, queryNgrams);

            // Filter candidates based on options
            const filteredCandidates = this.filterCandidates(candidateIds, options);

            // Score and sort documents
            const scoredDocuments = this.scoreDocuments(filteredCandidates, queryTokens, queryNgrams);

            // Apply sorting
            this.sortDocuments(scoredDocuments, options.sortBy ?? 'relevance', options.sortOrder ?? 'desc');

            // Apply pagination
            const offset = options.offset ?? 0;
            const limit = options.limit ?? 100;
            const paginatedResults = scoredDocuments.slice(offset, offset + limit);

            // Generate facets if requested
            const facets = this.generateFacets(filteredCandidates);

            const queryTime = Date.now() - queryStartTime;

            console.log(
                `Index query completed: "${query}" - ${paginatedResults.length}/${scoredDocuments.length} results in ${queryTime}ms`
            );

            return {
                documents: paginatedResults.map(item => item.document),
                totalCount: scoredDocuments.length,
                queryTime,
                facets
            };
        } catch (error) {
            console.error(`Index query failed for "${query}":`, error);
            throw new FlintError(
                `Index query failed: ${error instanceof Error ? error.message : String(error)}`,
                'INDEX_QUERY_FAILED',
                'Search index query failed',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Rebuilds the entire search index
     */
    async rebuildIndex(documents: SearchIndexDocument[]): Promise<void> {
        const rebuildStartTime = Date.now();

        try {
            console.log(`Starting index rebuild with ${documents.length} documents`);

            // Clear existing indexes
            this.searchIndex.clear();
            this.tokenIndex.clear();
            this.ngramIndex.clear();

            // Index all documents
            for (const document of documents) {
                this.indexDocumentInternal(document);
            }

            // Save the rebuilt index
            await this.saveSearchIndex();

            const duration = Date.now() - rebuildStartTime;

            this.indexRebuildEmitter.fire({
                totalDocuments: documents.length,
                duration
            });

            console.log(`Index rebuild completed: ${documents.length} documents in ${duration}ms`);
        } catch (error) {
            console.error('Index rebuild failed:', error);
            throw new FlintError(
                `Index rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
                'INDEX_REBUILD_FAILED',
                'Failed to rebuild search index',
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Gets index statistics
     */
    getIndexStatistics(): IndexStatistics {
        const documentsByType: Record<string, number> = {};
        const documentsByProject: Record<string, number> = {};
        let totalTokens = 0;

        for (const entry of this.searchIndex.values()) {
            const doc = entry.document;

            // Count by type
            documentsByType[doc.resourceType] = (documentsByType[doc.resourceType] ?? 0) + 1;

            // Count by project
            documentsByProject[doc.projectId] = (documentsByProject[doc.projectId] ?? 0) + 1;

            // Count tokens
            totalTokens += entry.tokens.length;
        }

        const indexSize = this.calculateIndexSize();

        return Object.freeze({
            totalDocuments: this.searchIndex.size,
            totalTokens,
            documentsByType: Object.freeze(documentsByType),
            documentsByProject: Object.freeze(documentsByProject),
            indexSize,
            lastUpdated: new Date().toISOString(),
            updateOperations: this.pendingUpdates.length
        });
    }

    /**
     * Optimizes the search index for better performance
     */
    async optimizeIndex(): Promise<void> {
        console.log('Starting index optimization');

        // Remove empty entries from token and ngram indexes
        for (const [token, docIds] of this.tokenIndex.entries()) {
            if (docIds.size === 0) {
                this.tokenIndex.delete(token);
            }
        }

        for (const [ngram, docIds] of this.ngramIndex.entries()) {
            if (docIds.size === 0) {
                this.ngramIndex.delete(ngram);
            }
        }

        // Save optimized index
        await this.saveSearchIndex();

        console.log('Index optimization completed');
    }

    /**
     * Clears the entire search index
     */
    async clearIndex(): Promise<void> {
        this.searchIndex.clear();
        this.tokenIndex.clear();
        this.ngramIndex.clear();
        this.pendingUpdates = [];

        await this.saveSearchIndex();

        console.log('Search index cleared');
    }

    /**
     * Processes pending index updates
     */
    private processPendingUpdates(): void {
        if (this.pendingUpdates.length === 0) {
            return;
        }

        const updates = [...this.pendingUpdates];
        this.pendingUpdates = [];

        for (const update of updates) {
            try {
                switch (update.type) {
                    case 'add':
                    case 'update':
                        if (update.document) {
                            this.indexDocumentInternal(update.document);
                            this.indexUpdatedEmitter.fire({
                                operation: update.type,
                                documentId: update.documentId,
                                document: update.document
                            });
                        }
                        break;

                    case 'delete':
                        this.removeDocumentInternal(update.documentId);
                        this.indexUpdatedEmitter.fire({
                            operation: 'delete',
                            documentId: update.documentId
                        });
                        break;

                    default:
                        console.error(`Unknown update operation type: ${String(update.type)}`);
                        break;
                }
            } catch (error) {
                console.error(`Failed to process index update for ${update.documentId}:`, error);
            }
        }

        console.log(`Processed ${updates.length} index updates`);
    }

    /**
     * Internally indexes a document
     */
    private indexDocumentInternal(document: SearchIndexDocument): void {
        // Remove existing entry if updating
        if (this.searchIndex.has(document.id)) {
            this.removeDocumentInternal(document.id);
        }

        // Tokenize document content
        const textContent = this.extractTextContent(document);
        const tokens = this.tokenizeText(textContent);
        const ngrams = this.generateNgrams(textContent);

        // Create index entry
        const entry: SearchIndexEntry = {
            document,
            tokens: Object.freeze(tokens),
            ngrams: Object.freeze(ngrams)
        };

        // Add to main index
        this.searchIndex.set(document.id, entry);

        // Update token index
        for (const token of tokens) {
            if (!this.tokenIndex.has(token)) {
                this.tokenIndex.set(token, new Set());
            }
            this.tokenIndex.get(token)!.add(document.id);
        }

        // Update ngram index
        for (const ngram of ngrams) {
            if (!this.ngramIndex.has(ngram)) {
                this.ngramIndex.set(ngram, new Set());
            }
            this.ngramIndex.get(ngram)!.add(document.id);
        }
    }

    /**
     * Internally removes a document from the index
     */
    private removeDocumentInternal(documentId: string): void {
        const entry = this.searchIndex.get(documentId);
        if (!entry) {
            return;
        }

        // Remove from token index
        for (const token of entry.tokens) {
            const docIds = this.tokenIndex.get(token);
            if (docIds) {
                docIds.delete(documentId);
                if (docIds.size === 0) {
                    this.tokenIndex.delete(token);
                }
            }
        }

        // Remove from ngram index
        for (const ngram of entry.ngrams) {
            const docIds = this.ngramIndex.get(ngram);
            if (docIds) {
                docIds.delete(documentId);
                if (docIds.size === 0) {
                    this.ngramIndex.delete(ngram);
                }
            }
        }

        // Remove from main index
        this.searchIndex.delete(documentId);
    }

    /**
     * Extracts text content from a document for indexing
     */
    private extractTextContent(document: SearchIndexDocument): string {
        const parts: string[] = [document.displayName, document.resourcePath, ...document.tags];

        if (document.content) {
            parts.push(document.content);
        }

        // Add metadata values
        for (const value of Object.values(document.metadata)) {
            if (typeof value === 'string') {
                parts.push(value);
            }
        }

        return parts.join(' ').toLowerCase();
    }

    /**
     * Tokenizes text into searchable tokens
     */
    private tokenizeText(text: string): string[] {
        // Simple tokenization - split on non-alphanumeric characters
        return text
            .toLowerCase()
            .split(/[^a-zA-Z0-9]+/)
            .filter(token => token.length > 0)
            .filter(token => token.length >= 2); // Minimum token length
    }

    /**
     * Generates n-grams for fuzzy matching
     */
    private generateNgrams(text: string): string[] {
        const ngrams: string[] = [];
        const cleanText = text.toLowerCase().replace(/[^a-zA-Z0-9]/g, '');

        for (let i = 0; i <= cleanText.length - SearchIndexService.NGRAM_SIZE; i++) {
            const ngram = cleanText.substr(i, SearchIndexService.NGRAM_SIZE);
            ngrams.push(ngram);
        }

        return ngrams;
    }

    /**
     * Finds candidate documents based on token and ngram matching
     */
    private findCandidateDocuments(queryTokens: string[], queryNgrams: string[]): Set<string> {
        const candidates = new Set<string>();

        // Find documents matching tokens (exact matches)
        for (const token of queryTokens) {
            const docIds = this.tokenIndex.get(token);
            if (docIds) {
                for (const docId of docIds) {
                    candidates.add(docId);
                }
            }
        }

        // Find documents matching ngrams (fuzzy matches)
        for (const ngram of queryNgrams) {
            const docIds = this.ngramIndex.get(ngram);
            if (docIds) {
                for (const docId of docIds) {
                    candidates.add(docId);
                }
            }
        }

        return candidates;
    }

    /**
     * Filters candidate documents based on query options
     */
    private filterCandidates(candidateIds: Set<string>, options: IndexQueryOptions): SearchIndexEntry[] {
        const filtered: SearchIndexEntry[] = [];

        for (const docId of candidateIds) {
            const entry = this.searchIndex.get(docId);
            if (!entry) continue;

            const doc = entry.document;

            // Filter by project IDs
            if (options.projectIds && !options.projectIds.includes(doc.projectId)) {
                continue;
            }

            // Filter by resource types
            if (options.resourceTypes && !options.resourceTypes.includes(doc.resourceType)) {
                continue;
            }

            // Filter by tags
            if (options.tags) {
                const hasRequiredTags = options.tags.some(tag => doc.tags.includes(tag));
                if (!hasRequiredTags) {
                    continue;
                }
            }

            filtered.push(entry);
        }

        return filtered;
    }

    /**
     * Scores documents based on relevance to the query
     */
    private scoreDocuments(
        entries: SearchIndexEntry[],
        queryTokens: string[],
        queryNgrams: string[]
    ): Array<{ document: SearchIndexDocument; score: number }> {
        return entries.map(entry => {
            let score = 0;

            // Score based on token matches
            for (const token of queryTokens) {
                if (entry.tokens.includes(token)) {
                    score += 10; // Exact token match

                    // Boost for matches in display name
                    if (entry.document.displayName.toLowerCase().includes(token)) {
                        score += 5;
                    }

                    // Boost for matches in resource path
                    if (entry.document.resourcePath.toLowerCase().includes(token)) {
                        score += 3;
                    }
                }
            }

            // Score based on ngram matches (fuzzy matching)
            for (const ngram of queryNgrams) {
                if (entry.ngrams.includes(ngram)) {
                    score += 1; // Fuzzy match
                }
            }

            // Normalize score by document length
            const normalizedScore = entry.tokens.length > 0 ? score / Math.log(entry.tokens.length + 1) : score;

            return { document: entry.document, score: normalizedScore };
        });
    }

    /**
     * Sorts documents based on the specified criteria
     */
    private sortDocuments(
        scoredDocuments: Array<{ document: SearchIndexDocument; score: number }>,
        sortBy: 'relevance' | 'name' | 'modified' | 'type',
        sortOrder: 'asc' | 'desc'
    ): void {
        scoredDocuments.sort((a, b) => {
            let comparison = 0;

            switch (sortBy) {
                case 'relevance':
                    comparison = b.score - a.score;
                    break;
                case 'name':
                    comparison = a.document.displayName.localeCompare(b.document.displayName);
                    break;
                case 'modified':
                    comparison = b.document.lastModified - a.document.lastModified;
                    break;
                case 'type':
                    comparison = a.document.resourceType.localeCompare(b.document.resourceType);
                    break;

                default:
                    console.error(`Unknown sort criteria: ${String(sortBy)}`);
                    comparison = 0;
                    break;
            }

            return sortOrder === 'desc' ? comparison : -comparison;
        });
    }

    /**
     * Generates facets for search results
     */
    private generateFacets(entries: SearchIndexEntry[]): Record<string, Record<string, number>> {
        const facets: Record<string, Record<string, number>> = {
            resourceType: {},
            projectId: {},
            tags: {}
        };

        for (const entry of entries) {
            const doc = entry.document;

            // Resource type facet
            facets.resourceType[doc.resourceType] = (facets.resourceType[doc.resourceType] ?? 0) + 1;

            // Project ID facet
            facets.projectId[doc.projectId] = (facets.projectId[doc.projectId] ?? 0) + 1;

            // Tags facet
            for (const tag of doc.tags) {
                facets.tags[tag] = (facets.tags[tag] ?? 0) + 1;
            }
        }

        return facets;
    }

    /**
     * Sets up index storage location
     */
    private async setupIndexStorage(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const flintDir = path.join(workspaceFolder.uri.fsPath, '.flint');
                await fs.mkdir(flintDir, { recursive: true });
                this.indexFilePath = path.join(flintDir, 'search-index.json');
            }
        } catch (error) {
            console.warn('Failed to setup index storage:', error);
            this.indexFilePath = null;
        }
    }

    /**
     * Loads search index from disk
     */
    private async loadSearchIndex(): Promise<void> {
        if (!this.indexFilePath) {
            return;
        }

        try {
            const content = await fs.readFile(this.indexFilePath, 'utf8');
            const data = JSON.parse(content);

            if (data.version === SearchIndexService.INDEX_VERSION && Array.isArray(data.documents)) {
                // Rebuild indexes from documents
                for (const doc of data.documents) {
                    this.indexDocumentInternal(doc);
                }
                console.log(`Loaded search index with ${data.documents.length} documents`);
            } else {
                console.log('Index format mismatch, starting with empty index');
            }
        } catch {
            console.log('No existing search index found, starting fresh');
        }
    }

    /**
     * Saves search index to disk
     */
    private async saveSearchIndex(): Promise<void> {
        if (!this.indexFilePath) {
            return;
        }

        try {
            const documents = Array.from(this.searchIndex.values()).map(entry => entry.document);

            const data = {
                version: SearchIndexService.INDEX_VERSION,
                lastUpdated: new Date().toISOString(),
                documents
            };

            await fs.writeFile(this.indexFilePath, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            console.warn('Failed to save search index:', error);
        }
    }

    /**
     * Calculates approximate index size in bytes
     */
    private calculateIndexSize(): number {
        let size = 0;

        for (const entry of this.searchIndex.values()) {
            size += JSON.stringify(entry.document).length;
            size += entry.tokens.join('').length;
            size += entry.ngrams.join('').length;
        }

        return size;
    }

    /**
     * Sets up periodic index maintenance
     */
    private setupPeriodicUpdates(): void {
        this.updateTimer = setInterval(() => {
            try {
                this.processPendingUpdates();
            } catch (error) {
                console.error('Periodic index update failed:', error);
            }
        }, 30000); // Process updates every 30 seconds
    }
}
