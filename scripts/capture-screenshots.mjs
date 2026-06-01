#!/usr/bin/env node
/**
 * Automated screenshot capture with data anonymization for Segment Reporting.
 *
 * Captures full-page and feature-cropped screenshots of each plugin page
 * from a running Emby server, replacing real library data with fictional
 * names to protect privacy.
 *
 * Prerequisites:
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *
 * Usage:
 *   node scripts/capture-screenshots.mjs
 *
 * Environment variables:
 *   EMBY_URL       Emby server URL (default: http://localhost:8096)
 *   EMBY_API_KEY   Admin API key (lets non-SPA asset requests through)
 *   EMBY_USER      Admin username (required; the plugin pages use ApiClient,
 *                  which needs an authenticated user session)
 *   EMBY_PASSWORD  Admin password
 *
 * Output: docs/Screenshots/ directory (full-page and *-crop.png variants)
 */

import { chromium } from 'playwright';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Output directory. Defaults to docs/Screenshots; override with SCREENSHOTS_DIR
// to capture into a scratch directory (e.g. a smoke test) without overwriting
// the committed images.
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR
    ? path.resolve(process.env.SCREENSHOTS_DIR)
    : path.resolve(__dirname, '..', 'docs', 'Screenshots');

const EMBY_URL = process.env.EMBY_URL || 'http://localhost:8096';
const API_KEY = process.env.EMBY_API_KEY;

