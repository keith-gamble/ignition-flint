/**
 * @module testUtils
 * @description Test utilities and helpers for Flint unit tests
 */

import * as assert from 'assert';

/**
 * Assertion helpers with better error messages
 */
export const assertions: {
    isDefined: <T>(value: T | undefined | null, message?: string) => asserts value is T;
    isUndefined: (value: unknown, message?: string) => void;
    isNull: (value: unknown, message?: string) => void;
    hasLength: (array: unknown[], expectedLength: number, message?: string) => void;
    isEmpty: (array: unknown[], message?: string) => void;
    isNotEmpty: (array: unknown[], message?: string) => void;
    contains: (str: string, substring: string, message?: string) => void;
    startsWith: (str: string, prefix: string, message?: string) => void;
    endsWith: (str: string, suffix: string, message?: string) => void;
    matches: (str: string, pattern: RegExp, message?: string) => void;
    hasProperty: (obj: object, property: string, message?: string) => void;
    throwsAsync: (
        fn: () => Promise<unknown>,
        errorType?: new (...args: unknown[]) => Error,
        message?: string
    ) => Promise<void>;
    doesNotThrowAsync: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
} = {
    /**
     * Assert that a value is defined (not undefined or null)
     */
    isDefined<T>(value: T | undefined | null, message?: string): asserts value is T {
        assert.ok(value !== undefined && value !== null, message || 'Expected value to be defined');
    },

    /**
     * Assert that a value is undefined
     */
    isUndefined(value: unknown, message?: string): void {
        assert.strictEqual(value, undefined, message || 'Expected value to be undefined');
    },

    /**
     * Assert that a value is null
     */
    isNull(value: unknown, message?: string): void {
        assert.strictEqual(value, null, message || 'Expected value to be null');
    },

    /**
     * Assert that an array has a specific length
     */
    hasLength(array: unknown[], expectedLength: number, message?: string): void {
        assert.strictEqual(
            array.length,
            expectedLength,
            message || `Expected array length ${expectedLength}, got ${array.length}`
        );
    },

    /**
     * Assert that an array is empty
     */
    isEmpty(array: unknown[], message?: string): void {
        assert.strictEqual(array.length, 0, message || `Expected empty array, got ${array.length} elements`);
    },

    /**
     * Assert that an array is not empty
     */
    isNotEmpty(array: unknown[], message?: string): void {
        assert.ok(array.length > 0, message || 'Expected non-empty array');
    },

    /**
     * Assert that a string contains a substring
     */
    contains(str: string, substring: string, message?: string): void {
        assert.ok(str.includes(substring), message || `Expected "${str}" to contain "${substring}"`);
    },

    /**
     * Assert that a string starts with a prefix
     */
    startsWith(str: string, prefix: string, message?: string): void {
        assert.ok(str.startsWith(prefix), message || `Expected "${str}" to start with "${prefix}"`);
    },

    /**
     * Assert that a string ends with a suffix
     */
    endsWith(str: string, suffix: string, message?: string): void {
        assert.ok(str.endsWith(suffix), message || `Expected "${str}" to end with "${suffix}"`);
    },

    /**
     * Assert that a value matches a regex pattern
     */
    matches(str: string, pattern: RegExp, message?: string): void {
        assert.ok(pattern.test(str), message || `Expected "${str}" to match ${pattern}`);
    },

    /**
     * Assert that an object has a specific property
     */
    hasProperty(obj: object, property: string, message?: string): void {
        assert.ok(property in obj, message || `Expected object to have property "${property}"`);
    },

    /**
     * Assert that an async function throws an error
     */
    async throwsAsync(
        fn: () => Promise<unknown>,
        errorType?: new (...args: unknown[]) => Error,
        message?: string
    ): Promise<void> {
        let threw = false;
        let error: Error | undefined;

        try {
            await fn();
        } catch (e) {
            threw = true;
            error = e as Error;
        }

        assert.ok(threw, message || 'Expected function to throw');

        if (errorType && error) {
            assert.ok(
                error instanceof errorType,
                `Expected error of type ${errorType.name}, got ${error.constructor.name}`
            );
        }
    },

    /**
     * Assert that an async function does not throw
     */
    async doesNotThrowAsync(fn: () => Promise<unknown>, message?: string): Promise<void> {
        try {
            await fn();
        } catch (e) {
            assert.fail(message || `Expected function not to throw, but it threw: ${(e as Error).message}`);
        }
    }
};

/**
 * Test data generators
 */
