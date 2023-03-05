import { Uri } from "vscode";

// Defines a map of replacement characters and their encoded values
const REPLACEMENT_CHARS: { [key: string]: string } = {
	'\\': '\\\\',
	'"': '\\\"',
	'\t': '\\t',
	'\b': '\\b',
	'\n': '\\n',
	'\r': '\\r',
	'\f': '\\f',
	'<': '\\u003c',
	'>': '\\u003e',
	'&': '\\u0026',
	'=': '\\u003d',
	'\'': '\\u0027',
}

/**
 * Encodes the given code text by replacing special characters with their encoded values.
 * 
 * @param codeText - The code text to encode.
 * @returns The encoded code text.
 */
export function encodeCodeText(codeText: string): string {
	// Replace the replacement characters with their encoded values
	for (let char in REPLACEMENT_CHARS) {
		codeText = codeText.split(char).join(REPLACEMENT_CHARS[char]);
	}

	return codeText;
}

/**
 * Decodes the given code text by replacing encoded values with their original characters.
 * 
 * @param codeText - The code text to decode.
 * @returns The decoded code text.
 */
export function decodeCodeText(codeText: string): string {
	// Replace the encoded values with their original characters
	for (let char in REPLACEMENT_CHARS) {
		codeText = codeText.split(REPLACEMENT_CHARS[char]).join(char);
	}

	return codeText;
}

/**
 * Gets the value of the specified query parameter from the given URI.
 * 
 * @param uri - The URI to get the query parameter from.
 * @param parameterName - The name of the query parameter to get.
 * @returns The value of the query parameter, or null if the parameter is not found.
 */
export function getUriQueryParameter(uri: Uri, parameterName: string): string | null {
	let parameterValue = null;

	// Get the query string from the URI
	let queryString = uri.query;

	// Parse the query string to get the value of the specified parameter
	if (queryString) {
		let parameterValues = queryString.split('&');
		for (let i = 0; i < parameterValues.length; i++) {
			let parameterValueParts = parameterValues[i].split('=');
			if (parameterValueParts[0] == parameterName) {
				parameterValue = parameterValueParts[1];
				break;
			}
		}
	}
	
	return parameterValue;
}

/**
 * Normalizes a Windows file path by removing the initial slash if running on a Windows platform.
 * 
 * @param filePath - The file path to normalize.
 * @returns The normalized file path.
 */
export function normalizeWindowsFilePath(filePath: string): string {
	// Check if the process is running on a Windows platform
	if (process.platform === 'win32') {
		// If it is, remove the initial slash from the file path
		filePath = filePath.replace(/^\//, '');
	}
	return filePath;
}

/**
 * A custom error class for Flint-specific errors.
 */
export class FlintError extends Error {
	constructor(message: string) {
		super(message);
	}
}
