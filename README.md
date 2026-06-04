# Segment Reporting

An Emby server plugin for reporting, browsing, and editing media segment markers (Intros, Credits) across your libraries.

Documentation site: **https://sydlexius.github.io/Segment_Reporting/** (User Guide and Developer Guide, built from `docs/` with ProperDocs and the Material theme).

## Features

### Reporting & Navigation

- **Interactive Dashboard** - Overview charts showing segment coverage per library, with breadcrumb drill-down navigation into libraries, series, and episodes
- **Library Browsing** - Browse series and movies with segment coverage stats, sortable columns, and filtering by segment status (missing intros, missing credits, has intro, has credits, etc.)
- **Series Detail** - Season/episode grid with per-season intro and credits coverage percentages, expandable accordions, and search
- **Movie Support** - Movie libraries display a flat table with inline segment timestamps; mixed libraries show both series and movies. Note: there is currently no automated detection mechanism for movie intros or credits, so movie and mixed library support is primarily reporting-only unless you add markers manually

### Editing & Bulk Operations

- **Inline Editing** - Edit intro/credits timestamps directly in any table view (library, series, or query results) via a unified Actions dropdown menu
- **Timing Adjustment** - Nudge intro or credits markers earlier/later in 250 ms steps from a per-row modal; apply the same relative shift to a whole selection in bulk, with a transient Undo for both individual and bulk adjustments
- **Bulk Operations** - Copy intros, credits, or both across episodes (type-selective), bulk delete intros or credits, and set credits-to-end in bulk
- **EmbyCredits Integration** - When the [EmbyCredits](https://github.com/faush01/EmbyCredits) plugin is installed, "Detect Credits" buttons appear on the dashboard, library, series, and custom query pages to trigger credits detection directly

### Custom Query

- **Visual Query Builder** - Point-and-click query builder with field/operator selection, condition groups, and drag-to-reorder column pills
- **Autocomplete & Multi-Value Selection** - Fields like Series Name, Library Name, and Item Type offer autocomplete suggestions from your library; use "is any of" / "is none of" operators for multi-value pill selection with `IN`/`NOT IN` SQL generation
- **Interactive Results** - Query results support inline editing, row selection with checkboxes, bulk actions, clickable playback links on timestamps, and CSV export
- **Saved Queries** - Save, load, and delete named queries; the visual builder fully round-trips `IN`/`NOT IN` clauses

### Settings & Maintenance

- **Display Preferences** - Choose from five named, theme-aware chart color palettes (Green, Blue, Red, Pink, Purple), plus Auto (accent-matched) and Custom colors; toggle gridlines and alternating row colors, and hide specific libraries from the dashboard
- **Scheduled Sync** - Automatic daily sync with your Emby server (configurable via Emby's Scheduled Tasks)
- **Cache Maintenance** - Weekly VACUUM task, on-demand Vacuum button, force rescan, and sync status display
- **About Page** - Plugin version, acknowledgements, Emby Forums link, and API endpoint reference

## Screenshots

![Dashboard](docs/Screenshots/dashboard.png)

![Query Builder](docs/Screenshots/query-builder.png)

See the **[User Guide](docs/USER_GUIDE.md)** for a full walkthrough with all screenshots.

## Installation

> **Pick the build for your Emby version.** Emby changed its plugin binary
> interface (ABI) between 4.9 and 4.10, so each release ships two assets:
> - `segment_reporting_emby_4.9x.zip` - for Emby **4.9.x**
> - `segment_reporting_emby_4.10x.zip` - for Emby **4.10.x**
>
> A mismatched build will not load (or loads but does not function). Check your
> version at **Settings > About** on the Emby dashboard. Each zip contains a
> ready-to-use `segment_reporting.dll` - no renaming needed.

1. Download the zip matching your Emby version from the [GitHub Releases](../../releases) page
2. Unzip it and copy `segment_reporting.dll` to your Emby server's plugins directory:
   - **Windows:** `C:\ProgramData\Emby-Server\plugins`
   - **Linux:** `/opt/emby-server/plugins` (or wherever your installation is)
3. Restart your Emby server
4. Navigate to **Settings → Plugins** and enable "Segment Reporting"
5. Run the initial sync via **Settings → Scheduled Tasks → Segment Reporting → Run Sync Segments Now**

## Configuration

The plugin integrates with Emby's built-in Scheduled Tasks system:

- **Sync Segments** - Default: Daily at 2:00 AM (crawls all libraries and syncs segment data to the cache)
- **Clean Segment DB** - Default: Weekly on Sunday at 3:00 AM (VACUUM and health check)

From the plugin Settings page you can:

- Choose a chart color palette: five named, theme-aware presets (Green, Blue, Red, Pink, Purple), Auto (accent-matched), or custom colors, with a live preview chart
- Toggle table gridlines and alternating row colors
- Hide specific libraries from the dashboard (per-library checkboxes)
- View cache statistics (row count, database size, last sync time)
- Force a full rescan or vacuum the database on demand

> **Note:** The admin pages are designed for desktop browsers. Mobile web browsers (phone/tablet) are not currently supported - the wide data tables, inline editing, and query builder assume a desktop viewport (see issue #47).

## Building from Source

### Prerequisites

- .NET SDK (any modern version such as .NET 6, 7, or 8 to compile the project)
- The project compiles to `.NET Standard 2.0` for compatibility with Emby Server
- Emby 4.10.0.13 reference assemblies in `segment_reporting/embylibs/` (gitignored;
  see [docs/DEVELOPER.md](docs/DEVELOPER.md) "Building the Plugin" for the one-time
  extraction command). The build references these instead of a NuGet SDK package.

### Build

```bash
cd segment_reporting
dotnet restore
dotnet build --configuration Release
```

The compiled DLL will be in `bin/Release/`.

### Testing

A `Makefile` wraps the common workflows (run `make help` for the list):

- `make test` - xUnit unit suite for pure logic (custom-query validators, marker types).
- `make gate` - the full CI-parity pre-push gate (Release build with analyzers as errors, unit tests, format check, JS lint); also run by the git pre-push hook.
- `make uat-deploy` / `uat-seed` / `uat-test` / `uat-concurrency` / `uat` - the UAT Emby harness, which exercises the full write path and the lock-ordering concurrency guard against a real Emby server (Docker/OrbStack). These are local-only manual gates; they need a running UAT Emby and a gitignored `.env`, and never run in CI.

See the [Developer Guide](docs/DEVELOPER.md) for the full testing and UAT workflow.

### Dependencies

- `mediabrowser.server.core` (4.9.*) - Emby server SDK
- `SQLitePCL.pretty.core` (1.2.2) - SQLite database wrapper
- `System.Memory` (4.6.3) - Memory utilities

## Supported Segment Types

- `IntroStart` - Intro marker start timestamp
- `IntroEnd` - Intro marker end timestamp
- `CreditsStart` - Credits marker start timestamp

These are the three marker types that Emby currently supports. Other segment types such as recaps, previews, commercials, and mid/post-credit scenes are not supported by Emby's chapter system and therefore cannot be tracked by this plugin.

## Data Model

Segment Reporting maintains a lightweight SQLite cache (`segment_reporting.db`) alongside your Emby server. The cache is always synchronized with Emby's source-of-truth chapter system:

- **Reads:** Fast queries from the SQLite cache
- **Writes:** Written through to Emby first, then the cache is updated
- **Sync:** Scheduled task crawls your libraries and rebuilds the cache

The cache supports both TV episodes and movies across mixed libraries, with denormalized tables designed for custom SQL queries.

## License

This project is licensed under **GNU General Public License v3.0** (GPL-3.0). See [LICENSE](LICENSE) for details.

## Acknowledgements

Segment Reporting is built on architectural patterns and code references from the following GPL-3.0 licensed projects by [faush01](https://github.com/faush01):

- **[playback_reporting](https://github.com/faush01/playback_reporting)** - Emby plugin for media playback analytics. Used as the primary architectural template for:
  - Plugin scaffolding and configuration patterns
  - SQLite data layer and query patterns
  - REST API structure and authentication
  - Embedded web page patterns (data-controller, AMD modules)
  - Scheduled task registration and execution
  - Chart library integration and visualization patterns

- **[ChapterApi](https://github.com/faush01/ChapterApi)** - Emby plugin providing a reference implementation of Emby's media segment APIs. Used as the reference for:
  - `IItemRepository.GetChapters()` and `SaveChapters()` APIs
  - Chapter/marker type definitions (`MarkerType` enum, `ChapterInfo` model)
  - Write-through patterns for persisting chapters to Emby

Both projects are licensed under GPL-3.0 and have been instrumental in understanding Emby's plugin architecture and segment handling capabilities.

## Documentation

- **[User Guide](docs/USER_GUIDE.md)** - Full walkthrough with screenshots
- **[Developer Guide](docs/DEVELOPER.md)** - Architecture, data models, API specs

## Support

- **Emby Forums** - [Segment Reporting discussion thread](https://emby.media/community/index.php?/topic/146268-segment-reporting-plugin/)
- **GitHub** - [Issues and feature requests](../../issues)