export const generators = {
    /**
     * Generate a random string
     */
    randomString(length: number = 10): string {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    },

    /**
     * Generate a random integer
     */
    randomInt(min: number = 0, max: number = 1000): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    /**
     * Generate a random path
     */
    randomPath(depth: number = 3): string {
        const segments = [];
        for (let i = 0; i < depth; i++) {
            segments.push(this.randomString(8));
        }
        return segments.join('/');
    },

    /**
     * Generate a mock project resource
     */
    mockProjectResource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            key: `test:${this.randomString()}`,
            path: this.randomPath(),
            type: 'test-type',
            origin: 'local',
            files: [],
            metadata: {},
            ...overrides
        };
    },

    /**
     * Generate a mock gateway config
     */
    mockGatewayConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            host: 'localhost',
            port: 8088,
            useHttps: false,
            projects: [],
            ...overrides
        };
    }
};

/**
 * Async test helpers
 */
export const asyncHelpers = {
    /**
     * Wait for a condition to be true
     */
    async waitFor(condition: () => boolean, timeout: number = 5000, interval: number = 100): Promise<void> {
        const startTime = Date.now();
        while (!condition()) {
            if (Date.now() - startTime > timeout) {
                throw new Error('Timeout waiting for condition');
            }
            await this.delay(interval);
        }
    },

    /**
     * Delay for a specified time
     */
    delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Run a function with a timeout
     */
    async withTimeout<T>(fn: () => Promise<T>, timeout: number = 5000): Promise<T> {
        return Promise.race([
            fn(),
            new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Operation timed out')), timeout))
        ]);
    }
};

/**
 * Mock function helpers (for when not using jest)
 */
export class MockFunction<T extends (...args: any[]) => any> {
    private calls: Parameters<T>[] = [];
    private returnValue: ReturnType<T> | undefined;
    private implementation: T | undefined;

    constructor(implementation?: T) {
        this.implementation = implementation;
    }

    call(...args: Parameters<T>): ReturnType<T> {
        this.calls.push(args);
        if (this.implementation) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return this.implementation(...args) as ReturnType<T>;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return this.returnValue as ReturnType<T>;
    }

    mockReturnValue(value: ReturnType<T>): this {
        this.returnValue = value;
        return this;
    }

    mockImplementation(impl: T): this {
        this.implementation = impl;
        return this;
    }

    get mock(): { calls: Parameters<T>[] } {
        return { calls: this.calls };
    }

    get callCount(): number {
        return this.calls.length;
    }

    wasCalledWith(...args: Parameters<T>): boolean {
        return this.calls.some(callArgs => JSON.stringify(callArgs) === JSON.stringify(args));
    }

    reset(): void {
        this.calls = [];
    }
}

/**
 * Creates a spy function that tracks calls
 * Uses 'any' types for flexibility in test mocking
 */
export function createSpy<T extends (...args: any[]) => any>(
    impl?: T
): {
    (...args: any[]): any;
    mock: { calls: any[][] };
    callCount: number;
    mockReturnValue: (value: any) => void;
    mockImplementation: (impl: T) => void;
    wasCalledWith: (...args: any[]) => boolean;
    reset: () => void;
} {
    const mockFn = new MockFunction<T>(impl);
    const fn = (...args: any[]): any => mockFn.call(...(args as Parameters<T>));

    // Create the spy object with all properties
    const spy = fn as typeof fn & {
        mock: { calls: any[][] };
        callCount: number;
        mockReturnValue: (value: any) => void;
        mockImplementation: (impl: T) => void;
        wasCalledWith: (...args: any[]) => boolean;
        reset: () => void;
    };

    // Copy MockFunction properties
    Object.defineProperty(spy, 'mock', { get: () => mockFn.mock });
    Object.defineProperty(spy, 'callCount', { get: () => mockFn.callCount });
    spy.mockReturnValue = (value: any): void => {
        mockFn.mockReturnValue(value);
    };
    spy.mockImplementation = (newImpl: T): void => {
        mockFn.mockImplementation(newImpl);
    };
    spy.wasCalledWith = (...args: any[]): boolean => mockFn.wasCalledWith(...(args as Parameters<T>));
    spy.reset = (): void => {
        mockFn.reset();
    };

    return spy;
}

/**
 * Test suite helpers
 */
export const suiteHelpers = {
    /**
     * Creates a describe block that skips if condition is false
     */
    describeIf(condition: boolean, name: string, fn: () => void): void {
        if (condition) {
            suite(name, fn);
        }
    },

    /**
     * Creates a test that skips if condition is false
     */
    testIf(condition: boolean, name: string, fn: () => void | Promise<void>): void {
        if (condition) {
            test(name, fn);
        }
    }
};

/**
 * Path normalization helper for cross-platform tests
 */
export function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+/g, '/');
}

/**
 * Creates a temporary test context that cleans up after itself
 */
export function createTestContext(): {
    cleanup: () => void;
    addCleanup: (fn: () => void | Promise<void>) => void;
} {
    const cleanupFns: (() => void | Promise<void>)[] = [];

    return {
        addCleanup(fn: () => void | Promise<void>): void {
            cleanupFns.push(fn);
        },
        async cleanup(): Promise<void> {
            for (const fn of cleanupFns.reverse()) {
                await fn();
            }
        }
    };
}
