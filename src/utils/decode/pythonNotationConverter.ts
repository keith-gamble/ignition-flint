/**
 * @module PythonNotationConverter
 * @description Converts Python 2/3 debug output notation to valid JSON
 * Handles unicode strings (u'text'), single quotes, True/False/None, and unquoted identifiers
 */

/**
 * Token types for the state machine tokenizer
 */
type TokenType = 'string' | 'number' | 'keyword' | 'identifier' | 'structural' | 'whitespace' | 'colon' | 'comma';

/**
 * A token produced by the tokenizer
 */
interface Token {
    type: TokenType;
    value: string;
    raw: string;
}

/**
 * Result of the conversion attempt
 */
export interface ConversionResult {
    success: boolean;
    json: string;
    error?: string;
}

/**
 * Converts Python debug output notation to valid JSON
 *
 * Key conversions:
 * - u'text' / u"text" → "text" (remove unicode prefix, use double quotes)
 * - 'text' → "text" (single to double quotes)
 * - True → true, False → false
 * - None → null
 * - Unquoted identifiers → quoted strings
 * - Complex values like tag paths → quoted strings
 * - Trailing commas → removed
 */
export class PythonNotationConverter {
    private static readonly PYTHON_KEYWORDS: Record<string, string> = {
        True: 'true',
        False: 'false',
        None: 'null'
    };

    /**
     * JSON keywords that should pass through unchanged
     */
    private static readonly JSON_KEYWORDS = new Set(['true', 'false', 'null']);

    /**
     * Python-specific patterns that indicate we need conversion
     */
    private static readonly PYTHON_PATTERNS = [/u'/, /u"/, /(?<!["\w])'/, /\bTrue\b/, /\bFalse\b/, /\bNone\b/];

