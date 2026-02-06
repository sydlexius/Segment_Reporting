# Segment Reporting — Emby Plugin Design Document

**Date:** 2026-02-06
**Status:** Approved
**License:** GPL-3.0 (consistent with source references)

## Overview

Segment Reporting is an Emby server plugin that caches, displays, and allows editing of media segment markers (Intros, Credits) across all libraries. It provides administrators with library-level, series-level, and episode-level visibility into segment coverage through interactive charts and filterable tables, with inline editing and bulk management capabilities.

## References

- [playback_reporting](https://github.com/faush01/playback_reporting) — Emby plugin by faush01. Used as the primary architectural template (plugin scaffolding, SQLite data layer, API patterns, embedded web pages, scheduled tasks, configuration system).
- [ChapterApi](https://github.com/faush01/ChapterApi) — Emby plugin by faush01. Used as the reference for Emby's media segment APIs (`IItemRepository.GetChapters()`, `SaveChapters()`, `MarkerType` enum, `ChapterInfo` model).

Both projects are licensed under GPL-3.0.

## Scope

### In Scope

- Segment types: `IntroStart`, `IntroEnd`, `CreditsStart` (the three types Emby currently supports)
- Media types: Movies, TV Episodes (including Anime), Mixed libraries
- SQLite cache for fast reporting and custom SQL queries
- Interactive charts with drill-down navigation
- Inline table editing with per-row CRUD buttons
- Bulk operations (copy/apply across season, bulk delete)
- Filtering by library, segment status, and text search
- Custom SQL query interface with canned queries
- Scheduled sync via Emby's built-in Scheduled Tasks system
- Force full rescan option in advanced settings
- GitHub Actions CI/CD

### Out of Scope (Future Enhancements)

- Additional segment types (Recap, Commercial, etc.) — design is extensible
- Incremental/event-driven sync — may add if full scan proves insufficient
- Saving custom queries — future enhancement
- Automated testing — Emby plugins require a running server

---

## Architecture

```
+-----------------------------------------------------+
|                    Emby Server                       |
|  +---------------+   +--------------------------+   |
|  | IItemRepository|   | ILibraryManager          |   |
|  | (chapters)     |   | (items, libraries)       |   |
|  +-------+-------+   +------------+-------------+   |
|          |  read/write chapters   |  query items     |
|  +-------+------------------------+--------------+   |
|  |          Segment Reporting Plugin             |   |
|  |                                               |   |
|  |  +---------+  +----------+  +-------------+   |   |
|  |  | SyncTask |  | API Layer|  | Web UI      |   |   |
|  |  | (sched.) |  | (REST)   |  | (HTML/JS)   |   |   |
|  |  +----+-----+  +-----+---+  +------+------+   |   |
|  |       |               |             |          |   |
|  |  +----+---------------+-------------+------+   |   |
|  |  |     SegmentRepository (SQLite cache)    |   |   |
|  |  |     segment_reporting.db                |   |   |
|  |  +-----------------------------------------+   |   |
|  +-----------------------------------------------+   |
+-----------------------------------------------------+
```

### Data Flow

- **Reads:** Web UI -> API Layer -> SegmentRepository (SQLite) -- fast queries against the cache
- **Writes:** Web UI -> API Layer -> IItemRepository.SaveChapters() (Emby) -> then updates SQLite cache
- **Sync:** SyncTask crawls ILibraryManager + IItemRepository -> rebuilds SQLite cache
- **Force rescan:** Drops all tables, runs full rebuild from scratch

### Key Principle

Emby's chapter system is always the source of truth. The SQLite DB is a read-optimized cache for reporting and custom queries. All edits go through Emby first, then update the cache.

---

## Data Model

### SQLite Schema

**Table: `MediaSegments`**

| Column | Type | Description |
|---|---|---|
| `Id` | INTEGER PRIMARY KEY | Auto-increment row ID |
| `ItemId` | TEXT NOT NULL | Emby internal item ID |
| `ItemName` | TEXT | Episode/movie title |
| `ItemType` | TEXT | `Episode` or `Movie` |
| `SeriesName` | TEXT | Series name (null for movies) |
| `SeriesId` | TEXT | Series internal ID (null for movies) |
| `SeasonName` | TEXT | e.g., "Season 3" (null for movies) |
| `SeasonId` | TEXT | Season internal ID |
| `SeasonNumber` | INT | Sortable season number |
| `EpisodeNumber` | INT | Sortable episode number |
| `LibraryName` | TEXT | Parent library name |
| `LibraryId` | TEXT | Parent library ID |
| `IntroStartTicks` | BIGINT | Nullable -- null means missing |
| `IntroEndTicks` | BIGINT | Nullable |
| `CreditsStartTicks` | BIGINT | Nullable |
| `HasIntro` | INT | 0/1 computed flag for fast filtering |
| `HasCredits` | INT | 0/1 computed flag |
| `LastSyncDate` | DATETIME | When this row was last updated from Emby |

**Why denormalized?** A single flat table keeps custom SQL queries simple. Admins can write `SELECT * FROM MediaSegments WHERE SeriesName = 'Breaking Bad' AND HasIntro = 0` without joins.

**Table: `SyncStatus`**

| Column | Type | Description |
|---|---|---|
| `Id` | INTEGER PRIMARY KEY | Single row |
| `LastFullSync` | DATETIME | Timestamp of last completed full sync |
| `ItemsScanned` | INT | Count from last sync |
| `SyncDuration` | INT | Milliseconds last sync took |

**Indexes:**

```sql
CREATE INDEX idx_segments_library ON MediaSegments(LibraryId);
CREATE INDEX idx_segments_series ON MediaSegments(SeriesId);
CREATE INDEX idx_segments_season ON MediaSegments(SeasonId);
CREATE INDEX idx_segments_missing ON MediaSegments(HasIntro, HasCredits);
```

**Schema migration** follows the playback_reporting pattern: use `PRAGMA table_info` to check existing columns, `ALTER TABLE ADD` for new ones.

### Movie vs. Episode Handling

Movies and episodes share the same table. For movies, the series/season columns are null:

- Movies: `ItemType='Movie'`, `SeriesName=null`, `SeasonNumber=null`, `EpisodeNumber=null`
- Episodes: `ItemType='Episode'`, all columns populated

The UI drill-down branches based on library content type:
- Movie libraries: Library -> flat movie list with inline segments (2 levels)
- TV/Anime libraries: Library -> Series list -> Season/Episode grid (3 levels)
- Mixed libraries: Series grouped together, standalone movies listed separately

---

## API Layer

All endpoints under `/segment_reporting/` prefix. All require `[Authenticated(Roles = "admin")]`.

### Reporting & Browse Endpoints (GET)

| Route | Purpose |
|---|---|
| `/segment_reporting/library_summary` | Coverage stats per library (counts, percentages). Powers the landing page. |
| `/segment_reporting/series_list?libraryId=X` | Series/movies in a library with per-item coverage stats. Supports `&search=` and `&filter=missing_intro,missing_credits`. |
| `/segment_reporting/season_list?seriesId=X` | Seasons for a series with per-season coverage summary. |
| `/segment_reporting/episode_list?seasonId=X` | Episodes with full segment tick values. Also works with `?seriesId=X` for flat series view. |
| `/segment_reporting/item_segments?itemId=X` | Single item's segment detail. |

### Edit Endpoints (POST)

| Route | Purpose |
|---|---|
| `/segment_reporting/update_segment` | Update a single segment on one item. Body: `{ itemId, markerType, ticks }`. Writes to Emby via `SaveChapters()`, then updates cache. |
| `/segment_reporting/delete_segment` | Remove a segment marker from an item. Body: `{ itemId, markerType }`. |
| `/segment_reporting/bulk_apply` | Copy segments from a source item to targets. Body: `{ sourceItemId, targetItemIds[], markerTypes[] }`. For "apply to all in season". |
| `/segment_reporting/bulk_delete` | Remove segment types from multiple items. Body: `{ itemIds[], markerTypes[] }`. |

### Sync & Admin Endpoints

| Route | Purpose |
|---|---|
| `/segment_reporting/sync_now` | Trigger an immediate full sync. Returns job status. |
| `/segment_reporting/sync_status` | Check last sync time, items scanned, duration. |
| `/segment_reporting/force_rescan` | Drops cache, rebuilds from scratch. |
| `/segment_reporting/submit_custom_query` | Custom SQL against the cache DB (read-only). |
| `/segment_reporting/canned_queries` | Returns list of built-in queries. |

### Write-Through Pattern

All write operations:
1. Read current chapters from Emby via `IItemRepository.GetChapters()`
2. Modify the chapter list (add/update/remove the target marker)
3. Write back via `IItemRepository.SaveChapters()`
4. Update the corresponding SQLite row immediately

Edits made through other tools (ChapterApi, etc.) get picked up on the next scheduled sync or manual "Sync Now".

---

## Web UI

Six embedded pages following the `data-controller` / AMD module pattern from playback_reporting.

### Pages

**1. `segment_dashboard.html/js`** — Landing page (`EnableInMainMenu = true`)
- Summary cards: total items, intro coverage %, credits coverage %, both %, neither %
- Stacked bar chart: per-library coverage breakdown (clickable -- drills to series list)
- "Last synced" indicator with a "Sync Now" button

**2. `segment_library.html/js`** — Series/movie list for a library
- Received via `?libraryId=X` from dashboard chart/table click
- Bar chart: per-series coverage (clickable -- drills to season view)
- Filterable table: series name, intro count/total, credits count/total, coverage %
- Filter controls: dropdown for segment status (All / Missing Intros / Missing Credits / Complete), text search
- For movie libraries: shows movies directly with inline segment data and edit buttons

**3. `segment_series.html/js`** — Season/episode detail for a series
- Received via `?seriesId=X`
- Mini bar chart per season showing coverage
- Season tabs or accordion, each containing an episode table
- Episode table columns: #, Episode Name, IntroStart, IntroEnd, CreditsStart, Actions
- Inline editing: click a tick value cell to edit (displayed as `HH:MM:SS.fff`, stored as ticks)
- Per-row buttons: Edit (toggle inline edit), Delete (dropdown to pick which segment), Copy (mark as bulk source)
- Bulk action row at top of each season table:
  - "Apply source to all episodes" (copies from the Copy-marked row)
  - "Delete all intros in season" / "Delete all credits in season"
  - "Select all" checkbox for custom bulk operations

**4. `segment_settings.html/js`** — Plugin settings
- Top section: display preferences (time format, chart color palette)
- Bottom section (Advanced): "Force Full Rescan" button with confirmation dialog
  - Dialog text: "This will drop and rebuild the entire segment cache from Emby's data. Your segment data in Emby is not affected. This may take a few minutes on large libraries. Continue?"
- Cache stats: row count, DB file size, last sync details

**5. `segment_custom_query.html/js`** — Custom SQL interface
- Text area for SQL input
- Canned query dropdown (pre-built queries loaded from API)
- Results table with export option
- Same pattern as playback_reporting's custom_query page

**6. `helper_function.js`** — Shared utilities
- Tick <-> `HH:MM:SS.fff` conversion
- Chart click-through navigation helpers
- API client extension methods
- Common table rendering functions

### Navigation Flow

```
Dashboard -> [click library bar/row] -> Library View -> [click series bar/row] -> Series View
                                         | (movies)
                                         v
                                      Inline edit directly
```

Charts and tables are synchronized: clicking a chart bar is equivalent to clicking the matching table row. Filter state passes through as URL parameters (`?libraryId=X&seriesId=Y`), making views bookmarkable.

### Shared Dependency

`chart.min.js` embedded as a resource (same library as playback_reporting).

---

## Scheduled Tasks

Two tasks registered with Emby's Scheduled Tasks system via `IScheduledTask`.

### TaskSyncSegments — Primary sync

- **Category:** "Segment Reporting"
- **Default trigger:** Daily at 2:00 AM
- **Behavior:**
  1. Query all libraries via `ILibraryManager`
  2. For each library, get all items (episodes + movies) via `GetItemList()`
  3. For each item, call `IItemRepository.GetChapters()` and extract `IntroStart`, `IntroEnd`, `CreditsStart` markers
  4. Upsert into `MediaSegments` SQLite table (match on `ItemId`)
  5. Remove rows from cache where the item no longer exists in Emby (handles deleted media)
  6. Update `SyncStatus` table with timestamp, count, duration
- **Progress reporting:** uses `IProgress<double>` so Emby's task UI shows a progress bar
- Also triggered on-demand via `/segment_reporting/sync_now`

### TaskCleanSegmentDb — Cache maintenance

- **Category:** "Segment Reporting"
- **Default trigger:** Weekly, Sunday 3:00 AM
- **Behavior:**
  1. Run `VACUUM` on the SQLite database to reclaim space
  2. Verify row count matches Emby's item count -- log a warning if they diverge significantly
  3. Log cache health stats

### Force Full Rescan

Not a scheduled task. Invoked via `/segment_reporting/force_rescan` API (triggered from settings page):
1. Drop and recreate the `MediaSegments` table
2. Run the same logic as `TaskSyncSegments` from a clean slate

---

## Project Structure

```
Segment_Reporting/
├── .github/
│   └── workflows/
│       └── build.yml
├── segment_reporting/
│   ├── segment_reporting.csproj
│   ├── Plugin.cs
│   ├── PluginConfiguration.cs
│   ├── SegmentReportingOptions.cs
│   ├── Extensions.cs
│   ├── Api/
│   │   └── SegmentReportingAPI.cs
│   ├── Data/
│   │   ├── SegmentRepository.cs
│   │   └── SegmentInfo.cs
│   ├── Tasks/
│   │   ├── TaskSyncSegments.cs
│   │   └── TaskCleanSegmentDb.cs
│   └── Pages/
│       ├── segment_dashboard.html
│       ├── segment_dashboard.js
│       ├── segment_library.html
│       ├── segment_library.js
│       ├── segment_series.html
│       ├── segment_series.js
│       ├── segment_settings.html
│       ├── segment_settings.js
│       ├── segment_custom_query.html
│       ├── segment_custom_query.js
│       ├── helper_function.js
│       └── chart.min.js
├── docs/
│   └── plans/
│       └── 2026-02-06-segment-reporting-design.md
├── LICENSE
├── README.md
└── .gitignore
```

## Dependencies

- `mediabrowser.server.core` (4.8.x) — Emby server SDK
- `SQLitePCL.pretty.core` (1.2.2) — SQLite database wrapper
- `System.Memory` (4.5.5) — Memory utilities

## CI/CD

GitHub Actions workflow (`.github/workflows/build.yml`):
- **Trigger:** Push to main/develop, pull requests
- **Steps:** checkout, setup-dotnet, restore, build (Release), upload artifact
- **Release:** On tag push (`v*`), create GitHub Release with compiled DLL attached

## GitHub Issues

Implementation tracked via 15 scoped issues:

1. Project scaffolding — .csproj, Plugin.cs, PluginConfiguration, Extensions, .gitignore, LICENSE, thumb.png
2. SQLite data layer — SegmentRepository singleton, schema creation, migration, SegmentInfo model
3. Sync task — TaskSyncSegments: crawl libraries, read chapters, upsert cache
4. Cache maintenance task — TaskCleanSegmentDb: VACUUM, health check, orphan removal
5. Reporting API endpoints — library_summary, series_list, season_list, episode_list, item_segments
6. Edit API endpoints — update_segment, delete_segment, bulk_apply, bulk_delete (write-through)
7. Admin API endpoints — sync_now, sync_status, force_rescan, submit_custom_query, canned_queries
8. Dashboard page — summary cards, per-library coverage chart, drill-down click handlers
9. Library browse page — series/movie table, filters, search, coverage chart
10. Series detail page — season tabs, episode table, inline editing, per-row CRUD buttons
11. Bulk operations — bulk action row UI, copy/apply across season, bulk delete
12. Settings page — preferences, force rescan with confirmation dialog
13. Custom query page — SQL input, canned queries dropdown, results table
14. CI/CD pipeline — GitHub Actions build workflow, release on tag
15. README and documentation — setup instructions, feature overview, GPL-3.0 attribution
