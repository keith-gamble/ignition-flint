/**
 * @module helpers.test
 * @description Unit tests for utility helper functions
 */

import * as assert from 'assert';

import { ErrorHelper } from '../../../utils/errorHelper';
import { assertions, generators, asyncHelpers, createSpy, normalizePath } from '../../helpers/testUtils';

suite('ErrorHelper Test Suite', () => {
    // ============================================================================
    // ERROR TYPE TESTS
    // ============================================================================

    suite('ErrorTypes', () => {
        test('Should have expected error types', () => {
            assert.ok('VALIDATION' in ErrorHelper.ErrorTypes);
            assert.ok('FILE_SYSTEM' in ErrorHelper.ErrorTypes);
            assert.ok('NETWORK' in ErrorHelper.ErrorTypes);
            assert.ok('CONFIGURATION' in ErrorHelper.ErrorTypes);
            assert.ok('RESOURCE' in ErrorHelper.ErrorTypes);
            assert.ok('PROJECT' in ErrorHelper.ErrorTypes);
            assert.ok('PERMISSION' in ErrorHelper.ErrorTypes);
            assert.ok('UNKNOWN' in ErrorHelper.ErrorTypes);
        });

        test('Should have correct type values', () => {
            assert.strictEqual(ErrorHelper.ErrorTypes.VALIDATION, 'validation');
            assert.strictEqual(ErrorHelper.ErrorTypes.FILE_SYSTEM, 'filesystem');
            assert.strictEqual(ErrorHelper.ErrorTypes.NETWORK, 'network');
            assert.strictEqual(ErrorHelper.ErrorTypes.CONFIGURATION, 'configuration');
        });
    });

    // ============================================================================
    // LOGGING TESTS
    // ============================================================================

    suite('Logging', () => {
        setup(() => {
            ErrorHelper.silent = true;
        });

        teardown(() => {
            ErrorHelper.silent = false;
        });

        test('Should log error without throwing', () => {
            // Should not throw
            ErrorHelper.logError('Test context', new Error('Test error'));
            ErrorHelper.logError('Test context', 'String error message');
        });

        test('Should log error with additional data', () => {
            // Should not throw
            ErrorHelper.logError('Test context', new Error('Test'), { extra: 'data' });
        });

        test('Should log warning without throwing', () => {
            // Should not throw
            ErrorHelper.logWarning('Test context', 'Test warning');
            ErrorHelper.logWarning('Test context', 'Test warning', { extra: 'data' });
        });
    });

    // ============================================================================
    // SAFE EXECUTION TESTS
    // ============================================================================

    suite('safe()', () => {
        setup(() => {
            ErrorHelper.silent = true;
        });

        teardown(() => {
            ErrorHelper.silent = false;
        });

        test('Should return result on success', () => {
            const result = ErrorHelper.safe(() => 'success', 'test');

            assert.strictEqual(result, 'success');
        });

        test('Should return fallback on error', () => {
            const result = ErrorHelper.safe(
                () => {
                    throw new Error('test');
                },
                'test',
                'fallback',
                false
            );

            assert.strictEqual(result, 'fallback');
        });

        test('Should return undefined on error without fallback', () => {
            const result = ErrorHelper.safe(
                () => {
                    throw new Error('test');
                },
                'test',
                undefined,
                false
            );

            assert.strictEqual(result, undefined);
        });
    });

    suite('safeAsync()', () => {
        setup(() => {
            ErrorHelper.silent = true;
        });

        teardown(() => {
            ErrorHelper.silent = false;
        });

        test('Should return result on success', async () => {
            const result = await ErrorHelper.safeAsync(() => Promise.resolve('success'), 'test', undefined, false);

            assert.strictEqual(result, 'success');
        });

        test('Should return fallback on error', async () => {
            const result = await ErrorHelper.safeAsync(
                () => Promise.reject(new Error('test')),
                'test',
                'fallback',
                false
            );

            assert.strictEqual(result, 'fallback');
        });

        test('Should return undefined on error without fallback', async () => {
            const result = await ErrorHelper.safeAsync(
                () => Promise.reject(new Error('test')),
                'test',
                undefined,
                false
            );

            assert.strictEqual(result, undefined);
        });
    });
});