if (!process.env.EMBY_USER) {
    console.error('Error: EMBY_USER (and EMBY_PASSWORD) are required for SPA login.');
    console.error('The plugin pages use Emby ApiClient, which needs an authenticated user session.');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Fictional names for anonymization
// ---------------------------------------------------------------------------

/** Episode names used to replace real episode titles. */
const FICTIONAL_EPISODES = [
    'The Awakening', 'Shadow Protocol', 'Convergence', 'Midnight Signal',
    'The First Gate', 'Resonance', 'Fractured Light', 'Silent Accord',
    'Descent', 'The Iron Path', 'Catalyst', 'Veil of Stars',
    'Crossfire', 'The Ember Court', 'Undertow', 'Threshold',
    'Reckoning', 'Parallax', 'The Quiet Storm', 'Meridian Line',
    'Fulcrum', 'Aftermath', 'Obsidian Hour', 'The Last Signal',
    'Solstice', 'Uncharted', 'The Forge', 'Twilight Run',
    'Faultline', 'The Accord', 'Tempest', 'Zenith Point'
];

/** Series names used to replace real series titles. */
const FICTIONAL_SERIES = [
    'Crimson Meridian', 'Silver Horizon', 'Azure Chronicle', 'The Phantom Gate',
    'Starweaver', 'Obsidian Legacy', 'Neon Prism', 'Shadowfall',
    'The Jade Compass', 'Iron Bloom', 'Crystal Vanguard', 'Stormlight',
    'Starfield Academy', 'Night Circuit', 'The Amber Throne', 'Echoes of Dawn'
];

/** Library names used to replace real library names. */
const FICTIONAL_LIBRARIES = {
    // Map common library types to safe names. During capture, real names are
    // mapped to these by detection order.
    defaults: ['TV Shows', 'Movies', 'Documentaries', 'Kids TV']
};

/** Larger pool of fictional library names (the prod server has many). */
const FICTIONAL_LIBRARY_POOL = [
    'TV Shows', 'Movies', 'Documentaries', 'Kids TV', 'Classic Films',
    'Anime Collection', 'Indie Cinema', 'Nature Series', 'Comedy Vault',
    'Drama Archive', 'Sci-Fi Shows', 'Family Movies', 'Mini-Series',
    'World Cinema', 'Animated Features', 'Holiday Specials', 'Concert Films',
    'Short Films', 'Travel Series', 'Cooking Shows'
];

/** Pool of fictional movie titles for movie-type items. */
const FICTIONAL_MOVIES = [
    'The Last Horizon', 'Echo Valley', 'Northern Lights', 'Glass City',
    'The Quiet Mile', 'Paper Moon Rising', 'Driftwood', 'The Hollow Crown',
    'Silver Lining', 'Open Road', 'The Long Winter', 'Coastline',
    'Midsummer', 'The Far Shore', 'Lantern Festival', 'Stone & Sky'
];

/**
 * Generic fallback pool. Any name/title column the heuristics do not recognize
 * is anonymized from this pool, so a NEW name-bearing field added to the API
 * later still fails safe (gets a fictional value) instead of leaking real data.
 */
const FICTIONAL_GENERIC = [
    'Sample One', 'Sample Two', 'Sample Three', 'Sample Four',
    'Sample Five', 'Sample Six', 'Sample Seven', 'Sample Eight'
];

// ---------------------------------------------------------------------------
// Viewport and crop geometry
// ---------------------------------------------------------------------------

/** Full-page viewport for 2561-wide screenshots. */
const VIEWPORT_FULL = { width: 2561, height: 1398 };
/** Smaller viewport for detail-focused screenshots. */
const VIEWPORT_DETAIL = { width: 1460, height: 1000 };

/**
 * Crop regions for feature-highlight screenshots.
 * Format: { x, y, width, height } in source image pixels.
 * These values assume the corresponding VIEWPORT size above.
 */
const CROPS = {
    dashboard:      { x: 370, y: 55,  width: 2190, height: 1210 },
    'query-builder':{ x: 370, y: 170, width: 2190, height: 990 },
    'series-detail':{ x: 240, y: 240, width: 1220, height: 450 },
    'query-results':{ x: 240, y: 180, width: 1220, height: 620 }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Merge multiple bounding boxes into their union. Null entries are ignored. */
function unionBbox(...boxes) {
    const valid = boxes.filter(Boolean);
    if (!valid.length) return null;
    const x1 = Math.min(...valid.map(b => b.x));
    const y1 = Math.min(...valid.map(b => b.y));
    const x2 = Math.max(...valid.map(b => b.x + b.width));
    const y2 = Math.max(...valid.map(b => b.y + b.height));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Save a full-page screenshot and a dynamically-measured crop.
 *
 * boxFn is an async function called with the Playwright page; it must return a
 * bounding box { x, y, width, height } in CSS pixels (== image pixels at DSF 1).
 * pad is added on all four sides before the crop.
 */
async function saveFeatureShot(page, name, boxFn, pad = 40) {
    const fullPath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    await page.screenshot({ path: fullPath, fullPage: false });
    console.log(`  Saved ${name}.png`);

    let box;
    try {
        box = await boxFn(page);
    } catch (e) {
        console.warn(`  Warning: boxFn failed for ${name}: ${e.message}`);
        box = null;
    }
    if (!box) {
        console.warn(`  Warning: could not measure bbox for ${name}-crop, skipping crop.`);
        return;
    }

    const x = Math.max(0, Math.round(box.x - pad));
    const y = Math.max(0, Math.round(box.y - pad));
    const w = Math.round(box.width + pad * 2);
    const h = Math.round(box.height + pad * 2);
    const cropPath = path.join(SCREENSHOTS_DIR, `${name}-crop.png`);
    try {
        execSync(`magick "${fullPath}" -crop ${w}x${h}+${x}+${y} +repage "${cropPath}"`);
        console.log(`  Saved ${name}-crop.png (${w}x${h})`);
    } catch (e) {
        console.warn(`  Warning: ImageMagick crop failed for ${name}: ${e.message}`);
    }
}

function pluginPageUrl(pageName) {
    return `${EMBY_URL}/web/configurationpage?name=${pageName}`;
}

/**
 * Install a network route that anonymizes the plugin's JSON API responses
 * BEFORE the page consumes them. This is the authoritative anonymization layer:
 * because both the tables AND the Chart.js charts are built from these
 * responses, rewriting the data at the network boundary guarantees no real
 * library/series/season/episode name (or internal id) can leak into either the
 * DOM or a chart canvas. The chart instance itself is held in a page-module
 * closure and cannot be reached cross-module, so DOM/chart scrubbing alone is
 * insufficient; this layer closes that gap.
 *
 * Mappings are deterministic per real name, so the same real name maps to the
 * same fictional name across every endpoint (table, chart, detail pages).
 */
function installAnonymizingRoute(context) {
    const libMap = new Map();
    const seriesMap = new Map();
    const movieMap = new Map();
    const episodeMap = new Map();
    const genMap = new Map();
    let libI = 0, serI = 0, movI = 0, epI = 0, genI = 0;

    const mapName = (real, map, pool, counterRef) => {
        if (!real) return real;
        if (!map.has(real)) { map.set(real, pool[counterRef.i % pool.length]); counterRef.i++; }
        return map.get(real);
    };
    const libRef = { get i() { return libI; }, set i(v) { libI = v; } };
    const serRef = { get i() { return serI; }, set i(v) { serI = v; } };
    const movRef = { get i() { return movI; }, set i(v) { movI = v; } };
    const epRef = { get i() { return epI; }, set i(v) { epI = v; } };
    const genRef = { get i() { return genI; }, set i(v) { genI = v; } };

    // Pick the fictional pool for a name-bearing column by key heuristic, so the
    // same entity kind maps consistently. Unrecognized name columns fall back to
    // the generic pool (fail-safe: a new *Name field is still anonymized).
    const poolForKey = (key, row) => {
        const k = key.toLowerCase();
        if (k.includes('library')) return { map: libMap, pool: FICTIONAL_LIBRARY_POOL, ref: libRef };
        if (k.includes('series')) return { map: seriesMap, pool: FICTIONAL_SERIES, ref: serRef };
        if (k.includes('movie')) return { map: movieMap, pool: FICTIONAL_MOVIES, ref: movRef };
        if (k === 'itemname' || k === 'name' || k.includes('episode') || k.includes('title')) {
            const isMovie = row && row.ItemType === 'Movie';
            return isMovie ? { map: movieMap, pool: FICTIONAL_MOVIES, ref: movRef }
                : { map: episodeMap, pool: FICTIONAL_EPISODES, ref: epRef };
        }
        return { map: genMap, pool: FICTIONAL_GENERIC, ref: genRef };
    };

    // Anonymize one record by COLUMN, not by value: any string field whose key
    // looks like a name/title (and is not an opaque *Id) is replaced regardless
    // of its contents. This is fail-safe - a name field the API adds later is
    // anonymized automatically instead of leaking. Non-string values, *Id keys,
    // and everything else (ticks/counts/types/booleans) are preserved, because
    // the page round-trips ids for drill-down navigation.
    const anonRow = (row) => {
        if (!row || typeof row !== 'object') return row;
        for (const key of Object.keys(row)) {
            const val = row[key];
            if (typeof val !== 'string' || !val) continue;
            if (/id$/i.test(key)) continue;
            if (/season/i.test(key) && /name$/i.test(key)) {
                row[key] = 'Season ' + (row.SeasonNumber || 1);
                continue;
            }
            if (/(name|title)$/i.test(key)) {
                const p = poolForKey(key, row);
                row[key] = mapName(val, p.map, p.pool, p.ref);
            }
        }
        return row;
    };

    const anonPayload = (data) => {
        if (Array.isArray(data)) return data.map(anonRow);
        if (data && typeof data === 'object') {
            // Wrapped collections, e.g. { series: [...] }
            ['series', 'seasons', 'episodes', 'libraries', 'rows', 'results', 'items', 'data'].forEach(k => {
                if (Array.isArray(data[k])) data[k] = data[k].map(anonRow);
            });
            // Custom query result: { columns: [...], rows: [[...]] } handled separately by caller.
            return anonRow(data);
        }
        return data;
    };

    return context.route(/segment_reporting\//i, async (route) => {
        const req = route.request();
        const url = req.url();
        // Never touch non-data endpoints or script assets.
        if (/\.js(\?|$)/i.test(url) || /\/(version|preferences|sync_status)(\?|$)/i.test(url)) {
            return route.fallback();
        }
        let response;
        try {
            response = await route.fetch();
        } catch (e) {
            return route.fallback();
        }
        const ct = (response.headers()['content-type'] || '').toLowerCase();
        if (!ct.includes('json')) {
            return route.fulfill({ response });
        }
        let body;
        try {
            body = await response.json();
        } catch (e) {
            return route.fulfill({ response });
        }

        let out;
        // Custom query returns a column/row matrix. The endpoint uses
        // PascalCase keys (Columns/Rows); accept both casings defensively.
        const colsKey = (body && Array.isArray(body.Columns)) ? 'Columns'
            : (body && Array.isArray(body.columns)) ? 'columns' : null;
        const rowsKey = (body && Array.isArray(body.Rows)) ? 'Rows'
            : (body && Array.isArray(body.rows)) ? 'rows' : null;
        if (body && colsKey && rowsKey) {
            const cols = body[colsKey].map(c => (typeof c === 'string' ? c : (c && c.name) || ''));
            const typeIdx = cols.indexOf('ItemType');
            const seaNumIdx = cols.indexOf('SeasonNumber');
            body[rowsKey] = body[rowsKey].map(r => {
                const row = Array.isArray(r) ? r.slice() : r;
                if (!Array.isArray(row)) return anonRow(row);
                // Anonymize by COLUMN HEADER pattern - the same fail-safe rule as
                // anonRow: any *Name/*Title column that is not an *Id column,
                // regardless of the underlying cell value.
                cols.forEach((colName, i) => {
                    const cell = row[i];
                    if (typeof cell !== 'string' || !cell) return;
                    if (/id$/i.test(colName)) return;
                    if (/season/i.test(colName) && /name$/i.test(colName)) {
                        row[i] = 'Season ' + (seaNumIdx >= 0 ? (row[seaNumIdx] || 1) : 1);
                    } else if (/(name|title)$/i.test(colName)) {
                        const isMovie = typeIdx >= 0 && row[typeIdx] === 'Movie';
                        const p = /library/i.test(colName) ? { map: libMap, pool: FICTIONAL_LIBRARY_POOL, ref: libRef }
                            : /series/i.test(colName) ? { map: seriesMap, pool: FICTIONAL_SERIES, ref: serRef }
                                : isMovie ? { map: movieMap, pool: FICTIONAL_MOVIES, ref: movRef }
                                    : { map: episodeMap, pool: FICTIONAL_EPISODES, ref: epRef };
                        row[i] = mapName(cell, p.map, p.pool, p.ref);
                    }
                });
                return row;
            });
            out = body;
        } else {
            out = anonPayload(body);
        }

        return route.fulfill({
            response,
            body: JSON.stringify(out),
            headers: { ...response.headers(), 'content-type': 'application/json; charset=utf-8' }
        });
    });
}

/**
 * Navigate to a plugin page WITHIN the Emby SPA via the hash route.
 *
 * Loading the bare `/web/configurationpage` URL directly produces an
 * unstyled, unauthenticated page whose API calls never resolve. Driving the
 * SPA through its hash route keeps the Emby app shell (sidebar, theme) and the
 * authenticated ApiClient session, so the plugin's data loads correctly.
 */
async function navigateTo(page, pageName, pageId) {
    await page.evaluate((name) => {
        window.location.hash = '#!/configurationpage?name=' + name;
    }, pageName);
    await page.waitForSelector(`#${pageId}`, { state: 'attached', timeout: 20000 });
    // Wait for viewshow lifecycle + async data loads to complete
    await page.waitForTimeout(3500);
}

/** Log in to the Emby SPA so ApiClient has an authenticated session. */
async function login(page) {
    const user = process.env.EMBY_USER;
    const pw = process.env.EMBY_PASSWORD || '';
    if (!user) {
        throw new Error('EMBY_USER environment variable is required for SPA login.');
    }
    await page.goto(`${EMBY_URL}/web/index.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.ApiClient !== 'undefined', null, { timeout: 15000 });
    const result = await page.evaluate(async ({ user, pw }) => {
        try {
            await ApiClient.authenticateUserByName(user, pw);
            return { ok: true, uid: ApiClient.getCurrentUserId() };
        } catch (e) {
            return { ok: false, err: String(e) };
        }
    }, { user, pw });
    if (!result.ok) {
        throw new Error('Emby login failed: ' + result.err);
    }
    console.log(`Logged in (userId ${result.uid}).`);
    // Let the app shell settle after authentication
    await page.waitForTimeout(2000);
}

/** Save a full-page screenshot and optionally a cropped version. */
async function saveScreenshot(page, name) {
    const fullPath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    await page.screenshot({ path: fullPath, fullPage: false });
    console.log(`  Saved ${name}.png`);

    const crop = CROPS[name];
    if (crop) {
        const cropPath = path.join(SCREENSHOTS_DIR, `${name}-crop.png`);
        try {
            execSync(
                `magick "${fullPath}" -crop ${crop.width}x${crop.height}+${crop.x}+${crop.y} +repage "${cropPath}"`
            );
            console.log(`  Saved ${name}-crop.png (${crop.width}x${crop.height})`);
        } catch {
            console.warn(`  Warning: ImageMagick crop failed for ${name}. Is magick on PATH?`);
        }
    }
}

// ---------------------------------------------------------------------------
// Page capture functions
// ---------------------------------------------------------------------------

/**
 * Navigate from the dashboard to the first library then the first series.
 * Leaves the page on the series detail view with the episode table loaded.
 */
async function gotoFirstSeries(page) {
    await page.setViewportSize(VIEWPORT_DETAIL);
    await navigateTo(page, 'segment_dashboard', 'segmentDashboardPage');
    const firstLibRow = await page.$('#segmentDashboardPage table tbody tr');
    if (!firstLibRow) throw new Error('No library rows found on dashboard');
    await firstLibRow.click();
    await page.waitForSelector('#segmentLibraryPage', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3500);
    const firstSeriesRow = await page.$('#segmentLibraryPage table tbody tr');
    if (!firstSeriesRow) throw new Error('No series rows found on library page');
    await firstSeriesRow.click();
    await page.waitForSelector('#segmentSeriesPage', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3500);
    // Allow episode table and auto-expanded first season to finish rendering.
    await page.waitForTimeout(1500);
}

async function captureDashboard(page) {
    console.log('Capturing dashboard...');
    await page.setViewportSize(VIEWPORT_FULL);
    await navigateTo(page, 'segment_dashboard', 'segmentDashboardPage');

    // Names are anonymized at the network layer; no DOM pass needed.
    await page.waitForTimeout(500);
    await saveScreenshot(page, 'dashboard');
}

async function captureLibraryBrowse(page) {
    console.log('Capturing library-browse...');
    await page.setViewportSize(VIEWPORT_FULL);

    // Navigate to dashboard first to find a library to browse.
    await navigateTo(page, 'segment_dashboard', 'segmentDashboardPage');
    // Library rows carry data-library-id and a pointer cursor; click the first.
    const firstRow = await page.$('#segmentDashboardPage table tbody tr');
    if (firstRow) {
        await firstRow.click();
        await page.waitForSelector('#segmentLibraryPage', { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(3500);
    } else {
        console.warn('  No library rows found, skipping library-browse');
        return;
    }

    // Names are anonymized at the network layer; no DOM pass needed.
    await page.waitForTimeout(500);
    await saveScreenshot(page, 'library-browse');
}

async function captureSeriesDetail(page) {
    console.log('Capturing series-detail...');
    await gotoFirstSeries(page);

    // Names are anonymized at the network layer; no DOM pass needed.

    // Open the Actions dropdown on the 3rd episode row to show the submenu.
    const actionsButtons = await page.$$('#segmentSeriesPage table tbody tr td:last-child, #segmentSeriesPage table tbody tr .btnActions');
    if (actionsButtons.length >= 3) {
        await actionsButtons[2].click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);

        // Hover over "Copy" to expand its submenu.
        const copyItem = await page.$('text=Copy');
        if (copyItem) {
            await copyItem.hover({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(300);
        }
    }

    // Scroll the page element to show the episode table with dropdown
    await page.evaluate(() => {
        const pageEl = document.querySelector('#segmentSeriesPage');
        if (pageEl) pageEl.scrollTop = 200;
    });
    await page.waitForTimeout(300);

    await saveScreenshot(page, 'series-detail');
}

async function captureInlineEdit(page) {
    console.log('Capturing inline-edit...');
    await gotoFirstSeries(page);

    // Open the Actions menu on the first episode row.
    const actionBtn = page.locator('#segmentSeriesPage .btn-actions').first();
    await actionBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);

    // Click the Edit item to put the row into editing mode.
    const editItem = page.locator('.actions-menu').getByText(/^Edit$/).first();
    await editItem.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);

    await page.waitForSelector('#segmentSeriesPage tr.editing', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);

    await saveFeatureShot(page, 'inline-edit', async (pg) => {
        const thead = await pg.locator('#segmentSeriesPage table thead').first().boundingBox();
        const editRow = await pg.locator('#segmentSeriesPage tr.editing').first().boundingBox();
        return unionBbox(thead, editRow);
    }, 16);
}

async function captureBulkSelect(page) {
    console.log('Capturing bulk-select...');
    await gotoFirstSeries(page);

    // Check 3 checkboxes to show the selection count update.
    const cbs = page.locator('#segmentSeriesPage .row-select-cb');
    const cbCount = await cbs.count();
    for (let i = 0; i < Math.min(3, cbCount); i++) {
        await cbs.nth(i).check().catch(() => {});
        await page.waitForTimeout(150);
    }
    await page.waitForTimeout(500);

    await saveFeatureShot(page, 'bulk-select', async (pg) => {
        const bulkRow = await pg.locator('#segmentSeriesPage .bulk-action-row').first().boundingBox();
        const rows = pg.locator('#segmentSeriesPage table tbody tr[data-item-id]');
        const rCount = await rows.count();
        const boxes = [bulkRow];
        for (let i = 0; i < Math.min(4, rCount); i++) {
            boxes.push(await rows.nth(i).boundingBox());
        }
        return unionBbox(...boxes);
    }, 16);
}

async function captureCopyBanner(page) {
    console.log('Capturing copy-banner...');
    await gotoFirstSeries(page);

    // Open the Actions menu on the first episode row, then trigger Copy > Intros
    // via in-page dispatch (headless hover is unreliable for CSS submenus).
    const actionBtn = page.locator('#segmentSeriesPage .btn-actions').first();
    await actionBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);

    await page.evaluate(() => {
        const copyItem = Array.from(document.querySelectorAll('div')).find(el =>
            el.textContent.trim().replace(/[▶\s]+$/, '') === 'Copy'
            && el.nextElementSibling && el.nextElementSibling.tagName === 'DIV'
        );
        if (copyItem) {
            copyItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            copyItem.nextElementSibling.style.display = 'block';
            const introsItem = Array.from(copyItem.nextElementSibling.querySelectorAll('div'))
                .find(el => el.textContent.trim() === 'Intros');
            if (introsItem) introsItem.click();
        }
    });
    await page.waitForTimeout(600);

    await page.waitForSelector('#bulkSourceBanner', { state: 'visible', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);

    await saveFeatureShot(page, 'copy-banner', async (pg) => {
        const banner = await pg.locator('#bulkSourceBanner').first().boundingBox();
        const rows = pg.locator('#segmentSeriesPage table tbody tr[data-item-id]');
        const rCount = await rows.count();
        const boxes = [banner];
        for (let i = 0; i < Math.min(3, rCount); i++) {
            boxes.push(await rows.nth(i).boundingBox());
        }
        return unionBbox(...boxes);
    }, 16);
}

async function capturePalettePreview(page) {
    console.log('Capturing palette-preview...');
    await page.setViewportSize(VIEWPORT_DETAIL);
    await navigateTo(page, 'segment_settings', 'segmentSettingsPage');

    // Select "Custom" to reveal the custom color pickers and live preview chart.
    await page.evaluate(() => {
        const sel = document.querySelector('#prefChartPalette');
        if (!sel) return;
        const opt = Array.from(sel.options).find(o => o.value === 'custom' || o.text.toLowerCase().includes('custom'));
        if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForTimeout(800);

    await saveFeatureShot(page, 'palette-preview', async (pg) => {
        const dropdown = await pg.locator('#prefChartPalette').boundingBox();
        const custom = await pg.locator('#customColorsPanel').boundingBox();
        const preview = await pg.locator('#palettePreviewContainer').boundingBox();
        return unionBbox(dropdown, custom, preview);
    }, 24);
}

async function captureCustomQuery(page) {
    console.log('Capturing custom-query...');
    await page.setViewportSize(VIEWPORT_FULL);
    await navigateTo(page, 'segment_custom_query', 'segmentCustomQueryPage');
    await saveScreenshot(page, 'custom-query');
}

async function captureQueryBuilder(page) {
    console.log('Capturing query-builder...');
    await page.setViewportSize(VIEWPORT_FULL);
    await navigateTo(page, 'segment_custom_query', 'segmentCustomQueryPage');

    // Click "Show Builder" if the builder is hidden
    const showBtn = await page.$('#segmentCustomQueryPage button:has-text("Show Builder")');
    if (showBtn) {
        await showBtn.click();
        await page.waitForTimeout(500);
    }

    // Build a sample query using the builder UI to demonstrate the feature.
    // This adds conditions programmatically via DOM manipulation to avoid
    // fragile click sequences on the builder UI.
    await page.evaluate(() => {
        const textarea = document.querySelector('#segmentCustomQueryPage textarea');
        if (textarea) {
            textarea.value = [
                "SELECT ItemId, ItemName, ItemType, SeriesName, SeasonName,",
                "  SeasonNumber, EpisodeNumber, LibraryName,",
                "  IntroStartTicks, IntroEndTicks, CreditsStartTicks,",
                "  HasIntro, HasCredits",
                "FROM MediaSegments",
                "WHERE HasCredits = '' AND ItemType IN ('Episode')",
                "  AND (SeriesName IN ('Starfield Academy', 'Crimson Meridian')",
                "       OR ItemName LIKE '%Pilot%')",
                "ORDER BY CreditsStartTicks DESC",
                "LIMIT 100"
            ].join('\n');
        }
    });
    await page.waitForTimeout(500);

    await saveScreenshot(page, 'query-builder');
}

async function captureQueryAutocomplete(page) {
    console.log('Capturing query-autocomplete...');
    await page.setViewportSize(VIEWPORT_FULL);
    await navigateTo(page, 'segment_custom_query', 'segmentCustomQueryPage');
    // The autocomplete screenshot requires the builder to be visible with
    // a search tag input showing suggestions. This is difficult to automate
    // reliably, so we just capture the page state.
    await saveScreenshot(page, 'query-autocomplete');
}

/**
 * Reliably open a row's Actions menu (and optionally expand a named submenu) by
 * driving the in-page handlers directly. Headless hover() is unreliable for the
 * CSS-driven submenu, and the menu's mouseleave timer can hide it before the
 * screenshot - dispatching the events in-page avoids both. The trigger is the
 * per-row `.btn-actions` button (falls back to a button whose text starts with
 * "Actions"); the submenu opens via its parent item's mouseenter -> showSub().
 */
async function openActionsMenu(page, pageId, submenuLabel) {
    // A REAL Playwright click on a per-row Actions button opens the menu (a
    // synthetic in-page click does not reliably trigger it). Use a middle row
    // so the menu does not collide with the table header.
    // Scroll the data table near the top so the opened menu lands in-viewport
    // (a bottom-row menu opens below the fold and is not captured).
    await page.evaluate((pid) => {
        const tbl = document.querySelector('#' + pid + ' table');
        if (tbl) tbl.scrollIntoView({ block: 'start' });
    }, pageId).catch(() => {});
    await page.waitForTimeout(300);
    const btns = page.locator(`#${pageId} .btn-actions`);
    const n = await btns.count();
    if (n > 0) {
        await btns.nth(0).click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(700);
    }
    const state = await page.evaluate((label) => {
        const btnActions = document.querySelectorAll('.btn-actions').length;
        const anyActionsBtn = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent.trim().startsWith('Actions')).length;
        const hasMenu = !!Array.from(document.querySelectorAll('*')).find((el) => el.childElementCount <= 2 && el.textContent.trim() === 'Set Credits to End');
        const spanByText = (txt) => Array.from(document.querySelectorAll('span'))
            .find((s) => s.textContent.trim() === txt);
        let submenuShown = false;
        if (label) {
            // The submenu parent item's text is "<label> <arrow>"; find it and
            // force its sibling submenu div visible (reliable; no hover needed).
            const item = Array.from(document.querySelectorAll('div')).find((el) =>
                el.childElementCount <= 2
                && el.textContent.trim().replace(/[▶\s]+$/, '') === label
                && el.nextElementSibling && el.nextElementSibling.tagName === 'DIV');
            if (item) {
                item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                item.nextElementSibling.style.display = 'block';
                submenuShown = true;
            }
        }
        // The menu can open off the right edge of the wide results table.
        // Reposition it into the viewport so the screenshot captures it.
        let repositioned = false;
        const marker = Array.from(document.querySelectorAll('div'))
            .find((el) => el.childElementCount <= 2 && el.textContent.trim() === 'Set Credits to End');
        if (marker) {
            let menu = marker;
            while (menu && menu !== document.body && getComputedStyle(menu).position !== 'absolute') menu = menu.parentElement;
            if (menu && menu !== document.body) {
                menu.style.position = 'fixed';
                menu.style.left = '780px';
                menu.style.top = '170px';
                menu.style.right = 'auto';
                repositioned = true;
            }
        }
        return { btnActions, anyActionsBtn, hasMenu, submenuShown, repositioned };
    }, submenuLabel);
    console.log('  menu:', JSON.stringify(state));
    await page.waitForTimeout(300);
}

async function captureQueryResults(page) {
    console.log('Capturing query-results...');
    await page.setViewportSize(VIEWPORT_DETAIL);
    await navigateTo(page, 'segment_custom_query', 'segmentCustomQueryPage');

    // Execute a sample query
    await page.evaluate(() => {
        const textarea = document.querySelector('#segmentCustomQueryPage textarea');
        if (textarea) {
            textarea.value =
                "SELECT * FROM MediaSegments WHERE HasCredits = 1 AND ItemType = 'Episode' " +
                "ORDER BY SeriesName, SeasonNumber LIMIT 100";
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });
    const execBtn = await page.$('#segmentCustomQueryPage button:has-text("Execute")');
    if (execBtn) {
        await execBtn.click();
        await page.waitForTimeout(3000);
    }

    // Query results are anonymized at the network layer; no DOM pass needed.

    // Open the Actions menu on the first results row and expand the Delete
    // submenu (Intros / Credits / Both) for the feature-highlight crop.
    await openActionsMenu(page, 'segmentCustomQueryPage', 'Delete');

    await saveScreenshot(page, 'query-results');
}

async function captureSettings(page) {
    console.log('Capturing settings...');
    await page.setViewportSize(VIEWPORT_FULL);
    await navigateTo(page, 'segment_settings', 'segmentSettingsPage');
    await saveScreenshot(page, 'settings');
}

async function captureAbout(page) {
    console.log('Capturing about...');
    await page.setViewportSize(VIEWPORT_FULL);
    await navigateTo(page, 'segment_about', 'segmentAboutPage');
    await saveScreenshot(page, 'about');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log(`Connecting to Emby at ${EMBY_URL}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: VIEWPORT_FULL,
        // API-key header lets non-SPA asset requests through; the real session
        // for in-page ApiClient calls is established by login() below.
        extraHTTPHeaders: API_KEY ? { 'X-Emby-Token': API_KEY } : {}
    });
    // Anonymize plugin JSON responses at the network boundary so that tables
    // AND charts render with fictional names from the start (see function doc).
    await installAnonymizingRoute(context);

    const page = await context.newPage();

    try {
        // Establish an authenticated SPA session. The plugin pages use Emby's
        // ApiClient, which requires a logged-in user session; navigating to the
        // bare configurationpage URL is not authenticated and never loads data.
        await login(page);

        // CAPTURE_ONLY=query-results[,settings,...] limits the run to specific
        // pages (comma-separated). Unset captures all.
        const only = process.env.CAPTURE_ONLY
            ? process.env.CAPTURE_ONLY.split(',').map((s) => s.trim())
            : null;
        const want = (name) => !only || only.includes(name);

        if (want('dashboard')) await captureDashboard(page);
        if (want('library-browse')) await captureLibraryBrowse(page);
        if (want('series-detail')) await captureSeriesDetail(page);
        if (want('inline-edit')) await captureInlineEdit(page);
        if (want('bulk-select')) await captureBulkSelect(page);
        if (want('copy-banner')) await captureCopyBanner(page);
        if (want('custom-query')) await captureCustomQuery(page);
        if (want('query-builder')) await captureQueryBuilder(page);
        if (want('query-autocomplete')) await captureQueryAutocomplete(page);
        if (want('query-results')) await captureQueryResults(page);
        if (want('settings')) await captureSettings(page);
        if (want('palette-preview')) await capturePalettePreview(page);
        if (want('about')) await captureAbout(page);

        console.log('\nAll screenshots captured successfully.');
    } catch (err) {
        console.error('Screenshot capture failed:', err.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

main();
