#!/usr/bin/env node
/**
 * Runtime accessibility audit for the Segment Reporting plugin pages.
 *
 * This is the RUNTIME tier of the plugin's two-tier a11y check (issue #132):
 *   - Static tier:  `npm run lint:html` (html-validate) runs in the pre-commit
 *                   hook and CI. It catches structural ARIA/WCAG issues that are
 *                   visible in the markup (missing labels, bad roles, dup ids,
 *                   missing img alt, table-header scope).
 *   - Runtime tier: THIS script. It drives a real, themed, data-loaded page in a
 *                   headless browser and runs axe-core, which can evaluate things
 *                   only computable at runtime, most importantly COLOR CONTRAST
 *                   (the rendered foreground/background pair after the live Emby
 *                   theme and any opacity are applied).
 *
 * Like capture-screenshots.mjs, this needs a running Emby server with the plugin
 * installed and an authenticated user session, so it is LOCAL / UAT-ONLY and is
 * intentionally NOT wired into the blocking CI gate. It reuses the same SPA
 * login + hash-route navigation approach as capture-screenshots.mjs.
 *
 * Prerequisites:
 *   npm install            (installs @axe-core/playwright)
 *   npx playwright install chromium
 *
 * Usage (from repo root):
 *   EMBY_UAT_URL=http://localhost:8096 EMBY_UAT_USER=admin EMBY_UAT_PASSWORD=... \
 *     CAPTURE_TARGET=uat node scripts/axe-a11y.mjs
 *
 *   node scripts/axe-a11y.mjs            # prod-style defaults (localhost:8096)
 *   AXE_ONLY=dashboard,settings node scripts/axe-a11y.mjs   # subset of pages
 *
 * Environment variables (same names as capture-screenshots.mjs):
 *   CAPTURE_TARGET  "uat" to target the UAT Emby (default: prod-style localhost)
 *   EMBY_URL        Emby server URL (default: http://localhost:8096, or
 *                   EMBY_UAT_URL in UAT mode)
 *   EMBY_API_KEY    Admin API key (or EMBY_UAT_API_KEY in UAT mode)
 *   EMBY_USER       Admin username (or EMBY_UAT_USER in UAT mode). Required.
 *   EMBY_PASSWORD   Admin password (or EMBY_UAT_PASSWORD in UAT mode)
 *   AXE_ONLY        Comma-separated page keys to audit (default: all)
 *   AXE_TREE        "1" to also dump the accessibility tree per page
 *
 * Exit status: 0 = no violations on any audited page; 1 = at least one
 * violation, or a setup/login failure. The full violation report is printed.
 */

import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const UAT = (process.env.CAPTURE_TARGET || '').toLowerCase() === 'uat';

const EMBY_URL = process.env.EMBY_URL
    || (UAT ? process.env.EMBY_UAT_URL : undefined)
    || (!UAT ? 'http://localhost:8096' : undefined);
const API_KEY = process.env.EMBY_API_KEY || (UAT ? process.env.EMBY_UAT_API_KEY : undefined);
const EMBY_USER = process.env.EMBY_USER || (UAT ? process.env.EMBY_UAT_USER : undefined);
const EMBY_PASSWORD = process.env.EMBY_PASSWORD || (UAT ? process.env.EMBY_UAT_PASSWORD : '');

// Fail closed in UAT mode if no URL is set (mirrors capture-screenshots.mjs).
if (UAT && !EMBY_URL) {
    console.error('Error: CAPTURE_TARGET=uat requires EMBY_URL or EMBY_UAT_URL to be set explicitly.');
    process.exit(1);
}

if (!EMBY_USER) {
    const userVar = UAT ? 'EMBY_USER or EMBY_UAT_USER' : 'EMBY_USER';
    console.error(`Error: ${userVar} (and the matching password) are required for SPA login.`);
    console.error('The plugin pages use Emby ApiClient, which needs an authenticated user session.');
    process.exit(1);
}

const VIEWPORT = { width: 1460, height: 1000 };

