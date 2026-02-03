/**
 * @module ConflictTypes
 * @description Type definitions for merge conflict detection and resolution
 */

/**
 * Side of a merge conflict
 */
export type ConflictSide = 'current' | 'incoming';

/**
 * Represents a single merge conflict block in a file
 */
export interface MergeConflict {
    /** Unique identifier for this conflict */
    readonly id: string;
    /** Start line of the conflict (<<<<<<< marker) */
    readonly startLine: number;
    /** End line of the conflict (>>>>>>> marker) */
    readonly endLine: number;
    /** Line of the ======= divider */
    readonly dividerLine: number;
    /** Content from current branch (HEAD) */
    readonly currentContent: string;
    /** Content from incoming branch */
    readonly incomingContent: string;
    /** Branch name for current (from <<<<<<< marker) */
    readonly currentBranch: string;
    /** Branch name for incoming (from >>>>>>> marker) */
    readonly incomingBranch: string;
}

/**
 * Represents a script-containing merge conflict
 */
export interface ScriptConflict extends MergeConflict {
    /** JSON key (e.g., 'script', 'code') */
    readonly jsonKey: string;
    /** Decoded current Python script */
    readonly currentScript: string;
    /** Decoded incoming Python script */
    readonly incomingScript: string;
}

/**
 * Result of parsing conflicts in a file
 */
export interface ConflictParseResult {
    /** All conflicts found */
    readonly conflicts: readonly MergeConflict[];
    /** Conflicts that contain scripts */
    readonly scriptConflicts: readonly ScriptConflict[];
    /** Whether the file has any conflicts */
    readonly hasConflicts: boolean;
    /** Parsing errors encountered */
    readonly errors: readonly string[];
}

/**
 * Metadata for a conflict script entry in the virtual filesystem
 */
export interface ConflictScriptEntry {
    /** Original JSON file URI */
    readonly originalUri: string;
    /** Conflict unique ID */
    readonly conflictId: string;
    /** Side of the conflict */
    readonly side: ConflictSide;
    /** JSON key (script/code) */
    readonly jsonKey: string;
    /** The full script conflict data */
    readonly conflict: ScriptConflict;
    /** Current decoded Python content (with function wrapper) */
    content: string;
    /** Function definition wrapper used */
    readonly functionDefinition: string;
    /** Original encoded value */
    readonly originalEncoded: string;
    /** Last modification timestamp */
    lastModified: number;
}
