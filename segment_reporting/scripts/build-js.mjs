/**
 * Build script for JS minification, cache busting, and custom Chart.js bundling.
 *
 * Usage:
 *   node scripts/build-js.mjs minify   - Patch cache tags, minify JS, and patch HTML (backup originals first)
 *   node scripts/build-js.mjs restore  - Restore original JS and HTML files from backup
 *   node scripts/build-js.mjs chart    - Rebuild the custom Chart.js bundle (run once, then commit)
 *
 * Called by MSBuild during Release builds (see .csproj MinifyJS/RestoreJS targets).
 */
import { rollup } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import terserPlugin from '@rollup/plugin-terser';
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');
const pagesDir = path.join(projectDir, 'Pages');
const backupDir = path.join(projectDir, 'obj', 'js-backup');

/** JS files to minify (excludes chart.min.js which is rebuilt from source). */
const CUSTOM_JS_FILES = [
    'segment_dashboard.js',
    'segment_library.js',
    'segment_series.js',
    'segment_custom_query.js',
    'segment_about.js',
    'segment_reporting_helpers.js',
    'segment_settings.js'
];

/** HTML files to patch with cache-busting version tags. */
const HTML_FILES = [
    'segment_dashboard.html',
    'segment_library.html',
    'segment_series.html',
    'segment_settings.html',
    'segment_custom_query.html',
    'segment_about.html'
];

const CHART_OUTPUT = 'segment_reporting_chart.min.js';

/**
 * Read the AssemblyVersion from Properties/AssemblyInfo.cs.
 * Returns the version string, e.g. "1.0.0.0".
 */
function readAssemblyVersion() {
    const assemblyInfo = fs.readFileSync(
        path.join(projectDir, 'Properties', 'AssemblyInfo.cs'), 'utf8'
    );
    // Match only uncommented [assembly: AssemblyVersion("...")] lines (skip // comments)
    const match = assemblyInfo.match(/^\[assembly: AssemblyVersion\("([^"]+)"\)/m);
    if (!match) {
        throw new Error('Could not read AssemblyVersion from Properties/AssemblyInfo.cs');
    }
    return match[1];
}

/**
 * Convert a version string like "1.0.0.0" into a cache tag like "v1_0_0_0".
 * Must match the format used by Plugin.cs at runtime.
 */
function cacheTag(version) {
    return 'v' + version.replace(/\./g, '_');
}

/**
 * Patch JS and HTML files in-place to add version tags for cache busting.
 * - JS: getConfigurationResourceUrl('file.js') → getConfigurationResourceUrl('file.{tag}.js')
 * - HTML: data-controller="__plugin/file.js" → data-controller="__plugin/file.{tag}.js"
 */
function patchCacheBust(tag) {
    // Patch JS files: version all getConfigurationResourceUrl calls
    for (const file of CUSTOM_JS_FILES) {
        const filePath = path.join(pagesDir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        content = content.replace(
            /getConfigurationResourceUrl\('([^']+)\.js'\)/g,
            `getConfigurationResourceUrl('$1.${tag}.js')`
        );
        fs.writeFileSync(filePath, content);
    }

    // Patch HTML files: version data-controller paths
    for (const file of HTML_FILES) {
        const filePath = path.join(pagesDir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        content = content.replace(
            /data-controller="__plugin\/([^"]+)\.js"/g,
            `data-controller="__plugin/$1.${tag}.js"`
        );
        fs.writeFileSync(filePath, content);
    }
}

/**
 * Build a custom Chart.js v4 bundle with only the modules this plugin uses.
 * Uses rollup for aggressive tree-shaking and native UMD output.
 * Output is compatible with Emby's AMD require() loader.
 */
async function buildChart() {
    const entryPoint = path.join(__dirname, 'chart-entry.mjs');

    const bundle = await rollup({
        input: entryPoint,
        plugins: [resolve(), terserPlugin()],
    });

    const { output } = await bundle.generate({
        format: 'umd',
        name: 'Chart',
        exports: 'default',
        banner: '/*!\n * Chart.js v4.5.1 (custom build - bar charts only)\n * https://www.chartjs.org\n * (c) 2024 Chart.js Contributors\n * Released under the MIT License\n */',
    });

    await bundle.close();

    const code = output[0].code;
    const outPath = path.join(pagesDir, CHART_OUTPUT);
    fs.writeFileSync(outPath, code);

    const sizeKB = (Buffer.byteLength(code, 'utf8') / 1024).toFixed(1);
    console.log('  ' + CHART_OUTPUT + ': 195.0 KB -> ' + sizeKB + ' KB');
}

/**
 * Minify custom JS files and patch all files for cache busting.
 * Originals (JS + HTML) are backed up to obj/js-backup/ for restoration after build.
 */
async function minifyJS() {
    fs.mkdirSync(backupDir, { recursive: true });

    // Back up JS files
    for (const file of CUSTOM_JS_FILES) {
        const filePath = path.join(pagesDir, file);
        fs.writeFileSync(path.join(backupDir, file), fs.readFileSync(filePath, 'utf8'));
    }

    // Back up HTML files
    for (const file of HTML_FILES) {
        const filePath = path.join(pagesDir, file);
        fs.writeFileSync(path.join(backupDir, file), fs.readFileSync(filePath, 'utf8'));
    }

    // Patch cache-busting version tags into JS and HTML files
    const version = readAssemblyVersion();
    const tag = cacheTag(version);
    console.log('  Cache tag: ' + tag + ' (from AssemblyVersion ' + version + ')');
    patchCacheBust(tag);

    // Minify JS files (now containing versioned resource URLs)
    for (const file of CUSTOM_JS_FILES) {
        const filePath = path.join(pagesDir, file);
        const patched = fs.readFileSync(filePath, 'utf8');

        const result = await esbuild.transform(patched, {
            minify: true,
            target: 'es2015',
        });

        fs.writeFileSync(filePath, result.code);

        const origKB = (Buffer.byteLength(
            fs.readFileSync(path.join(backupDir, file), 'utf8'), 'utf8'
        ) / 1024).toFixed(1);
        const minKB = (Buffer.byteLength(result.code, 'utf8') / 1024).toFixed(1);
        console.log('  ' + file + ': ' + origKB + ' KB -> ' + minKB + ' KB');
    }
}

/** Restore original JS and HTML files from backup (called after build completes). */
function restoreJS() {
    if (!fs.existsSync(backupDir)) {
        console.log('  No backup found, nothing to restore.');
        return;
    }

    let restored = 0;
    for (const file of [...CUSTOM_JS_FILES, ...HTML_FILES]) {
        const backupPath = path.join(backupDir, file);
        if (fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, path.join(pagesDir, file));
            restored++;
        }
    }
    console.log('  Restored ' + restored + ' files from backup.');
}

// --- Main ---
const mode = process.argv[2];

switch (mode) {
    case 'minify':
        console.log('Minifying JS files...');
        await minifyJS();
        break;

    case 'restore':
        console.log('Restoring JS files...');
        restoreJS();
        break;

    case 'chart':
        console.log('Building custom Chart.js...');
        await buildChart();
        break;

    default:
        console.log('Usage: node scripts/build-js.mjs [minify|restore|chart]');
        process.exit(1);
}
