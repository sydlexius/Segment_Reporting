# Segment Reporting

An Emby server plugin for reporting, browsing, and editing media segment markers (Intros, Credits) across your libraries.

## Features

- **Interactive Dashboard** — Overview charts showing segment coverage per library with drill-down navigation
- **Library & Series Browsing** — Explore segments organized by library, series, season, and episode
- **Inline Editing** — Edit intro/credits timestamps directly in the table view
- **Bulk Operations** — Copy segments across episodes or delete in bulk
- **Custom SQL Queries** — Write your own queries against the segment cache
- **Scheduled Sync** — Automatic daily sync with your Emby server (configurable)
- **Admin Settings** — Control sync schedule, display preferences, and cache maintenance

## Screenshots

*Dashboard, Library View, Series Detail, and Settings pages to be added after UI implementation.*

## Installation

1. Download the latest release from the [GitHub Releases](../../releases) page
2. Copy the DLL file to your Emby server's plugins directory:
   - **Windows:** `C:\ProgramData\Emby-Server\plugins`
   - **Linux:** `/opt/emby-server/plugins` (or wherever your installation is)
3. Restart your Emby server
4. Navigate to **Settings → Plugins** and enable "Segment Reporting"
5. Run the initial sync via **Settings → Scheduled Tasks → Segment Reporting → Run Sync Segments Now**

## Configuration

The plugin integrates with Emby's built-in Scheduled Tasks system:

- **TaskSyncSegments** — Default: Daily at 2:00 AM (crawls all libraries and syncs segment data)
- **TaskCleanSegmentDb** — Default: Weekly on Sunday at 3:00 AM (database maintenance)

From the plugin Settings page, you can:
- Adjust the sync schedule
- Configure display preferences (time format, chart colors)
- Force a full rescan of the segment cache (advanced)

## Building from Source

### Prerequisites

- .NET SDK (any modern version such as .NET 6, 7, or 8 to compile the project)
- The project compiles to `.NET Standard 2.0` for compatibility with Emby Server

### Build

```bash
cd segment_reporting
dotnet restore
dotnet build --configuration Release
```

The compiled DLL will be in `bin/Release/`.

### Dependencies

- `mediabrowser.server.core` (4.8.x) — Emby server SDK
- `SQLitePCL.pretty.core` (1.2.2) — SQLite database wrapper
- `System.Memory` (4.5.5) — Memory utilities

## Supported Segment Types

- `IntroStart` — Intro marker start timestamp
- `IntroEnd` — Intro marker end timestamp
- `CreditsStart` — Credits marker start timestamp

These are the segment types currently supported by Emby.

## Data Model

Segment Reporting maintains a lightweight SQLite cache (`segment_reporting.db`) alongside your Emby server. The cache is always synchronized with Emby's source-of-truth chapter system:

- **Reads:** Fast queries from the SQLite cache
- **Writes:** Written through to Emby first, then the cache is updated
- **Sync:** Scheduled task crawls your libraries and rebuilds the cache

The cache supports both TV episodes and movies across mixed libraries, with denormalized tables designed for custom SQL queries.

## API Reference

All API endpoints are under `/segment_reporting/` and require admin authentication. See the [design document](docs/plans/2026-02-06-segment-reporting-design.md) for detailed endpoint specifications.

## License

This project is licensed under **GNU General Public License v3.0** (GPL-3.0). See [LICENSE](LICENSE) for details.

## Acknowledgements

Segment Reporting is built on architectural patterns and code references from the following GPL-3.0 licensed projects by [faush01](https://github.com/faush01):

- **[playback_reporting](https://github.com/faush01/playback_reporting)** — Emby plugin for media playback analytics. Used as the primary architectural template for:
  - Plugin scaffolding and configuration patterns
  - SQLite data layer and query patterns
  - REST API structure and authentication
  - Embedded web page patterns (data-controller, AMD modules)
  - Scheduled task registration and execution
  - Chart library integration and visualization patterns

- **[ChapterApi](https://github.com/faush01/ChapterApi)** — Emby plugin providing a reference implementation of Emby's media segment APIs. Used as the reference for:
  - `IItemRepository.GetChapters()` and `SaveChapters()` APIs
  - Chapter/marker type definitions (`MarkerType` enum, `ChapterInfo` model)
  - Write-through patterns for persisting chapters to Emby

Both projects are licensed under GPL-3.0 and have been instrumental in understanding Emby's plugin architecture and segment handling capabilities.

## Documentation

For detailed architecture, data models, API specifications, and implementation details, see the [design document](docs/plans/2026-02-06-segment-reporting-design.md).

## Support

For issues, feature requests, or contributions, please open an issue or pull request on [GitHub](../../issues).