suite('Test Utilities Test Suite', () => {
    // ============================================================================
    // ASSERTIONS TESTS
    // ============================================================================

    suite('assertions', () => {
        test('isDefined should pass for defined values', () => {
            assertions.isDefined('value');
            assertions.isDefined(0);
            assertions.isDefined(false);
            assertions.isDefined({});
        });

        test('isDefined should throw for undefined/null', () => {
            assert.throws(() => assertions.isDefined(undefined));
            assert.throws(() => assertions.isDefined(null));
        });

        test('isUndefined should pass for undefined', () => {
            assertions.isUndefined(undefined);
        });

        test('isNull should pass for null', () => {
            assertions.isNull(null);
        });

        test('hasLength should check array length', () => {
            assertions.hasLength([1, 2, 3], 3);
            assert.throws(() => assertions.hasLength([1, 2], 3));
        });

        test('isEmpty should check for empty array', () => {
            assertions.isEmpty([]);
            assert.throws(() => assertions.isEmpty([1]));
        });

        test('isNotEmpty should check for non-empty array', () => {
            assertions.isNotEmpty([1]);
            assert.throws(() => assertions.isNotEmpty([]));
        });

        test('contains should check substring', () => {
            assertions.contains('hello world', 'world');
            assert.throws(() => assertions.contains('hello', 'world'));
        });

        test('startsWith should check prefix', () => {
            assertions.startsWith('hello world', 'hello');
            assert.throws(() => assertions.startsWith('hello', 'world'));
        });

        test('endsWith should check suffix', () => {
            assertions.endsWith('hello world', 'world');
            assert.throws(() => assertions.endsWith('hello', 'world'));
        });

        test('matches should check regex', () => {
            assertions.matches('hello123', /\d+/);
            assert.throws(() => assertions.matches('hello', /\d+/));
        });

        test('hasProperty should check object property', () => {
            assertions.hasProperty({ key: 'value' }, 'key');
            assert.throws(() => assertions.hasProperty({}, 'missing'));
        });

        test('throwsAsync should catch async errors', async () => {
            await assertions.throwsAsync(() => Promise.reject(new Error('test')));
        });

        test('doesNotThrowAsync should pass for non-throwing functions', async () => {
            await assertions.doesNotThrowAsync(() => Promise.resolve('success'));
        });
    });

    // ============================================================================
    // GENERATORS TESTS
    // ============================================================================

    suite('generators', () => {
        test('randomString should generate string of specified length', () => {
            const str = generators.randomString(10);
            assert.strictEqual(str.length, 10);
        });

        test('randomString should generate different strings', () => {
            const str1 = generators.randomString(10);
            const str2 = generators.randomString(10);
            assert.notStrictEqual(str1, str2);
        });

        test('randomInt should generate integer in range', () => {
            const num = generators.randomInt(5, 10);
            assert.ok(num >= 5);
            assert.ok(num <= 10);
        });

        test('randomPath should generate path with segments', () => {
            const pathResult = generators.randomPath(3);
            const segments = pathResult.split('/');
            assert.strictEqual(segments.length, 3);
        });

        test('mockProjectResource should create resource object', () => {
            const resource = generators.mockProjectResource();
            assert.ok('key' in resource);
            assert.ok('path' in resource);
            assert.ok('type' in resource);
        });

        test('mockProjectResource should allow overrides', () => {
            const resource = generators.mockProjectResource({ type: 'custom' });
            assert.strictEqual(resource.type, 'custom');
        });

        test('mockGatewayConfig should create gateway object', () => {
            const config = generators.mockGatewayConfig();
            assert.ok('host' in config);
            assert.ok('port' in config);
        });
    });

    // ============================================================================
    // ASYNC HELPERS TESTS
    // ============================================================================

    suite('asyncHelpers', () => {
        test('delay should wait specified time', async () => {
            const start = Date.now();
            await asyncHelpers.delay(50);
            const elapsed = Date.now() - start;
            assert.ok(elapsed >= 40); // Allow some tolerance
        });

        test('waitFor should resolve when condition is true', async () => {
            let ready = false;
            setTimeout(() => {
                ready = true;
            }, 50);

            await asyncHelpers.waitFor(() => ready, 1000, 10);
            assert.strictEqual(ready, true);
        });

        test('waitFor should timeout', async () => {
            try {
                await asyncHelpers.waitFor(() => false, 100, 10);
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('Timeout'));
            }
        });

        test('withTimeout should return result before timeout', async () => {
            const result = await asyncHelpers.withTimeout(() => Promise.resolve('success'), 1000);
            assert.strictEqual(result, 'success');
        });

        test('withTimeout should throw on timeout', async () => {
            try {
                await asyncHelpers.withTimeout(async () => {
                    await asyncHelpers.delay(500);
                    return 'too late';
                }, 50);
                assert.fail('Should have thrown');
            } catch (e) {
                assert.ok((e as Error).message.includes('timed out'));
            }
        });
    });

    // ============================================================================
    // SPY TESTS
    // ============================================================================

    suite('createSpy', () => {
        test('Should track calls', () => {
            const spy = createSpy();
            spy('arg1');
            spy('arg2', 'arg3');

            assert.strictEqual(spy.callCount, 2);
        });

        test('Should track call arguments', () => {
            const spy = createSpy();
            spy('hello', 'world');

            assert.ok(spy.wasCalledWith('hello', 'world'));
        });

        test('Should return mocked value', () => {
            const spy = createSpy();
            spy.mockReturnValue('mocked');

            const result = spy();
            assert.strictEqual(result, 'mocked');
        });

        test('Should use mock implementation', () => {
            const spy = createSpy((x: number) => x * 2);

            const result = spy(5);
            assert.strictEqual(result, 10);
        });

        test('Should reset call tracking', () => {
            const spy = createSpy();
            spy('call1');
            spy.reset();

            assert.strictEqual(spy.callCount, 0);
        });
    });

    // ============================================================================
    // PATH NORMALIZATION TESTS
    // ============================================================================

    suite('normalizePath', () => {
        test('Should convert backslashes to forward slashes', () => {
            const result = normalizePath('folder\\subfolder\\file.txt');
            assert.strictEqual(result, 'folder/subfolder/file.txt');
        });

        test('Should normalize multiple slashes', () => {
            const result = normalizePath('folder//subfolder///file.txt');
            assert.strictEqual(result, 'folder/subfolder/file.txt');
        });

        test('Should handle mixed separators', () => {
            const result = normalizePath('folder\\\\subfolder//file.txt');
            assert.strictEqual(result, 'folder/subfolder/file.txt');
        });
    });
});
