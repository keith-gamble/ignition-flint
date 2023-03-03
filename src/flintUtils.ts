import { Uri, TextDocument } from "vscode";

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

export function encodeCodeText(codeText: string): string {
	// Replace the replacement characters
	for (let char in REPLACEMENT_CHARS) {
		codeText = codeText.split(char).join(REPLACEMENT_CHARS[char]);
	}

	return codeText;
}

export function decodeCodeText(codeText: string): string {
	// Replace the replacement characters
	for (let char in REPLACEMENT_CHARS) {
		codeText = codeText.split(REPLACEMENT_CHARS[char]).join(char);
	}

	return codeText;
}

export function getUriQueryParameter(uri: Uri, parameterName: string): string | null {
	let parameterValue = null;

	// Get the query string
	let queryString = uri.query;

	// Get the parameter value
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