// WCAG 2.1 AA tag set, matching the plugin's stated conformance target.
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Each plugin page: its configurationpage name and the DOM id that signals the
// page has mounted. Drill-down pages (library/series) are reached by clicking
// through, so only the top-level pages are listed here for the direct audit.
const PAGES = [
    { key: 'dashboard', name: 'segment_dashboard', id: 'segmentDashboardPage' },
    { key: 'custom-query', name: 'segment_custom_query', id: 'segmentCustomQueryPage' },
    { key: 'settings', name: 'segment_settings', id: 'segmentSettingsPage' },
    { key: 'about', name: 'segment_about', id: 'segmentAboutPage' }
];

/** Log in to the Emby SPA so ApiClient has an authenticated session. */
async function login(page) {
    const user = EMBY_USER;
    const pw = EMBY_PASSWORD || '';
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
    await page.waitForTimeout(2000);
}

/**
 * Navigate to a plugin page WITHIN the Emby SPA via the hash route, keeping the
 * authenticated ApiClient session and the live theme (so contrast is evaluated
 * against the real rendered colors). Mirrors capture-screenshots.mjs.
 */
async function navigateTo(page, pageName, pageId) {
    await page.evaluate((name) => {
        window.location.hash = '#!/configurationpage?name=' + name;
    }, pageName);
    await page.waitForSelector(`#${pageId}`, { state: 'attached', timeout: 20000 });
    // Allow the viewshow lifecycle + async data loads to finish so the audited
    // DOM matches what a user sees (tables populated, cards filled in).
    await page.waitForTimeout(3500);
}

/** Run axe against the mounted plugin page and return the result object. */
async function auditPage(page, pg) {
    const builder = new AxeBuilder({ page })
        .withTags(AXE_TAGS)
        .include(`#${pg.id}`);
    return builder.analyze();
}

/** Print a compact accessibility-tree dump for the mounted page (optional). */
async function dumpAccessibilityTree(page, pg) {
    const snapshot = await page.accessibility.snapshot({ interestingOnly: true });
    console.log(`\n  Accessibility tree for ${pg.key}:`);
    console.log(JSON.stringify(snapshot, null, 2));
}

function formatViolations(pg, violations) {
    console.log(`\n=== ${pg.key} (${pg.name}) ===`);
    if (!violations.length) {
        console.log('  No WCAG 2.1 AA violations.');
        return;
    }
    for (const v of violations) {
        console.log(`  [${v.impact || 'n/a'}] ${v.id}: ${v.help}`);
        console.log(`    ${v.helpUrl}`);
        for (const node of v.nodes) {
            console.log(`    - ${node.target.join(' ')}`);
            if (node.failureSummary) {
                console.log('      ' + node.failureSummary.replace(/\n/g, '\n      '));
            }
        }
    }
}

async function main() {
    console.log(`Connecting to Emby at ${EMBY_URL} (${UAT ? 'UAT' : 'prod-style'} mode)`);

    const only = process.env.AXE_ONLY
        ? process.env.AXE_ONLY.split(',').map((s) => s.trim())
        : null;
    const wantTree = process.env.AXE_TREE === '1';
    const targets = PAGES.filter((p) => !only || only.includes(p.key));

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: VIEWPORT,
        extraHTTPHeaders: API_KEY ? { 'X-Emby-Token': API_KEY } : {}
    });
    const page = await context.newPage();

    let totalViolations = 0;
    try {
        await login(page);
        for (const pg of targets) {
            await navigateTo(page, pg.name, pg.id);
            const result = await auditPage(page, pg);
            formatViolations(pg, result.violations);
            totalViolations += result.violations.length;
            if (wantTree) {
                await dumpAccessibilityTree(page, pg);
            }
        }
    } catch (err) {
        console.error('Accessibility audit failed:', err.message);
        await browser.close();
        process.exit(1);
    }
    await browser.close();

    console.log(`\nAudited ${targets.length} page(s); ${totalViolations} total violation(s).`);
    process.exit(totalViolations > 0 ? 1 : 0);
}

main();
