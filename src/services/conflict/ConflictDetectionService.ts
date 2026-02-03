/**
 * @module ConflictDetectionService
 * @description Detects and parses merge conflicts in JSON files, identifying script conflicts
 */

import * as vscode from 'vscode';

import { ServiceContainer } from '@/core/ServiceContainer';
import { ConflictParseResult, MergeConflict, ScriptConflict } from '@/core/types/conflict';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { decodeScript } from '@/utils/decode';

/**
 * Service for detecting and parsing merge conflicts in JSON files
 */
export class ConflictDetectionService implements IServiceLifecycle {
    private serviceContainer: ServiceContainer;
    private isInitialized = false;

    /** Cache of parsed conflicts per document URI */
    private conflictCache = new Map<string, ConflictParseResult>();

    constructor(serviceContainer: ServiceContainer) {
        this.serviceContainer = serviceContainer;
    }

    // ============================================================================
    // SERVICE LIFECYCLE
    // ============================================================================

    async initialize(): Promise<void> {
        await Promise.resolve();
        this.isInitialized = true;
        console.log('ConflictDetectionService: Initialized');
    }

    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async stop(): Promise<void> {
        await Promise.resolve();
        this.conflictCache.clear();
    }

    async dispose(): Promise<void> {
        await this.stop();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    // ============================================================================
    // CONFLICT DETECTION
    // ============================================================================

    /**
     * Parse all conflicts in a document
     */
    parseConflicts(document: vscode.TextDocument): ConflictParseResult {
        const cacheKey = document.uri.toString();

        // For now, always re-parse (could add version tracking for optimization)
        const text = document.getText();
        const result = this.parseConflictsFromText(text, document.uri.fsPath);

        this.conflictCache.set(cacheKey, result);
        return result;
    }

    /**
     * Invalidate cache for a document
     */
    invalidateCache(documentUri: vscode.Uri): void {
        this.conflictCache.delete(documentUri.toString());
    }

    /**
     * Check if a line is within a conflict
     */
    isLineInConflict(document: vscode.TextDocument, line: number): MergeConflict | undefined {
        const result = this.parseConflicts(document);
        return result.conflicts.find(c => line >= c.startLine && line <= c.endLine);
    }

    /**
     * Get script conflict at a specific line
     */
    getScriptConflictAtLine(document: vscode.TextDocument, line: number): ScriptConflict | undefined {
        const result = this.parseConflicts(document);
        return result.scriptConflicts.find(c => line >= c.startLine && line <= c.endLine);
    }

    /**
     * Get a specific conflict by ID
     */
    getConflictById(document: vscode.TextDocument, conflictId: string): ScriptConflict | undefined {
        const result = this.parseConflicts(document);
        return result.scriptConflicts.find(c => c.id === conflictId);
    }

    // ============================================================================
    // PRIVATE HELPERS
    // ============================================================================

    /**
     * Parse conflicts from raw text
     */
    private parseConflictsFromText(text: string, filePath: string): ConflictParseResult {
        const conflicts: MergeConflict[] = [];
        const scriptConflicts: ScriptConflict[] = [];
        const errors: string[] = [];

        // Match conflict blocks
        // Pattern: <<<<<<< branch\ncontent\n=======\ncontent\n>>>>>>> branch
        const conflictRegex = /^(<{7}) (.+)\r?\n([\s\S]*?)^(={7})\r?\n([\s\S]*?)^(>{7}) (.+)$/gm;

        let match: RegExpExecArray | null;

        while ((match = conflictRegex.exec(text)) !== null) {
            try {
                const fullMatch = match[0];
                const currentBranch = match[2];
                const currentContent = match[3];
                const incomingContent = match[5];
                const incomingBranch = match[7];

                // Calculate line numbers
                const startOffset = match.index;
                const startLine = this.offsetToLine(text, startOffset);
                const dividerOffset =
                    startOffset + match[1].length + 1 + currentBranch.length + 1 + currentContent.length;
                const dividerLine = this.offsetToLine(text, dividerOffset);
                const endLine = this.offsetToLine(text, startOffset + fullMatch.length - 1);

                const conflictId = this.generateConflictId(filePath, startLine);

                const conflict: MergeConflict = {
                    id: conflictId,
                    startLine,
                    endLine,
                    dividerLine,
                    currentContent,
                    incomingContent,
                    currentBranch,
                    incomingBranch
                };

                conflicts.push(conflict);

                // Check if this conflict contains a script field
                const scriptConflict = this.detectScriptInConflict(conflict);
                if (scriptConflict) {
                    scriptConflicts.push(scriptConflict);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                errors.push(`Error parsing conflict at offset ${match.index}: ${errorMessage}`);
            }
        }

        return {
            conflicts,
            scriptConflicts,
            hasConflicts: conflicts.length > 0,
            errors
        };
    }

    /**
     * Convert a character offset to a line number
     */
    private offsetToLine(text: string, offset: number): number {
        const textBeforeOffset = text.substring(0, offset);
        return (textBeforeOffset.match(/\r?\n/g) ?? []).length;
    }

    /**
     * Generate a unique conflict ID
     */
    private generateConflictId(filePath: string, startLine: number): string {
        // Use a hash of file path + line number for stability
        const hash = this.simpleHash(`${filePath}:${startLine}`);
        return `conflict-${hash}`;
    }

    /**
     * Simple string hash function
     */
    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(16);
    }

    /**
     * Detect if a conflict contains a script/code field and extract it
     */
    private detectScriptInConflict(conflict: MergeConflict): ScriptConflict | undefined {
        // Look for "script" or "code" keys in the conflict content
        const scriptKeyRegex = /"(script|code)":\s*"((?:[^"\\]|\\.)*)"/;

        const currentMatch = conflict.currentContent.match(scriptKeyRegex);
        const incomingMatch = conflict.incomingContent.match(scriptKeyRegex);

        // Both sides must have the same key type for us to handle it
        if (!currentMatch || !incomingMatch) {
            return undefined;
        }

        const currentKey = currentMatch[1];
        const incomingKey = incomingMatch[1];

        // Keys must match
        if (currentKey !== incomingKey) {
            return undefined;
        }

        const currentEncoded = currentMatch[2];
        const incomingEncoded = incomingMatch[2];

        // Decode the scripts
        let currentScript: string;
        let incomingScript: string;

        try {
            currentScript = decodeScript(currentEncoded);
            incomingScript = decodeScript(incomingEncoded);
        } catch {
            // If decoding fails, this might not be a proper script
            return undefined;
        }

        return {
            ...conflict,
            jsonKey: currentKey,
            currentScript,
            incomingScript
        };
    }
}
