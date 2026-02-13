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
 *   EMBY_URL      Emby server URL (default: http://localhost:8096)
 *   EMBY_API_KEY  Admin API key for authentication (required)
 *
 * Output: Screenshots/ directory (full-page and *-crop.png variants)
 */

import { chromium } from 'playwright';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'Screenshots');

const EMBY_URL = process.env.EMBY_URL || 'http://localhost:8096';
const API_KEY = process.env.EMBY_API_KEY;

if (!API_KEY) {
    console.error('Error: EMBY_API_KEY environment variable is required.');
    console.error('Find your API key in Emby under Settings > API Keys.');
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

function pluginPageUrl(pageName) {
    return `${EMBY_URL}/web/configurationpage?name=${pageName}`;
}

/** Navigate to a plugin page and wait for the view to initialize. */
async function navigateTo(page, pageName, pageId) {
    await page.goto(pluginPageUrl(pageName), { waitUntil: 'networkidle' });
    await page.waitForSelector(`#${pageId}`, { state: 'attached', timeout: 15000 });
    // Wait for viewshow lifecycle to complete
    await page.waitForTimeout(1500);
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
// Anonymization functions (run inside page.evaluate)
// ---------------------------------------------------------------------------

/**
 * Anonymize the dashboard page.
 * Replaces library names in the chart and table, randomizes item IDs.
 */
function anonymizeDashboard(libraryNames) {
    // Build mapping of real library names to fictional ones
    const mapping = {};
    const realNames = [];
    document.querySelectorAll('#segmentDashboardPage .detailTableContainer td:first-child')
        .forEach(td => {
            const name = td.textContent.trim();
            if (name && !realNames.includes(name)) realNames.push(name);
        });
    realNames.forEach((name, i) => { mapping[name] = libraryNames[i] || `Library ${i + 1}`; });

    // Replace table cells
    document.querySelectorAll('#segmentDashboardPage .detailTableContainer td').forEach(td => {
        const text = td.textContent.trim();
        if (mapping[text]) td.textContent = mapping[text];
    });

    // Replace chart labels
    const canvas = document.querySelector('#segmentDashboardPage canvas');
    if (canvas) {
        const chart = Chart.getChart(canvas);
        if (chart) {
            chart.data.labels = chart.data.labels.map(l => mapping[l] || l);
            chart.update('none');
        }
    }
    return mapping;
}

/**
 * Anonymize a series detail page.
 * Replaces the series name in headings, season labels, and episode names
 * in the episode table.
 */
function anonymizeSeriesDetail(fictionalSeriesName, episodeNames) {
    const page = document.querySelector('#segmentSeriesPage');
    if (!page) return;

    // Replace series name in headings and breadcrumbs
    page.querySelectorAll('h2, .breadcrumbItem, .sectionTitle').forEach(el => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            // Replace any non-generic text that looks like a series name (not
            // "Dashboard", "Season", or navigation labels)
            if (node.textContent.trim() &&
                !node.textContent.includes('Dashboard') &&
                !node.textContent.includes('Season') &&
                !node.textContent.includes('Segment Reporting')) {
                node.textContent = node.textContent.replace(
                    node.textContent.trim(), fictionalSeriesName
                );
            }
        }
    });

    // Replace episode names in table cells (3rd column: Episode Name)
    let epIdx = 0;
    page.querySelectorAll('table tbody tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        // Episode Name is typically the 3rd cell (index 2) after checkbox and #
        if (cells.length >= 3) {
            const nameCell = cells[2];
            if (nameCell && nameCell.textContent.trim()) {
                nameCell.textContent = episodeNames[epIdx % episodeNames.length];
                epIdx++;
            }
        }
    });

    // Randomize item IDs displayed in any visible elements
    page.querySelectorAll('[data-itemid]').forEach(el => {
        el.setAttribute('data-itemid', Math.floor(1000 + Math.random() * 9000));
    });
}

/**
 * Anonymize query results table.
 * Replaces series names, episode names, and item IDs.
 */
function anonymizeQueryResults(seriesNames, episodeNames) {
    const page = document.querySelector('#segmentCustomQueryPage');
    if (!page) return;

    // Find column indices from header row
    const headers = [];
    page.querySelectorAll('.queryResultTable thead th').forEach((th, i) => {
        headers[i] = th.textContent.trim();
    });

    const seriesCol = headers.indexOf('SeriesName');
    const itemNameCol = headers.indexOf('ItemName');
    const itemIdCol = headers.indexOf('ItemId');
    const seasonNameCol = headers.indexOf('SeasonName');

    const seriesMapping = {};
    let seriesIdx = 0;
    let epIdx = 0;

    page.querySelectorAll('.queryResultTable tbody tr').forEach(row => {
        const cells = row.querySelectorAll('td');

        // Map series names consistently
        if (seriesCol >= 0 && cells[seriesCol]) {
            const real = cells[seriesCol].textContent.trim();
            if (real && !seriesMapping[real]) {
                seriesMapping[real] = seriesNames[seriesIdx % seriesNames.length];
                seriesIdx++;
            }
            if (seriesMapping[real]) cells[seriesCol].textContent = seriesMapping[real];
        }

        // Replace episode/item names
        if (itemNameCol >= 0 && cells[itemNameCol]) {
            cells[itemNameCol].textContent = episodeNames[epIdx % episodeNames.length];
            epIdx++;
        }

        // Randomize item IDs
        if (itemIdCol >= 0 && cells[itemIdCol]) {
            cells[itemIdCol].textContent = String(Math.floor(1000 + Math.random() * 9000));
        }

        // Normalize season names
        if (seasonNameCol >= 0 && cells[seasonNameCol]) {
            cells[seasonNameCol].textContent = 'Season 1';
        }
    });
}

