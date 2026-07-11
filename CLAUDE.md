# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## >> ON SESSION START / RESUME: read SESSION-STATE.md FIRST (if present) <<

`SESSION-STATE.md` (repo root; gitignored, machine-local) is the orchestrate session
checkpoint - read it before doing anything when asked to resume / pick up work. It holds
only non-derivable intent + pointers (status banner, next actions); reboot-durable
derivables (in-flight PRs via `gh pr list`, worktrees via `git worktree list`) are
reconstructed on demand, not mirrored. Absent on a fresh checkout; created on the first
orchestrate session.

## Project Overview

Segment Reporting is an Emby server plugin (C#/.NET) that caches media segment markers (Intros, Credits) into a local SQLite database and provides admin-facing reporting, charts, inline editing, and bulk management through embedded web pages. Licensed GPL-3.0.

The design document at [docs/plans/2026-02-06-segment-reporting-design.md](docs/plans/2026-02-06-segment-reporting-design.md) is the authoritative specification - consult it for all data model details, API contracts, UI page specs, and sync behavior.

## Build & Run

Common dev tasks are wrapped in a `Makefile` (run `make help` for the full
list: `build`, `test`, `format`, `lint`, `gate`, `hooks`, `docs`, `screenshots`,
`clean`, plus the UAT harness targets below). The Makefile only wraps the
commands below; CI invokes them directly.

```bash
# Restore and build
dotnet restore segment_reporting/segment_reporting.csproj
dotnet build segment_reporting/segment_reporting.csproj -c Release

# Unit tests (xUnit) for pure logic (custom-query validators, marker types).
# The test project targets net8.0 (matches CI); RollForward lets it run on a
# newer local runtime if the 8.0 runtime is not installed.
dotnet test Segment_Reporting.sln        # or: make test

# Full CI-parity pre-push gate (Release build with analyzers-as-errors, format
# check, JS lint, and the xUnit suite). The lefthook pre-push hook runs this.
make gate
```

**Analyzers:** the plugin builds with StyleCop, Roslynator, IDisposableAnalyzers,
and `Microsoft.VisualStudio.Threading.Analyzers` under `-warnaserror`, so analyzer
warnings fail the Release build (enforced by `make gate` and CI).

**Integration / UAT testing** runs against a real Emby server via the UAT harness
(`scripts/uat/*`, Docker/OrbStack `emby` container), not by hand-copying DLLs:

```bash
make uat-deploy        # build + docker cp the DLL into the container, restart
make uat-seed          # generate synthetic media, libraries, markers (idempotent)
make uat-test          # run the Bruno API assertions (alias: make bruno)
make uat-concurrency   # stress SegmentRepository lock ordering (#66) under load
make uat               # full chain: deploy -> seed -> test
```

`make uat-concurrency` is the runtime concurrency guard: the plugin's SQLite
stack (`SQLitePCL.pretty` + Emby's bundled raw provider) cannot be hosted outside
Emby, so lock-ordering is exercised against the live server, not a unit test. The
UAT and fuzz targets are local-only manual gates (need the UAT Emby up and seeded;
read `EMBY_UAT_*` from a gitignored `.env`); they never run in CI or a git hook.
See `docs/DEVELOPER.md` (UAT Emby Harness) for the full workflow.

## Architecture

This plugin follows the architecture pattern established by [playback_reporting](https://github.com/faush01/playback_reporting) and references [ChapterApi](https://github.com/faush01/ChapterApi) for Emby's segment/chapter APIs.

**Core principle:** Emby's chapter system (`IItemRepository`) is always the source of truth. The SQLite DB (`segment_reporting.db`) is a read-optimized cache. All edits write through to Emby first, then update the cache.

**Data flow:**
- Reads: Web UI -> REST API -> SegmentRepository (SQLite)
- Writes: Web UI -> REST API -> `IItemRepository.SaveChapters()` (Emby) -> update SQLite cache
- Sync: Scheduled task crawls `ILibraryManager` + `IItemRepository` -> rebuilds SQLite cache

**Key components:**
- `Plugin.cs` / `PluginConfiguration.cs` - Plugin entry point and config
- `Data/SegmentRepository.cs` - SQLite singleton, schema creation/migration, all queries
- `Data/SegmentInfo.cs` - Model class for the denormalized `MediaSegments` table
- `Api/SegmentReportingAPI.cs` - All REST endpoints under `/segment_reporting/` prefix (admin-only)
- `Tasks/TaskSyncSegments.cs` - Scheduled daily sync (crawl all libraries, upsert cache)
- `Tasks/TaskCleanSegmentDb.cs` - Weekly VACUUM and health check
- `Pages/` - Six embedded HTML/JS pages using Emby's `data-controller` / AMD module pattern

**SQLite schema:** Single denormalized `MediaSegments` table (no joins needed for custom queries). Movies and episodes share the same table; series/season columns are null for movies. Schema migration uses `PRAGMA table_info` + `ALTER TABLE ADD`.

## Dependencies

- `mediabrowser.server.core` (4.9.x) - Emby server SDK (plugin targets `netstandard2.0`)
- `SQLitePCL.pretty.core` (1.2.2) - SQLite wrapper
- `System.Memory` (4.5.5)

## Conventions

- All API endpoints require `[Authenticated(Roles = "admin")]`
- Web pages follow the `data-controller` / AMD module pattern from playback_reporting
- `chart.min.js` is embedded as a resource for charting
- Segment types: `IntroStart`, `IntroEnd`, `CreditsStart` (the three types Emby currently supports)
- Time values stored as ticks (BIGINT), displayed as `HH:MM:SS.fff`
- Shared utilities live in `Pages/segment_reporting_helpers.js` (tick conversion, chart navigation, API helpers, HTML escaping)
- Avoid em-dashes in user-facing strings (error messages, banners, labels). Use regular dashes, commas, or parentheses instead.

## CI/CD

GitHub Actions (`.github/workflows/build.yml`): build on push to main/develop and PRs. Tag push (`v*`) creates a GitHub Release with the compiled DLL. Release notes are generated automatically by GitHub from the merged PRs since the previous tag (`generate_release_notes: true`); there is no `RELEASE_NOTES.md` file to maintain.

Release builds automatically minify JS via MSBuild targets in the csproj (`NpmInstall` → `MinifyJS` → `RestoreJS`). This runs `npm ci` if needed, minifies JS in-place before compilation, then restores originals after the DLL is built. Requires Node.js on the build machine; `npm ci` is skipped if `node_modules` already exists.

## Releasing a New Version

When asked to tag/release a version, follow these steps in order:

1. **Bump version** in `Properties/AssemblyInfo.cs` (both `AssemblyVersion` and `AssemblyFileVersion`)
2. **Build** to verify: `dotnet build segment_reporting/segment_reporting.csproj -c Release`
3. **Stage, commit, push** the version bump + any pending changes
4. **Tag and push the tag**: `git tag vX.Y.Z.W && git push origin vX.Y.Z.W`
5. **Wait for CI** to create the GitHub Release (check with `gh release view vX.Y.Z.W`). Release notes are auto-generated by GitHub from the merged PRs since the previous tag, so write clear PR titles. Edit the published release body afterward with `gh release edit` if it needs polish.
6. **Close related issues** if applicable, with a comment referencing the version

## Documentation Maintenance

Three docs describe the plugin at different levels. When code changes affect documented behavior, update the relevant docs in the same commit:

| Document | Audience | What to update |
|----------|----------|---------------|
| `README.md` | GitHub visitors | Feature list, installation steps, screenshots, supported segment types |
| `docs/USER_GUIDE.md` | Emby admins | How-to instructions, UI workflows, filter/button labels, settings options, troubleshooting |
| `docs/DEVELOPER.md` | Contributors | Architecture, schema, API endpoints, helper functions, build pipeline, page lifecycle |

**When to update which doc:**

- **New/changed API endpoint** → DEVELOPER.md (API Reference section)
- **New/changed UI feature or button** → USER_GUIDE.md (relevant section) and README.md (Features list if it's a headline feature)
- **New/changed setting or preference** → USER_GUIDE.md (Settings section) and DEVELOPER.md (Preferences endpoint)
- **Schema change (new column/table)** → DEVELOPER.md (Schema section)
- **New page added** → all three (README features, USER_GUIDE walkthrough, DEVELOPER.md page overview)
- **New/changed bulk operation** → USER_GUIDE.md (Bulk Operations section)
- **New/changed query builder feature** → USER_GUIDE.md (Custom Queries section)
- **Build/CI changes** → DEVELOPER.md (CI/CD section)
- **New screenshot needed** → capture to `docs/Screenshots/`, reference in USER_GUIDE.md, consider updating README.md hero images

**Screenshot freshness:** When a UI change alters the appearance of a page that has a screenshot in `docs/Screenshots/`, flag that the screenshot needs retaking. Screenshots are captured via Playwright MCP (`browser_take_screenshot`) from a local Emby server with DOM manipulation to anonymize personal library data (see issue #56 for the anonymization patterns and fictional name lists used). Do not commit screenshots containing real media library names.

Prefer solving tasks in a single session. Only spawn subagents for genuinely independent workstreams.