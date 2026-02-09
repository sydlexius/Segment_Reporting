/**
 * Build script for JS minification and custom Chart.js bundling.
 *
 * Usage:
 *   node scripts/build-js.mjs minify   - Minify custom JS files in-place (backup originals first)
 *   node scripts/build-js.mjs restore  - Restore original JS files from backup
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
    'segment_reporting_helpers.js',
    'segment_settings.js'
];

const CHART_OUTPUT = 'segment_reporting_chart.min.js';

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
 * Minify custom JS files in-place using esbuild transform.
 * Originals are backed up to obj/js-backup/ for restoration after build.
 */
async function minifyJS() {
    fs.mkdirSync(backupDir, { recursive: true });

    for (const file of CUSTOM_JS_FILES) {
        const filePath = path.join(pagesDir, file);
        const original = fs.readFileSync(filePath, 'utf8');

        // Back up original
        fs.writeFileSync(path.join(backupDir, file), original);

        // Minify with esbuild (faster than terser, similar compression)
        const result = await esbuild.transform(original, {
            minify: true,
            target: 'es2015',
        });

        fs.writeFileSync(filePath, result.code);

        const origKB = (Buffer.byteLength(original, 'utf8') / 1024).toFixed(1);
        const minKB = (Buffer.byteLength(result.code, 'utf8') / 1024).toFixed(1);
        console.log('  ' + file + ': ' + origKB + ' KB -> ' + minKB + ' KB');
    }
}

/** Restore original JS files from backup (called after build completes). */
function restoreJS() {
    if (!fs.existsSync(backupDir)) {
        console.log('  No backup found, nothing to restore.');
        return;
    }

    let restored = 0;
    for (const file of CUSTOM_JS_FILES) {
        const backupPath = path.join(backupDir, file);
        if (fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, path.join(pagesDir, file));
            restored++;
        }
    }
    console.log('  Restored ' + restored + ' JS files from backup.');
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
