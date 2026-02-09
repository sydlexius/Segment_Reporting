# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Segment Reporting is an Emby server plugin (C#/.NET) that caches media segment markers (Intros, Credits) into a local SQLite database and provides admin-facing reporting, charts, inline editing, and bulk management through embedded web pages. Licensed GPL-3.0.

The design document at [docs/plans/2026-02-06-segment-reporting-design.md](docs/plans/2026-02-06-segment-reporting-design.md) is the authoritative specification — consult it for all data model details, API contracts, UI page specs, and sync behavior.

## Build & Run

```bash
# Restore and build
dotnet restore segment_reporting/segment_reporting.csproj
dotnet build segment_reporting/segment_reporting.csproj -c Release

# No automated tests — Emby plugins require a running server instance
# Manual testing: copy the built DLL into Emby's plugins directory and restart
```

## Architecture

This plugin follows the architecture pattern established by [playback_reporting](https://github.com/faush01/playback_reporting) and references [ChapterApi](https://github.com/faush01/ChapterApi) for Emby's segment/chapter APIs.

**Core principle:** Emby's chapter system (`IItemRepository`) is always the source of truth. The SQLite DB (`segment_reporting.db`) is a read-optimized cache. All edits write through to Emby first, then update the cache.

**Data flow:**
- Reads: Web UI -> REST API -> SegmentRepository (SQLite)
- Writes: Web UI -> REST API -> `IItemRepository.SaveChapters()` (Emby) -> update SQLite cache
- Sync: Scheduled task crawls `ILibraryManager` + `IItemRepository` -> rebuilds SQLite cache

**Key components:**
- `Plugin.cs` / `PluginConfiguration.cs` — Plugin entry point and config
- `Data/SegmentRepository.cs` — SQLite singleton, schema creation/migration, all queries
- `Data/SegmentInfo.cs` — Model class for the denormalized `MediaSegments` table
- `Api/SegmentReportingAPI.cs` — All REST endpoints under `/segment_reporting/` prefix (admin-only)
- `Tasks/TaskSyncSegments.cs` — Scheduled daily sync (crawl all libraries, upsert cache)
- `Tasks/TaskCleanSegmentDb.cs` — Weekly VACUUM and health check
- `Pages/` — Six embedded HTML/JS pages using Emby's `data-controller` / AMD module pattern

**SQLite schema:** Single denormalized `MediaSegments` table (no joins needed for custom queries). Movies and episodes share the same table; series/season columns are null for movies. Schema migration uses `PRAGMA table_info` + `ALTER TABLE ADD`.

## Dependencies

- `mediabrowser.server.core` (4.8.x) — Emby server SDK
- `SQLitePCL.pretty.core` (1.2.2) — SQLite wrapper
- `System.Memory` (4.5.5)

## Conventions

- All API endpoints require `[Authenticated(Roles = "admin")]`
- Web pages follow the `data-controller` / AMD module pattern from playback_reporting
- `chart.min.js` is embedded as a resource for charting
- Segment types: `IntroStart`, `IntroEnd`, `CreditsStart` (the three types Emby currently supports)
- Time values stored as ticks (BIGINT), displayed as `HH:MM:SS.fff`
- Shared utilities live in `Pages/segment_reporting_helpers.js` (tick conversion, chart navigation, API helpers, HTML escaping)

## CI/CD

GitHub Actions (`.github/workflows/build.yml`): build on push to main/develop and PRs. Tag push (`v*`) creates a GitHub Release with the compiled DLL. Release notes are extracted from `RELEASE_NOTES.md` automatically.

## Releasing a New Version

When asked to tag/release a version, follow these steps in order:

1. **Bump version** in `Properties/AssemblyInfo.cs` (both `AssemblyVersion` and `AssemblyFileVersion`)
2. **Add a section to `RELEASE_NOTES.md`** at the top (below the `# title`), using the format `## vX.Y.Z.W - Short Title`. Write user-friendly descriptions (not technical jargon). CI extracts this section automatically for the GitHub Release page.
3. **Build** to verify: `dotnet build segment_reporting/segment_reporting.csproj -c Release`
4. **Stage, commit, push** the version bump + release notes + any pending changes
5. **Tag and push the tag**: `git tag vX.Y.Z.W && git push origin vX.Y.Z.W`
6. **Wait for CI** to create the GitHub Release (check with `gh release view vX.Y.Z.W`)
7. **Close related issues** if applicable, with a comment referencing the version

Prefer solving tasks in a single session. Only spawn subagents for genuinely independent workstreams.