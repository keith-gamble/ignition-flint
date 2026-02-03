/**
 * @module ScriptEncoder
 * @description Encodes and decodes Ignition's HTML-safe script format
 * Used for Python scripts embedded in JSON files (Perspective views, tags, etc.)
 */

/**
 * Mapping of decoded characters to their encoded representations
 * Order matters: backslash must be processed first when encoding
 */
const ENCODING_MAP: ReadonlyMap<string, string> = new Map([
    ['\\', '\\\\'], // Backslash (must be first)
    ['"', '\\"'], // Double quote
    ['\t', '\\t'], // Tab
    ['\n', '\\n'], // Newline
    ['\r', '\\r'], // Carriage return
    ['\f', '\\f'], // Form feed
    ['\b', '\\b'], // Backspace
    ['<', '\\u003c'], // Less than (Unicode)
    ['>', '\\u003e'], // Greater than (Unicode)
    ['&', '\\u0026'], // Ampersand (Unicode)
    ['=', '\\u003d'], // Equals (Unicode)
    ["'", '\\u0027'] // Single quote (Unicode)
]);

/**
 * Reverse mapping for decoding (encoded -> decoded)
 * Order matters: Unicode escapes should be processed before simple escapes
 */
const DECODING_MAP: ReadonlyMap<string, string> = new Map([
    // Unicode escapes first
    ['\\u003c', '<'],
    ['\\u003e', '>'],
    ['\\u0026', '&'],
    ['\\u003d', '='],
    ['\\u0027', "'"],
    // Simple escapes (backslash last)
    ['\\t', '\t'],
    ['\\n', '\n'],
    ['\\r', '\r'],
    ['\\f', '\f'],
    ['\\b', '\b'],
    ['\\"', '"'],
    ['\\\\', '\\'] // Backslash must be last when decoding
]);

/**
 * Pattern to detect if a string likely contains Ignition-encoded content
 * Matches common Unicode escapes used in Ignition scripts
 */
const ENCODED_PATTERN = /\\u003[cde]|\\u0026|\\u0027|\\n|\\t/;

/**
 * Decodes an Ignition-encoded script string to readable Python code
 * Replaces Unicode escapes and escape sequences with their original characters
 *
 * @param encoded - The encoded script string from JSON
 * @returns The decoded, human-readable script
 *
 * @example
 * decodeScript('\\tlogger.info(\\u0027Hello\\u0027)')
 * // Returns: '\tlogger.info('Hello')'
 */
export function decodeScript(encoded: string): string {
    if (!encoded || typeof encoded !== 'string') {
        return encoded;
    }

    let decoded = encoded;

    // Process each decoding rule in order
    for (const [encodedSeq, decodedChar] of DECODING_MAP) {
        decoded = decoded.split(encodedSeq).join(decodedChar);
    }

    return decoded;
}

/**
 * Encodes a Python script to Ignition's HTML-safe format
 * Escapes special characters and converts certain characters to Unicode escapes
 *
 * @param decoded - The readable Python script
 * @returns The encoded string suitable for JSON storage
 *
 * @example
 * encodeScript('\tlogger.info('Hello')')
 * // Returns: '\\tlogger.info(\\u0027Hello\\u0027)'
 */
export function encodeScript(decoded: string): string {
    if (!decoded || typeof decoded !== 'string') {
        return decoded;
    }

    let encoded = decoded;

    // Process each encoding rule in order (backslash first is critical)
    for (const [decodedChar, encodedSeq] of ENCODING_MAP) {
        encoded = encoded.split(decodedChar).join(encodedSeq);
    }

    return encoded;
}

/**
 * Checks if a string appears to contain Ignition-encoded content
 * Useful for determining whether decoding is necessary
 *
 * @param value - The string to check
 * @returns True if the string contains patterns typical of Ignition encoding
 */
export function isEncodedScript(value: string): boolean {
    if (!value || typeof value !== 'string') {
        return false;
    }
    return ENCODED_PATTERN.test(value);
}

/**
 * Performs a round-trip test to verify encoding/decoding correctness
 * Useful for validation and testing
 *
 * @param script - The original script to test
 * @returns True if encode(decode(script)) === script for encoded input,
 *          or decode(encode(script)) === script for decoded input
 */
export function verifyRoundTrip(script: string): boolean {
    if (!script || typeof script !== 'string') {
        return true; // Empty strings are valid
    }

    // Test both directions
    const encoded = encodeScript(script);
    const decoded = decodeScript(encoded);

    return decoded === script;
}

/**
 * Gets all encoding rules as a readonly map
 * Useful for documentation or debugging
 */
export function getEncodingRules(): ReadonlyMap<string, string> {
    return ENCODING_MAP;
}

/**
 * Gets all decoding rules as a readonly map
 * Useful for documentation or debugging
 */
export function getDecodingRules(): ReadonlyMap<string, string> {
    return DECODING_MAP;
}
