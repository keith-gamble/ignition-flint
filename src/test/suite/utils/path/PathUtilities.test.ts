/**
 * @module PathUtilities.test
 * @description Unit tests for PathUtilities class
 */

import * as assert from 'assert';

import { PathUtilities, PathNormalizationOptions } from '../../../../utils/path/PathUtilities';

suite('PathUtilities Test Suite', () => {
    let pathUtils: PathUtilities;

    setup(() => {
        // Create PathUtilities without service container (standalone mode)
        pathUtils = new PathUtilities(undefined, {
            preserveCase: false,
            allowBackslashes: false,
            maxDepth: 10
        });
    });

    // ============================================================================
    // NORMALIZATION TESTS
    // ============================================================================

    suite('normalize()', () => {
        test('Should normalize simple path', () => {
            const result = pathUtils.normalize('folder/subfolder/file.txt');
            assert.strictEqual(result, 'folder/subfolder/file.txt');
        });

        test('Should convert backslashes to forward slashes', () => {
            const result = pathUtils.normalize('folder\\subfolder\\file.txt');
            assert.strictEqual(result, 'folder/subfolder/file.txt');
        });

        test('Should remove leading and trailing slashes', () => {
            const result = pathUtils.normalize('/folder/subfolder/');
            assert.strictEqual(result, 'folder/subfolder');
        });

        test('Should normalize multiple consecutive slashes', () => {
            const result = pathUtils.normalize('folder//subfolder///file.txt');
            assert.strictEqual(result, 'folder/subfolder/file.txt');
        });

        test('Should remove current directory references', () => {
            const result = pathUtils.normalize('folder/./subfolder/./file.txt');
            assert.strictEqual(result, 'folder/subfolder/file.txt');
        });

        test('Should handle parent directory references', () => {
            const result = pathUtils.normalize('folder/subfolder/../file.txt');
            assert.strictEqual(result, 'folder/file.txt');
        });

        test('Should convert to lowercase by default', () => {
            const result = pathUtils.normalize('Folder/SubFolder/FILE.TXT');
            assert.strictEqual(result, 'folder/subfolder/file.txt');
        });

        test('Should preserve case when option is set', () => {
            const result = pathUtils.normalize('Folder/SubFolder/FILE.TXT', { preserveCase: true });
            assert.strictEqual(result, 'Folder/SubFolder/FILE.TXT');
        });

        test('Should return empty string for empty input', () => {
            assert.strictEqual(pathUtils.normalize(''), '');
            assert.strictEqual(pathUtils.normalize('   '), '');
        });

        test('Should handle null/undefined gracefully', () => {
            assert.strictEqual(pathUtils.normalize(null as unknown as string), '');
            assert.strictEqual(pathUtils.normalize(undefined as unknown as string), '');
        });

        test('Should handle complex path with mixed separators', () => {
            const result = pathUtils.normalize('/folder\\\\subfolder//nested/../file.txt/');
            assert.strictEqual(result, 'folder/subfolder/file.txt');
        });

        test('Should handle path starting with ./', () => {
            const result = pathUtils.normalize('./folder/file.txt');
            assert.strictEqual(result, 'folder/file.txt');
        });
    });

    // ============================================================================
    // JOIN TESTS
    // ============================================================================

    suite('join()', () => {
        test('Should join path segments', () => {
            const result = pathUtils.join('folder', 'subfolder', 'file.txt');
            assert.strictEqual(result, 'folder/subfolder/file.txt');
        });

        test('Should handle empty segments', () => {
            const result = pathUtils.join('folder', '', 'file.txt');
            assert.strictEqual(result, 'folder/file.txt');
        });

        test('Should handle single segment', () => {
            const result = pathUtils.join('folder');
            assert.strictEqual(result, 'folder');
        });

        test('Should return empty string for no valid segments', () => {
            const result = pathUtils.join('', '', '');
            assert.strictEqual(result, '');
        });

        test('Should normalize joined path', () => {
            const result = pathUtils.join('folder/', '/subfolder/', '/file.txt');
            assert.strictEqual(result, 'folder/subfolder/file.txt');
        });

        test('Should handle segments with spaces', () => {
            // join preserves internal spaces in segments
            const result = pathUtils.join('  folder  ', '  subfolder  ');
            // The normalize call trims leading/trailing slashes but preserves spaces in segments
            assert.ok(result.includes('folder'));
            assert.ok(result.includes('subfolder'));
        });
    });

    // ============================================================================
    // RELATIVE PATH TESTS
    // ============================================================================

    suite('relative()', () => {
        test('Should calculate relative path', () => {
            const result = pathUtils.relative('folder/subfolder', 'folder/subfolder/nested/file.txt');
            assert.strictEqual(result, 'nested/file.txt');
        });

        test('Should return empty for same path', () => {
            const result = pathUtils.relative('folder/subfolder', 'folder/subfolder');
            assert.strictEqual(result, '');
        });

        test('Should handle paths with no common prefix', () => {
            const result = pathUtils.relative('folder1', 'folder2/file.txt');
            assert.strictEqual(result, '../folder2/file.txt');
        });

        test('Should handle navigating up multiple levels', () => {
            const result = pathUtils.relative('folder/a/b/c', 'folder/x/y');
            assert.strictEqual(result, '../../../x/y');
        });

        test('Should handle base deeper than target', () => {
            const result = pathUtils.relative('folder/subfolder/nested', 'folder');
            assert.strictEqual(result, '../..');
        });
    });

    // ============================================================================
    // PARSE TESTS
    // ============================================================================

    suite('parse()', () => {
        test('Should parse path into components', () => {
            const result = pathUtils.parse('folder/subfolder/file.txt');

            assert.strictEqual(result.fullPath, 'folder/subfolder/file.txt');
            assert.deepStrictEqual(result.segments, ['folder', 'subfolder', 'file.txt']);
            assert.strictEqual(result.name, 'file.txt');
            assert.strictEqual(result.extension, '.txt');
            assert.strictEqual(result.parent, 'folder/subfolder');
            assert.strictEqual(result.depth, 3);
            assert.strictEqual(result.isAbsolute, false);
        });

        test('Should handle path without extension', () => {
            const result = pathUtils.parse('folder/subfolder/readme');

            assert.strictEqual(result.name, 'readme');
            assert.strictEqual(result.extension, '');
        });

        test('Should handle single segment path', () => {
            const result = pathUtils.parse('file.txt');

            assert.strictEqual(result.name, 'file.txt');
            assert.strictEqual(result.parent, null);
            assert.strictEqual(result.depth, 1);
        });

        test('Should detect absolute paths', () => {
            const absoluteUnix = pathUtils.parse('/absolute/path');
            assert.strictEqual(absoluteUnix.isAbsolute, true);

            const absoluteWindows = pathUtils.parse('C:/windows/path');
            assert.strictEqual(absoluteWindows.isAbsolute, true);
        });

        test('Should handle empty path', () => {
            const result = pathUtils.parse('');

            assert.strictEqual(result.fullPath, '');
            assert.deepStrictEqual(result.segments, []);
            assert.strictEqual(result.name, '');
            assert.strictEqual(result.depth, 0);
        });
    });

    // ============================================================================
    // GETTER TESTS
    // ============================================================================

    suite('getParent()', () => {
        test('Should return parent path', () => {
            assert.strictEqual(pathUtils.getParent('folder/subfolder/file.txt'), 'folder/subfolder');
        });

        test('Should return null for single segment', () => {
            assert.strictEqual(pathUtils.getParent('file.txt'), null);
        });
    });

    suite('getName()', () => {
        test('Should return name from path', () => {
            assert.strictEqual(pathUtils.getName('folder/subfolder/file.txt'), 'file.txt');
        });

        test('Should return empty string for empty path', () => {
            assert.strictEqual(pathUtils.getName(''), '');
        });
    });

    suite('getExtension()', () => {
        test('Should return extension', () => {
            assert.strictEqual(pathUtils.getExtension('folder/file.txt'), '.txt');
        });

        test('Should return empty string for no extension', () => {
            assert.strictEqual(pathUtils.getExtension('folder/file'), '');
        });

        test('Should handle multiple dots', () => {
            assert.strictEqual(pathUtils.getExtension('folder/file.test.txt'), '.txt');
        });
    });

    suite('getDepth()', () => {
        test('Should return depth', () => {
            assert.strictEqual(pathUtils.getDepth('folder/subfolder/file.txt'), 3);
            assert.strictEqual(pathUtils.getDepth('file.txt'), 1);
            assert.strictEqual(pathUtils.getDepth(''), 0);
        });
    });

    // ============================================================================
    // RELATIONSHIP TESTS
    // ============================================================================

    suite('isSubPath()', () => {
        test('Should detect subpath', () => {
            assert.strictEqual(pathUtils.isSubPath('folder/subfolder/file.txt', 'folder'), true);
            assert.strictEqual(pathUtils.isSubPath('folder/subfolder/file.txt', 'folder/subfolder'), true);
        });

        test('Should return true for same path', () => {
            assert.strictEqual(pathUtils.isSubPath('folder/subfolder', 'folder/subfolder'), true);
        });

        test('Should return false for non-subpath', () => {
            assert.strictEqual(pathUtils.isSubPath('folder1/file.txt', 'folder2'), false);
        });

        test('Should return false for partial matches', () => {
            assert.strictEqual(pathUtils.isSubPath('folder123/file.txt', 'folder1'), false);
        });

        test('Should return false for empty paths', () => {
            assert.strictEqual(pathUtils.isSubPath('', 'folder'), false);
            assert.strictEqual(pathUtils.isSubPath('folder', ''), false);
        });
    });

    suite('areSiblings()', () => {
        test('Should detect siblings', () => {
            assert.strictEqual(pathUtils.areSiblings('folder/file1.txt', 'folder/file2.txt'), true);
        });

        test('Should return false for non-siblings', () => {
            assert.strictEqual(pathUtils.areSiblings('folder1/file.txt', 'folder2/file.txt'), false);
        });

        test('Should return false for root level files', () => {
            assert.strictEqual(pathUtils.areSiblings('file1.txt', 'file2.txt'), false);
        });
    });

    suite('getCommonAncestor()', () => {
        test('Should find common ancestor', () => {
            const result = pathUtils.getCommonAncestor(
                'folder/subfolder/file1.txt',
                'folder/subfolder/file2.txt',
                'folder/subfolder/nested/file3.txt'
            );
            assert.strictEqual(result, 'folder/subfolder');
        });

        test('Should return null for no common ancestor', () => {
            const result = pathUtils.getCommonAncestor('folder1/file.txt', 'folder2/file.txt');
            assert.strictEqual(result, null);
        });

        test('Should return null for empty paths array', () => {
            assert.strictEqual(pathUtils.getCommonAncestor(), null);
        });

        test('Should return parent for single path', () => {
            const result = pathUtils.getCommonAncestor('folder/subfolder/file.txt');
            assert.strictEqual(result, 'folder/subfolder');
        });
    });

    // ============================================================================
    // VALIDATION TESTS
    // ============================================================================

    suite('validate()', () => {
        test('Should validate valid path', () => {
            const result = pathUtils.validate('folder/subfolder/file.txt');

            assert.strictEqual(result.isValid, true);
            assert.deepStrictEqual(result.errors, []);
        });

        test('Should detect invalid characters', () => {
            const result = pathUtils.validate('folder/file<name>.txt');

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('invalid characters')));
        });

        test('Should detect reserved names', () => {
            const result = pathUtils.validate('folder/CON/file.txt');

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('reserved name')));
        });

        test('Should detect path depth exceeding max', () => {
            const deepPath = Array(15).fill('folder').join('/');
            const result = pathUtils.validate(deepPath);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('depth')));
        });

        test('Should resolve parent directory references', () => {
            // Note: normalize() resolves ".." references, so no warning is produced
            // "folder/../file.txt" becomes "file.txt" after normalization
            const result = pathUtils.validate('folder/../file.txt');

            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.normalizedPath, 'file.txt');
        });

        test('Should warn about hidden files', () => {
            const result = pathUtils.validate('.hidden/file.txt');

            assert.ok(result.warnings.some(w => w.includes('hidden')));
        });

        test('Should handle extension validation', () => {
            // Test that validation returns a result with warnings array
            // Default config has allowedExtensions, so unknown extensions may generate warnings
            const result = pathUtils.validate('folder/file.txt');

            // Valid path with known extension
            assert.strictEqual(result.isValid, true);
            assert.ok(Array.isArray(result.warnings));
        });

        test('Should return error for empty path', () => {
            const result = pathUtils.validate('');

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('empty')));
        });

        test('Should return error for null path', () => {
            const result = pathUtils.validate(null as unknown as string);

            assert.strictEqual(result.isValid, false);
        });
    });

    suite('validateName()', () => {
        test('Should validate valid name', () => {
            const result = pathUtils.validateName('valid_name.txt');

            assert.strictEqual(result.isValid, true);
        });

        test('Should detect path separators in name', () => {
            const result = pathUtils.validateName('folder/file.txt');

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('path separators')));
        });

        test('Should detect invalid characters in name', () => {
            const result = pathUtils.validateName('file<name>.txt');

            assert.strictEqual(result.isValid, false);
        });

        test('Should detect reserved names', () => {
            const result = pathUtils.validateName('NUL');

            assert.strictEqual(result.isValid, false);
        });

        test('Should detect name too long', () => {
            const longName = 'a'.repeat(300);
            const result = pathUtils.validateName(longName);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes('too long')));
        });

        test('Should warn about dot prefix', () => {
            const result = pathUtils.validateName('.hidden');

            assert.ok(result.warnings.some(w => w.includes('dot')));
        });

        test('Should warn about dot suffix', () => {
            const result = pathUtils.validateName('file.');

            assert.ok(result.warnings.some(w => w.includes('dot')));
        });

        test('Should warn about multiple spaces', () => {
            const result = pathUtils.validateName('file  name.txt');

            assert.ok(result.warnings.some(w => w.includes('spaces')));
        });
    });

    // ============================================================================
    // CONFIGURATION TESTS
    // ============================================================================

    suite('Configuration', () => {
        test('Should update configuration', () => {
            pathUtils.updateConfiguration({ maxDepth: 5 });
            const config = pathUtils.getConfiguration();

            assert.strictEqual(config.maxDepth, 5);
        });

        test('Should return frozen configuration', () => {
            const config = pathUtils.getConfiguration();

            assert.throws(() => {
                (config as PathNormalizationOptions & { maxDepth: number }).maxDepth = 100;
            });
        });
    });

    // ============================================================================
    // SERVICE LIFECYCLE TESTS
    // ============================================================================

    suite('Service Lifecycle', () => {
        test('Should return STOPPED status before initialization', () => {
            const newUtils = new PathUtilities();
            assert.strictEqual(newUtils.getStatus(), 'stopped');
        });

        test('Should handle start without prior initialization', async () => {
            const newUtils = new PathUtilities();
            // Start should auto-initialize
            await newUtils.start();
            assert.strictEqual(newUtils.getStatus(), 'running');
        });

        test('Should handle stop and dispose', async () => {
            const newUtils = new PathUtilities();
            await newUtils.start();
            await newUtils.stop();
            await newUtils.dispose();
            // Should not throw
        });

        test('toString should return descriptive string', () => {
            const str = pathUtils.toString();
            assert.ok(str.includes('PathUtilities'));
            assert.ok(str.includes('maxDepth'));
        });
    });
});