    /**
     * Converts Python notation to JSON
     * @param input The input string with Python notation
     * @returns ConversionResult with the converted JSON or error
     */
    convert(input: string): ConversionResult {
        const trimmed = input.trim();

        if (trimmed.length === 0) {
            return { success: false, json: '', error: 'Empty input' };
        }

        // Quick check: if it's already valid JSON, return it formatted
        if (this.isValidJson(trimmed)) {
            try {
                const parsed = JSON.parse(trimmed);
                return { success: true, json: JSON.stringify(parsed, null, 2) };
            } catch {
                // Fall through to conversion
            }
        }

        // Check if we detect Python patterns
        if (!this.hasPythonPatterns(trimmed)) {
            // Try parsing as JSON anyway - might just need formatting
            try {
                const parsed = JSON.parse(trimmed);
                return { success: true, json: JSON.stringify(parsed, null, 2) };
            } catch {
                // Fall through to tokenization
            }
        }

        try {
            const tokens = this.tokenize(trimmed);
            const transformed = this.transformTokens(tokens);
            const jsonString = this.assembleJson(transformed);

            // Validate the result
            const parsed = JSON.parse(jsonString);
            return { success: true, json: JSON.stringify(parsed, null, 2) };
        } catch (error) {
            return {
                success: false,
                json: '',
                error: `Conversion failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Checks if input is valid JSON
     */
    private isValidJson(input: string): boolean {
        try {
            JSON.parse(input);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Checks if input contains Python-specific patterns
     */
    private hasPythonPatterns(input: string): boolean {
        return PythonNotationConverter.PYTHON_PATTERNS.some(pattern => pattern.test(input));
    }

    /**
     * Tokenizes the input using a context-aware state machine
     */
    private tokenize(input: string): Token[] {
        const tokens: Token[] = [];
        let i = 0;
        let lastMeaningfulToken: Token | null = null;

        while (i < input.length) {
            const result = this.tokenizeNext(input, i, lastMeaningfulToken);
            if (result.token !== null) {
                tokens.push(result.token);
                if (result.token.type !== 'whitespace') {
                    lastMeaningfulToken = result.token;
                }
            }
            i = result.nextIndex;
        }

        return tokens;
    }

    /**
     * Tokenizes the next token at the given position with context awareness
     */
    private tokenizeNext(
        input: string,
        i: number,
        lastMeaningfulToken: Token | null
    ): { token: Token | null; nextIndex: number } {
        const char = input[i];

        // Whitespace
        if (/\s/.test(char)) {
            return this.tokenizeWhitespace(input, i);
        }

        // Check if we're in a value position (after : or [ or ,)
        const inValuePosition = this.isInValuePosition(lastMeaningfulToken);

        // Opening brackets - need to determine if it's structural or part of a tag path
        if (char === '[') {
            // If in value position, check if this looks like a tag path
            if (inValuePosition && this.looksLikeTagPath(input, i)) {
                const result = this.parseComplexUnquotedValue(input, i);
                return {
                    token: { type: 'identifier', value: result.value, raw: result.raw },
                    nextIndex: result.endIndex
                };
            }
            return { token: { type: 'structural', value: char, raw: char }, nextIndex: i + 1 };
        }

        // Other structural characters
        if (char === '{' || char === '}' || char === ']') {
            return { token: { type: 'structural', value: char, raw: char }, nextIndex: i + 1 };
        }

        // Colon
        if (char === ':') {
            return { token: { type: 'colon', value: ':', raw: ':' }, nextIndex: i + 1 };
        }

        // Comma
        if (char === ',') {
            return { token: { type: 'comma', value: ',', raw: ',' }, nextIndex: i + 1 };
        }

        // Unicode string prefix (u' or u")
        if (this.isUnicodeStringStart(input, i)) {
            return this.tokenizeUnicodeString(input, i);
        }

        // String (single or double quoted)
        if (char === "'" || char === '"') {
            const result = this.parseString(input, i, char);
            return { token: { type: 'string', value: result.value, raw: result.raw }, nextIndex: result.endIndex };
        }

        // Number (including negative)
        if (this.isNumberStart(input, i)) {
            const result = this.parseNumber(input, i);
            if (result !== null) {
                return {
                    token: { type: 'number', value: result.value, raw: result.raw },
                    nextIndex: result.endIndex
                };
            }
        }

        // Keywords and identifiers
        if (/[a-zA-Z_]/.test(char)) {
            // If in value position, check if this could be a complex unquoted value
            // (like a date: "Mon Jan 05 09:33:15 MST 2026")
            if (inValuePosition && this.looksLikeComplexValue(input, i)) {
                const result = this.parseComplexUnquotedValue(input, i);
                return {
                    token: { type: 'identifier', value: result.value, raw: result.raw },
                    nextIndex: result.endIndex
                };
            }
            return this.tokenizeIdentifierOrKeyword(input, i);
        }

        // Unknown character - skip it
        return { token: null, nextIndex: i + 1 };
    }

    /**
     * Checks if the last meaningful token indicates we're in a value position
     */
    private isInValuePosition(lastToken: Token | null): boolean {
        if (lastToken === null) {
            return true;
        }
        if (lastToken.type === 'colon') {
            return true;
        }
        if (lastToken.type === 'comma') {
            return true;
        }
        if (lastToken.type === 'structural' && lastToken.value === '[') {
            return true;
        }
        return false;
    }

    /**
     * Checks if the [ at position i starts a tag path like [Provider]path/to/tag
     */
    private looksLikeTagPath(input: string, i: number): boolean {
        // Find the closing ]
        let j = i + 1;
        let depth = 1;
        while (j < input.length && depth > 0) {
            if (input[j] === '[') {
                depth++;
            } else if (input[j] === ']') {
                depth--;
            }
            j++;
        }

        if (depth !== 0) {
            return false; // Unmatched brackets
        }

        // After the ], check if there's more path content (not a comma, }, or whitespace followed by comma)
        if (j < input.length) {
            const nextChar = input[j];
            // If followed by alphanumeric, underscore, or /, it's a tag path
            if (/[a-zA-Z0-9_/]/.test(nextChar)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Checks if the identifier at position i looks like part of a complex value (date, etc.)
     */
    private looksLikeComplexValue(input: string, i: number): boolean {
        // Check if this looks like a date (starts with day name or month name)
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        // Extract the word starting at position i
        let j = i;
        while (j < input.length && /[a-zA-Z]/.test(input[j])) {
            j++;
        }
        const word = input.slice(i, j);

        // Check if it's a day or month name followed by more content
        if ((dayNames.includes(word) || monthNames.includes(word)) && j < input.length && input[j] === ' ') {
            return true;
        }

        return false;
    }

    /**
     * Parses a complex unquoted value (tag path, date, identifier with special chars)
     * Captures everything until a delimiter that ends the value
     */
    private parseComplexUnquotedValue(input: string, start: number): { value: string; raw: string; endIndex: number } {
        let i = start;
        let bracketDepth = 0;
        let parenDepth = 0;

        while (i < input.length) {
            const char = input[i];

            if (char === '[') {
                bracketDepth++;
                i++;
                continue;
            }

            if (char === ']') {
                if (bracketDepth > 0) {
                    bracketDepth--;
                    i++;
                    continue;
                }
                // Unmatched ] means we've hit an array end
                break;
            }

            if (char === '(') {
                parenDepth++;
                i++;
                continue;
            }

            if (char === ')') {
                if (parenDepth > 0) {
                    parenDepth--;
                    i++;
                    continue;
                }
                // Unmatched ) - include it and continue (might be part of value)
                i++;
                continue;
            }

            // Stop at value delimiters when not in brackets/parens
            if (bracketDepth === 0 && parenDepth === 0) {
                if (char === ',' || char === '}') {
                    break;
                }
                // Also stop at ] when it's an array close (bracketDepth is 0)
                if (char === ']') {
                    break;
                }
            }

            i++;
        }

        const raw = input.slice(start, i).trim();
        return { value: raw, raw, endIndex: i };
    }

    /**
     * Checks if this is the start of a unicode string (u' or u")
     */
    private isUnicodeStringStart(input: string, i: number): boolean {
        return input[i] === 'u' && i + 1 < input.length && (input[i + 1] === "'" || input[i + 1] === '"');
    }

    /**
     * Checks if this is the start of a number
     */
    private isNumberStart(input: string, i: number): boolean {
        const char = input[i];
        return /[-\d]/.test(char) && (char !== '-' || (i + 1 < input.length && /\d/.test(input[i + 1])));
    }

    /**
     * Tokenizes whitespace
     */
    private tokenizeWhitespace(input: string, start: number): { token: Token; nextIndex: number } {
        let i = start;
        while (i < input.length && /\s/.test(input[i])) {
            i++;
        }
        const value = input.slice(start, i);
        return { token: { type: 'whitespace', value, raw: value }, nextIndex: i };
    }

    /**
     * Tokenizes a unicode string (u'...' or u"...")
     */
    private tokenizeUnicodeString(input: string, i: number): { token: Token; nextIndex: number } {
        const quote = input[i + 1];
        const result = this.parseString(input, i + 1, quote);
        return { token: { type: 'string', value: result.value, raw: `u${result.raw}` }, nextIndex: result.endIndex };
    }

    /**
     * Tokenizes an identifier or keyword
     */
    private tokenizeIdentifierOrKeyword(input: string, i: number): { token: Token; nextIndex: number } {
        const result = this.parseIdentifier(input, i);
        const pythonKeyword = PythonNotationConverter.PYTHON_KEYWORDS[result.value];
        if (pythonKeyword !== undefined) {
            return { token: { type: 'keyword', value: pythonKeyword, raw: result.raw }, nextIndex: result.endIndex };
        }
        // Check if it's a JSON keyword (pass through as keyword)
        if (PythonNotationConverter.JSON_KEYWORDS.has(result.value)) {
            return { token: { type: 'keyword', value: result.value, raw: result.raw }, nextIndex: result.endIndex };
        }
        return { token: { type: 'identifier', value: result.value, raw: result.raw }, nextIndex: result.endIndex };
    }

    /**
     * Parses a string starting at the given position
     */
    private parseString(input: string, start: number, quote: string): { value: string; raw: string; endIndex: number } {
        let i = start + 1;
        let value = '';
        let escaped = false;

        while (i < input.length) {
            const char = input[i];

            if (escaped) {
                value += this.handleEscapeSequence(input, i, char);
                if (char === 'u' && i + 4 < input.length && /^[0-9a-fA-F]{4}$/.test(input.slice(i + 1, i + 5))) {
                    i += 4; // Skip the 4 hex digits
                }
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                return { value, raw: input.slice(start, i + 1), endIndex: i + 1 };
            } else {
                value += char;
            }
            i++;
        }

        // Unterminated string - return what we have
        return { value, raw: input.slice(start, i), endIndex: i };
    }

    /**
     * Handles escape sequences in strings
     */
    private handleEscapeSequence(input: string, i: number, char: string): string {
        switch (char) {
            case 'n':
                return '\n';
            case 'r':
                return '\r';
            case 't':
                return '\t';
            case '\\':
                return '\\';
            case "'":
                return "'";
            case '"':
                return '"';
            case 'u':
                if (i + 4 < input.length) {
                    const hex = input.slice(i + 1, i + 5);
                    if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                        return String.fromCharCode(parseInt(hex, 16));
                    }
                }
                return '\\u';
            default:
                return char;
        }
    }

    /**
     * Parses a number starting at the given position
     */
    private parseNumber(input: string, start: number): { value: string; raw: string; endIndex: number } | null {
        let i = start;
        let hasDecimal = false;
        let hasExponent = false;

        if (input[i] === '-') {
            i++;
        }

        if (i >= input.length || !/\d/.test(input[i])) {
            return null;
        }

        while (i < input.length) {
            const char = input[i];

            if (/\d/.test(char)) {
                i++;
            } else if (char === '.' && !hasDecimal && !hasExponent) {
                hasDecimal = true;
                i++;
            } else if ((char === 'e' || char === 'E') && !hasExponent) {
                hasExponent = true;
                i++;
                if (i < input.length && (input[i] === '+' || input[i] === '-')) {
                    i++;
                }
            } else {
                break;
            }
        }

        const raw = input.slice(start, i);
        return { value: raw, raw, endIndex: i };
    }

    /**
     * Parses an identifier (keyword or variable name)
     */
    private parseIdentifier(input: string, start: number): { value: string; raw: string; endIndex: number } {
        let i = start;
        while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
            i++;
        }
        const raw = input.slice(start, i);
        return { value: raw, raw, endIndex: i };
    }

    /**
     * Transforms tokens to JSON-compatible format
     */
    private transformTokens(tokens: Token[]): Token[] {
        const result: Token[] = [];

        for (const token of tokens) {
            if (token.type === 'whitespace') {
                result.push(token);
                continue;
            }

            if (token.type === 'identifier') {
                // Convert identifiers to strings
                result.push({ type: 'string', value: token.value, raw: token.raw });
                continue;
            }

            result.push(token);
        }

        return this.removeTrailingCommas(result);
    }

    /**
     * Removes trailing commas before closing brackets/braces
     */
    private removeTrailingCommas(tokens: Token[]): Token[] {
        const result: Token[] = [];

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            if (token.type === 'comma') {
                let nextMeaningful = i + 1;
                while (nextMeaningful < tokens.length && tokens[nextMeaningful].type === 'whitespace') {
                    nextMeaningful++;
                }

                if (
                    nextMeaningful < tokens.length &&
                    tokens[nextMeaningful].type === 'structural' &&
                    (tokens[nextMeaningful].value === '}' || tokens[nextMeaningful].value === ']')
                ) {
                    continue; // Skip trailing comma
                }
            }

            result.push(token);
        }

        return result;
    }

    /**
     * Assembles tokens back into a JSON string
     */
    private assembleJson(tokens: Token[]): string {
        const parts: string[] = [];

        for (const token of tokens) {
            switch (token.type) {
                case 'string':
                    parts.push(this.toJsonString(token.value));
                    break;
                case 'number':
                case 'keyword':
                case 'structural':
                case 'colon':
                case 'comma':
                case 'whitespace':
                    parts.push(token.value);
                    break;
                case 'identifier':
                    parts.push(this.toJsonString(token.value));
                    break;
                default:
                    break;
            }
        }

        return parts.join('');
    }

    /**
     * Converts a string value to a properly escaped JSON string
     */
    private toJsonString(value: string): string {
        let escaped = '';

        for (const char of value) {
            const code = char.charCodeAt(0);

            if (char === '\\') {
                escaped += '\\\\';
            } else if (char === '"') {
                escaped += '\\"';
            } else if (char === '\n') {
                escaped += '\\n';
            } else if (char === '\r') {
                escaped += '\\r';
            } else if (char === '\t') {
                escaped += '\\t';
            } else if (code < 32) {
                escaped += `\\u${code.toString(16).padStart(4, '0')}`;
            } else {
                escaped += char;
            }
        }

        return `"${escaped}"`;
    }
}
