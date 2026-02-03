import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Resolve a path to a TypeScript file, trying various extensions
 */
function resolveTypescriptPath(basePath) {
    // Try exact path first
    if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
        return basePath;
    }
    // Try with .ts extension
    if (fs.existsSync(basePath + '.ts')) {
        return basePath + '.ts';
    }
    // Try with /index.ts for directories
    if (fs.existsSync(path.join(basePath, 'index.ts'))) {
        return path.join(basePath, 'index.ts');
    }
    // Fallback
    return basePath + '.ts';
}

/** @type {esbuild.BuildOptions} */
const buildOptions = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !production,
    minify: production,
    treeShaking: true,
    // Handle path aliases from tsconfig (esbuild resolves @/* to src/*)
    plugins: [
        {
            name: 'path-alias',
            setup(build) {
                // Resolve @/* imports to src/*
                build.onResolve({ filter: /^@\// }, (args) => {
                    const relativePath = args.path.replace(/^@\//, 'src/');
                    const absolutePath = path.resolve(__dirname, relativePath);
                    const resolvedPath = resolveTypescriptPath(absolutePath);
                    return { path: resolvedPath };
                });
            },
        },
    ],
};

async function main() {
    if (watch) {
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        console.log('Watching for changes...');
    } else {
        await esbuild.build(buildOptions);
        console.log(production ? 'Production build complete' : 'Development build complete');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
