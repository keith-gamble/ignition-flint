/**
 * @module ScriptPathMatcher
 * @description Identifies and extracts script values from Ignition JSON files
 * Provides utilities to find script locations in JSON and perform targeted decode/encode
 */

import { decodeScript, encodeScript, isEncodedScript } from './scriptEncoder';

/**
 * Represents the location of a script value within a JSON document
 */
export interface ScriptLocation {
    /** JSON path to the script (e.g., "root.events.onAction.config.script") */
    readonly path: string;
    /** The original encoded script value */
    readonly encodedValue: string;
    /** The decoded script value */
    readonly decodedValue: string;
    /** Parent object path (for context like method names) */
    readonly parentPath: string;
}

/**
 * Result of extracting scripts from JSON content
 */
export interface ExtractionResult {
    /** JSON content with scripts decoded */
    readonly decodedContent: string;
    /** All script locations found */
    readonly scriptLocations: readonly ScriptLocation[];
    /** Whether any scripts were found and decoded */
    readonly hasScripts: boolean;
    /** Any errors encountered during extraction */
    readonly errors: readonly string[];
}

/**
 * Known JSON path patterns that contain Ignition scripts
 * These are the keys where Python code is typically stored in Ignition JSON
 */
const SCRIPT_KEY_PATTERNS: readonly RegExp[] = [
    // Direct script properties
    /\.script$/,

    // Script action configuration
    /config\.script$/,

    // Transform scripts
    /transforms\[\d+\]\.code$/,

    // Custom methods
    /customMethods\[\d+\]\.script$/,

    // Message handlers
    /messageHandlers\[\d+\]\.script$/,

    // Tag event scripts
    /eventScripts\[\d+\]\.script$/,

    // Property change scripts
    /onChange\.script$/,

    // Extension functions
    /extensionFunctions\[\d+\]\.script$/
];

/**
 * Script key names to look for when traversing JSON
 */
const SCRIPT_KEYS = new Set(['script', 'code']);

/**
 * Parent keys that indicate the child 'script' or 'code' is a Python script
 * Note: Prefixed with underscore as it's reserved for future use
 */
const _SCRIPT_PARENT_KEYS = new Set([
    'config',
    'transforms',
    'customMethods',
    'messageHandlers',
    'eventScripts',
    'onChange',
    'extensionFunctions'
]);

/**
 * Checks if a JSON path matches a known script location pattern
 *
 * @param jsonPath - The dot-notation path to check
 * @returns True if the path represents a script location
 */
export function isScriptPath(jsonPath: string): boolean {
    if (!jsonPath || typeof jsonPath !== 'string') {
        return false;
    }

    return SCRIPT_KEY_PATTERNS.some(pattern => pattern.test(jsonPath));
}

/**
 * Recursively finds all script locations in a JSON object
 *
 * @param obj - The parsed JSON object to search
 * @param currentPath - Current path in the object (used for recursion)
 * @param locations - Accumulator for found locations (used for recursion)
 * @returns Array of script locations found
 */
export function findScriptPaths(
    obj: unknown,
    currentPath: string = '',
    locations: ScriptLocation[] = []
): ScriptLocation[] {
    if (obj === null || obj === undefined) {
        return locations;
    }

    if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
            const arrayPath = currentPath ? `${currentPath}[${index}]` : `[${index}]`;
            findScriptPaths(item, arrayPath, locations);
        });
        return locations;
    }

    if (typeof obj === 'object') {
        const record = obj as Record<string, unknown>;
        for (const [key, value] of Object.entries(record)) {
            const newPath = currentPath ? `${currentPath}.${key}` : key;

            // Check if this is a script value
            if (SCRIPT_KEYS.has(key) && typeof value === 'string' && isScriptPath(newPath)) {
                const encodedValue = value;
                const decodedValue = decodeScript(encodedValue);
                const parentPath = currentPath;

                locations.push({
                    path: newPath,
                    encodedValue,
                    decodedValue,
                    parentPath
                });
            } else {
                // Continue recursion
                findScriptPaths(value, newPath, locations);
            }
        }
    }

    return locations;
}

/**
 * Extracts and decodes all scripts from JSON content
 * Returns the modified JSON with decoded scripts and location metadata
 *
 * @param jsonContent - The original JSON string
 * @returns Extraction result with decoded content and script locations
 */
