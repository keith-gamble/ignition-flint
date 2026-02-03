/**
 * @module Decode
 * @description Utilities for decoding Ignition's HTML-safe encoded Python scripts
 * Provides encoding/decoding and JSON script extraction capabilities
 */

// Script encoding/decoding
export {
    decodeScript,
    encodeScript,
    isEncodedScript,
    verifyRoundTrip,
    getEncodingRules,
    getDecodingRules
} from './scriptEncoder';

// Script path matching and extraction
export {
    isScriptPath,
    findScriptPaths,
    extractAndDecodeScripts,
    encodeScriptsInContent,
    getScriptKeyPatterns,
    hasScripts
} from './scriptPathMatcher';

// Python notation conversion
export { PythonNotationConverter } from './pythonNotationConverter';
export type { ConversionResult } from './pythonNotationConverter';

// Types
export type { ScriptLocation, ExtractionResult } from './scriptPathMatcher';
