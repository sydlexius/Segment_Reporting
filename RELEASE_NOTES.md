# Segment Reporting - Release Notes

## v0.0.12.0 - About Page

### Added

- **About page** (#38) - New "About" button on the dashboard opens a page showing plugin version, acknowledgements for ChapterApi, Playback Reporting, and EmbyCredits, links to the GitHub repository, and a quick-reference list of all REST API endpoints.
- **Plugin info API endpoint** - New `GET /segment_reporting/plugin_info` endpoint returns the plugin name, version, and description.

### Fixed

- **API comment URLs** - Developer-facing URL examples in the API source code now use a generic `http(s)://<host>:<port>` placeholder instead of `localhost:8096`.

---

## v0.0.11.0 - EmbyCredits Plugin Integration

### Added

- **EmbyCredits integration** (#35) - If the EmbyCredits plugin is installed, new "Detect Credits" buttons appear throughout the UI to trigger credits detection directly from Segment Reporting.
  - **Dashboard** - "Detect All Credits" button queues detection for every episode in the library.
  - **Series page header** - "Detect Credits" button processes the entire series at once.
  - **Season accordion header** - Per-season "Detect" button processes all episodes in that season.
  - **Season bulk action row** - "Detect All Credits" button respects episode selection and includes skip/overwrite prompts.
  - **Episode row** - Per-episode "Detect" button triggers detection for a single episode.
- **Skip-existing prompt** (#35) - Bulk detect operations check which episodes already have credits and ask whether to skip them or re-detect, avoiding unnecessary processing.
- **Auto-detection** (#35) - EmbyCredits availability is detected automatically on page load. All detect buttons are hidden when the plugin is not installed, keeping the UI clean for users without it.

---

## v0.0.10.0 - Browser Back Button and Unassigned Season Fix

### Fixed

- **Browser back button now works** (#32) - Navigation parameters (library ID, series ID) are now encoded directly in the URL instead of browser session storage. Previously, hitting the back button would lose the page context and show "No library/series ID provided" errors.
- **Episodes without a season now display correctly** (#33) - Episodes whose parent season can't be resolved by Emby (e.g. flat library structures) are now grouped under "Unassigned" instead of silently disappearing. The sync task tries additional fallbacks to resolve season metadata, and the API safely scopes null-season queries to prevent cross-series data leaks.

---

## v0.0.9.9 - Separate Intro and Credit Percentages

### Improved

- **Separate intro/credit percentages on series page** (#34) - The series drill-down now shows independent "Intros: XX%" and "Credits: XX%" in each season header, replacing the single combined percentage that always showed 0% when only one segment type was detected.
- **Grouped coverage chart** (#34) - The season chart now displays intro and credit coverage as side-by-side percentage bars (0–100%) instead of a stacked episode count chart, making per-segment-type coverage immediately visible.
- **Consistent table header alignment** - Table headers on the dashboard and library pages now left-align to match their data cells, fixing visual misalignment caused by the browser's default center-alignment of `<th>` elements.

---

## v0.0.9.8 - Curated Chart Color Palettes

### Improved

- **Hand-picked chart color palettes** (#21) - Chart and dashboard card colors now use curated palettes matched to the active Emby accent color (green, blue, red, pink, or purple) instead of auto-generated HSL variations.

---

## v0.0.9.7 - Movie Library Browsing

### Added

- **Movie library support** (#29) - Movie libraries now display a flat table with inline segment timestamps (Intro Start, Intro End, Credits Start) instead of the series drill-down view. Mixed libraries show both series and movies.
- **Inline editing for movies** (#29) - Edit, save, and delete segment markers directly from the movie table row, with the same workflow used for TV episodes.
- **Library content type detection** (#29) - The library page automatically detects whether a library contains series, movies, or both, and shows the appropriate layout.

---

## v0.0.9.6 - Bulk Operation Limits and Unnecessary API Call Removal

### Improved

- **Bulk operation safety limit** (#31) - Bulk apply, bulk delete, and bulk set-credits-to-end now reject requests with more than 500 items, preventing accidental overload of the API thread.
- **Faster filter switching** (#31) - Switching between "Complete", "No Segments", and "All" filters on the library page no longer makes a redundant server round-trip; existing data is re-filtered instantly on the client.
- **Lighter series page load** (#31) - The series page no longer fetches the entire episode list just to read the series name. The season list API now includes the series name and library ID directly, eliminating a potentially expensive extra call for long-running shows.

---

## v0.0.9.5 - SQLite UPSERT and Connection Improvements

### Improved

- **Faster sync for large libraries** (#30) - Replaced the two-query SELECT-then-INSERT/UPDATE pattern with a single SQLite UPSERT (`INSERT ... ON CONFLICT DO UPDATE`), cutting round-trips per item in half during sync.
- **Cancellable bulk upserts** (#30) - The sync task can now be cleanly cancelled mid-upsert. Large library syncs (50K+ items) check for cancellation periodically and roll back gracefully instead of blocking until completion.
- **Safer SQLite threading** (#30) - Switched the write connection from `NoMutex` to `FullMutex`, letting SQLite handle thread safety internally alongside the existing application-level lock.

### Fixed

- **Connection leak on plugin reload** (#30) - `SegmentRepository` now implements `IDisposable` so the SQLite connection is properly released if the plugin is unloaded or reloaded.
- **Silent path mismatch** (#30) - The singleton factory now logs a warning if a caller requests a different database path than the one already in use, instead of silently ignoring it.

---

## v0.0.9.4 - Reduce Backend Duplication

### Improved

- **Marker type constants** (#26) - Introduced a `MarkerTypes` constants class so `"IntroStart"`, `"IntroEnd"`, and `"CreditsStart"` are defined once. Typos in marker names now cause build errors instead of silent bugs.
- **API helper methods** (#26) - Extracted `GetRepository()`, `SplitAndTrim()`, and `ValidateMarkerTypes()` helpers, replacing dozens of duplicated blocks across API endpoints.
- **Repository filter helper** (#26) - Consolidated duplicated segment-filter logic into a shared `ApplySegmentFilters()` method.
- **Named constants for magic numbers** (#26) - Progress report interval and cache divergence threshold are now named constants in the sync and cleanup tasks.

### Removed

- **Dead code cleanup** (#26) - Removed unused `SegmentReportingOptions` configuration class, its factory and extension methods, an uncalled `GetItemsByLibrary()` repository method, and duplicate "future enhancement" comments.

---

## v0.0.9.3 - Reduce Frontend Duplication

### Improved

- **Shared helper library expanded** (#25) - Extracted 9 reusable utilities from page modules into the shared helpers file, eliminating copy-pasted patterns across the frontend.
- **Chart creation simplified** - All three chart pages (Dashboard, Library, Series) now use a single `createSegmentChart` factory instead of duplicating ~80 lines of Chart.js configuration each.
- **Consistent hover effects** - Table row and accordion hover styling is now handled by a single `attachHoverEffect` helper.
- **Automatic chart cleanup** - Chart lifecycle management (destroy on page hide/destroy) consolidated into `registerChartCleanup`.
- **API loading wrapper** - New `apiCallWithLoading` helper handles the show/hide loading indicator pattern used by most API calls.
- **Utility functions centralized** - `formatBytes`, `formatDuration`, `renderTimestamp`, `createEmptyRow`, and `withButtonLoading` moved from individual pages to the shared helpers.
- **Automatic JS minification in local builds** - Release builds now automatically minify JS files via MSBuild targets, matching CI behavior. No more manual `npm run build:js` step needed.

---

## v0.0.9.2 - Reduce DLL Size

### Improved

- **37% smaller plugin DLL** (#24) - Reduced from 461 KB to 293 KB through Chart.js tree-shaking, JS minification, and image optimization.
- **Custom Chart.js build** - Upgraded to Chart.js v4.5.1 with a tree-shaken bundle that includes only bar chart components (138 KB, down from 195 KB).
- **Build-time JS minification** - Custom JS files are automatically minified during Release builds using esbuild, cutting 90 KB from the embedded resources.
- **Optimized thumbnail** - Plugin icon compressed from 18 KB to 4 KB with no visible quality loss.

### Developer Notes

- JS minification runs in CI before the dotnet build step. For local Release builds with minification, run `npm ci && npm run build:js` in the `segment_reporting/` directory first.
- To update Chart.js: bump the version in `package.json`, run `npm run build:chart`, and commit the result.

---

## v0.0.9.1 - Fix Duplicate Button Clicks on Page Re-navigation

### Fixed

- **Event listener accumulation** (#28) - Buttons on the Dashboard, Library, and Series pages no longer fire multiple times after navigating away and back. Listeners are now attached only once per page lifecycle.

---

## v0.0.9.0 - Security Fixes

### Security

- **Custom queries are now read-only** (#27) - The custom query page can no longer be used to modify the database, even with specially crafted SQL. Protection is enforced at the database engine level.
- **HTML escaping for media names** (#27) - Library, series, and episode names are now properly escaped before display, preventing specially crafted media titles from executing scripts in the admin UI.

---

## v0.0.8.0 - Visual Query Builder

### Added

- **Visual query builder** (#22) - Point-and-click query builder with field/operator selection, condition groups, and saved queries support for the custom query page.

---

## v0.0.7.7 - UI Enhancements

- **Theme-derived chart colors** (#21) - Dashboard summary cards and charts now use colors derived from the active Emby theme accent color.
- **Clickable timestamps** (#19) - Segment timestamps in the series view are now clickable to launch playback at that position.
- **Fix: Resource name collision** - Renamed `helper_function.js` and `chart.min.js` to avoid conflicts with playback_reporting plugin.
- **Fix: README accuracy** - Updated README with correct .NET and dependency information.

---

## v0.0.7 - Initial Release

An Emby server plugin that caches media segment markers (Intros, Credits) into a local SQLite database and provides comprehensive reporting, charts, inline editing, and bulk management through embedded web pages.

### Interactive Web UI

- **Dashboard** (#8) - Overview with coverage statistics and quick navigation
- **Library Browser** (#9) - Browse series/movies with segment coverage stats, sortable columns, and intro/credits percentage split (#20)
- **Series Details** (#10) - Season/episode grid with inline segment editing
- **Bulk Operations** (#11) - Multi-select, copy/apply segments, delete, and set-credits-to-end operations
- **Settings Page** (#12) - Cache statistics and force rescan functionality
- **Custom Query** (#13) - SQL interface with canned queries for advanced reporting

### Data Management

- **Automated Sync Task** (#3) - Scheduled task to crawl libraries and cache segment data
- **Cache Maintenance** (#4) - Weekly VACUUM and health check task
- **SQLite Data Layer** (#2) - Efficient denormalized schema for fast queries

### REST API

- **Reporting Endpoints** (#5) - Query segment coverage and statistics
- **Edit Endpoints** (#6) - Update segment markers (writes through to Emby)
- **Admin Endpoints** (#7) - Library management and bulk operations

### Infrastructure

- **Core Plugin Framework** (#1) - Plugin entry point, configuration, and Emby integration
- **CI/CD Pipeline** (#14) - GitHub Actions for automated builds and releases
- **Code Quality** (#16) - StyleCop analyzers with pre-commit hooks

## System Requirements

- Emby Server 4.8.x
- .NET Standard 2.0 runtime
- SQLite support (included)

## Installation

1. Download `segment_reporting.dll` from the release assets
2. Copy to your Emby server's plugins directory
3. Restart Emby server
4. Access via Dashboard → Plugins → Segment Reporting

## License

GPL-3.0 License
