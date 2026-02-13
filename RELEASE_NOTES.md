<!-- markdownlint-disable MD024 -->
# Segment Reporting - Release Notes

## v1.2.0.4 - Unified Actions Dropdown

### Improved

- **Unified Actions dropdown menu** (#58) — Each episode and query result row now has a single "Actions ▼" button that opens a clean dropdown menu with Edit, Copy, Delete, and Set Credits to End options, replacing the previous row of individual buttons.
- **Type-selective Copy and Delete** (#58) — The Copy and Delete menu items now expand into submenus letting you choose Intros, Credits, or Both, so you can copy or delete just the segment type you need.
- **Shared dropdown menu infrastructure** (#58) — The menu system is built on reusable helpers in the shared library (theme-aware colors, submenu positioning, click-outside dismissal), keeping the code consistent across the Series and Custom Query pages.

### Screenshots

- Updated series detail and query results screenshots to reflect the new Actions dropdown UI.

---

## [v1.1.0.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.1.0.0) - Autocomplete & Multi-Value Pill UI for Query Builder

### Added

- **Autocomplete suggestions for query builder fields** (#54) — The "Item Type", "Series Name", and "Library Name" fields in the visual query builder now show a dropdown of matching values from your library as you type, so you no longer need to remember exact names.
- **Multi-value pill selection** (#54) — Choose the "is any of" or "is none of" operator to select multiple values as removable pills. The builder generates `IN (...)` and `NOT IN (...)` SQL clauses automatically.
- **New API endpoint** (#54) — `GET /segment_reporting/distinct_values?field=...` returns all unique values for a given field from the cache, powering the autocomplete dropdowns.

### Improved

- **Saved query round-trip** (#54) — Queries containing `IN` and `NOT IN` clauses are correctly imported back into the visual builder when loading a saved query.
- **Theme-aware dropdown** (#54) — The autocomplete dropdown background matches your Emby theme (light or dark) instead of using a hardcoded color.

### Fixed

- **Event listeners no longer stack on repeated page visits** (#55) — The Custom Query and Settings pages now attach event listeners only once per page lifecycle, matching the guard pattern already used by the Dashboard, Library, and Series pages. Previously, navigating to these pages multiple times in a single session caused button clicks and color picker inputs to fire repeatedly.

### Removed

- **Dead operator sets** — Cleaned up unused `enum` and `datetime` operator definitions left over from previous refactors.

---

## [v1.0.4.2](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.4.2) - Remove Redundant LastSyncDate Column

### Added

- **Vacuum Database button on Settings page** — A new "Vacuum Database" button in the Advanced section lets you reclaim disk space on demand, without waiting for the weekly scheduled cleanup task.

### Improved

- **Removed `LastSyncDate` from the MediaSegments table** (#53) — Every row in the cache used to store an identical sync timestamp, wasting space across thousands of rows. Sync timing is already tracked centrally in the `SyncStatus` table (shown as "Last synced" on the dashboard), so the per-row column was redundant. Existing databases will have the column's values cleared automatically on first load; a Force Rescan will fully remove the column.

---

## [v1.0.3.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.3.0) - Per-Library Visibility Controls

### Added

- **Exclude individual libraries from the dashboard** (#52) — The Library Visibility section on the Settings page now shows a checkbox for every library in your server. Uncheck any library to hide it from the dashboard charts and tables. This works alongside the existing "Hide Movie libraries" and "Hide Mixed libraries" options, giving full control over which libraries appear in your reports.

---

## [v1.0.2.1](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.2.1) - Fix Missing Intros/Credits Filter for Series

### Fixed

- **"Missing Intros" and "Missing Credits" filters now show the full series** — Previously, filtering by missing intros or credits on the Library page only counted episodes that lacked the marker, producing incorrect totals and coverage percentages. Now any series with at least one episode missing intros (or credits) is included in the results with accurate stats for the entire series.

---

## [v1.0.2.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.2.0) - Detect Credits on Custom Query Page

### Added

- **"Detect Credits" bulk action on Custom Query page** (#46) — When the EmbyCredits plugin is installed, a "Detect Credits" button now appears in the bulk action bar alongside the existing delete buttons. Select rows and click to trigger credits detection for the selected items, with the same skip-existing prompt used on all other pages.

---

## [v1.0.1.6](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.1.6) - Reduce Lock Contention During Sync

### Improved

- **Sync no longer freezes the web UI** (#50) — The sync task previously held the database lock for the entire upsert and orphan-removal operations, blocking all API reads (library summary, series list, episode list, custom queries) until the transaction finished. Both operations now process data in chunks of 500, releasing the lock between chunks so API reads can interleave freely.
- **Orphan removal is now cancellable** (#50) — `RemoveOrphanedRows` now accepts a cancellation token, so cancelling the sync task mid-run also stops the orphan cleanup step cleanly.
- **Smoother progress reporting during sync** (#50) — The sync task now reports granular progress during the upsert phase instead of jumping from 90% to 95% in one step.

---

## [v1.0.1.5](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.1.5) - Code Cleanup

### Removed

- **Dead code** (#51) — Removed unused `UpsertSegment` and `GetPreference` methods from the repository.

### Fixed

- **Case-insensitive marker type matching** (#51) — `IsIntroType` now uses case-insensitive comparison, consistent with the rest of the marker type validation.
- **Validation ordering** (#51) — `UpdateSegmentTicks` now validates the marker type before computing the column name, matching the pattern used by `DeleteSegment`.
- **Redundant initialization** (#51) — Removed unnecessary `Initialize()` calls in the sync and cleanup tasks that re-ran all schema creation statements on every execution.

---

## [v1.0.1.4](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.1.4) - Fix Singleton Disposal and Thread Safety

### Fixed

- **Thread-safe disposal** (#49) — `SegmentRepository.Dispose()` now acquires proper locks before closing the SQLite connection, preventing crashes if a query is in-flight during disposal.
- **Disposed singleton recovery** (#49) — `GetInstance()` now detects a disposed singleton and creates a fresh instance instead of returning one with a closed connection.
- **Use-after-dispose guard** (#49) — Every public repository method now throws `ObjectDisposedException` if called after disposal, instead of crashing with a native SQLite error.

---

## [v1.0.1.3](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.1.3) - Fix Duplicate Version Tag in JS Filenames

### Fixed

- **Dashboard pages failing to load** (#48) - Release builds could produce JS filenames with a doubled version tag (e.g. `segment_dashboard.v1_0_1_2.v1_0_1_2.js`) if a previous build was interrupted before its restore step completed. The build script now strips any stale version tags before patching, making the process safe to re-run regardless of prior state.

---

## [v1.0.1.2](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.1.2) - Emby Forums Link

### Added

- **Emby Forums link on About page** — The About page now links to the [Emby Forums discussion thread](https://emby.media/community/index.php?/topic/146268-segment-reporting-plugin/) for questions, feedback, and community discussion.

---

## [v1.0.1.1](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.1.1) - Drill-Down Filtering and Bulk Actions at Every Level

### Added

- **Filter dropdown on Series page** (#45) - The same filter controls from the Library page plus a search box are now available on the Series page, filtering episodes within each season accordion.
- **"Has Intro" and "Has Credits" filters** (#45) - The filter dropdowns on the Library and Series pages now include positive filters to show only items that already have intro or credits segments, in addition to the existing "Missing" filters.
- **Per-library "Detect Credits" on Dashboard** (#45) - Each library row on the Dashboard now has a "Detect" button (when EmbyCredits is installed) that finds all items missing credits in that library and queues detection for them.
- **Per-series and per-movie "Detect Credits" on Library page** (#45) - Each series row on the Library page now has a "Detect" button that triggers EmbyCredits detection for the entire series. Movie rows also get a per-item "Detect" button.

### Improved

- **Shared bulk action helpers** (#45) - Extracted duplicated bulk delete, bulk set-credits-to-end, and bulk detect-credits logic from the Series and Custom Query pages into shared helper functions, reducing code duplication and ensuring consistent behavior across all pages.

---

## [v1.0.0.1](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.0.1) - Cache Busting for Plugin Updates

### Improved

- **Automatic cache busting** - Browser-cached JS files are now invalidated automatically when the plugin is updated. Release builds embed a version tag (e.g. `segment_dashboard.v1_0_0_1.js`) into all page controllers and resource URLs, so browsers always load the correct version after an upgrade. No more manual cache clearing needed.

---

## [v1.0.0.0-RC2](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.0.0-RC2) - Selectable Columns, Bulk Actions & Sticky UI

### Added

- **Selectable columns in query builder** (#43) - The query builder now has a column picker with drag-to-reorder pills. Click to toggle columns on/off, drag to change their order in the SQL SELECT clause.
- **Row selection with checkboxes** (#43) - Query results now include a checkbox column for selecting individual rows or all rows at once via a header checkbox.
- **Bulk delete actions** (#43) - Select rows and bulk-delete intro or credits segments. Buttons show the selection count and are disabled until rows are selected, making the scope of the action clear.
- **Auto-inject ItemId** (#43) - When executing a query that doesn't include `ItemId` in the SELECT list, it is automatically added so that delete and edit actions are always available.

### Improved

- **Sticky checkbox and actions columns** (#43) - The leftmost checkbox column and rightmost Actions column stay pinned during horizontal scrolling, so controls remain accessible on wide result sets.
- **Tick values now render correctly** (#43) - Timestamp columns from custom queries are now properly converted from strings to numbers, enabling clickable playback links and formatted time display.

---

## [v1.0.0.0-RC1](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.0.0-RC1) - Interactive Custom Query Results

### Added

- **Playback links in custom query results** (#42) - Timestamp columns in query results are now clickable links that launch playback at that position, just like the reports pages.
- **Inline editing in custom query results** (#42) - Edit segment timestamps directly in the results table. Click "Edit" on any row, modify the tick values, and save. Changes write through to Emby and update the local cache.
- **Delete markers from custom query results** (#42) - Delete individual segment markers from query results via a context menu that shows which markers are set for each item.
- **Smart column auto-detection** (#42) - The custom query page automatically detects whether results contain `ItemId` and segment tick columns, and only shows interactive controls (edit, delete, playback) when the data supports it.

### Fixed

- **Horizontal scrollbar on wide query results** (#42) - The results table now scrolls horizontally when columns extend beyond the page width, instead of clipping content.

---

## [v1.0.0.0-RC0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v1.0.0.0-RC0) - Pre-Production Release

This is a pre-production release candidate. All planned features are implemented and working. Please report any issues before the final v1.0.0.0 release.

---

## [v0.0.17.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.17.0) - Palette Preview on Settings Page

### Added

- **Live chart preview on settings page** (#36) - The Chart Theme section now shows a sample stacked bar chart that updates instantly when you switch palettes or adjust custom colors, so you can see exactly how the dashboard will look before saving.

---

## [v0.0.16.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.16.0) - Breadcrumb Navigation

### Added

- **Breadcrumb navigation on drill-down pages** (#40) - The Library and Series pages now show a clickable breadcrumb trail (e.g. `Dashboard › TV Shows › Breaking Bad`) instead of "Back to …" buttons, making it easier to navigate between reporting levels.
- Friendly library and series names are displayed in the breadcrumbs. Names are passed through the URL for instant rendering, with a fallback to API data when landing on a page directly (e.g. from a bookmark).

---

## [v0.0.15.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.15.0) - Database-Backed Saved Queries

### Added

- **Saved custom queries** (#22) - Custom SQL queries can now be saved with a name and recalled later from a dropdown. Saved queries are stored in a new `SavedQueries` table in the plugin's SQLite database, surviving server restarts.
- **New API endpoints** (#22) - `GET /segment_reporting/saved_queries` lists all saved queries, `POST /segment_reporting/saved_queries` creates or updates a query, and `DELETE /segment_reporting/saved_queries/{Id}` removes one.

### Fixed

- **Custom query execution** (#22) - The custom query page now correctly executes user-entered SQL and displays results, fixing a regression where queries would silently fail.

---

## [v0.0.14.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.14.0) - Configurable Theming & UI Settings

### Added

- **Chart palette selection** (#36) - Choose from six chart color palettes (Auto, Refreshing Ocean Breeze, Sunshine Blue Dream, Deep Sea Carnival, Pastel Dreamland Adventure, Bold Hues) or define custom colors for each segment category.
- **Table display options** (#36) - Toggle gridlines and alternating row colors across all tables.
- **Library visibility controls** (#36) - Hide Movie and Mixed libraries from the dashboard, since Emby does not support intro/credit detection for those library types.
- **Preferences API** (#36) - New `GET`/`POST` `/segment_reporting/preferences` endpoints for reading and saving display settings.

### Improved

- **Settings page redesigned** (#36) - The Settings page now includes a full "Display Preferences" section above the existing cache statistics and advanced controls.
- **Preferences persist in SQLite** (#36) - All display settings are stored in a new `UserPreferences` table in the plugin's database, surviving server restarts.

### Fixed

- **Database tables now created on startup** - Schema initialization now runs when the repository is first instantiated, instead of waiting for the first scheduled sync task. This ensures new tables are available immediately after deploying a new version.

---

## [v0.0.13.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.13.0) - Better Display for Shows Without Season Folders

### Fixed

- **Shows without season folders now display "Season 1"** (#37) - Shows that don't use season folders previously had their episodes grouped under "Unassigned" in the series view. They now display as "Season 1" (or the appropriate season number when available), which better reflects the actual library structure.

---

## [v0.0.12.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.12.0) - About Page

### Added

- **About page** (#38) - New "About" button on the dashboard opens a page showing plugin version, acknowledgements for ChapterApi, Playback Reporting, and EmbyCredits, links to the GitHub repository, and a quick-reference list of all REST API endpoints.
- **Plugin info API endpoint** - New `GET /segment_reporting/plugin_info` endpoint returns the plugin name, version, and description.

### Fixed

- **API comment URLs** - Developer-facing URL examples in the API source code now use a generic `http(s)://<host>:<port>` placeholder instead of `localhost:8096`.

---

## [v0.0.11.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.11.0) - EmbyCredits Plugin Integration

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

## [v0.0.10.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.10.0) - Browser Back Button and Unassigned Season Fix

### Fixed

- **Browser back button now works** (#32) - Navigation parameters (library ID, series ID) are now encoded directly in the URL instead of browser session storage. Previously, hitting the back button would lose the page context and show "No library/series ID provided" errors.
- **Episodes without a season now display correctly** (#33) - Episodes whose parent season can't be resolved by Emby (e.g. flat library structures) are now grouped under "Unassigned" instead of silently disappearing. The sync task tries additional fallbacks to resolve season metadata, and the API safely scopes null-season queries to prevent cross-series data leaks.

---

## [v0.0.9.9](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.9.9) - Separate Intro and Credit Percentages

### Improved

- **Separate intro/credit percentages on series page** (#34) - The series drill-down now shows independent "Intros: XX%" and "Credits: XX%" in each season header, replacing the single combined percentage that always showed 0% when only one segment type was detected.
- **Grouped coverage chart** (#34) - The season chart now displays intro and credit coverage as side-by-side percentage bars (0–100%) instead of a stacked episode count chart, making per-segment-type coverage immediately visible.
- **Consistent table header alignment** - Table headers on the dashboard and library pages now left-align to match their data cells, fixing visual misalignment caused by the browser's default center-alignment of `<th>` elements.

---

## [v0.0.9.8](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.9.8) - Curated Chart Color Palettes

### Improved

- **Hand-picked chart color palettes** (#21) - Chart and dashboard card colors now use curated palettes matched to the active Emby accent color (green, blue, red, pink, or purple) instead of auto-generated HSL variations.

---

## [v0.0.9.7](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.9.7) - Movie Library Browsing

### Added

- **Movie library support** (#29) - Movie libraries now display a flat table with inline segment timestamps (Intro Start, Intro End, Credits Start) instead of the series drill-down view. Mixed libraries show both series and movies.
- **Inline editing for movies** (#29) - Edit, save, and delete segment markers directly from the movie table row, with the same workflow used for TV episodes.
- **Library content type detection** (#29) - The library page automatically detects whether a library contains series, movies, or both, and shows the appropriate layout.

---

## [v0.0.9.6](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.9.6) - Bulk Operation Limits and Unnecessary API Call Removal

### Improved

- **Bulk operation safety limit** (#31) - Bulk apply, bulk delete, and bulk set-credits-to-end now reject requests with more than 500 items, preventing accidental overload of the API thread.
- **Faster filter switching** (#31) - Switching between "Complete", "No Segments", and "All" filters on the library page no longer makes a redundant server round-trip; existing data is re-filtered instantly on the client.
- **Lighter series page load** (#31) - The series page no longer fetches the entire episode list just to read the series name. The season list API now includes the series name and library ID directly, eliminating a potentially expensive extra call for long-running shows.

---

## [v0.0.9.5](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.9.5) - SQLite UPSERT and Connection Improvements

### Improved

- **Faster sync for large libraries** (#30) - Replaced the two-query SELECT-then-INSERT/UPDATE pattern with a single SQLite UPSERT (`INSERT ... ON CONFLICT DO UPDATE`), cutting round-trips per item in half during sync.
- **Cancellable bulk upserts** (#30) - The sync task can now be cleanly cancelled mid-upsert. Large library syncs (50K+ items) check for cancellation periodically and roll back gracefully instead of blocking until completion.
- **Safer SQLite threading** (#30) - Switched the write connection from `NoMutex` to `FullMutex`, letting SQLite handle thread safety internally alongside the existing application-level lock.

### Fixed

- **Connection leak on plugin reload** (#30) - `SegmentRepository` now implements `IDisposable` so the SQLite connection is properly released if the plugin is unloaded or reloaded.
- **Silent path mismatch** (#30) - The singleton factory now logs a warning if a caller requests a different database path than the one already in use, instead of silently ignoring it.

---

## [v0.0.9.4](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.9.4) - Reduce Backend Duplication

### Improved

- **Marker type constants** (#26) - Introduced a `MarkerTypes` constants class so `"IntroStart"`, `"IntroEnd"`, and `"CreditsStart"` are defined once. Typos in marker names now cause build errors instead of silent bugs.
- **API helper methods** (#26) - Extracted `GetRepository()`, `SplitAndTrim()`, and `ValidateMarkerTypes()` helpers, replacing dozens of duplicated blocks across API endpoints.
- **Repository filter helper** (#26) - Consolidated duplicated segment-filter logic into a shared `ApplySegmentFilters()` method.
- **Named constants for magic numbers** (#26) - Progress report interval and cache divergence threshold are now named constants in the sync and cleanup tasks.

### Removed

- **Dead code cleanup** (#26) - Removed unused `SegmentReportingOptions` configuration class, its factory and extension methods, an uncalled `GetItemsByLibrary()` repository method, and duplicate "future enhancement" comments.

---

## [v0.0.9.3](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.9.3) - Reduce Frontend Duplication

### Improved

- **Shared helper library expanded** (#25) - Extracted 9 reusable utilities from page modules into the shared helpers file, eliminating copy-pasted patterns across the frontend.
- **Chart creation simplified** - All three chart pages (Dashboard, Library, Series) now use a single `createSegmentChart` factory instead of duplicating ~80 lines of Chart.js configuration each.
- **Consistent hover effects** - Table row and accordion hover styling is now handled by a single `attachHoverEffect` helper.
- **Automatic chart cleanup** - Chart lifecycle management (destroy on page hide/destroy) consolidated into `registerChartCleanup`.
- **API loading wrapper** - New `apiCallWithLoading` helper handles the show/hide loading indicator pattern used by most API calls.
- **Utility functions centralized** - `formatBytes`, `formatDuration`, `renderTimestamp`, `createEmptyRow`, and `withButtonLoading` moved from individual pages to the shared helpers.
- **Automatic JS minification in local builds** - Release builds now automatically minify JS files via MSBuild targets, matching CI behavior. No more manual `npm run build:js` step needed.

---

## [v0.0.9.2](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.9.2) - Reduce DLL Size

### Improved

- **37% smaller plugin DLL** (#24) - Reduced from 461 KB to 293 KB through Chart.js tree-shaking, JS minification, and image optimization.
- **Custom Chart.js build** - Upgraded to Chart.js v4.5.1 with a tree-shaken bundle that includes only bar chart components (138 KB, down from 195 KB).
- **Build-time JS minification** - Custom JS files are automatically minified during Release builds using esbuild, cutting 90 KB from the embedded resources.
- **Optimized thumbnail** - Plugin icon compressed from 18 KB to 4 KB with no visible quality loss.

### Developer Notes

- JS minification runs in CI before the dotnet build step. For local Release builds with minification, run `npm ci && npm run build:js` in the `segment_reporting/` directory first.
- To update Chart.js: bump the version in `package.json`, run `npm run build:chart`, and commit the result.

---

## [v0.0.9.1](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.9.1) - Fix Duplicate Button Clicks on Page Re-navigation

### Fixed

- **Event listener accumulation** (#28) - Buttons on the Dashboard, Library, and Series pages no longer fire multiple times after navigating away and back. Listeners are now attached only once per page lifecycle.

---

## [v0.0.9.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.9.0) - Security Fixes

### Security

- **Custom queries are now read-only** (#27) - The custom query page can no longer be used to modify the database, even with specially crafted SQL. Protection is enforced at the database engine level.
- **HTML escaping for media names** (#27) - Library, series, and episode names are now properly escaped before display, preventing specially crafted media titles from executing scripts in the admin UI.

---

## [v0.0.8.0](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.8.0) - Visual Query Builder

### Added

- **Visual query builder** (#22) - Point-and-click query builder with field/operator selection, condition groups, and saved queries support for the custom query page.

---

## [v0.0.7.7](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.7.7) - UI Enhancements

- **Theme-derived chart colors** (#21) - Dashboard summary cards and charts now use colors derived from the active Emby theme accent color.
- **Clickable timestamps** (#19) - Segment timestamps in the series view are now clickable to launch playback at that position.
- **Fix: Resource name collision** - Renamed `helper_function.js` and `chart.min.js` to avoid conflicts with playback_reporting plugin.
- **Fix: README accuracy** - Updated README with correct .NET and dependency information.

---

## [v0.0.7](https://github.com/sydlexius/Segment_Reporting/releases/tag/v0.0.7) - Initial Release

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
