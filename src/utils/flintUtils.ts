import { Uri } from "vscode";

const REPLACEMENT_CHARS: { [key: string]: string } = {
    '\\': '\\\\',
    '"': '\\"',
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
};

export function encodeCodeText(codeText: string): string {
    // Replace the replacement characters with their encoded values
    for (let char in REPLACEMENT_CHARS) {
        codeText = codeText.split(char).join(REPLACEMENT_CHARS[char]);
    }

    return codeText;
}

export function decodeCodeText(codeText: string): string {
    // Replace the encoded values with their original characters
    for (let char in REPLACEMENT_CHARS) {
        codeText = codeText.split(REPLACEMENT_CHARS[char]).join(char);
    }

    return codeText;
}

export function getUriQueryParameter(uri: Uri, parameterName: string): string | null {
    const queryString = uri.query;
    if (!queryString) {
        return null;
    }

    const parameterValues = queryString.split('&');
    for (const parameterValue of parameterValues) {
        const [key, value] = parameterValue.split('=');
        if (key === parameterName) {
            return value;
        }
    }

    return null;
}

export function normalizeWindowsFilePath(filePath: string): string {
    // Check if the process is running on a Windows platform
    if (process.platform === 'win32') {
        // If it is, remove the initial slash from the file path
        filePath = filePath.replace(/^\//, '');
    }
    return filePath;
}

export class FlintError extends Error {
    constructor(message: string) {
        super(message);
    }
}