/**
 * Anonymize the library browse page.
 * Replaces series and movie names in the library table and chart.
 */
function anonymizeLibrary(seriesNames, libraryDisplayName) {
    const page = document.querySelector('#segmentLibraryPage');
    if (!page) return;

    // Replace library name in heading/breadcrumbs
    page.querySelectorAll('.breadcrumbItem').forEach(el => {
        if (!el.textContent.includes('Dashboard') &&
            !el.textContent.includes('Segment Reporting')) {
            el.textContent = libraryDisplayName;
        }
    });

    // Replace series names in table and chart
    let idx = 0;
    page.querySelectorAll('table tbody tr td:first-child a, table tbody tr td:first-child')
        .forEach(el => {
            const text = el.textContent.trim();
            if (text && text !== 'Loading...') {
                el.textContent = seriesNames[idx % seriesNames.length];
                idx++;
            }
        });

    // Update chart labels
    const canvas = page.querySelector('canvas');
    if (canvas) {
        const chart = Chart.getChart(canvas);
        if (chart) {
            idx = 0;
            chart.data.labels = chart.data.labels.map(() =>
                seriesNames[idx++ % seriesNames.length]
            );
            chart.update('none');
        }
    }
}

// ---------------------------------------------------------------------------
// Page capture functions
// ---------------------------------------------------------------------------

async function captureDashboard(page) {
    console.log('Capturing dashboard...');
    await page.setViewportSize(VIEWPORT_FULL);
    await navigateTo(page, 'segment_dashboard', 'segmentDashboardPage');

    await page.evaluate(anonymizeDashboard, FICTIONAL_LIBRARIES.defaults);
    await page.waitForTimeout(500);
    await saveScreenshot(page, 'dashboard');
}

async function captureLibraryBrowse(page) {
    console.log('Capturing library-browse...');
    await page.setViewportSize(VIEWPORT_FULL);

    // Navigate to dashboard first to find a library to browse
    await navigateTo(page, 'segment_dashboard', 'segmentDashboardPage');
    // Click the first library row to navigate to library page
    const firstRow = await page.$('#segmentDashboardPage .detailTableContainer tbody tr');
    if (firstRow) {
        await firstRow.click();
        await page.waitForTimeout(2000);
    } else {
        console.warn('  No library rows found, skipping library-browse');
        return;
    }

    await page.evaluate(anonymizeLibrary, FICTIONAL_SERIES, 'TV Shows');
    await page.waitForTimeout(500);
    await saveScreenshot(page, 'library-browse');
}

async function captureSeriesDetail(page) {
    console.log('Capturing series-detail...');
    await page.setViewportSize(VIEWPORT_DETAIL);

    // Navigate to a series detail page (requires navigating through dashboard > library > series)
    await navigateTo(page, 'segment_dashboard', 'segmentDashboardPage');
    const firstRow = await page.$('#segmentDashboardPage .detailTableContainer tbody tr');
    if (firstRow) {
        await firstRow.click();
        await page.waitForTimeout(2000);
    }
    // Click first series in the library page
    const seriesLink = await page.$('#segmentLibraryPage table tbody tr td:first-child a');
    if (seriesLink) {
        await seriesLink.click();
        await page.waitForTimeout(2000);
    } else {
        console.warn('  No series links found, skipping series-detail');
        return;
    }

    // Wait for episode table to load (first season auto-expands)
    await page.waitForTimeout(2000);

    // Anonymize series name and episode names
    await page.evaluate(anonymizeSeriesDetail, 'Crimson Meridian', FICTIONAL_EPISODES);

    // Open the Actions dropdown on the 3rd episode row to show the submenu
    const actionsButtons = await page.$$('#segmentSeriesPage table tbody tr .btnActions, #segmentSeriesPage table tbody tr [class*="action"]');
    if (actionsButtons.length >= 3) {
        await actionsButtons[2].click();
        await page.waitForTimeout(500);

        // Hover over "Copy" to expand its submenu
        const copyItem = await page.$('text=Copy');
        if (copyItem) {
            await copyItem.hover();
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
        }
    });
    const execBtn = await page.$('#segmentCustomQueryPage button:has-text("Execute")');
    if (execBtn) {
        await execBtn.click();
        await page.waitForTimeout(2000);
    }

    // Anonymize the results table
    await page.evaluate(anonymizeQueryResults, FICTIONAL_SERIES, FICTIONAL_EPISODES);

    // Open Actions dropdown on the 3rd row to show the submenu
    const actionsButtons = await page.$$('#segmentCustomQueryPage .queryResultTable tbody tr .btnActions, #segmentCustomQueryPage .queryResultTable [class*="action"]');
    if (actionsButtons.length >= 3) {
        await actionsButtons[2].click();
        await page.waitForTimeout(500);
        // Hover over Delete to expand submenu
        const deleteItem = await page.$('text=Delete');
        if (deleteItem) {
            await deleteItem.hover();
            await page.waitForTimeout(300);
        }
    }

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
        // Authenticate via URL parameter
        extraHTTPHeaders: { 'X-Emby-Token': API_KEY }
    });
    const page = await context.newPage();

    try {
        // Authenticate by visiting the dashboard with the API key
        await page.goto(`${EMBY_URL}/web/index.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);

        await captureDashboard(page);
        await captureLibraryBrowse(page);
        await captureSeriesDetail(page);
        await captureCustomQuery(page);
        await captureQueryBuilder(page);
        await captureQueryAutocomplete(page);
        await captureQueryResults(page);
        await captureSettings(page);
        await captureAbout(page);

        console.log('\nAll screenshots captured successfully.');
    } catch (err) {
        console.error('Screenshot capture failed:', err.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

main();
