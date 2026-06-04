# Segment Reporting - Developer Guide

Developer documentation for the Segment Reporting Emby plugin. This guide covers
everything needed to build, modify, and extend the plugin -- whether you are
contributing to this project or using it as a reference for your own Emby plugin.

---


## Prerequisites and Dev Environment Setup

### Required Software

| Tool | Version | Purpose |
|------|---------|---------|
| .NET SDK | 8.0 (LTS) or newer | Compiles the project (target is .NET Standard 2.0) |
| Emby Server | 4.9.x | Runtime host -- required for manual testing |
| Node.js | 24.x (LTS) | JS minification in Release builds |
| npm | Bundled with Node.js | Installs rollup/terser for the minification pipeline |
| Git | Any modern version | Source control |

The plugin targets **.NET Standard 2.0** so it can load into Emby Server's runtime.
Any in-support .NET SDK can compile it; 8.0 is the current minimum LTS version.
Newer SDKs (9, 10, etc.) work too, and 8.0+ also runs the xUnit test suite.

### Optional Tooling

None of the tools below are needed to compile and load the plugin. They support
specific developer workflows: running the test suite, building the docs site,
refreshing screenshots, or the local git-hook gate. Install only what the
workflow you are touching requires.

| Tool | Used by | Purpose |
|------|---------|---------|
| .NET 8 runtime | `make test` (`dotnet test`) | Runs the xUnit suite. The test project targets `net8.0` with `RollForward`, so a newer runtime (9 or 10) also works; the 8.0 runtime is only needed if you have nothing newer. |
| GNU Make | every `make` target | Runs the convenience targets in the `Makefile`. CI calls the underlying commands directly, so Make itself is never required. |
| Python 3 + ProperDocs | `make docs`, `make docs-serve` | Builds and live-serves the documentation site. Install with `make docs-deps` (`pip install -r dev-requirements.txt`). |
| Playwright + Chromium | `make screenshots` | Headless browser that captures the plugin-page screenshots (`npm install --no-save playwright && npx playwright install chromium`). |
| ImageMagick (`magick`) | `make screenshots` | Crops the full-page captures into the feature-highlight images. |
| lefthook | `make hooks-install` | Installs the pre-commit and pre-push git hooks (run via `npx`; declared in `segment_reporting/package.json`). |
| gitleaks, actionlint | pre-commit hooks | Secret scanning and workflow linting. The hooks print `brew install ...` hints if either is missing. |

The git hooks are opt-in (you enable them with `make hooks-install`), but once
installed they are not optional per commit: every commit runs lefthook, which
invokes `dotnet format`, ESLint, gitleaks, and actionlint, and every push runs
the full build/format/lint gate. The `dotnet format` and ESLint steps rely on
the .NET SDK and the `npm install` you already have; gitleaks and actionlint are
the only extra installs the hooks add. You can bypass a single run with
`git commit --no-verify` / `git push --no-verify` (you are then skipping the
checks CI will still enforce).

**Agent / contributor tooling (suggested, not required):** This repo is friendly
to working with Claude Code and its plugins, but none of that is a requirement -
the build, tests, docs, and hooks all run with the standard toolchain above.
Some contributors also use claude-kit, a personal Claude Code toolkit whose
scripts are symlinked under `~/.claude/` for repo automation (safe pushing, PR
watching, CodeRabbit-budget tracking, worktree cleanup). It is a convenience
only: the `Makefile` gate and hook targets run scripts vendored in this repo
(`scripts/pre-push-gate.sh`, `scripts/check-hooks.sh`), so you never need
claude-kit or Claude Code to build, test, or contribute.

### Developer Commands (Makefile)

A `Makefile` at the repo root wraps the common dotnet / npm / properdocs / script
commands so you do not have to remember each one. Run `make help` for the list.
The Makefile is a convenience only: CI (`.github/workflows/build.yml`) invokes
the underlying commands directly, so the targets can never silently drift from
what CI runs. GNU Make is the only prerequisite, and even that is optional - you
can always run the underlying command shown below by hand.

| Target | Underlying command | Purpose |
|--------|--------------------|---------|
| `make help` | (self-documenting grep) | List every target with its description (the default target). |
| `make restore` | `dotnet restore` | Restore NuGet dependencies. |
| `make build` | `dotnet build` (Debug) | Build the solution; skips JS minification. |
| `make build-release` | `dotnet build --configuration Release` | Release build; minifies JS, so it needs Node. |
| `make test` | `dotnet test` | Run the xUnit suite (needs a .NET 8-or-newer runtime). |
| `make format` | `dotnet format` | Apply C# code formatting in place. |
| `make format-check` | `dotnet format --verify-no-changes` | Verify formatting without writing changes (matches CI). |
| `make lint` | `npm run lint:js` | ESLint the page JavaScript. |
| `make gate` | `bash scripts/pre-push-gate.sh` | Full CI-parity pre-push gate (Release build + format-check + lint). |
| `make hooks` | `bash scripts/check-hooks.sh` | Verify the git hooks are wired to lefthook. |
| `make hooks-install` | `npx lefthook install` + `fix-hooks.mjs` | Install the pre-commit and pre-push git hooks. |
| `make docs-deps` | `pip install -r dev-requirements.txt` | Install the docs toolchain (ProperDocs + Material). |
| `make docs` | `properdocs build --strict` | Build the documentation site (fails on broken links). |
| `make docs-serve` | `properdocs serve` | Serve the docs locally with live reload. |
| `make screenshots` | `node scripts/capture-screenshots.mjs` | Capture and anonymize page screenshots (needs a running Emby plus `.env`). |
| `make clean` | `dotnet clean` + remove `bin`/`obj`/`site` | Remove build output and the generated docs site. |