export function extractAndDecodeScripts(jsonContent: string): ExtractionResult {
    const errors: string[] = [];

    if (!jsonContent || typeof jsonContent !== 'string') {
        return {
            decodedContent: jsonContent,
            scriptLocations: [],
            hasScripts: false,
            errors: ['Invalid JSON content provided']
        };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonContent);
    } catch (error) {
        return {
            decodedContent: jsonContent,
            scriptLocations: [],
            hasScripts: false,
            errors: [`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`]
        };
    }

    // Find all script locations
    const scriptLocations = findScriptPaths(parsed);

    if (scriptLocations.length === 0) {
        return {
            decodedContent: jsonContent,
            scriptLocations: [],
            hasScripts: false,
            errors: []
        };
    }

    // Decode scripts in-place in the parsed object
    const decodedObj = decodeScriptsInObject(parsed, scriptLocations);

    // Serialize back to JSON with original formatting
    let decodedContent: string;
    try {
        // Detect original indentation
        const indentMatch = jsonContent.match(/^(\s+)/m);
        const indent = indentMatch ? indentMatch[1].length : 2;
        decodedContent = JSON.stringify(decodedObj, null, indent);
    } catch (error) {
        errors.push(`Failed to serialize decoded JSON: ${error instanceof Error ? error.message : String(error)}`);
        decodedContent = jsonContent;
    }

    return {
        decodedContent,
        scriptLocations,
        hasScripts: scriptLocations.length > 0,
        errors
    };
}

/**
 * Re-encodes scripts in JSON content back to Ignition format
 * Used when saving decoded content back to the original file
 *
 * @param decodedContent - The JSON string with decoded scripts
 * @returns JSON string with scripts re-encoded
 */
export function encodeScriptsInContent(decodedContent: string): string {
    if (!decodedContent || typeof decodedContent !== 'string') {
        return decodedContent;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(decodedContent);
    } catch {
        return decodedContent;
    }

    // Find and encode all script locations
    encodeScriptsInObject(parsed);

    // Detect original indentation
    const indentMatch = decodedContent.match(/^(\s+)/m);
    const indent = indentMatch ? indentMatch[1].length : 2;

    try {
        return JSON.stringify(parsed, null, indent);
    } catch {
        return decodedContent;
    }
}

/**
 * Decodes scripts in a parsed JSON object based on known locations
 * Modifies the object in place and returns it
 */
function decodeScriptsInObject(obj: unknown, _locations: readonly ScriptLocation[]): unknown {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map((item, _index) => decodeScriptsInObject(item, _locations));
    }

    if (typeof obj === 'object') {
        const record = obj as Record<string, unknown>;
        const result: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(record)) {
            if (SCRIPT_KEYS.has(key) && typeof value === 'string' && isEncodedScript(value)) {
                // Decode this script value
                result[key] = decodeScript(value);
            } else if (typeof value === 'object') {
                // Recurse into nested objects
                result[key] = decodeScriptsInObject(value, _locations);
            } else {
                result[key] = value;
            }
        }

        return result;
    }

    return obj;
}

/**
 * Encodes scripts in a parsed JSON object
 * Modifies the object in place
 */
function encodeScriptsInObject(obj: unknown, currentPath: string = ''): void {
    if (obj === null || obj === undefined || typeof obj !== 'object') {
        return;
    }

    if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
            const arrayPath = currentPath ? `${currentPath}[${index}]` : `[${index}]`;
            encodeScriptsInObject(item, arrayPath);
        });
        return;
    }

    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
        const newPath = currentPath ? `${currentPath}.${key}` : key;

        if (SCRIPT_KEYS.has(key) && typeof value === 'string' && isScriptPath(newPath)) {
            // Encode this script value
            record[key] = encodeScript(value);
        } else if (typeof value === 'object') {
            encodeScriptsInObject(value, newPath);
        }
    }
}

/**
 * Gets the list of known script key patterns
 * Useful for documentation or extending the patterns
 */
export function getScriptKeyPatterns(): readonly RegExp[] {
    return SCRIPT_KEY_PATTERNS;
}

/**
 * Checks if a JSON object contains any script values
 * Lightweight check without full extraction
 *
 * @param obj - The parsed JSON object to check
 * @returns True if any script locations were found
 */
export function hasScripts(obj: unknown): boolean {
    const locations = findScriptPaths(obj);
    return locations.length > 0;
}
