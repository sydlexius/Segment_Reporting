# Segment Reporting - Developer Guide

Developer documentation for the Segment Reporting Emby plugin. This guide covers
everything needed to build, modify, and extend the plugin -- whether you are
contributing to this project or using it as a reference for your own Emby plugin.

---

## Table of Contents

1. [Prerequisites and Dev Environment Setup](#1-prerequisites-and-dev-environment-setup)
   - [Required Software](#required-software)
   - [Building the Plugin](#building-the-plugin)
   - [Deploying to Emby for Testing](#deploying-to-emby-for-testing)
   - [Automatic Deploy via Environment Variable](#automatic-deploy-via-environment-variable)
2. [Architecture Overview](#2-architecture-overview)
   - [Design Principles](#design-principles)
   - [Data Flow](#data-flow)
   - [Component Map](#component-map)
   - [Key Design Decisions](#key-design-decisions)
3. [SQLite Schema and Data Model](#3-sqlite-schema-and-data-model)
   - [Tables](#tables)
   - [MediaSegments Table](#mediasegments-table)
   - [SyncStatus Table](#syncstatus-table)
   - [UserPreferences Table](#userpreferences-table)
   - [SavedQueries Table](#savedqueries-table)
   - [Indexes](#indexes)
   - [Schema Migration](#schema-migration)
   - [Segment Types](#segment-types)
   - [Tick Format](#tick-format)
   - [Movies vs Episodes](#movies-vs-episodes)
4. [API Reference](#4-api-reference)
   - [API Overview](#api-overview)
   - [Browsing Endpoints](#browsing-endpoints)
   - [Single-Item Endpoints](#single-item-endpoints)
   - [Edit Endpoints](#edit-endpoints)
   - [Bulk Operation Endpoints](#bulk-operation-endpoints)
   - [Sync and Cache Endpoints](#sync-and-cache-endpoints)
   - [Custom Query Endpoints](#custom-query-endpoints)
   - [Saved Query Endpoints](#saved-query-endpoints)
   - [Preferences Endpoints](#preferences-endpoints)
   - [Info Endpoints](#info-endpoints)
5. [Web UI Development Guide](#5-web-ui-development-guide)
   - [Page Architecture](#page-architecture)
   - [Embedding Resources](#embedding-resources)
   - [Page Lifecycle](#page-lifecycle)
   - [Shared Utilities](#shared-utilities-segment_reporting_helpersjs)
   - [Chart Integration](#chart-integration)
   - [Adding a New Page](#adding-a-new-page-step-by-step)
   - [Existing Pages Overview](#existing-pages-overview)
6. [Scheduled Tasks](#6-scheduled-tasks)
   - [IScheduledTask Interface](#ischeduledtask-interface)
   - [TaskSyncSegments -- Full Sync](#tasksyncsegments----full-sync)
   - [TaskCleanSegmentDb -- Cache Maintenance](#taskcleansegmentdb----cache-maintenance)
   - [Adding a New Scheduled Task](#adding-a-new-scheduled-task)
   - [Running Tasks Manually](#running-tasks-manually)
7. [CI/CD Pipeline](#7-cicd-pipeline)
   - [Workflow Overview](#workflow-overview)
   - [Build Job](#build-job)
   - [Release Job](#release-job)
   - [JS Minification Pipeline](#js-minification-pipeline)
   - [Auto-Deploy for Local Development](#auto-deploy-for-local-development)
   - [Code Quality Enforcement](#code-quality-enforcement)
   - [Releasing a New Version](#releasing-a-new-version)
8. [Testing](#8-testing)
   - [Manual Testing Workflow](#manual-testing-workflow)
   - [Bruno API Test Collection](#bruno-api-test-collection)
   - [What to Check After Changes](#what-to-check-after-changes)
9. [Screenshots](#9-screenshots)
   - [Screenshot Inventory](#screenshot-inventory)
   - [Automated Capture Script](#automated-capture-script)
   - [Data Anonymization](#data-anonymization)
   - [Emby SPA Gotchas](#emby-spa-gotchas)
   - [ImageMagick Crop Commands](#imagemagick-crop-commands)
   - [Retaking Screenshots](#retaking-screenshots)
10. [Reference Links](#10-reference-links)

---

## 1. Prerequisites and Dev Environment Setup

### Required Software

| Tool | Version | Purpose |
|------|---------|---------|
| .NET SDK | 6.0 or later | Compiles the project (target is .NET Standard 2.0) |
| Emby Server | 4.8.x | Runtime host -- required for manual testing |
| Node.js | 22.x (LTS) | JS minification in Release builds |
| npm | Bundled with Node.js | Installs rollup/terser for the minification pipeline |
| Git | Any modern version | Source control |

The plugin targets **.NET Standard 2.0** so it can load into Emby Server's runtime.
Any modern .NET SDK (6, 7, 8, or 9) can compile it.

### Building the Plugin

```bash
# From the repository root
dotnet restore segment_reporting/segment_reporting.csproj
dotnet build segment_reporting/segment_reporting.csproj -c Release
```

The compiled DLL is written to `segment_reporting/bin/Release/netstandard2.0/segment_reporting.dll`.

**Debug builds** skip JS minification. **Release builds** run a three-step MSBuild
pipeline (`NpmInstall` -> `MinifyJS` -> `RestoreJS`) that minifies every `.js` file
in `Pages/` before compilation and restores the originals afterward. This requires
Node.js to be installed. See the [CI/CD Pipeline](#7-cicd-pipeline) section for details.

If you only need to iterate on C# code, use `Debug` configuration to skip the
Node.js dependency:

```bash
dotnet build segment_reporting/segment_reporting.csproj -c Debug
```

### Deploying to Emby for Testing

1. Build the DLL (Debug or Release).
2. Copy `segment_reporting.dll` into your Emby Server plugins directory:
   - **Windows:** `C:\ProgramData\Emby-Server\programdata\plugins`
   - **Linux:** `/opt/emby-server/programdata/plugins` (varies by installation)
3. Restart Emby Server.
4. Navigate to **Settings > Plugins** to confirm "Segment Reporting" appears.
5. Run the initial sync: **Settings > Scheduled Tasks > Sync Segments > Run Now**.

There are no automated tests. The plugin depends on Emby Server internals that
cannot be mocked outside a running server instance. All testing is manual.

### Automatic Deploy via Environment Variable

The `.csproj` includes a post-build target that copies the DLL to a plugins
directory when the `EMBY_PLUGINS_DIR` environment variable is set:

```xml
<Target Name="PostBuild" AfterTargets="PostBuildEvent"
        Condition="Exists('$(EMBY_PLUGINS_DIR)')">
  <Copy SourceFiles="$(TargetPath)" DestinationFolder="$(EMBY_PLUGINS_DIR)" />
</Target>
```

Set this once in your shell profile and every build will auto-deploy:

```bash
# Windows (PowerShell profile)
$env:EMBY_PLUGINS_DIR = "C:\ProgramData\Emby-Server\programdata\plugins"

# Linux
export EMBY_PLUGINS_DIR="/opt/emby-server/programdata/plugins"
```

---

## 2. Architecture Overview

### Design Principles

1. **Emby is the source of truth.** The plugin's SQLite database is a read-optimized
   cache. It never holds data that does not also exist in Emby's chapter system.
2. **Write-through on edits.** Every user edit writes to Emby first via
   `IItemRepository.SaveChapters()`, then updates the local cache. If the Emby
   write fails, the cache is not updated.
3. **Periodic sync keeps the cache fresh.** A scheduled task crawls all libraries
   and upserts the cache, catching any changes made outside the plugin.

### Data Flow

```text
READS
  Browser  -->  REST API (SegmentReportingAPI)  -->  SegmentRepository (SQLite)
                                                      ^
WRITES                                                |
  Browser  -->  REST API  -->  IItemRepository         |
                               (Emby chapters)  -->  update SQLite cache
                                                      ^
SYNC                                                  |
  Scheduled task  -->  ILibraryManager (all items)    |
                       IItemRepository (chapters)  -->  upsert SQLite cache
```

Reads go directly to SQLite for speed. The cache supports arbitrary SQL queries
through the Custom Query page, which is only possible because the data is
denormalized into a single flat table.

### Component Map

```text
segment_reporting/
  Plugin.cs                     Entry point, page registration, metadata
  PluginConfiguration.cs        Required by Emby SDK (currently empty)
  Properties/AssemblyInfo.cs    Version and assembly metadata

  Api/
    SegmentReportingAPI.cs      All REST endpoints (22 routes, admin-only)

  Data/
    SegmentRepository.cs        SQLite singleton -- schema, queries, upserts
    SegmentInfo.cs              Model classes (SegmentInfo, LibrarySummaryItem, etc.)
    MarkerTypes.cs              Segment type constants and helpers

  Tasks/
    TaskSyncSegments.cs         Daily sync -- crawls libraries, upserts cache
    TaskCleanSegmentDb.cs       Weekly maintenance -- VACUUM, orphan removal

  Pages/
    segment_dashboard.html/js   Dashboard with per-library coverage charts
    segment_library.html/js     Library drill-down (series list or movie list)
    segment_series.html/js      Series/season/episode detail with inline editing
    segment_custom_query.html/js  Custom SQL query editor and results table
    segment_settings.html/js    Plugin settings (theme, sync, cache management)
    segment_about.html/js       About/info page
    segment_reporting_helpers.js  Shared JS utilities (tick conversion, API, etc.)
    segment_reporting_chart.min.js  Bundled Chart.js library
```

### Key Design Decisions

**Why a denormalized single table?**

The `MediaSegments` table stores episode metadata (series name, season, library)
alongside segment tick values. This means every reporting query is a single-table
scan with no joins. It also makes the Custom Query page possible -- users can
write plain SQL without understanding a relational schema.

The tradeoff is data duplication (series name is repeated for every episode), but
the dataset is small (thousands of rows, not millions) and the sync task
rebuilds everything periodically.

**Why SQLite instead of Emby's own database?**

Emby's internal database is not directly queryable by plugins. The chapter data
is accessible only through `IItemRepository.GetChapters()`, which returns data
one item at a time. Aggregation queries (e.g., "how many episodes in library X
have intros?") would require loading every item into memory. The SQLite cache
makes these queries instant.

**Why write-through instead of cache-only?**

If edits only updated the cache, the data would be lost on the next sync or if
the cache were rebuilt. Writing to Emby first ensures the edits persist in the
source of truth. The cache update is a convenience so the UI reflects changes
immediately.

**Singleton repository pattern:** `SegmentRepository` uses a singleton pattern with a lock on the static instance.
This ensures a single SQLite connection is shared across all API requests and
scheduled tasks, avoiding file-locking issues. All database operations are
serialized through `_dbLock`.

---

## 3. SQLite Schema and Data Model

The database file is `segment_reporting.db`, stored in Emby's data directory
(typically alongside other plugin databases). The repository manages four tables.

### Tables

#### MediaSegments Table

The primary table. Each row represents one media item (episode or movie) and its
segment markers.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `Id` | INTEGER | No | Auto-increment primary key |
| `ItemId` | TEXT | No | Emby internal item ID (unique index) |
| `ItemName` | TEXT | Yes | Display name of the episode or movie |
| `ItemType` | TEXT | Yes | `"Episode"` or `"Movie"` |
| `SeriesName` | TEXT | Yes | Parent series name (null for movies) |
| `SeriesId` | TEXT | Yes | Emby series ID (null for movies) |
| `SeasonName` | TEXT | Yes | Parent season name (null for movies) |
| `SeasonId` | TEXT | Yes | Emby season ID (null for movies) |
| `SeasonNumber` | INT | Yes | Season number (null for movies) |
| `EpisodeNumber` | INT | Yes | Episode number within season (null for movies) |
| `LibraryName` | TEXT | Yes | Name of the containing Emby library |
| `LibraryId` | TEXT | Yes | Emby library ID |
| `IntroStartTicks` | BIGINT | Yes | Intro start position in ticks |
| `IntroEndTicks` | BIGINT | Yes | Intro end position in ticks |
| `CreditsStartTicks` | BIGINT | Yes | Credits start position in ticks |
| `HasIntro` | INT | No | 1 if either IntroStartTicks or IntroEndTicks is set |
| `HasCredits` | INT | No | 1 if CreditsStartTicks is set |

#### SyncStatus Table

Single-row table tracking the most recent sync operation.

| Column | Type | Description |
|--------|------|-------------|
| `Id` | INTEGER | Always 1 (primary key) |
| `LastFullSync` | DATETIME | Timestamp of last completed sync |
| `ItemsScanned` | INT | Number of items processed in last sync |
| `SyncDuration` | INT | Duration of last sync in milliseconds |

#### UserPreferences Table

Key-value store for display preferences set through the Settings page.

| Column | Type | Description |
|--------|------|-------------|
| `Key` | TEXT | Preference name (primary key) |
| `Value` | TEXT | Preference value |

#### SavedQueries Table

User-saved custom SQL queries.

| Column | Type | Description |
|--------|------|-------------|
| `Id` | INTEGER | Auto-increment primary key |
| `QueryName` | TEXT | Display name for the saved query |
| `QuerySql` | TEXT | The SQL statement |
| `CreatedDate` | DATETIME | Timestamp (defaults to `CURRENT_TIMESTAMP`) |

### Indexes

```sql
CREATE UNIQUE INDEX idx_segments_itemid  ON MediaSegments(ItemId);
CREATE INDEX idx_segments_library        ON MediaSegments(LibraryId);
CREATE INDEX idx_segments_series         ON MediaSegments(SeriesId);
CREATE INDEX idx_segments_season         ON MediaSegments(SeasonId);
CREATE INDEX idx_segments_missing        ON MediaSegments(HasIntro, HasCredits);
```

The unique index on `ItemId` is critical -- it powers the `INSERT ... ON CONFLICT`
upsert pattern used by the sync task.

### Schema Migration

The plugin handles schema changes without requiring users to delete their database.
On startup, `SegmentRepository.Initialize()` creates the table if it does not
exist, then calls `CheckMigration()`:

1. Read existing columns via `PRAGMA table_info('MediaSegments')`.
2. Compare against a dictionary of required columns.
3. For any missing column, execute `ALTER TABLE MediaSegments ADD COLUMN ...`.

This approach is append-only -- columns can be added but not removed or renamed.
If a destructive migration is ever needed, the `force_rescan` API endpoint drops
and recreates the table.

### Segment Types

Defined in `Data/MarkerTypes.cs`:

| Constant | Column | Description |
|----------|--------|-------------|
| `IntroStart` | `IntroStartTicks` | Beginning of the intro segment |
| `IntroEnd` | `IntroEndTicks` | End of the intro segment |
| `CreditsStart` | `CreditsStartTicks` | Beginning of the credits segment |

These are the three marker types that Emby's chapter system currently supports
for media segments. The `MarkerTypes.Valid` set is used throughout the codebase
to validate input.

The column name for a marker type is always `{MarkerType}Ticks` (e.g.,
`IntroStartTicks`). This convention is enforced by `MarkerTypes.GetColumnName()`.

### Tick Format

Time positions are stored as **ticks** (a .NET `TimeSpan` tick = 100 nanoseconds).

| Value | Equivalent |
|-------|------------|
| 10,000,000 | 1 second |
| 600,000,000 | 1 minute |
| 36,000,000,000 | 1 hour |

The UI displays ticks in `HH:MM:SS.fff` format. Conversion helpers are in
`Pages/segment_reporting_helpers.js`:

- `ticksToTime(ticks)` -- converts ticks to `HH:MM:SS.fff` string
- `timeToTicks(str)` -- parses `HH:MM:SS.fff` (or `MM:SS.fff`) back to ticks

### Movies vs Episodes

Both media types share the same `MediaSegments` table. The `ItemType` column
distinguishes them:

- **Episodes:** All columns populated. `SeriesName`, `SeriesId`, `SeasonName`,
  `SeasonId`, `SeasonNumber`, and `EpisodeNumber` contain parent metadata.
- **Movies:** Series/season columns are `NULL`. `ItemName` holds the movie title.

The `LibraryName` and `LibraryId` columns are always populated for both types.
Reporting queries use `ItemType` to branch between series-based aggregation
(group by series, then season) and flat movie lists.

---

## 4. API Reference

### API Overview

All endpoints are defined in `Api/SegmentReportingAPI.cs`. Every route:

- Lives under the `/segment_reporting/` prefix
- Requires admin authentication (`[Authenticated(Roles = "admin")]`)
- Returns JSON

**Base URL pattern:** `http(s)://<host>:<port>/emby/segment_reporting/<endpoint>`

**Authentication:** Pass an admin API key via the `X-Emby-Token` header or the
`api_key` query parameter.

```bash
# Header authentication (preferred)
curl -H "X-Emby-Token: YOUR_API_KEY" \
  "http://localhost:8096/emby/segment_reporting/library_summary"

# Query parameter authentication
curl "http://localhost:8096/emby/segment_reporting/library_summary?api_key=YOUR_API_KEY"
```

**Common error response format:**

```json
{ "error": "Description of what went wrong" }
```

**Common success response format (for write operations):**

```json
{ "success": true }
```

**Bulk operation response format:**

```json
{ "succeeded": 5, "failed": 1, "errors": ["12345/IntroStart: Item not found"] }
```

**Limits:** Bulk operations accept a maximum of 500 items per request.

---

### Browsing Endpoints

These endpoints power the drill-down navigation: Dashboard -> Library -> Series
-> Season -> Episodes.

#### GET /segment_reporting/library_summary

Returns per-library coverage statistics for the dashboard.

**Parameters:** None

**Response:** Array of library summary objects.

```json
[
  {
    "LibraryId": "abc123",
    "LibraryName": "TV Shows",
    "TotalItems": 1200,
    "WithIntro": 800,
    "WithCredits": 600,
    "WithBoth": 500,
    "WithNeither": 300,
    "ContentType": "series"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `LibraryId` | string | Emby library ID |
| `LibraryName` | string | Display name |
| `TotalItems` | int | Total episodes/movies in library |
| `WithIntro` | int | Items with at least one intro marker |
| `WithCredits` | int | Items with a credits marker |
| `WithBoth` | int | Items with both intro and credits |
| `WithNeither` | int | Items with no markers at all |
| `ContentType` | string | `"series"`, `"movies"`, or `"mixed"` |

```bash
curl -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/library_summary"
```

---

#### GET /segment_reporting/series_list

Returns series and/or movies in a library with coverage stats. The response
shape depends on the library's content type.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `libraryId` | string | Yes | Emby library ID |
| `search` | string | No | Filter by name (substring match) |
| `filter` | string | No | Comma-separated: `missing_intro`, `missing_credits` |

**Response:**

```json
{
  "contentType": "series",
  "series": [
    {
      "SeriesId": "def456",
      "SeriesName": "Breaking Bad",
      "TotalEpisodes": 62,
      "WithIntro": 60,
      "WithCredits": 55
    }
  ],
  "movies": null
}
```

For movie libraries, `series` is null and `movies` contains an array of
`SegmentInfo` objects. For mixed libraries, both arrays are populated.

**Errors:**

| Condition | Response |
|-----------|----------|
| Missing `libraryId` | `{ "error": "libraryId is required" }` |

```bash
curl -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/series_list?libraryId=abc123&search=breaking"
```

---

#### GET /segment_reporting/season_list

Returns seasons for a series with coverage stats.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `seriesId` | string | Yes | Emby series ID |

**Response:** Array of season summary objects.

```json
[
  {
    "SeasonId": "ghi789",
    "SeasonName": "Season 1",
    "SeasonNumber": 1,
    "SeriesName": "Breaking Bad",
    "LibraryId": "abc123",
    "TotalEpisodes": 7,
    "WithIntro": 7,
    "WithCredits": 5
  }
]
```

**Errors:**

| Condition | Response |
|-----------|----------|
| Missing `seriesId` | `{ "error": "seriesId is required" }` |

```bash
curl -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/season_list?seriesId=def456"
```

---

#### GET /segment_reporting/episode_list

Returns episodes with full segment tick values. Can be queried by season or by
series (for a flat all-episodes view).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `seasonId` | string | No* | Emby season ID |
| `seriesId` | string | No* | Emby series ID (flat view across all seasons) |

*At least one is required. If `seasonId` is provided, it takes precedence. The
literal strings `"null"` and `"undefined"` are treated as null (to handle
JavaScript's `encodeURIComponent(null)`).*

**Response:** Array of `SegmentInfo` objects.

```json
[
  {
    "Id": 42,
    "ItemId": "12345",
    "ItemName": "Pilot",
    "ItemType": "Episode",
    "SeriesName": "Breaking Bad",
    "SeriesId": "def456",
    "SeasonName": "Season 1",
    "SeasonId": "ghi789",
    "SeasonNumber": 1,
    "EpisodeNumber": 1,
    "LibraryName": "TV Shows",
    "LibraryId": "abc123",
    "IntroStartTicks": 50000000,
    "IntroEndTicks": 900000000,
    "CreditsStartTicks": 35000000000,
    "HasIntro": 1,
    "HasCredits": 1
  }
]
```

**Errors:**

| Condition | Response |
|-----------|----------|
| Neither parameter provided | `{ "error": "Either seasonId or seriesId is required" }` |
| Null `seasonId` without `seriesId` | Empty array (safety guard) |

```bash
# By season
curl -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/episode_list?seasonId=ghi789"

# Flat view for entire series
curl -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/episode_list?seriesId=def456"
```

---

### Single-Item Endpoints

#### GET /segment_reporting/item_segments

Returns segment detail for a single item (episode or movie).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | Yes | Emby item ID |

**Response:** A single `SegmentInfo` object (same shape as the episode_list
items above).

**Errors:**

| Condition | Response |
|-----------|----------|
| Missing `itemId` | `{ "error": "itemId is required" }` |
| Item not in cache | `{ "error": "Item not found" }` |

```bash
curl -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/item_segments?itemId=12345"
```

---

### Edit Endpoints

These endpoints write through to Emby first, then update the SQLite cache.

#### POST /segment_reporting/update_segment

Updates or adds a single segment marker on one item.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `ItemId` | string | Yes | Emby item ID |
| `MarkerType` | string | Yes | `IntroStart`, `IntroEnd`, or `CreditsStart` |
| `Ticks` | long | Yes | Timestamp in ticks (must be >= 0) |

**Response:**

```json
{ "success": true }
```

**Errors:**

| Condition | Response |
|-----------|----------|
| Missing `ItemId` | `{ "error": "itemId is required" }` |
| Invalid `MarkerType` | `{ "error": "Invalid markerType: BadValue" }` |
| Negative ticks | `{ "error": "ticks must be non-negative" }` |
| Emby write failure | `{ "error": "<exception message>" }` |

**Write-through behavior:** Loads the item's chapter list from Emby, updates or
adds the matching `MarkerType` entry, saves back via
`IItemRepository.SaveChapters()`, then updates `MediaSegments` in SQLite.

```bash
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/update_segment?ItemId=12345&MarkerType=IntroStart&Ticks=50000000"
```

---

#### POST /segment_reporting/delete_segment

Removes a single segment marker from an item.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `ItemId` | string | Yes | Emby item ID |
| `MarkerType` | string | Yes | `IntroStart`, `IntroEnd`, or `CreditsStart` |

**Response:**

```json
{ "success": true }
```

**Errors:**

| Condition | Response |
|-----------|----------|
| Missing `ItemId` | `{ "error": "itemId is required" }` |
| Invalid `MarkerType` | `{ "error": "Invalid markerType: BadValue" }` |
| Emby write failure | `{ "error": "<exception message>" }` |

**Write-through behavior:** Loads the item's chapter list from Emby, removes the
matching `MarkerType` entry, saves back, then sets the corresponding tick column
to NULL in SQLite and recalculates `HasIntro`/`HasCredits`.

```bash
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/delete_segment?ItemId=12345&MarkerType=CreditsStart"
```

---

### Bulk Operation Endpoints

All bulk endpoints cap at **500 items per request** (`MaxBulkItems`). They
process items individually, collecting successes and failures rather than
rolling back on error.

#### POST /segment_reporting/bulk_apply

Copies segment markers from a source item to one or more target items.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `SourceItemId` | string | Yes | Item ID to copy markers from |
| `TargetItemIds` | string | Yes | Comma-separated target item IDs |
| `MarkerTypes` | string | Yes | Comma-separated: `IntroStart`, `IntroEnd`, `CreditsStart` |

**Response:**

```json
{ "succeeded": 10, "failed": 1, "errors": ["99999/IntroStart: Item not found: 99999"] }
```

**Behavior:** For each target item and marker type combination, reads the source
item's tick value from the cache, then writes it through to Emby and updates the
cache. Skips marker types where the source has no value (null ticks).

**Errors:**

| Condition | Response |
|-----------|----------|
| Missing `SourceItemId` | `{ "error": "sourceItemId is required" }` |
| Missing `TargetItemIds` | `{ "error": "targetItemIds is required" }` |
| Missing `MarkerTypes` | `{ "error": "markerTypes is required" }` |
| Too many targets | `{ "error": "Maximum 500 items per batch" }` |
| Invalid marker type | `{ "error": "Invalid markerType: BadValue" }` |
| Source not in cache | `{ "error": "Source item not found in cache" }` |

```bash
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/bulk_apply?SourceItemId=12345&TargetItemIds=12346,12347,12348&MarkerTypes=IntroStart,IntroEnd"
```

---

#### POST /segment_reporting/bulk_delete

Removes segment markers from multiple items.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `ItemIds` | string | Yes | Comma-separated item IDs |
| `MarkerTypes` | string | Yes | Comma-separated: `IntroStart`, `IntroEnd`, `CreditsStart` |

**Response:**

```json
{ "succeeded": 5, "failed": 0, "errors": [] }
```

**Behavior:** For each item and marker type combination, removes the chapter
entry from Emby and sets the tick column to NULL in SQLite.

**Errors:**

| Condition | Response |
|-----------|----------|
| Missing `ItemIds` | `{ "error": "itemIds is required" }` |
| Missing `MarkerTypes` | `{ "error": "markerTypes is required" }` |
| Too many items | `{ "error": "Maximum 500 items per batch" }` |
| Invalid marker type | `{ "error": "Invalid markerType: BadValue" }` |

```bash
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/bulk_delete?ItemIds=12345,12346&MarkerTypes=IntroStart,IntroEnd,CreditsStart"
```

---

#### POST /segment_reporting/bulk_set_credits_end

Sets `CreditsStart` to each item's runtime minus an offset. Useful for batch-
setting credits markers at a fixed distance from the end of episodes.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `ItemIds` | string | Yes | Comma-separated item IDs |
| `OffsetTicks` | long | No | Offset from end in ticks (default 0) |

**Response:**

```json
{ "succeeded": 10, "failed": 2, "errors": ["99999: Item not found", "88888: No runtime available"] }
```

**Behavior:** For each item, looks up `RunTimeTicks` from Emby's library manager.
Calculates `CreditsStartTicks = RunTimeTicks - OffsetTicks` (clamped to 0).
Writes through to Emby and updates the cache.

**Errors (per-item):**

| Condition | Error string |
|-----------|-------------|
| Item not found in Emby | `"<itemId>: Item not found"` |
| Item has no runtime | `"<itemId>: No runtime available"` |

**Errors (request-level):**

| Condition | Response |
|-----------|----------|
| Missing `ItemIds` | `{ "error": "itemIds is required" }` |
| Too many items | `{ "error": "Maximum 500 items per batch" }` |

```bash
# Set credits at exactly the end of runtime (offset = 0)
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/bulk_set_credits_end?ItemIds=12345,12346&OffsetTicks=0"

# Set credits 2 minutes before the end (offset = 1,200,000,000 ticks)
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/bulk_set_credits_end?ItemIds=12345,12346&OffsetTicks=1200000000"
```

---

### Sync and Cache Endpoints

#### POST /segment_reporting/sync_now

Triggers an immediate full sync by queuing the `TaskSyncSegments` scheduled task.

**Parameters:** None

**Response:**

```json
{ "success": true, "message": "Sync task queued" }
```

The sync runs asynchronously. Use `sync_status` to check when it completes.

**Errors:**

| Condition | Response |
|-----------|----------|
| Task manager failure | `{ "error": "<exception message>" }` |

```bash
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/sync_now"
```

---

#### GET /segment_reporting/sync_status

Returns information about the most recent sync.

**Parameters:** None

**Response (after sync):**

```json
{
  "lastFullSync": "2026-02-09T02:00:00.000",
  "itemsScanned": 1200,
  "syncDuration": 4500
}
```

**Response (before first sync):**

```json
{
  "lastFullSync": null,
  "itemsScanned": 0,
  "syncDuration": 0,
  "message": "No sync has been performed yet"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `lastFullSync` | datetime/null | UTC timestamp of last completed sync |
| `itemsScanned` | int | Number of items processed |
| `syncDuration` | int | Duration in milliseconds |
| `message` | string | Only present when no sync has occurred |

```bash
curl -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/sync_status"
```

---

#### POST /segment_reporting/force_rescan

Drops and rebuilds the entire cache from scratch. **Destructive** -- all cached
data is deleted before the sync task is queued.

**Parameters:** None

**Response:**

```json
{ "success": true, "message": "Cache dropped and sync task queued" }
```

**Behavior:** Calls `SegmentRepository.DeleteAllData()` which drops and recreates
the `MediaSegments` and `SyncStatus` tables, then queues `TaskSyncSegments`.

**Errors:**

| Condition | Response |
|-----------|----------|
| Any failure | `{ "error": "<exception message>" }` |

```bash
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/force_rescan"
```

---

#### GET /segment_reporting/cache_stats

Returns cache size information and last sync details.

**Parameters:** None

**Response:**

```json
{
  "rowCount": 1200,
  "dbFileSize": 524288,
  "lastFullSync": "2026-02-09T02:00:00.000",
  "itemsScanned": 1200,
  "syncDuration": 4500
}
```

| Field | Type | Description |
|-------|------|-------------|
| `rowCount` | int | Number of rows in MediaSegments |
| `dbFileSize` | long | Size of `segment_reporting.db` in bytes |
| `lastFullSync` | datetime/null | UTC timestamp of last sync |
| `itemsScanned` | int | Items processed in last sync |
| `syncDuration` | int | Last sync duration in milliseconds |

```bash
curl -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/cache_stats"
```

---

### Custom Query Endpoints

#### POST /segment_reporting/submit_custom_query

Executes a read-only SQL query against the SQLite cache. Only `SELECT`, `PRAGMA`,
and `EXPLAIN` statements are allowed.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | Yes | SQL statement to execute |

**Response (success):**

```json
{
  "Columns": ["ItemName", "SeriesName", "HasIntro"],
  "Rows": [
    ["Pilot", "Breaking Bad", "1"],
    ["Cat's in the Bag...", "Breaking Bad", "1"]
  ],
  "Message": "2 row(s) returned"
}
```

**Response (rejected query):**

```json
{
  "Columns": [],
  "Rows": [],
  "Message": "Only SELECT, PRAGMA, and EXPLAIN queries are allowed"
}
```

**Response (SQL error):**

```json
{
  "Columns": [],
  "Rows": [],
  "Message": "Error: no such column: bogus"
}
```

All values in `Rows` are returned as strings (or null). The caller is
responsible for type conversion.

**Errors:**

| Condition | Response |
|-----------|----------|
| Missing/empty query | `{ "error": "query is required" }` |
| Non-SELECT statement | Message: `"Only SELECT, PRAGMA, and EXPLAIN queries are allowed"` |

```bash
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/submit_custom_query?query=SELECT%20COUNT(*)%20FROM%20MediaSegments"
```

---

#### GET /segment_reporting/canned_queries

Returns the list of built-in example queries for the Custom Query page.

**Parameters:** None

**Response:**

```json
[
  { "name": "All movies missing intros", "sql": "SELECT * FROM MediaSegments WHERE ItemType = 'Movie' AND HasIntro = 0" },
  { "name": "All movies missing credits", "sql": "SELECT * FROM MediaSegments WHERE ItemType = 'Movie' AND HasCredits = 0" },
  { "name": "All episodes missing intros", "sql": "SELECT * FROM MediaSegments WHERE ItemType = 'Episode' AND HasIntro = 0" },
  { "name": "All episodes missing credits", "sql": "SELECT * FROM MediaSegments WHERE ItemType = 'Episode' AND HasCredits = 0" },
  { "name": "Longest intros", "sql": "SELECT ItemName, SeriesName, (IntroEndTicks - IntroStartTicks) / 10000000.0 AS DurationSec FROM MediaSegments WHERE HasIntro = 1 ORDER BY DurationSec DESC LIMIT 50" },
  { "name": "Coverage summary by library", "sql": "SELECT LibraryName, COUNT(*) AS Total, SUM(HasIntro) AS WithIntro, SUM(HasCredits) AS WithCredits FROM MediaSegments GROUP BY LibraryName" }
]
```

```bash
curl -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/canned_queries"
```

---

### Saved Query Endpoints

#### GET /segment_reporting/saved_queries

Returns all user-saved custom queries.

**Parameters:** None

**Response:**

```json
[
  {
    "id": 1,
    "name": "My custom query",
    "sql": "SELECT * FROM MediaSegments WHERE HasIntro = 0",
    "createdDate": "2026-02-09 12:00:00"
  }
]
```

```bash
curl -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/saved_queries"
```

---

#### POST /segment_reporting/saved_queries

Creates or updates a saved query. If `id` is provided and > 0, the existing
query with that ID is updated. Otherwise a new query is created.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | Yes | Display name for the query |
| `sql` | string | Yes | SQL statement |
| `id` | long | No | Existing query ID to update |

**Response (new):**

```json
{ "success": true, "id": 5 }
```

**Response (update):**

```json
{ "success": true, "id": 3 }
```

```bash
# Create new
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/saved_queries?name=Missing%20All&sql=SELECT%20*%20FROM%20MediaSegments%20WHERE%20HasIntro%3D0%20AND%20HasCredits%3D0"

# Update existing
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/saved_queries?id=5&name=Updated%20Name&sql=SELECT%20COUNT(*)%20FROM%20MediaSegments"
```

---

#### DELETE /segment_reporting/saved_queries/{Id}

Deletes a saved query by ID.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Id` | long | Yes | Query ID (path parameter) |

**Response:**

```json
{ "success": true }
```

```bash
curl -X DELETE -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/saved_queries/5"
```

---

### Preferences Endpoints

#### GET /segment_reporting/preferences

Returns all display preferences as a key-value map.

**Parameters:** None

**Response:**

```json
{
  "chartPalette": "default",
  "customColorBoth": "#4caf50",
  "customColorIntro": "#2196f3",
  "customColorCredits": "#ff9800",
  "customColorNone": "#f44336",
  "tableGridlines": "true",
  "tableStripedRows": "true",
  "hideMovieLibraries": "false",
  "hideMixedLibraries": "false"
}
```

All values are strings. The response only contains keys that have been
explicitly set; missing keys should be treated as defaults by the caller.

```bash
curl -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/preferences"
```

---

#### POST /segment_reporting/preferences

Saves display preferences. Only non-null parameters are written; omitted
parameters are left unchanged.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `chartPalette` | string | No | Palette name, `"auto"`, or `"custom"` |
| `customColorBoth` | string | No | Hex color for "Both Segments" chart slice |
| `customColorIntro` | string | No | Hex color for "Intro Only" chart slice |
| `customColorCredits` | string | No | Hex color for "Credits Only" chart slice |
| `customColorNone` | string | No | Hex color for "No Segments" chart slice |
| `tableGridlines` | string | No | `"true"` or `"false"` -- show table gridlines |
| `tableStripedRows` | string | No | `"true"` or `"false"` -- alternating row colors |
| `hideMovieLibraries` | string | No | `"true"` or `"false"` -- hide movie libraries from dashboard |
| `hideMixedLibraries` | string | No | `"true"` or `"false"` -- hide mixed libraries from dashboard |

**Response:**

```json
{ "success": true }
```

```bash
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/preferences?chartPalette=custom&customColorBoth=%234caf50&tableGridlines=true"
```

---

### Info Endpoints

#### GET /segment_reporting/plugin_info

Returns the plugin name, version, and description.

**Parameters:** None

**Response:**

```json
{
  "name": "Segment Reporting",
  "version": "1.0.0.0",
  "description": "Caches and reports on media segment markers (Intros, Credits) with interactive charts, inline editing, and bulk management."
}
```

```bash
curl -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/plugin_info"
```

---

## 5. Web UI Development Guide

The plugin embeds six HTML pages into the compiled DLL. Emby serves them at
runtime through its configuration page system. This section explains how the
page system works, how to modify existing pages, and how to add new ones.

### Page Architecture

Emby plugins deliver web UI through **embedded resources** -- HTML and JS files
compiled into the DLL. At runtime, Emby's web server exposes these files at
URLs derived from the plugin's page registration.

Each page consists of two files:

1. **An HTML file** -- the markup and layout. It must contain a root `<div>`
   with the `data-controller` attribute pointing to the JS module.
2. **A JS file** -- the behavior. It is loaded as an AMD module (using
   `define()`) and receives the page's DOM element.

**The `data-controller` pattern:** Emby uses a `data-controller` attribute on the root `<div>` of each page to
specify which JS module controls it. The convention for plugin pages is:

```html
<div id="segmentDashboardPage"
     data-role="page"
     class="page type-interior pluginConfigurationPage"
     data-require="emby-button"
     data-controller="__plugin/segment_dashboard.js">
```

| Attribute | Purpose |
|-----------|---------|
| `id` | Unique identifier for the page element |
| `data-role="page"` | Tells Emby this is a full page |
| `class="page type-interior pluginConfigurationPage"` | Standard Emby page classes |
| `data-require` | Emby components to load before the page (e.g., `emby-button`) |
| `data-controller` | Path to the AMD module. `__plugin/` is a virtual prefix Emby resolves to the plugin's embedded resources |

**AMD module loading:** Each JS file uses the AMD `define()` pattern. The module declares its
dependencies (typically just the shared helpers file), and returns a function
that Emby calls with the page's root DOM element:

```javascript
define([Dashboard.getConfigurationResourceUrl('segment_reporting_helpers.js')],
function () {
    'use strict';

    return function (view, params) {
        // view  = the root <div> element of this page
        // params = route parameters (if any)

        var helpers = getSegmentReportingHelpers();

        // ... page logic ...
    };
});
```

`Dashboard.getConfigurationResourceUrl(name)` resolves an embedded resource
name to its runtime URL. This is how pages load the shared helpers and the
bundled Chart.js library.

---

### Embedding Resources

Files become embedded resources through two configuration points:

**1. The `.csproj` file** declares which files to embed:

```xml
<ItemGroup>
    <EmbeddedResource Include="Pages\*.html" />
    <EmbeddedResource Include="Pages\*.js" />
    <EmbeddedResource Include="thumb.png" />
</ItemGroup>
```

The wildcard patterns embed every `.html` and `.js` file under `Pages/`. New
files placed in `Pages/` are automatically included without editing the csproj.

**2. `Plugin.cs` `GetPages()`** registers each resource with Emby:

```csharp
new PluginPageInfo
{
    Name = "segment_dashboard",
    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_dashboard.html",
    EnableInMainMenu = true,
    MenuSection = "server",
    MenuIcon = "assessment",
    DisplayName = "Segment Reporting"
}
```

| Property | Purpose |
|----------|---------|
| `Name` | The name used in URLs. For HTML pages, this becomes the `name` parameter in `configurationpage?name=...`. For JS/resource files, include the file extension (e.g., `segment_dashboard.js`). |
| `EmbeddedResourcePath` | The .NET embedded resource path: `{Namespace}.Pages.{filename}` with dots replacing path separators. |
| `EnableInMainMenu` | If `true`, adds this page to Emby's server sidebar menu. Only one page (the dashboard) sets this. |
| `MenuSection` | Where the menu item appears. `"server"` places it in the server administration section. |
| `MenuIcon` | Material Design icon name for the menu item. |
| `DisplayName` | The label shown in the menu. |

**Naming convention:** The embedded resource path is constructed by replacing
path separators with dots: `segment_reporting.Pages.segment_dashboard.html`.
The namespace (`segment_reporting`) comes from `GetType().Namespace`. This must
match the csproj's `<RootNamespace>`.

Every file that needs to be accessible at runtime must be registered in
`GetPages()` -- both HTML pages and JS files. The helpers file and Chart.js
library are registered as `PluginPageInfo` entries without the menu properties.

---

### Page Lifecycle

Emby fires lifecycle events on the page's root DOM element. These events
control when pages load data, attach listeners, and clean up resources.

**Key events:**

| Event | When fired | Typical use |
|-------|-----------|-------------|
| `viewshow` | Page becomes visible (including back-navigation) | Load data, attach event listeners, initialize UI |
| `viewhide` | Page is navigated away from | Destroy charts, remove global listeners |
| `viewdestroy` | Page is removed from the DOM | Final cleanup of state |

**Standard initialization pattern:**

All pages in this plugin follow the same pattern inside `viewshow`:

```javascript
var listenersAttached = false;

view.addEventListener('viewshow', function () {
    // 1. Read URL parameters
    var libraryId = helpers.getQueryParam('libraryId');

    // 2. Attach event listeners (once only)
    if (!listenersAttached) {
        listenersAttached = true;

        view.querySelector('#btnSyncNow').addEventListener('click', handleSyncNow);
        view.querySelector('#filterDropdown').addEventListener('change', handleFilterChange);
    }

    // 3. Load preferences, then load page data
    helpers.loadPreferences().then(function () {
        loadMainData();
    });
});
```

The `listenersAttached` guard prevents duplicate event handlers when the user
navigates back to a page. Without it, each `viewshow` would add another click
handler.

**Chart cleanup pattern:**

Charts must be destroyed when the page is hidden, or they leak memory. Every
page with a Chart.js instance calls:

```javascript
helpers.registerChartCleanup(view,
    function () { return chart; },    // getter
    function (v) { chart = v; }       // setter
);
```

This registers `viewhide` and `viewdestroy` listeners that call
`chart.destroy()` and null the reference.

**Navigation between pages:**

Pages navigate to each other using `helpers.navigate(pageName, params)`:

```javascript
helpers.navigate('segment_library', {
    libraryId: lib.LibraryId,
    libraryName: lib.LibraryName
});
```

This builds a URL like `configurationpage?name=segment_library&libraryId=abc123&libraryName=TV+Shows`
and calls `Dashboard.navigate(url)`. Parameters are encoded into the URL so
that browser back/forward navigation preserves them.

The target page reads parameters with `helpers.getQueryParam(name)`, which
checks both standard query parameters and hash-based routing (Emby may use
either format depending on configuration).

---

### Shared Utilities (segment_reporting_helpers.js)

All shared logic lives in `Pages/segment_reporting_helpers.js`. Functions are
defined at global scope with a `segmentReporting` prefix (to avoid collisions
with other plugins), and are also exposed through a helper object returned by
`getSegmentReportingHelpers()`.

Pages access helpers like this:

```javascript
var helpers = getSegmentReportingHelpers();
helpers.ticksToTime(50000000);  // "00:00:05.000"
```

**Function reference by category:**

#### Tick/Time Conversion

| Function | Description |
|----------|-------------|
| `ticksToTime(ticks)` | Converts ticks to `HH:MM:SS.fff` string. Returns `--:--:--.---` for null/zero. |
| `timeToTicks(str)` | Parses `HH:MM:SS.fff` string back to ticks. Returns 0 for invalid input. |
| `pad(num, size)` | Zero-pads a number to the given width. |

#### Formatting

| Function | Description |
|----------|-------------|
| `percentage(part, total)` | Returns a string like `"66.7%"`. Returns `"0.0%"` if total is 0. |
| `relativeTime(dateStr)` | Converts an ISO date string to a relative label like `"3 hours ago"` or `"Never"`. |
| `formatBytes(bytes)` | Formats byte counts as `"1.2 MB"`. |
| `formatDuration(ms)` | Formats milliseconds as `"4.5s"` or `"250ms"`. |
| `escHtml(s)` | Escapes `&`, `"`, `<`, `>` for safe HTML insertion. |

#### Navigation

| Function | Description |
|----------|-------------|
| `navigate(page, params)` | Navigates to a plugin page with URL-encoded parameters. |
| `getQueryParam(name)` | Reads a URL parameter, checking both standard and hash-based routing. |
| `clearNavParams()` | Cleans up legacy `sessionStorage` entries (params now live in the URL). |

#### API

| Function | Description |
|----------|-------------|
| `apiCall(endpoint, method, data)` | Makes a request to `/segment_reporting/{endpoint}`. GET uses `ApiClient.getJSON()`, POST uses `ApiClient.ajax()`. Returns a Promise. |
| `apiCallWithLoading(endpoint, method, data)` | Same as `apiCall` but shows/hides the Emby loading spinner and displays errors automatically. |

#### UI Feedback

| Function | Description |
|----------|-------------|
| `showLoading()` / `hideLoading()` | Show/hide Emby's global loading spinner (`Dashboard.showLoadingMsg()`). |
| `showError(message)` | Shows an error alert dialog. |
| `showSuccess(message)` | Shows a success alert dialog. |
| `withButtonLoading(btn, workingText, promise)` | Disables a button and changes its label while a Promise is pending. Restores on resolve/reject. |

#### Table and Row Helpers

| Function | Description |
|----------|-------------|
| `applyTableStyles(tableElement)` | Applies gridline and striped-row styles based on user preferences. |
| `attachHoverEffect(element, hoverBg, normalBg)` | Adds mouseenter/mouseleave handlers for hover highlighting. |
| `createEmptyRow(message, colspan)` | Creates a `<tr>` with a single centered cell for "no data" messages. |
| `renderBreadcrumbs(container, crumbs)` | Renders a breadcrumb trail. Each crumb is `{ label, page, params }`. The last crumb is rendered as plain text. |
| `renderTimestamp(ticks, itemId)` | Returns an HTML string with a clickable timestamp link that launches playback at the given position. |

#### Playback

| Function | Description |
|----------|-------------|
| `launchPlayback(itemId, positionTicks)` | Starts playback of an item at a specific tick position using Emby's `playbackManager`. |

#### Chart and Theme

| Function | Description |
|----------|-------------|
| `getThemeColors(view)` | Returns the current theme's color set (accent, text, chart palette, card backgrounds). Respects user preferences for palette selection. |
| `createSegmentChart(Chart, ctx, labels, segmentData, view, options)` | Creates a pre-configured stacked bar chart with theme-aware colors, legend, and tooltips. All chart pages use this for visual consistency. |
| `registerChartCleanup(view, getChart, setChart)` | Registers viewhide/viewdestroy handlers to destroy a Chart.js instance. |
| `generateChartPalette(accentHex)` | Auto-selects the best built-in palette based on hue distance from the accent color. |
| `getPaletteByName(name)` | Looks up a named palette from the `chartPalettes` array. |
| `detectAccentColor(view)` | Reads the background color of Emby's submit button to detect the server's accent color. Falls back to `#52b54b`. |

#### Color Conversion

| Function | Description |
|----------|-------------|
| `rgbToHex(r, g, b)` | Converts RGB values to a hex string. |
| `hexToRgb(hex)` | Parses a hex color to `{r, g, b}`. |
| `rgbToHsl(r, g, b)` | Converts RGB to `{h, s, l}`. |
| `hslToRgb(h, s, l)` | Converts HSL to `{r, g, b}`. |
| `hslToHexString(h, s, l)` | Converts HSL directly to a hex string. |

#### Preferences

| Function | Description |
|----------|-------------|
| `loadPreferences()` | Fetches preferences from the API and caches them. Returns a Promise. Subsequent calls return the cached value. |
| `invalidatePreferencesCache()` | Clears the cached preferences so the next `loadPreferences()` call re-fetches from the API. |
| `getPreference(key)` | Returns a single preference value from the cache, or null. |

#### Dropdown Menu Infrastructure

These functions provide a shared, theme-aware dropdown menu system used by
both the Series Detail and Custom Query pages. Menus detect the page's
background color to render correctly on both light and dark Emby themes.

| Function | Description |
|----------|-------------|
| `getMenuColors(viewEl)` | Returns a color set (background, border, hover, divider) by detecting the theme via DOM walking + luminance calculation. |
| `createActionsMenu(colors)` | Creates the root dropdown `<div>` with absolute positioning, border, shadow, and auto-cleanup of the parent cell's z-index on removal. |
| `createMenuItem(label, enabled, colors, onClick)` | Creates a single clickable menu item. Disabled items are dimmed and non-interactive. |
| `createMenuDivider(colors)` | Creates a horizontal divider line between menu sections. |
| `createSubmenuItem(label, subItems, anyEnabled, colors)` | Creates a menu item with a right-arrow indicator and a flyout submenu. Supports hover + click (for touch) toggling. Flips left/right if the submenu overflows the viewport. |
| `positionMenuBelowButton(menu, buttonEl)` | Appends the menu to the button's parent cell and positions it below the button, right-aligned. Elevates the parent cell's z-index to escape sticky-column stacking contexts. |
| `attachMenuCloseHandler(menu)` | Registers a click-away handler that removes the menu when clicking outside it. |
| `detectDropdownBg(viewEl)` | Walks the DOM tree upward from the view element to find the first non-transparent background color. |
| `isLightBackground(bgColor)` | Calculates relative luminance of an RGB color string to determine if the background is light (> 0.5 threshold). |

#### Bulk Operations

| Function | Description |
|----------|-------------|
| `showBulkResult(prefix, result)` | Formats and displays a success/error dialog from a bulk operation result object (`{ succeeded, failed, errors }`). |
| `bulkDelete(itemIds, markerTypes)` | Prompts for confirmation, then calls `bulk_delete` with the given item IDs and marker types. Returns a Promise. |
| `bulkSetCreditsEnd(itemIds, offsetTicks)` | Prompts for confirmation, then calls `bulk_set_credits_end`. Returns a Promise. |
| `bulkDetectCredits(items)` | Sequentially calls EmbyCredits `ProcessEpisode` for each item. Returns a Promise with aggregate results. |

#### External Plugin Integration

| Function | Description |
|----------|-------------|
| `checkCreditsDetector()` | Probes for the EmbyCredits plugin by calling its API. Returns a Promise resolving to `true` or `false`. Result is cached. |
| `creditsDetectorCall(endpoint, queryParams)` | Calls an EmbyCredits API endpoint. Returns a Promise. |

---

### Chart Integration

The plugin bundles Chart.js as `segment_reporting_chart.min.js`, an embedded
resource served alongside the page files. It is not loaded from a CDN.

**Loading Chart.js:**

Charts are loaded on demand via AMD `require()`, not at page load time:

```javascript
require([Dashboard.getConfigurationResourceUrl('segment_reporting_chart.min.js')],
function (Chart) {
    var ctx = view.querySelector('#myChart').getContext('2d');
    // ... create chart using the Chart constructor ...
});
```

This deferred loading means the Chart.js library is only fetched when a page
actually needs to render a chart.

**Using the shared chart factory:**

Most pages use `helpers.createSegmentChart()` to build a theme-aware stacked
bar chart with consistent styling:

```javascript
chart = helpers.createSegmentChart(Chart, ctx, labels,
    {
        withBoth: [50, 40],
        introOnly: [20, 30],
        creditsOnly: [10, 15],
        withNeither: [5, 15]
    },
    view,
    {
        tooltipCallbacks: { footer: function (items) { return 'Total: 100'; } },
        onClick: function (event, elements) { /* handle bar click */ },
        xTickOptions: { maxRotation: 45 }
    }
);
```

The factory reads the current theme colors (via `helpers.getThemeColors(view)`)
and configures the chart's colors, grid lines, legend, and tooltip styles
automatically. This keeps all charts visually consistent across pages.

**Custom charts:**

The series detail page (`segment_series.js`) creates its chart directly with
`new Chart(ctx, config)` instead of using the factory, because it uses a
different chart layout (side-by-side bars showing intro/credits percentages
per season rather than a stacked segment breakdown).

**Chart lifecycle:**

Every page that creates a chart must register cleanup:

```javascript
helpers.registerChartCleanup(view,
    function () { return chart; },
    function (v) { chart = v; }
);
```

And before creating a new chart (e.g., when data is reloaded), destroy the
previous instance:

```javascript
if (chart) {
    chart.destroy();
}
chart = helpers.createSegmentChart(Chart, ctx, ...);
```

---

### Adding a New Page (Step by Step)

Follow these steps to add a new page to the plugin. This example adds a
hypothetical "segment_stats" page.

**Step 1: Create the HTML file.** Create `Pages/segment_stats.html`:

```html
<div id="segmentStatsPage"
     data-role="page"
     class="page type-interior pluginConfigurationPage"
     data-require="emby-button"
     data-controller="__plugin/segment_stats.js">

    <div data-role="content">
        <div class="content-primary">

            <div class="sectionTitleContainer flex align-items-center">
                <h2 class="sectionTitle">Statistics</h2>
            </div>

            <div id="statsContent" class="verticalSection">
                <div style="text-align: center; padding: 2em;">Loading...</div>
            </div>

        </div>
    </div>

</div>
```

Key points:

- The root `id` must be unique across all plugin pages.
- `data-controller` points to `__plugin/segment_stats.js`.
- Use `data-require="emby-button"` if your page uses Emby button components.
- Wrap content in `<div data-role="content"><div class="content-primary">`.

**Step 2: Create the JS module.** Create `Pages/segment_stats.js`:

```javascript
define([Dashboard.getConfigurationResourceUrl('segment_reporting_helpers.js')],
function () {
    'use strict';

    return function (view, params) {
        var helpers = getSegmentReportingHelpers();
        var listenersAttached = false;

        function loadData() {
            helpers.apiCallWithLoading('cache_stats', 'GET')
                .then(function (data) {
                    view.querySelector('#statsContent').textContent =
                        'Rows: ' + data.rowCount;
                })
                .catch(function () {});
        }

        view.addEventListener('viewshow', function () {
            if (!listenersAttached) {
                listenersAttached = true;
                // Attach any click handlers here
            }

            helpers.loadPreferences().then(function () {
                loadData();
            });
        });
    };
});
```

Key points:

- Always load helpers as the dependency.
- Use the `listenersAttached` guard for event handlers.
- Load preferences before loading data (needed for theming).

**Step 3: Register in Plugin.cs.** Add two entries to the array returned by
`GetPages()` -- one for the HTML page and one for the JS module:

```csharp
new PluginPageInfo
{
    Name = "segment_stats",
    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_stats.html"
},
new PluginPageInfo
{
    Name = "segment_stats.js",
    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_stats.js"
}
```

If you want the page to appear in Emby's sidebar menu, add `EnableInMainMenu`,
`MenuSection`, `MenuIcon`, and `DisplayName` properties to the HTML entry.
Typically only the main dashboard page does this; other pages are navigated
to from within the plugin.

**Step 4: No csproj changes needed.** The wildcard patterns `Pages\*.html` and `Pages\*.js` in the csproj
automatically include any new files. No edit required.

**Step 5: Add a navigation link.** From an existing page, navigate to the
new page:

```javascript
helpers.navigate('segment_stats');
```

Or with parameters:

```javascript
helpers.navigate('segment_stats', { libraryId: 'abc123' });
```

**Step 6: Build and test.**

```bash
dotnet build segment_reporting/segment_reporting.csproj -c Debug
```

Copy the DLL to your Emby plugins directory and restart the server. Navigate
to the new page via the URL `configurationpage?name=segment_stats` or through
whichever button or link you added.

---

### Existing Pages Overview

The plugin ships six pages. Each page has an HTML file (layout) and a JS file
(behavior) in the `Pages/` directory.

#### segment_dashboard -- Coverage Dashboard

The main entry point. Linked from Emby's sidebar menu.

**Features:**

- Summary cards showing total items, intro/credits/both/neither percentages
- Stacked bar chart of coverage by library (clickable -- navigates to library)
- Library details table with coverage statistics and row hover navigation
- Sync status indicator with relative timestamp
- "Sync Now" button to trigger immediate cache refresh
- Conditional "Detect All Credits" button (visible only when EmbyCredits is installed)
- Navigation buttons for Custom Query, Settings, and About pages

**Patterns demonstrated:** Chart factory usage, preference-based library
filtering (hide movie/mixed libraries), EmbyCredits plugin detection.

#### segment_library -- Library Drill-Down

Shows series and/or movies within a single library.

**Features:**

- Breadcrumb navigation (Dashboard > Library Name)
- Filter dropdown (All, Complete, Missing Intros, Missing Credits, No Segments)
- Search box with 300ms debounced input
- Stacked bar chart of coverage by series or movie
- Series table with sortable columns (click headers to sort)
- Movie table with inline tick timestamps, Edit/Delete actions
- Inline editing for movies (text inputs for tick values, Save/Cancel)
- Movie segment deletion via dropdown menu

**Patterns demonstrated:** Client-side filtering and sorting, dual table
layout for mixed libraries (series + movies), inline editing with
Save/Cancel, debounced search.

#### segment_series -- Series/Season/Episode Detail

The most complex page. Shows seasons as an accordion with lazy-loaded
episode tables inside each section.

**Features:**

- Breadcrumb navigation (Dashboard > Library > Series Name)
- Season coverage bar chart (intro % and credits % per season)
- Collapsible season accordion (first season auto-expanded)
- Episode tables with checkboxes for multi-select
- Unified **Actions** dropdown per episode row (Edit, Copy submenu, Delete
  submenu, Set Credits to End, Detect Credits)
- Copy submenu with type selection: Intros / Credits / Both
- Delete submenu with grouped deletion: Intros / Credits / Both
- Type-aware bulk source banner (e.g., "Copying intros from Episode 3")
- Bulk operations: Apply Source (type-aware), Delete All Intros, Delete All
  Credits, Set All Credits to End, Detect All Credits
- Selection-aware bulk buttons (show count when items are checked)
- Per-episode, per-season, and per-series credits detection (EmbyCredits)
- Clickable timestamp links that launch playback at that position

**Patterns demonstrated:** Lazy-loading data (episodes loaded on accordion
expand), multi-select with select-all, unified Actions dropdown with
hierarchical submenus, type-aware bulk copy, bulk operations against the REST
API, external plugin integration (EmbyCredits), row-level refresh after edits.

#### segment_custom_query -- Custom SQL Query Editor

A SQL editor with a visual query builder and saved query management.

**Features:**

- SQL textarea for direct query input
- Visual query builder with conditions, groups, AND/OR connectors,
  field type-aware operators, and ORDER BY / LIMIT controls
- SQL import: the builder can parse existing SQL and populate the UI
- Unified dropdown combining built-in (canned) queries and user-saved queries
- Save / Delete / Overwrite saved queries
- Query execution with results displayed in a dynamic table
- Per-row **Actions** dropdown (Edit, Delete submenu, Set Credits to End,
  Detect Credits) — shown whenever `ItemId` is present in the result columns
- Tick columns automatically formatted as `HH:MM:SS.fff`
- CSV export of query results
- Clear button to reset the interface

**Patterns demonstrated:** Recursive descent SQL parser, dynamic form
generation (query builder), shared Actions menu infrastructure from helpers,
CSV blob export, `optgroup` usage in dropdowns.

#### segment_settings -- Plugin Settings

Configuration page for display preferences and cache management.

**Features:**

- Chart palette selector (Auto, five named palettes, Custom)
- Custom color picker panel with linked color inputs and text fields
- Live palette preview chart (updates immediately on any change)
- Table display toggles (gridlines, striped rows)
- Library visibility toggles (hide movie/mixed libraries from dashboard)
- Cache statistics display (row count, DB size, last sync, duration)
- Force Full Rescan button (drops and rebuilds the cache)
- Refresh Stats button

**Patterns demonstrated:** Two-way color picker sync (color input <-> text
input), live chart preview, `Dashboard.confirm()` for destructive actions,
preference save/load cycle with cache invalidation.

#### segment_about -- About/Info Page

Static information page with dynamic plugin version display.

**Features:**

- Plugin name, version, and description (loaded from the API)
- Acknowledgements table (playback_reporting, ChapterApi, EmbyCredits)
- External links (GitHub repo, issues, releases)
- API endpoints reference table (method, path, description)
- License information (GPL-3.0)

**Patterns demonstrated:** Minimal page with no complex state, dynamic table
rendering from a static data array, API call for plugin metadata.

---

## 6. Scheduled Tasks

Emby's task system runs background work on a configurable schedule. The plugin
registers two tasks by implementing the `IScheduledTask` interface. Emby
discovers them automatically through dependency injection -- no manual
registration is required.

### IScheduledTask Interface

Every scheduled task implements these members:

| Member | Type | Purpose |
|--------|------|---------|
| `Name` | `string` | Display name shown in Emby's Scheduled Tasks UI |
| `Key` | `string` | Unique identifier. Must not collide with other plugins |
| `Description` | `string` | Shown in the task details panel |
| `Category` | `string` | Grouping label in the UI. Both tasks use `"Segment Reporting"` |
| `GetDefaultTriggers()` | `IEnumerable<TaskTriggerInfo>` | The default schedule. Users can override this from the Emby UI |
| `Execute(CancellationToken, IProgress<double>)` | `Task` | The work to perform. Report progress (0-100) and respect cancellation |

### TaskSyncSegments -- Full Sync

**File:** `Tasks/TaskSyncSegments.cs`

**Default schedule:** Daily at 2:00 AM (`TriggerDaily`, `TimeSpan.FromHours(2)`)

**What it does:**

1. Opens (or creates) the SQLite database via `SegmentRepository.GetInstance()`
2. Queries Emby for all Episode and Movie items (`ILibraryManager.GetItemList()`)
3. For each item, reads chapter markers via `IItemRepository.GetChapters()` and
   builds a `SegmentInfo` object with denormalized metadata (library, series,
   season, episode number, tick values)
4. Upserts all segments into the cache in a single batch
   (`SegmentRepository.UpsertSegments()`)
5. Removes orphaned rows -- items that exist in the cache but are no longer in
   Emby (`SegmentRepository.RemoveOrphanedRows()`)
6. Records sync statistics (items scanned, duration) in the `SyncStatus` table

**Progress reporting:** Progress is reported every 100 items (`ProgressReportInterval`
constant). The scan phase uses 0-90%, upsert is 90-95%, orphan removal is
95-98%, and finalization is 98-100%.

**Cancellation:** The scan loop checks `cancellationToken.ThrowIfCancellationRequested()`
on every iteration, allowing clean cancellation mid-sync. The upsert method
also checks periodically during batch operations.

**Error handling:** Individual item failures (e.g., a corrupted chapter record) are
caught and logged as warnings. The sync continues with the remaining items and
reports the skip count at the end.

**Season resolution fallbacks:** For episodes, the task tries multiple strategies
to find the parent season:

1. `episode.FindParent<Season>()` -- standard Emby parent traversal
2. `item.Parent as Season` -- direct parent cast (flat library structures)
3. `episode.ParentIndexNumber` -- last resort, uses the episode's own season
   number metadata without a season entity

### TaskCleanSegmentDb -- Cache Maintenance

**File:** `Tasks/TaskCleanSegmentDb.cs`

**Default schedule:** Weekly on Sunday at 3:00 AM (`TriggerWeekly`, `DayOfWeek.Sunday`)

**What it does:**

1. Runs `VACUUM` on the SQLite database to reclaim disk space after row deletions
2. Reads cache health statistics (row count, file size, last sync timestamp)
3. Compares the cache row count against Emby's actual item count
4. Logs a health report with all statistics
5. If the divergence exceeds 5% (`DivergenceThreshold` constant), logs a warning
   suggesting a sync task run

**Progress reporting:** VACUUM is 0-50%, statistics collection is 50-90%,
divergence check is 90-100%.

### Adding a New Scheduled Task

1. Create a class implementing `IScheduledTask` in the `Tasks/` directory.
2. Accept dependencies via constructor injection (e.g., `ILibraryManager`,
   `ILogger`, `IApplicationPaths`).
3. Set `Category` to `"Segment Reporting"` so it groups with the existing tasks.
4. Implement `GetDefaultTriggers()` with an appropriate schedule.
5. Implement `Execute()` with progress reporting and cancellation support.
6. Build and deploy -- Emby discovers the task automatically.

**Trigger types available:**

| Type | Constant | Parameters |
|------|----------|------------|
| Daily | `TaskTriggerInfo.TriggerDaily` | `TimeOfDayTicks` |
| Weekly | `TaskTriggerInfo.TriggerWeekly` | `DayOfWeek`, `TimeOfDayTicks` |
| On interval | `TaskTriggerInfo.TriggerInterval` | `IntervalTicks` |
| After system event | `TaskTriggerInfo.TriggerSystemEvent` | `SystemEvent` |
| On startup | `TaskTriggerInfo.TriggerStartup` | (none) |

### Running Tasks Manually

Tasks can be triggered in three ways:

- **Emby UI:** Dashboard > Scheduled Tasks > Segment Reporting > Run button
- **Plugin UI:** The "Sync Now" button on the dashboard calls the
  `POST /segment_reporting/sync_now` endpoint, which queues `TaskSyncSegments`
- **API:** The `force_rescan` endpoint drops the cache and queues a sync

---

## 7. CI/CD Pipeline

### Workflow Overview

The CI/CD pipeline is defined in `.github/workflows/build.yml` and has two jobs:
**build** (runs on every push and PR) and **release** (runs only on version
tags).

### Build Job

Triggers on push to `main` or `develop`, and on pull requests targeting those
branches. Runs on `ubuntu-latest`.

**Steps:**

1. **Checkout** -- `actions/checkout@v4`
2. **Setup .NET** -- `actions/setup-dotnet@v4` with .NET 8.0.x
3. **Setup Node.js** -- `actions/setup-node@v4` with Node 22
4. **Install JS build tools** -- `npm ci --prefix segment_reporting`
5. **Minify JS** -- `npm run build:js --prefix segment_reporting` (esbuild
   minification of the 7 custom JS files)
6. **Restore dependencies** -- `dotnet restore Segment_Reporting.sln`
7. **Build with analyzers** -- `dotnet build` with `-warnaserror` so any
   StyleCop or analyzer warning fails the build
8. **Check code formatting** -- `dotnet format --verify-no-changes` ensures
   code style matches `.editorconfig` rules
9. **Upload artifact** -- the compiled DLL is uploaded as a build artifact

**Key point:** JS minification happens *before* `dotnet build` so the minified
files are what gets compiled into the DLL as embedded resources. The MSBuild
targets in the csproj handle this automatically for local Release builds, but
CI runs the npm scripts explicitly for clarity.

### Release Job

Triggers only when a tag matching `v*` is pushed (e.g., `git push origin v1.0.0.0`).
Depends on the build job succeeding.

**Steps:**

1. Repeats checkout, .NET/Node setup, JS minification, and build
2. Downloads the build artifact from the build job
3. **Extracts release notes** from `RELEASE_NOTES.md` using an `awk` script
   that finds the section matching the tag version
4. Appends a "Full Changelog" comparison link (current tag vs. previous tag)
5. **Creates a GitHub Release** via `softprops/action-gh-release@v2` with the
   DLL attached and the extracted release notes as the body

**Release notes extraction:** The `awk` script matches sections starting with
`## vX.Y.Z` in `RELEASE_NOTES.md`. It reads from the matching version header
until it hits the next `---` delimiter or another `## v` header. If no match
is found, it falls back to a generic message.

### JS Minification Pipeline

Release builds minify custom JS files to reduce the DLL size. The pipeline is
implemented in `scripts/build-js.mjs` and orchestrated by MSBuild targets.

**MSBuild targets in the csproj:**

| Target | Runs | Condition | Purpose |
|--------|------|-----------|---------|
| `NpmInstall` | Before `MinifyJS` | Release AND `node_modules` missing | Runs `npm ci` to install build tools |
| `MinifyJS` | Before `CoreCompile` | Release only | Runs `npm run build:js` to minify JS in-place |
| `RestoreJS` | After `Build` | Release only | Runs `npm run build:restore` to restore originals |

**How it works:**

1. **Backup** -- Original JS files are copied to `obj/js-backup/`
2. **Minify** -- esbuild transforms each file in-place (ES2015 target)
3. **Compile** -- `dotnet build` embeds the minified versions into the DLL
4. **Restore** -- Originals are copied back from backup so the working tree
   is unchanged after the build

This means `dotnet build -c Release` produces a DLL with minified JS, while
the source files in `Pages/` remain readable. Debug builds skip minification
entirely.

**npm scripts:**

| Script | Command | Purpose |
|--------|---------|---------|
| `build:js` | `node scripts/build-js.mjs minify` | Minify custom JS files |
| `build:restore` | `node scripts/build-js.mjs restore` | Restore originals from backup |
| `build:chart` | `node scripts/build-js.mjs chart` | Rebuild the custom Chart.js bundle |
| `build:thumb` | `node scripts/optimize-thumb.mjs` | Optimize the plugin thumbnail |

**Updating Chart.js:** To upgrade the bundled Chart.js version, bump the
version in `package.json`, run `npm run build:chart`, and commit the resulting
`segment_reporting_chart.min.js`. The chart build uses rollup with tree-shaking
to include only bar chart components, producing a bundle roughly 30% smaller
than the full Chart.js distribution.

### Auto-Deploy for Local Development

The csproj includes a `PostBuild` target that copies the compiled DLL to the
Emby plugins directory when the `EMBY_PLUGINS_DIR` environment variable is set:

```xml
<Target Name="PostBuild" AfterTargets="PostBuildEvent"
        Condition="Exists('$(EMBY_PLUGINS_DIR)')">
    <Copy SourceFiles="$(TargetPath)" DestinationFolder="$(EMBY_PLUGINS_DIR)" />
</Target>
```

Set this variable to your Emby plugins path (e.g.,
`C:\ProgramData\Emby-Server\plugins`) and every build will automatically deploy
the DLL. See [Automatic Deploy via Environment Variable](#automatic-deploy-via-environment-variable)
in Section 1 for setup details.

### Code Quality Enforcement

The build enforces code quality through several layers:

- **StyleCop.Analyzers** (NuGet package) -- C# style rules configured via
  `.editorconfig`. Documentation rules are disabled; naming and ordering rules
  are enforced.
- **`-warnaserror`** in CI -- any analyzer warning fails the build.
- **`dotnet format --verify-no-changes`** -- enforces consistent formatting
  (indentation, spacing, brace style) against `.editorconfig` rules.
- **`.editorconfig`** -- defines project-wide conventions: 4-space indentation,
  Allman-style braces, `_camelCase` for private fields, `PascalCase` for
  public members, `var` only when type is apparent.

### Releasing a New Version

Follow these steps to create a release:

1. Bump `AssemblyVersion` and `AssemblyFileVersion` in
   `Properties/AssemblyInfo.cs`
2. Add a release notes section to the top of `RELEASE_NOTES.md` using the
   format `## vX.Y.Z.W - Short Title`
3. Build locally to verify: `dotnet build segment_reporting/segment_reporting.csproj -c Release`
4. Commit and push all changes
5. Tag and push: `git tag vX.Y.Z.W && git push origin vX.Y.Z.W`
6. CI creates the GitHub Release automatically with the DLL and extracted
   release notes
7. Close related issues with a comment referencing the version

---

## 8. Testing

There are no automated unit tests -- Emby plugins require a running server
instance with loaded libraries to exercise the code paths. Testing is done
manually against a live Emby server using the Bruno API test collection and
direct UI interaction.

### Manual Testing Workflow

The general workflow for verifying a change is:

1. Build the plugin: `dotnet build segment_reporting/segment_reporting.csproj -c Debug`
2. Copy the DLL to your Emby plugins directory (or let the `PostBuild` target
   do it -- see [Automatic Deploy via Environment Variable](#automatic-deploy-via-environment-variable))
3. Restart Emby server
4. Run a sync (Dashboard > Scheduled Tasks > "Sync Segment Data" > Run, or use
   the "Sync Now" button on the plugin dashboard)
5. Exercise the changed functionality through the UI or API tests
6. Check Emby server logs for errors or warnings

### Bruno API Test Collection

The `bruno-tests/` directory contains a Bruno collection that covers all REST
API endpoints. Bruno is an open-source API client similar to Postman, with
test definitions stored as plain-text `.bru` files that are checked into the
repository.

#### Setup

**1. Configure the API key.** The collection uses a secret variable `apiKey`
for authentication. Set it through the Bruno environment editor, or export the
`EMBY_API_KEY` environment variable:

```bash
export EMBY_API_KEY="your-emby-admin-api-key"
```

You can find your API key in Emby under Settings > API Keys.

**2. Configure environment variables.** Open
`bruno-tests/segment-reporting-api/environments/Local.bru` and replace the
placeholder values with real IDs from your Emby server:

| Variable | Where to Find It |
|----------|-----------------|
| `baseUrl` | Your Emby server URL (default `http://localhost:8096`) |
| `sampleLibraryId` | From `library_summary` response or Emby's library settings |
| `sampleSeriesId` | From `series_list` response for a library with segments |
| `sampleSeasonId` | From `season_list` response for a series |
| `sampleItemId` | Any episode or movie ID with existing segments |
| `sampleItemId2` | A second item ID (used for bulk operations) |

**3. Open the collection** in Bruno (desktop app or VS Code extension):
navigate to `bruno-tests/segment-reporting-api`.

#### Test Organization

The collection is organized into folders matching the API categories:

| Folder | Tests | Coverage |
|--------|-------|----------|
| Browse | 10 | `library_summary`, `series_list` (with search, filter, missing params), `season_list`, `episode_list` |
| Items | 3 | `item_segments` (success, missing ID, not found) |
| Edit | 5 | `update_segment` (success, invalid marker, negative ticks), `delete_segment` (success, missing ID) |
| Bulk | 7 | `bulk_apply` (success, missing params, invalid marker), `bulk_delete`, `bulk_set_credits_end` |
| Saved Queries | 4 | Create, update, list, and delete saved queries |
| Preferences | 3 | Get, save, and save with custom colors |
| Info | 1 | `plugin_info` |
| Sync & Cache | 4 | `sync_status`, `sync_now`, `force_rescan`, `cache_stats` |
| Custom Queries | 3 | `canned_queries`, `submit_custom_query` (valid and invalid) |
| Auth | 1 | No-token request (should be rejected) |

Each `.bru` file includes inline documentation with expected responses and
acceptance criteria.

#### Recommended Test Order

Run tests in this order to build up state progressively:

1. **Sync & Cache > Get Sync Status** -- baseline check, works before first sync
2. **Sync & Cache > Sync Now** -- trigger initial sync (wait for completion
   before proceeding)
3. **Browse > Get Library Summary** -- verify libraries appear after sync
4. **Browse > Get Series List** -- verify series data for a library
5. **Items > Get Item Segments** -- verify segment data for a specific item
6. **Custom Queries > Get Canned Queries** -- verify built-in queries
7. **Custom Queries > Submit Custom Query** -- test a valid SELECT
8. **Custom Queries > Submit Custom Query - Invalid** -- verify rejection
9. **Auth > Auth Test - No Token** -- verify authentication enforcement
10. **Edit** and **Bulk** tests -- only after confirming reads work correctly
11. **Sync & Cache > Force Rescan** -- run last (destructive)

#### Destructive and Long-Running Tests

Some tests modify data or take significant time. Be aware of these before
running them:

**Destructive tests (modify Emby data):**

- **Edit > Update Segment** -- writes a segment marker to Emby's chapter
  system. Changes are permanent and will appear in the Emby player UI.
- **Edit > Delete Segment** -- removes a segment marker from Emby. The
  segment cannot be recovered without re-detection.
- **Bulk > Bulk Apply** -- copies segments from a source item to target items.
  Overwrites existing markers on the targets.
- **Bulk > Bulk Delete** -- removes segment types from multiple items at once.
- **Bulk > Bulk Set Credits End** -- sets CreditsStart on multiple items based
  on runtime minus an offset. Overwrites existing CreditsStart values.

**Destructive tests (modify cache only):**

- **Sync & Cache > Force Rescan** -- drops the entire SQLite cache and queues
  a rebuild. The cache will be empty until the sync task completes. Does not
  affect Emby's actual segment data.

**Long-running tests:**

- **Sync & Cache > Sync Now** -- queues a full library crawl. Duration depends
  on library size (a few seconds for small libraries, several minutes for
  50K+ items). The endpoint returns immediately but the task runs in the
  background.
- **Sync & Cache > Force Rescan** -- same as Sync Now but also drops the cache
  first, so the plugin returns empty results until the sync finishes.

**Safe read-only tests (no side effects):**

- All **Browse** tests -- read from the SQLite cache only
- All **Items** tests -- read from the SQLite cache only
- All **Custom Queries** tests -- read-only SQL (writes are rejected)
- All **Saved Queries** tests -- only modify the `SavedQueries` table in the
  plugin's own database, not Emby data
- All **Preferences** tests -- only modify the `UserPreferences` table in the
  plugin's own database
- **Info > Get Plugin Info** -- returns static metadata
- **Sync & Cache > Get Sync Status** / **Get Cache Stats** -- read-only
- **Auth > Auth Test** -- deliberately sends an unauthenticated request

#### Quick Smoke Test with curl

For a fast check without Bruno, run these curl commands:

```bash
export EMBY_API_KEY="your-key"

# Check sync status (safe, read-only)
curl -s -H "X-Emby-Token: $EMBY_API_KEY" \
  "http://localhost:8096/emby/segment_reporting/sync_status" | jq

# Get library summary (safe, read-only)
curl -s -H "X-Emby-Token: $EMBY_API_KEY" \
  "http://localhost:8096/emby/segment_reporting/library_summary" | jq

# Run a custom query (safe, read-only)
curl -s -X POST -H "X-Emby-Token: $EMBY_API_KEY" \
  "http://localhost:8096/emby/segment_reporting/submit_custom_query?query=SELECT%20COUNT(*)%20as%20TotalSegments%20FROM%20MediaSegments" | jq

# Verify auth enforcement (should return 401/403)
curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:8096/emby/segment_reporting/sync_status"
```

### What to Check After Changes

Depending on what was changed, verify the following:

**Backend changes (C# / API / Repository):**

- Build succeeds with `dotnet build -c Release` (includes `-warnaserror` via
  CI rules)
- `dotnet format --verify-no-changes` passes
- Run the relevant Bruno API tests
- Check Emby server logs for unexpected exceptions

**Frontend changes (JS / HTML):**

- Build succeeds (verifies JS minification works on the changed files)
- Open the affected page in a browser and check for JavaScript console errors
- Test the changed functionality manually
- Navigate away and back to the page to verify event listeners are cleaned up
  (no duplicate button clicks)
- If chart-related: verify charts render, resize, and clean up on page exit

**Schema changes (new columns / tables):**

- Start with a fresh database (delete `segment_reporting.db` or use Force
  Rescan) to verify table creation
- Start with an existing database to verify migration (`ALTER TABLE ADD`)
- Run a full sync to confirm the new columns are populated correctly

---

## 9. Screenshots

This section documents the screenshot capture process, anonymization patterns,
and cropping commands used to produce the images in `Screenshots/`.

### Screenshot Inventory

| File | Viewport | Croppable | What it shows |
|------|----------|-----------|---------------|
| `dashboard.png` | 2561x1398 | Yes | Summary cards, coverage chart, library table |
| `library-browse.png` | 2561x1398 | -- | Library drill-down with series/movie list |
| `series-detail.png` | 1460x1000 | Yes | Episode table with Actions dropdown/submenu |
| `custom-query.png` | 2561x1398 | -- | Custom query page overview |
| `query-builder.png` | 2561x1398 | Yes | Visual query builder (Match through Limit) |
| `query-autocomplete.png` | 2561x1398 | -- | Tag input autocomplete suggestions |
| `query-results.png` | 1460x1000 | Yes | Results table with Actions dropdown |
| `settings.png` | 2561x1398 | -- | Plugin settings page |
| `about.png` | 2561x1398 | -- | About/info page |

Full-page screenshots show the complete Emby interface (sidebar, header,
content). Cropped variants (generated on demand via the commands in
[ImageMagick Crop Commands](#imagemagick-crop-commands)) remove the sidebar and
focus on a specific feature. Crop files are not committed -- generate them as
needed and reference with a `*-crop.png` suffix.

### Automated Capture Script

`scripts/capture-screenshots.mjs` automates the full workflow: navigate to each
plugin page, anonymize data, open menus for feature showcase, capture full-page
screenshots, and crop.

**Prerequisites:**

```bash
npm install --no-save playwright
npx playwright install chromium
```

**Usage:**

```bash
export EMBY_API_KEY="your-admin-api-key"
export EMBY_URL="http://localhost:8096"   # optional, this is the default
node scripts/capture-screenshots.mjs
```

The script requires a running Emby server with the plugin installed and synced.
ImageMagick (`magick` CLI) must be on PATH for cropping.

### Data Anonymization

Screenshots must never contain real media library names. The capture script
applies DOM manipulation after each page loads to replace real data with
fictional names.

**Anonymization layers:**

| Layer | Technique | Fictional data source |
|-------|-----------|----------------------|
| Library names | Replace table cells and Chart.js labels | TV Shows, Movies, Documentaries, Kids TV |
| Series names | TreeWalker text replacement + consistent mapping | Crimson Meridian, Silver Horizon, Starfield Academy, ... |
| Episode names | Table cell iteration (3rd column in episode tables) | The Awakening, Shadow Protocol, Convergence, ... |
| Item IDs | Replace `data-itemid` attrs and table cells | Random 4-digit numbers |
| Chart labels | `Chart.getChart(canvas)` → update labels → `chart.update('none')` | Same mappings as above |

**Fictional series names:**

```text
Crimson Meridian, Silver Horizon, Azure Chronicle, The Phantom Gate,
Starweaver, Obsidian Legacy, Neon Prism, Shadowfall,
The Jade Compass, Iron Bloom, Crystal Vanguard, Stormlight,
Starfield Academy, Night Circuit, The Amber Throne, Echoes of Dawn
```

**Fictional episode names:**

```text
The Awakening, Shadow Protocol, Convergence, Midnight Signal,
The First Gate, Resonance, Fractured Light, Silent Accord,
Descent, The Iron Path, Catalyst, Veil of Stars,
Crossfire, The Ember Court, Undertow, Threshold,
Reckoning, Parallax, The Quiet Storm, Meridian Line,
Fulcrum, Aftermath, Obsidian Hour, The Last Signal,
Solstice, Uncharted, The Forge, Twilight Run,
Faultline, The Accord, Tempest, Zenith Point
```

### Emby SPA Gotchas

These issues affect screenshot automation and manual Playwright MCP workflows:

- **Multiple pages in DOM.** Emby's SPA keeps previously visited pages mounted.
  Always scope selectors to the specific page element
  (e.g., `#segmentDashboardPage canvas`) rather than using bare
  `document.querySelector('canvas')`.

- **Escape key triggers navigation.** Pressing Escape in the Emby SPA navigates
  back rather than closing a dialog. Never use `page.keyboard.press('Escape')`
  to dismiss dropdowns -- click outside the menu instead.

- **Scroll container is the page element.** Scrolling the page content requires
  targeting the page element itself (e.g., `#segmentSeriesPage`), not
  `document.body` or `window`.

- **Use `page.waitForTimeout()` in Playwright.** Within `browser_run_code` or
  `page.evaluate` contexts, `setTimeout` does not work as expected. Use
  Playwright's built-in `page.waitForTimeout(ms)` for delays between
  interactions.

- **`viewshow` fires after navigation.** After `page.goto()`, the plugin page
  needs time for its `viewshow` lifecycle event to fire and load data. Wait for
  the page element to be attached and add a 1--2 second delay before interacting
  with the page content.

### ImageMagick Crop Commands

These are the crop geometries for each feature-highlight screenshot. Run from
the repository root:

```bash
# Dashboard: coverage chart + library table (removes sidebar)
magick Screenshots/dashboard.png -crop 2190x1210+370+55 +repage Screenshots/dashboard-crop.png

# Series detail: episode table with Actions dropdown/submenu
magick Screenshots/series-detail.png -crop 1220x450+240+240 +repage Screenshots/series-detail-crop.png

# Query results: results table with Actions dropdown
magick Screenshots/query-results.png -crop 1220x620+240+180 +repage Screenshots/query-results-crop.png

# Query builder: Match conditions through Limit field
magick Screenshots/query-builder.png -crop 2190x990+370+170 +repage Screenshots/query-builder-crop.png
```

Crop geometry format: `WxH+X+Y` where X,Y is the top-left corner offset. These
values assume the viewport sizes listed in the Screenshot Inventory table above.
If the Emby sidebar width changes (currently ~345px at 2561-wide viewport,
~230px at 1460-wide), the X offset will need adjustment.

### Retaking Screenshots

When a UI change alters the appearance of a screenshot:

1. **Automated (preferred):** Run the capture script. It handles anonymization
   and cropping automatically.
2. **Manual via Playwright MCP:** Navigate to the page, apply anonymization via
   `browser_evaluate`, open any menus needed for the shot, then use
   `browser_take_screenshot`. Apply crops with ImageMagick afterwards.
3. **Update docs:** If the screenshot shows a feature that changed (new button,
   renamed label, different layout), update the corresponding docs (see
   Documentation Maintenance in `CLAUDE.md`).

---

## 10. Reference Links

### Upstream Projects

- **[playback_reporting](https://github.com/faush01/playback_reporting)** --
  Emby plugin for playback analytics. The primary architectural template for this
  project. Covers plugin scaffolding, SQLite patterns, REST APIs, embedded web
  pages, scheduled tasks, and chart integration. Licensed GPL-3.0.

- **[ChapterApi](https://github.com/faush01/ChapterApi)** --
  Emby plugin providing chapter/segment management. Reference implementation for
  `IItemRepository.GetChapters()` and `SaveChapters()` APIs, `MarkerType` enum,
  and `ChapterInfo` model usage. Licensed GPL-3.0.

### Emby SDK

- **[mediabrowser.server.core](https://www.nuget.org/packages/mediabrowser.server.core/)** --
  NuGet package for Emby Server SDK (version 4.8.x). Provides `IItemRepository`,
  `ILibraryManager`, `IScheduledTask`, `BasePlugin`, and other interfaces.

- **Emby Plugin SDK documentation** -- Emby does not publish standalone SDK docs.
  The best references are the source code of existing plugins (playback_reporting,
  ChapterApi) and the NuGet package's public API surface.

### SQLite

- **[SQLitePCL.pretty](https://github.com/nicholasgasior/SQLitePCL.pretty)** --
  The SQLite wrapper library used by this plugin (version 1.2.2). Provides
  `IDatabaseConnection`, `IStatement`, and `IResultSet` interfaces.

- **[SQLite Documentation](https://www.sqlite.org/docs.html)** --
  Official SQLite reference for SQL syntax, `PRAGMA` statements, WAL mode, and
  the `INSERT ... ON CONFLICT` (upsert) pattern used extensively in this plugin.

### Build Tooling

- **[rollup](https://rollupjs.org/)** -- JavaScript bundler used in the
  minification pipeline.

- **[terser](https://terser.org/)** -- JavaScript minifier invoked via rollup
  during Release builds.