The UAT Emby harness ships as `make uat-deploy` / `uat-seed` / `uat-test`
(alias `bruno`) / `uat-concurrency` / `uat-clean` / `uat`, driving
`scripts/uat/*`. Fuzzing and leak detection (`make fuzz` / `leak-check`) remain
Phase 3 and ship with that work. See [UAT Emby Harness](#uat-emby-harness) below
before running any of the `uat-*` targets.

### Building the Plugin

```bash
# From the repository root
dotnet restore segment_reporting/segment_reporting.csproj
dotnet build segment_reporting/segment_reporting.csproj -c Release
```

The compiled DLL is written to `segment_reporting/bin/Release/netstandard2.0/segment_reporting.dll`.

**Reference assemblies (required):** the plugin builds against the Emby **4.10.0.13**
runtime assemblies, referenced locally from the gitignored
`segment_reporting/embylibs/` directory (NuGet has no 4.10.0.13 package, and the
old floating `mediabrowser.server.core` reference produced a 4.9-ABI DLL that fails
to load on Emby 4.10 servers). Populate `embylibs/` once before building:

```bash
mkdir -p segment_reporting/embylibs
curl -fsSL https://github.com/MediaBrowser/Emby.Releases/releases/download/4.10.0.13/emby-server-freebsd14_4.10.0.13_amd64.tar.xz -o /tmp/emby.tar.xz
tar xJf /tmp/emby.tar.xz -C /tmp --wildcards '*/MediaBrowser.Model.dll' '*/MediaBrowser.Common.dll' '*/MediaBrowser.Controller.dll' '*/Emby.Naming.dll'
find /tmp \( -name 'MediaBrowser.*.dll' -o -name 'Emby.Naming.dll' \) -exec cp {} segment_reporting/embylibs/ \;
```

The managed assemblies are AnyCPU/cross-platform, so the freebsd package works on
any OS. CI populates `embylibs/` automatically (see the [CI/CD Pipeline](#cicd-pipeline)
Build Job).

**Building the 4.9 artifact:** the build targets one Emby ABI at a time via the
`EmbyAbi` MSBuild property. The default (`EmbyAbi=4.10`) uses the local `embylibs/`
references above. Pass `-p:EmbyAbi=4.9` to build against the pinned
`mediabrowser.server.core` 4.9.1.90 NuGet package instead (no `embylibs/` needed):

```bash
dotnet build segment_reporting/segment_reporting.csproj -c Release -p:EmbyAbi=4.9
```

Each release ships both ABIs as separate zips (`segment_reporting_emby_4.9x.zip`,
`segment_reporting_emby_4.10x.zip`); a build only loads on its matching Emby line.

**Debug builds** skip JS minification. **Release builds** run a three-step MSBuild
pipeline (`NpmInstall` -> `MinifyJS` -> `RestoreJS`) that minifies every `.js` file
in `Pages/` before compilation and restores the originals afterward. This requires
Node.js to be installed. See the [CI/CD Pipeline](#cicd-pipeline) section for details.

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

Pure logic (the custom-query validators and marker-type helpers) is covered by
an xUnit suite you can run with `make test` (`dotnet test`). Anything that
touches Emby Server internals cannot be mocked outside a running server, so that
surface is still validated manually. See the [Testing](#testing) section for the
full picture.

### UAT Emby Harness

> **SAFETY WARNING -- READ FIRST.** The UAT harness is **destructive by design**:
> it writes and deletes segment markers, runs bulk operations, and creates and
> removes whole libraries. It must **only ever** target the local UAT Emby. The
> scripts read **only** `EMBY_UAT_URL` / `EMBY_UAT_API_KEY` from `.env` (never
> `EMBY_PROD_*`) and `scripts/uat/lib.sh` hard-aborts unless the target host is
> `localhost` / `127.0.0.1` / `::1`. **Never point these targets at a production Emby.**

The harness exercises the full write path that unit tests cannot reach:

```
seed media -> Emby ingest -> plugin sync -> set markers -> read reports -> assert
```

**Prerequisites:**

- **OrbStack / Docker** with the `stillwater` UAT compose project up, the
  Segment Reporting plugin installed, and the "Nfo Metadata" reader enabled.
  The harness targets the existing container named `emby` (override with the
  `CONTAINER` env var).
- **bash 4+** (the scripts use `mapfile` and `${!var}`; macOS ships bash 3.2,
  so install a newer one with `brew install bash`).
- **ffmpeg** on the host (sparse synthetic-video generation).
- **Node.js** (for the Bruno CLI via `npx @usebruno/cli`).
- **dotnet** SDK (for the `uat-deploy` Release build).
- **`.env`** populated with `EMBY_UAT_URL=http://localhost:8096` and
  `EMBY_UAT_API_KEY=<admin key>` (template in `.env.example`; `.env` is gitignored).

**Targets:**

| Target | Description |
|--------|-------------|
| `make uat-deploy` | Build the Release DLL, `docker cp` it into the container's `/config/plugins`, restart Emby, wait until healthy. |
| `make uat-seed` | Generate a rich sparse-media tree + lockdata NFOs (multiple libraries, many shows across several seasons, two movie libraries), `docker cp` into `/uat-media`, create every library from the generated manifest via the VirtualFolders API, scan, `sync_now`, write a 4-bucket marker coverage matrix derived from each item's runtime, and capture the discovered IDs into `bruno-tests/.../environments/Local.bru`. Idempotent (tears down all `SR-UAT*` libraries first). Tunable via `SR_UAT_SHOWS_PER_LIB` / `SR_UAT_MAX_SEASONS` / `SR_UAT_MAX_EPISODES` / `SR_UAT_MOVIES_PER_LIB` / `SR_UAT_DUP_ROOTS`. |
| `make uat-test` (alias `make bruno`) | Run the Bruno collection assertions against UAT (reads `apiKey` from `.env`). |
| `make uat-concurrency` | Stress `SegmentRepository` lock ordering (#66) with concurrent API workers (mixed reads plus an idempotent `/uat-media` write); fails on any request error/timeout or rowCount drift. Needs `make uat-seed` first. Tunable via `WORKERS` / `ITERATIONS` (defaults 8 / 25). Not run in CI. |
| `make uat-clean` | Delete the `SR-UAT` libraries, remove `/uat-media` in the container, and reset the captured IDs in `Local.bru` to placeholders. |
| `make uat` | Convenience chain: `uat-deploy` -> `uat-seed` -> `uat-test`. |

The synthetic media is generated as static black-frame H.264 clips (a 10-minute
clip is ~9.7 KB) that still report a true runtime, so markers sit at lifelike
offsets. Clip durations vary, and the coverage matrix derives each marker offset
from the item's `RunTimeTicks` (IntroStart 5s, IntroEnd 35s, CreditsStart 30s
before the end), so markers always land in-bounds and spread across the charts.
Because `docker cp` writes into the container's ephemeral layer, the seeded media
does not survive a container rebuild; recovery is just re-running `make uat-seed`.
The seed cycles all four `library_summary` coverage buckets (`WithBoth` /
`WithIntro` / `WithCredits` / `WithNeither`) across every episode and includes
movie libraries to exercise the null `series` / `season` code path.

`scripts/uat/gen-media.sh` is the single source of truth for the library set: it
generates the tree and writes a `libraries.tsv` manifest
(`<name>\t<collectionType>\t<containerPath>` per row) that `seed.sh` reads to
create the Emby libraries. By default it builds two TV libraries (`SR-UAT-TV`,
`SR-UAT-TV-Classics`) and two movie libraries (`SR-UAT-Movies`,
`SR-UAT-Movies-Indie`). The first TV and first movie library keep their canonical
names because `capture-ids.sh` and the Bruno environment key sample IDs off them;
the extras exist to make the dashboard show several library rows. All synthetic
libraries are named with the `SR-UAT` prefix so `delete_uat_libraries()` (in
`lib.sh`) can tear the whole set down by prefix for idempotency.

**Duplicate-root library inflation (`SR_UAT_DUP_ROOTS`, optional).** To inflate
the library count cheaply, `SR_UAT_DUP_ROOTS=N` generates one shared content tree
plus N sibling symlinks to it, registering each symlink as its own library
(`SR-UAT-Dup-1` ...). Relative symlink targets are used so they resolve under
`/uat-media` after `docker cp`. **Verified on Emby (UAT, 4.9.x):** distinct
symlink roots pointing at the same target register as separate libraries (a
`SR_UAT_DUP_ROOTS=2` run produced `SR-UAT-Dup-1` and `SR-UAT-Dup-2` as two
distinct VirtualFolders, each with its own items) - Emby does not canonicalize
the root or dedupe to the shared inode. Multiple same-content-type libraries at
genuinely distinct paths (the 4 defaults) also render separately, so no explicit
merge-disable option is needed. Default is `0` (off) since the 4 distinct-path
libraries already give the dashboard several rows.

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

## Architecture Overview

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

## SQLite Schema and Data Model

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

This approach is mostly append-only -- columns can be added via `ALTER TABLE ADD
COLUMN`.  Column removal uses `ALTER TABLE DROP COLUMN` (SQLite 3.35+) with a
fallback to nulling out values on older versions.  If a full schema reset is ever
needed, the `force_rescan` API endpoint drops and recreates the table.

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

## API Reference

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

**`GET /segment_reporting/library_summary`**{ #get-segment_reportinglibrary_summary }

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

**`GET /segment_reporting/series_list`**{ #get-segment_reportingseries_list }

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

**`GET /segment_reporting/season_list`**{ #get-segment_reportingseason_list }

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

**`GET /segment_reporting/episode_list`**{ #get-segment_reportingepisode_list }

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

**`GET /segment_reporting/item_segments`**{ #get-segment_reportingitem_segments }

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

**`POST /segment_reporting/update_segment`**{ #post-segment_reportingupdate_segment }

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

**`POST /segment_reporting/delete_segment`**{ #post-segment_reportingdelete_segment }

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

**`POST /segment_reporting/bulk_apply`**{ #post-segment_reportingbulk_apply }

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

**`POST /segment_reporting/bulk_delete`**{ #post-segment_reportingbulk_delete }

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

**`POST /segment_reporting/bulk_set_segments`**{ #post-segment_reportingbulk_set_segments }

Sets absolute tick values for up to three marker types across multiple items.
This endpoint backs both the offset-adjustment **Apply** action and the
subsequent **Undo** action. The client computes absolute target tick values;
the server does no delta math.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `ItemIds` | string | Yes | Comma-separated item IDs |
| `IntroStartTicks` | string | No | Comma-separated tick values, index-aligned to `ItemIds`. An empty token (e.g., `,,`) leaves that marker untouched for that item. Omitting the parameter entirely leaves IntroStart untouched for all items. |
| `IntroEndTicks` | string | No | Same format as `IntroStartTicks`, controls IntroEnd. |
| `CreditsStartTicks` | string | No | Same format as `IntroStartTicks`, controls CreditsStart. |

**Response:**

```json
{ "succeeded": 10, "failed": 0, "errors": [] }
```

**Behavior:** For each item and each non-empty tick token, validates that the
tick value is >= 0, then writes through to Emby via
`IItemRepository.SaveChapters()` and updates the SQLite cache. Items or tokens
that produce an error are counted in `failed` without aborting the rest.

**Server implementation helpers** (all in `Api/SegmentReportingAPI.cs`):

| Class / Method | Description |
|----------------|-------------|
| `BulkSetItem` | Plain data struct holding a parsed (ItemId, IntroStartTicks?, IntroEndTicks?, CreditsStartTicks?) tuple for one item. |
| `BulkSetParser` | Static class. Parses and validates the comma-separated tick columns from the request, aligning them to the `ItemIds` array. Returns a list of `BulkSetItem` or an error string. Validates that every non-empty token is a non-negative long. |
| `ExecuteBulkValueSet(items)` | Iterates over the parsed `BulkSetItem` list and applies each non-null tick value write-through (Emby chapters then SQLite cache). Accumulates succeeded/failed/errors and returns a bulk-result object. |

**Errors:**

| Condition | Response |
|-----------|----------|
| Missing `ItemIds` | `{ "error": "itemIds is required" }` |
| Too many items | `{ "error": "Maximum 500 items per batch" }` |
| Negative tick value | Per-item error string in `errors` array |
| Item not found | Per-item error string in `errors` array |

```bash
# Move IntroStart and IntroEnd 250 ms later for two items
curl -X POST -H "X-Emby-Token: $KEY" \
  "http://localhost:8096/emby/segment_reporting/bulk_set_segments?ItemIds=12345,12346&IntroStartTicks=52500000,52500000&IntroEndTicks=902500000,902500000"
```

---

**`POST /segment_reporting/bulk_set_credits_end`**{ #post-segment_reportingbulk_set_credits_end }

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

**`POST /segment_reporting/sync_now`**{ #post-segment_reportingsync_now }

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

**`GET /segment_reporting/sync_status`**{ #get-segment_reportingsync_status }

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

**`POST /segment_reporting/force_rescan`**{ #post-segment_reportingforce_rescan }

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

**`GET /segment_reporting/cache_stats`**{ #get-segment_reportingcache_stats }

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

**`POST /segment_reporting/submit_custom_query`**{ #post-segment_reportingsubmit_custom_query }

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

**`GET /segment_reporting/canned_queries`**{ #get-segment_reportingcanned_queries }

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

**`GET /segment_reporting/saved_queries`**{ #get-segment_reportingsaved_queries }

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

**`POST /segment_reporting/saved_queries`**{ #post-segment_reportingsaved_queries }

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

**`DELETE /segment_reporting/saved_queries/{Id}`**{ #delete-segment_reportingsaved_queriesid }

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

**`GET /segment_reporting/preferences`**{ #get-segment_reportingpreferences }

Returns all display preferences as a key-value map.

**Parameters:** None

**Response:**

```json
{
  "chartPalette": "auto",
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

**`POST /segment_reporting/preferences`**{ #post-segment_reportingpreferences }

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

**`GET /segment_reporting/plugin_info`**{ #get-segment_reportingplugin_info }

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

## Web UI Development Guide

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
| `createSegmentChart(Chart, ctx, labels, segmentData, view, options)` | Creates a pre-configured stacked bar chart with theme-aware colors, legend, and tooltips. All chart pages use this for visual consistency. Also marks the canvas as `role="img"` with a concise `aria-label` and links a visually-hidden data table via `aria-describedby` for screen readers (pass `options.ariaCaption` for the chart's accessible name). |
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

#### Timing Adjustment

These helpers implement the offset adjustment modal and the `bulk_set_segments`
call that backs both per-row and bulk apply/undo.

| Function | Description |
|----------|-------------|
| `createOffsetModal(config)` | Builds and returns the offset adjustment modal DOM element. `config` describes which marker rows to show (intro, introEnd, credits) and their current tick values. The modal renders left/right arrow buttons for each row; arrows that would produce a negative tick are disabled. |
| `showOffsetSnackbar(message, onUndo)` | Displays a transient snackbar with the given message and an **Undo** button; auto-dismisses after 12 seconds (12000 ms). Calls `onUndo()` if the user clicks Undo before it dismisses. |
| `buildBulkSetBody(items)` | Accepts an array of objects (each with `itemId`, `introStartTicks`, `introEndTicks`, `creditsStartTicks`; null means untouched) and constructs the comma-separated query-string parameters expected by `POST /segment_reporting/bulk_set_segments`. |
| `applyBulkSet(items)` | Calls `buildBulkSetBody`, posts to `bulk_set_segments`, and returns a Promise resolving to the `{ succeeded, failed, errors }` response. Used by both the single-item modal Apply path and the multi-item bulk Apply path. |

#### External Plugin Integration

| Function | Description |
|----------|-------------|
| `checkCreditsDetector()` | Probes for the EmbyCredits plugin by calling its API. Returns a Promise resolving to `true` or `false`. Result is cached. |
| `creditsDetectorCall(endpoint, queryParams)` | Calls an EmbyCredits API endpoint. Returns a Promise. |

**EmbyCredits endpoints used:**

| Endpoint | Method | Parameters | Used by |
|----------|--------|------------|---------|
| `CreditsDetector/GetAllSeries` | GET | - | `checkCreditsDetector()` (availability probe) |
| `CreditsDetector/ProcessEpisode` | POST | `ItemId` | Per-episode detect, `bulkDetectCredits()` |
| `CreditsDetector/ProcessSeries` | POST | `SeriesId` | Series-level detect button |
| `CreditsDetector/ProcessSeason` | POST | `SeriesId`, `SeasonNumber`, `SkipExistingMarkers` | Season Actions > Detect All |
| `CreditsDetector/ProcessSeasonMissingMarkers` | POST | `SeriesId`, `SeasonNumber` | Season Actions > Detect Missing |

#### Accessibility (a11y)

These helpers back the plugin's WCAG 2.1 AA support (issue #57). They let pages
announce dynamic changes to screen readers and expose chart data as an
accessible alternative.

| Function | Description |
|----------|-------------|
| `announce(view, message)` | Sends a message to the page's polite live region so screen readers read it. Used after filtering, sorting, query execution, and bulk selection. The text is cleared and re-set on a short delay so identical consecutive messages are still announced. |
| `getLiveRegion(view)` | Returns (or lazily creates) the page-level `role="status"` `aria-live="polite"` region appended to `.content-primary`. Visually hidden. |
| `describeChart(canvas, ariaLabel, describeEl)` | Marks a `<canvas>` as `role="img"` with `aria-label`, and optionally appends a visually-hidden element (typically a data table) linked via `aria-describedby`. Pass `null` for `describeEl` on purely decorative charts. |
| `buildDataTable(caption, columns, rows)` | Builds a `<table>` element (with `<caption>`, `scope="col"` headers, and `scope="row"` first cells) from plain arrays. Used as the visually-hidden screen-reader alternative for charts. |
| `describeSegmentChart(canvas, caption, labels, segmentData)` | Convenience wrapper that builds a per-category data table (Both / Intro Only / Credits Only / No Segments) and calls `describeChart`. Invoked automatically by `createSegmentChart`. |

**Conventions:**

- Each page wraps its primary content in `role="main"` with a descriptive
  `aria-label`; breadcrumb containers are `<nav aria-label="Breadcrumb">`.
- Every `<canvas>` chart has `role="img"` plus an `aria-label`, and (except for
  decorative previews) a hidden data table linked via `aria-describedby`.
- Sortable table headers use `aria-sort` (updated on sort), are keyboard
  operable (Enter/Space), and carry `scope="col"`. Data tables have an
  `sr-only` `<caption>`.
- Autocomplete inputs follow the combobox pattern (`role="combobox"`,
  `aria-expanded`, `aria-controls`, `aria-activedescendant`); the dropdown is
  `role="listbox"` with `role="option"` items. Chips expose a keyboard-operable
  remove button (`role="button"`, `aria-label="Remove ..."`).

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
- Movie table with inline tick timestamps, Edit/Adjust timing/Delete actions
- Inline editing for movies (text inputs for tick values, Save/Cancel)
- Per-row timing adjustment for movies via the offset modal
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
- Unified **Actions** dropdown per episode row (Edit, Adjust timing, Copy
  submenu, Delete submenu, Set Credits to End, Detect Credits)
- Copy submenu with type selection: Intros / Credits / Both
- Delete submenu with grouped deletion: Intros / Credits / Both
- Timing adjustment modal (per-row and bulk) via `createOffsetModal` /
  `applyBulkSet` / `showOffsetSnackbar`
- Type-aware bulk source banner (e.g., "Copying intros from Episode 3")
- Season-level **Actions** dropdown (Delete submenu, Set Credits to End,
  Adjust timing (bulk), Apply Source, Detect All/Detect Missing via
  EmbyCredits `ProcessSeason`)
- Selection-aware bulk buttons (show count when items are checked)
- Per-episode, per-series, and season-level Actions dropdown credits detection
  (EmbyCredits `ProcessSeason` / `ProcessSeasonMissingMarkers` endpoints)
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
- Per-row **Actions** dropdown (Edit, Adjust timing, Delete submenu, Set
  Credits to End, Detect Credits) - shown whenever `ItemId` is present in
  the result columns
- Bulk timing adjustment via the offset modal and `applyBulkSet`
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

## Scheduled Tasks

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

## CI/CD Pipeline

### Workflow Overview

The CI/CD pipeline is defined in `.github/workflows/build.yml` and has two jobs:
**build** (runs on every push and PR) and **release** (runs only on version
tags).

### Build Job

Triggers on push to `main` or `develop`, and on pull requests targeting those
branches. Runs on `ubuntu-latest`.

**Steps:**

1. **Checkout** -- `actions/checkout@v6` (SHA-pinned)
2. **Setup .NET** -- `actions/setup-dotnet@v5` (SHA-pinned) with .NET 8.0.x
3. **Setup Node.js** -- `actions/setup-node@v6` (SHA-pinned) with Node 24
4. **Fetch Emby 4.10.0.13 reference assemblies** -- downloads the pinned Emby
   server package and extracts `MediaBrowser.*.dll` + `Emby.Naming.dll` into
   `segment_reporting/embylibs/` (the gitignored 4.10 ABI references the build
   binds to; NuGet has no 4.10.0.13)
5. **Install JS build tools** -- `npm ci --prefix segment_reporting`
6. **Minify JS** -- `npm run build:js --prefix segment_reporting` (esbuild
   minification of the 7 custom JS files)
7. **Restore dependencies** -- `dotnet restore Segment_Reporting.sln`
8. **Build with analyzers** -- `dotnet build` with `-warnaserror` so any
   StyleCop or analyzer warning fails the build
9. **Run tests** -- `dotnet test Segment_Reporting.sln --configuration Release
   --no-build` runs the xUnit suite (see the Testing section)
10. **Check code formatting** -- `dotnet format --verify-no-changes` ensures
   code style matches `.editorconfig` rules
11. **Upload artifact** -- the compiled DLL is uploaded as a build artifact
12. **Verify 4.9 ABI also compiles** -- `dotnet build ... -p:EmbyAbi=4.9` so a PR
    that breaks the 4.9 channel fails CI (the default gate builds the 4.10 ABI)

**Key point:** JS minification happens *before* `dotnet build` so the minified
files are what gets compiled into the DLL as embedded resources. The MSBuild
targets in the csproj handle this automatically for local Release builds, but
CI runs the npm scripts explicitly for clarity.

### Documentation Site (Pages) Build

The docs site is built by `.github/workflows/pages.yml` (ProperDocs + Material).
Its Python dependencies are hash-pinned for supply-chain integrity (Scorecard
Pinned-Dependencies):

- `dev-requirements.txt` is the human-editable source (top-level pins only).
- `dev-requirements.lock` is the fully resolved, hash-pinned lock covering direct
  and transitive packages, each with one or more `--hash=sha256:...` entries. CI
  installs with `pip install --require-hashes -r dev-requirements.lock`, which
  rejects the install if any resolved package lacks a matching hash.

Regenerate the lock after editing `dev-requirements.txt`:

```bash
uv pip compile --generate-hashes --universal dev-requirements.txt -o dev-requirements.lock
# or, with pip-tools:
pip-compile --generate-hashes --allow-unsafe --output-file=dev-requirements.lock dev-requirements.txt
```

Local docs builds (`make docs-deps`) still install from `dev-requirements.txt`
for convenience; only CI enforces hashes.

### Release Job

Triggers only when a tag matching `v*` is pushed (e.g., `git push origin v1.0.0.0`).
Depends on the build job succeeding.

**Steps:**

1. Repeats checkout, .NET/Node setup, and the 4.10 reference-assembly fetch
2. **Builds both ABIs** from the same source: `-p:EmbyAbi=4.9` (NuGet 4.9.1.90)
   and `-p:EmbyAbi=4.10` (embylibs), cleaning between builds. Each compiled
   `segment_reporting.dll` is zipped under its exact install name into a labelled
   archive: `segment_reporting_emby_4.9x.zip` and `segment_reporting_emby_4.10x.zip`
3. **Creates a GitHub Release** via `softprops/action-gh-release` with both zips
   attached and `generate_release_notes: true`, so GitHub auto-generates the
   release body from the pull requests merged since the previous tag

Shipping zipped, correctly-named DLLs (rather than renamed loose `.dll` assets)
means users unzip and drop `segment_reporting.dll` straight in - no rename step.

**Release notes:** There is no `RELEASE_NOTES.md` file. GitHub generates the
release body automatically from merged PR titles/labels since the previous
tag. Write clear PR titles; polish the published body afterward with
`gh release edit <tag>` if needed.

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
| `lint:js` | `eslint Pages/*.js ...` | Lint JavaScript files |
| `prepare` | `lefthook install` | Auto-install git hooks after `npm ci` |

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
in the Prerequisites section for setup details.

### Code Quality Enforcement

The build enforces code quality through several layers:

- **StyleCop.Analyzers** (NuGet package) -- C# style rules configured via
  `.editorconfig`. Documentation rules are disabled; naming and ordering rules
  are enforced.
- **Roslynator.Analyzers** (NuGet package) -- additional C# analysis rules.
- **IDisposableAnalyzers** (NuGet package) -- IDisposable pattern correctness.
- **ESLint** (npm package) -- JavaScript linting with flat config
  (`eslint.config.mjs`). Enforces `no-undef`, `no-redeclare`, `eqeqeq`, and
  `no-unused-vars`. Run with `npm run lint:js --prefix segment_reporting`.
- **`-warnaserror`** in CI -- any analyzer warning fails the build.
- **`dotnet format --verify-no-changes`** -- enforces consistent formatting
  (indentation, spacing, brace style) against `.editorconfig` rules.
- **`.editorconfig`** -- defines project-wide conventions: 4-space indentation,
  Allman-style braces, `_camelCase` for private fields, `PascalCase` for
  public members, `var` only when type is apparent.

### Pre-commit Hooks (Lefthook)

[Lefthook](https://github.com/evilmartians/lefthook) runs checks automatically
before each commit. It is installed as a devDependency and its hooks are
activated by the `prepare` script when you run `npm ci`.

**Setup after cloning:**

```bash
cd segment_reporting
npm ci          # installs dependencies AND activates lefthook hooks
```

**What it checks (in parallel):**

| Check | Trigger | What it does |
|-------|---------|-------------|
| `dotnet-format` | Any `.cs` file staged | Verifies C# formatting matches `.editorconfig` |
| `eslint` | Any `Pages/*.js` file staged | Lints JavaScript (skips `.min.js`) |
| `whitespace` | Any staged file | Detects trailing whitespace, mixed line endings, and conflict markers |

**Bypassing (discouraged):** `git commit --no-verify` skips all pre-commit
hooks. Use this only for exceptional cases, not as a habit -- CI will still
catch the issues.

**Configuration:** The hook definitions live in `lefthook.yml` at the repo
root.

### Releasing a New Version

Follow these steps to create a release:

1. Bump `AssemblyVersion` and `AssemblyFileVersion` in
   `Properties/AssemblyInfo.cs`
2. Build locally to verify: `dotnet build segment_reporting/segment_reporting.csproj -c Release`
3. Commit and push all changes
4. Tag and push: `git tag vX.Y.Z.W && git push origin vX.Y.Z.W`
5. CI creates the GitHub Release automatically with the DLL attached and
   notes auto-generated by GitHub from merged PRs since the previous tag
6. Polish the published release body with `gh release edit vX.Y.Z.W` if needed
7. Close related issues with a comment referencing the version

---

## Testing

Pure logic (the custom-query security validators and marker-type helpers) is
covered by an xUnit unit-test project; everything that needs a live Emby server
(sync, write-through, UI) is still verified manually against a running server
using the Bruno API test collection and direct UI interaction.

### Unit Tests (xUnit)

The `tests/segment_reporting.Tests` project covers logic that does not need a
running Emby server: the custom-query validators (`ContainsDangerousKeyword`,
`IsAllowedPragma`, exposed as `internal` via `InternalsVisibleTo`) and
`MarkerTypes`. Run them with `make test` or `dotnet test Segment_Reporting.sln`.

The project targets `net8.0` to match the CI SDK; `<RollForward>Major</RollForward>`
lets the test host run on a newer locally-installed runtime when 8.0 is absent.
CI runs them as a dedicated step in the build job (see the CI/CD Pipeline section).

The plugin analyzer set also includes `Microsoft.VisualStudio.Threading.Analyzers`
(threading-antipattern static checks), enforced by the `-warnaserror` Release
build in CI and the local pre-push gate.

The same validators are also fuzzed with SharpFuzz (Docker, local-only); see
[Fuzzing the SQL Validators](#fuzzing-the-sql-validators-docker-manual) below.

### Concurrency Stress (UAT, manual)

The plugin's SQLite stack (`SQLitePCL.pretty` plus the raw provider Emby bundles)
cannot be hosted outside the Emby runtime, so `SegmentRepository`'s lock ordering
(#66) is exercised against a running UAT server rather than in a standalone unit
test. `make uat-concurrency` (or `bash scripts/uat/concurrency.sh`) fires many
concurrent API workers that mix reads (library summary, cache stats, sync status,
custom query, series list, season list) with an idempotent write (`update_segment` on a seeded
`/uat-media` episode). It fails if any request errors or times out (a possible
deadlock) or if the row count drifts (the writes are idempotent, so drift implies
a lost update or corruption). Local manual gate only: it needs the UAT Emby up and
seeded (`make uat-seed`) and never runs in CI or a git hook. Tune with the
`WORKERS` and `ITERATIONS` environment variables (defaults 8 and 25).

### Fuzzing the SQL Validators (Docker, manual)

The custom-query security predicates are the plugin's trust boundary for the
admin custom-query feature, so they are fuzzed in addition to the example-based
unit tests. The `tests/segment_reporting.Fuzz` console project (net8.0,
referencing the plugin via an `InternalsVisibleTo("segment_reporting.Fuzz")`
seam) drives SharpFuzz against the two branch-rich string predicates:

| Target name | Function under test |
|-------------|---------------------|
| `dangerous` | `SegmentRepository.ContainsDangerousKeyword(string)` |
| `pragma` | `SegmentRepository.IsAllowedPragma(string)` |

The property under test is simple: each must return a `bool` for ANY input and
never throw. A SharpFuzz crash (a thrown exception on some input) is a genuine
finding to fix in the validator.

The `MarkerTypes.Valid` whitelist lookup is deliberately **not** an AFL target.
`MarkerTypes.Valid.Contains(input)` routes only through framework `HashSet`
collection code with no branches in our own assembly, so SharpFuzz/AFL finds no
instrumented coverage and aborts the campaign with "No instrumentation
detected". The lookup also provably never throws on a non-null string, so its
"never throw for any input" property is covered by an ordinary xUnit test
(`MarkerTypesTests.Valid_Contains_ToleratesEdgeInputs_WithoutThrowing`, which
exercises empty, unicode, and very long inputs) rather than by fuzzing.

SharpFuzz is Linux-first (it drives AFL), so the campaign runs in a short-lived
container built from `scripts/fuzz/Dockerfile`; nothing fuzz-related touches the
developer's macOS host directly, and it is never wired into CI or a git hook.

| Command | Behavior |
|---------|----------|
| `make fuzz` | Build the image, then fuzz each target for a bounded 60s (`MAX_TOTAL_TIME=60`). |
| `make fuzz-deep` | Same image, unbounded campaign (`MAX_TOTAL_TIME=0`); stop with Ctrl-C. |

Both targets `docker build` the image and `docker run` it with the repo
bind-mounted at `/src`. The container entrypoint is `scripts/fuzz/run-fuzz.sh`,
which builds the fuzz project, instruments `segment_reporting.dll` with the
`sharpfuzz` CLI, seeds a benign `SELECT` corpus, and runs `afl-fuzz` per target.
Crashes (if any) land under `tests/segment_reporting.Fuzz/findings/<target>/crashes/`.

The runner builds the plugin in `Debug` against the `4.9` Emby ABI by default
(overridable via the `BUILD_CONFIG` and `EMBY_ABI` environment variables). This
sidesteps two container-only concerns that do not affect the pure string
predicates being fuzzed: the Release build minifies embedded JS via npm (no
Node in the image), and the default `4.10` ABI references the gitignored
`embylibs/` reference assemblies, which are absent in the container, whereas the
`4.9` ABI resolves the Emby SDK from NuGet. Narrow a run with `FUZZ_TARGETS`
(for example `-e FUZZ_TARGETS=dangerous`).

### Memory and Leak Profiling (manual)

The plugin caches into SQLite and runs scheduled syncs, so the leak class that
matters is managed-heap growth across repeated sync cycles. This is a manual,
local procedure with no CI gate:

1. Start the UAT Emby harness and install the plugin (`make uat-deploy`,
   `make uat-seed`).
2. Install the tools once: `dotnet tool install --global dotnet-gcdump` and
   `dotnet tool install --global dotnet-counters`.
3. Find the Emby server process ID, then capture a baseline snapshot:
   `dotnet-gcdump collect -p <pid> -o before.gcdump`.
4. Trigger several full sync cycles (run `sync_now` a few times via the UAT
   harness or the admin UI), optionally watching live with
   `dotnet-counters monitor -p <pid> System.Runtime` (watch `GC Heap Size` and
   the Gen 2 collection count).
5. Capture a second snapshot: `dotnet-gcdump collect -p <pid> -o after.gcdump`.
6. Compare the two `.gcdump` files (in Visual Studio, or with
   `dotnet-gcdump report`) by object count. Healthy: the managed heap returns to
   roughly the baseline after a GC, and `SegmentInfo` and SQLite connection
   objects do not accumulate per cycle. A monotonic climb in either across
   cycles indicates a leak to investigate.

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

## Screenshots

This section documents the screenshot capture process, anonymization patterns,
and cropping commands used to produce the images in `docs/Screenshots/`.

### Screenshot Inventory

| File | Viewport | Crop | What it shows |
|------|----------|------|---------------|
| `dashboard.png` | 2561x1398 | static | Summary cards, coverage chart, library table |
| `library-browse.png` | 2561x1398 | -- | Library drill-down with series/movie list |
| `series-detail.png` | 1460x1000 | static | Episode table with Actions dropdown/submenu |
| `inline-edit.png` | 1460x1000 | dynamic | Episode row in inline edit mode |
| `bulk-select.png` | 1460x1000 | dynamic | Multi-select with selection counter |
| `copy-banner.png` | 1460x1000 | dynamic | Copy-source banner + Apply Source button |
| `custom-query.png` | 2561x1398 | -- | Custom query page overview |
| `query-builder.png` | 2561x1398 | static | Visual query builder (Match through Limit) |
| `query-autocomplete.png` | 2561x1398 | -- | Tag input autocomplete suggestions |
| `query-results.png` | 1460x1000 | static | Results table with Actions dropdown |
| `settings.png` | 2561x1398 | -- | Plugin settings page |
| `palette-preview.png` | 1460x1000 | dynamic | Custom color pickers + live preview chart |

Full-page screenshots show the complete Emby interface (sidebar, header,
content). Cropped variants focus on a specific feature and are committed
alongside their full-page originals. **Static** crops use fixed `WxH+X+Y`
geometry defined in the `CROPS` constant; **dynamic** crops are measured
at capture time from the target element's bounding box via `saveFeatureShot()`.

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
# Minimum required variables
export EMBY_USER="admin"                   # admin username (required for SPA login)
export EMBY_PASSWORD="password"            # admin password

# Optional
export EMBY_URL="http://localhost:8096"    # default if unset
export EMBY_API_KEY="your-api-key"        # passed as X-Emby-Token for non-SPA requests
export SCREENSHOTS_DIR="/tmp/sr-smoke"    # override output dir (default: docs/Screenshots/)
export CAPTURE_ONLY="inline-edit,settings" # comma-separated subset; omit to capture all

node scripts/capture-screenshots.mjs
```

`EMBY_USER` (and `EMBY_PASSWORD`) are required because the plugin pages use
Emby's `ApiClient`, which needs an authenticated user session. `EMBY_API_KEY`
is optional but speeds up non-SPA asset requests. Use `SCREENSHOTS_DIR` with a
temp path for smoke tests so committed images are not overwritten accidentally.

The script requires a running Emby server with the plugin installed and synced.
ImageMagick (`magick` CLI) must be on PATH for cropping.

<!-- BEGIN UAT-SCREENSHOTS (issue #117) - keep edits localized to this block -->
### Capturing Against the UAT Emby

The capture script has two targets. The default (prod) path captures the real
Emby server and anonymizes every name at the network layer; the committed images
in `docs/Screenshots/` come from there. The UAT path captures the synthetic UAT
Emby seeded by `make uat-seed`, whose data is already fictional, so anonymization
is skipped and the `EMBY_UAT_*` credentials are used by default.

Set `CAPTURE_TARGET=uat` to switch:

```bash
# Seed the synthetic libraries first (see "UAT Emby Harness" above).
make uat-seed

# Capture against UAT. URL/key/user/password default to the EMBY_UAT_* vars
# (override any of them with the plain EMBY_* vars if needed).
export CAPTURE_TARGET=uat
export EMBY_UAT_USER="admin"           # or set EMBY_USER
export EMBY_UAT_PASSWORD="password"    # or set EMBY_PASSWORD
node scripts/capture-screenshots.mjs
```

Differences from the prod path in UAT mode:

- **No anonymization.** The network-layer rewrite is disabled (the UAT data is
  already synthetic), so screenshots show the real seeded names.
- **Credentials.** `EMBY_URL` / `EMBY_API_KEY` / `EMBY_USER` / `EMBY_PASSWORD`
  fall back to `EMBY_UAT_URL` / `EMBY_UAT_API_KEY` / `EMBY_UAT_USER` /
  `EMBY_UAT_PASSWORD`. (These come from the gitignored `.env`; see the UAT
  harness safety notes above.)
- **Output directory.** Defaults to a temp scratch dir
  (`$TMPDIR/sr-uat-screenshots`) instead of `docs/Screenshots/`, so a UAT run
  never overwrites the committed anonymized prod images. Override with
  `SCREENSHOTS_DIR`.

`CAPTURE_ONLY` still works to capture a subset. Because UAT capture skips
anonymization, never commit UAT screenshots in place of the anonymized prod
images without confirming they contain only synthetic `SR-UAT*` data.
<!-- END UAT-SCREENSHOTS -->

### Data Anonymization

Screenshots must never contain real media library names. The capture script
intercepts all `segment_reporting/` API responses at the network layer and
rewrites name/title fields before the page sees them, so both the DOM tables
and Chart.js charts (which hold data in module-closure variables unreachable
from `page.evaluate`) render fictional names from the start.

**Anonymization layers:**

| Layer | Technique | Fictional data source |
|-------|-----------|----------------------|
| Library names | Network route: rewrite `*Name/*Title` fields matching `library` | `FICTIONAL_LIBRARY_POOL` (20 entries) |
| Series names | Network route: rewrite `*Name/*Title` fields matching `series` | `FICTIONAL_SERIES` (16 entries) |
| Episode/movie names | Network route: rewrite remaining `*Name/*Title` fields by `ItemType` | `FICTIONAL_EPISODES` / `FICTIONAL_MOVIES` |
| Season names | Network route: replace with `Season N` (preserves SeasonNumber) | Derived from row data |
| Custom query matrix | Network route: anonymize by column header pattern (`Columns`/`Rows`) | Same pools as above |
| Unknown name fields | Network route: generic fallback pool (fail-safe for new API fields) | `FICTIONAL_GENERIC` (8 entries) |

The mapping is deterministic per real value (using a `Map`), so the same real
name maps to the same fictional name across all endpoints in one run.

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

**Static crops** use fixed geometry defined in the `CROPS` constant in
`capture-screenshots.mjs`. The capture script applies them automatically; these
commands are here for manual re-cropping only:

```bash
# Dashboard: coverage chart + library table (removes sidebar)
magick docs/Screenshots/dashboard.png -crop 2190x1210+370+55 +repage docs/Screenshots/dashboard-crop.png

# Series detail: episode table with Actions dropdown/submenu
magick docs/Screenshots/series-detail.png -crop 1220x450+240+240 +repage docs/Screenshots/series-detail-crop.png

# Query results: results table with Actions dropdown
magick docs/Screenshots/query-results.png -crop 1220x620+240+180 +repage docs/Screenshots/query-results-crop.png

# Query builder: Match conditions through Limit field
magick docs/Screenshots/query-builder.png -crop 2190x990+370+170 +repage docs/Screenshots/query-builder-crop.png
```

Crop geometry format: `WxH+X+Y` where X,Y is the top-left corner offset. These
values assume the viewport sizes listed in the Screenshot Inventory table above.
If the Emby sidebar width changes (currently ~345px at 2561-wide viewport,
~230px at 1460-wide), the X offset will need adjustment.

**Dynamic crops** (`inline-edit`, `bulk-select`, `copy-banner`,
`palette-preview`) are measured at capture time from the target element's
bounding box using `saveFeatureShot(page, name, boxFn, pad)`. There are no
fixed geometry values - re-run the capture script to regenerate them:

```bash
export EMBY_USER=... EMBY_PASSWORD=... EMBY_URL=...
CAPTURE_ONLY=inline-edit,bulk-select,copy-banner,palette-preview \
  node scripts/capture-screenshots.mjs
```

### Retaking Screenshots

When a UI change alters the appearance of a screenshot:

1. **Automated (preferred):** Use `CAPTURE_ONLY` to limit the run to specific
   pages, and `SCREENSHOTS_DIR` with a temp path for a dry run before
   overwriting committed images:
   ```bash
   SCREENSHOTS_DIR=/tmp/sr-smoke CAPTURE_ONLY=settings \
     EMBY_USER=... EMBY_PASSWORD=... node scripts/capture-screenshots.mjs
   # Inspect, then re-run without SCREENSHOTS_DIR to commit
   ```
2. **Manual via Playwright MCP:** Navigate to the page, use
   `browser_take_screenshot`. For pages that need an open Actions menu, use
   `openActionsMenu()` (or the in-page dispatch pattern from that function) to
   avoid hover unreliability in headless mode.
3. **Update docs:** If the screenshot shows a feature that changed (new button,
   renamed label, different layout), update the corresponding docs (see
   Documentation Maintenance in `CLAUDE.md`).

---

## Reference Links

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
  NuGet package for Emby Server SDK (version 4.9.x). Provides `IItemRepository`,
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
