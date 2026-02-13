# Issue Execution Guide

Recommended order of operations and session prompts for all open issues (excluding #47 and #57).

**Starting a session?** Copy-paste this into Claude Code:

```
Read docs/plans/issue-execution-guide.md and execute the next unchecked session. After completing it, mark its checkbox as [x] and commit the updated guide alongside the code changes.
```

**Before committing:** If the session involves behavioral changes (API, queries, UI interactions), perform manual acceptance testing by deploying the built DLL to Emby and verifying the changes work end-to-end. Build-only verification is not sufficient for sessions that change runtime behavior. Do not commit the code or mark the checkbox until acceptance testing passes. Do not close the related issue until the commit with the fix has been verified.

**Planning mode:** Sessions marked with `[plan first]` involve design decisions or multi-file refactors where the approach should be reviewed before writing code. Enter plan mode, explore the codebase, propose the approach, and get approval before implementing.

---

## Progress Tracker

### Phase 1 — Quick Wins (safety fixes + small bundled fixes)

Small, focused changes that reduce risk and clean up low-hanging fruit. Do these first while the codebase is stable.

- [x] **Session 1A** — #64 — Custom query SQL hardening (Small)
- [x] **Session 1B** — #65 — MarkerTypes.GetColumnName validation (Tiny)
- [x] **Session 1C** — #66 — Dispose lock ordering (Small)
- [x] **Session 1D** — #71 + #74 + #75 — Three small JS fixes in one commit (Tiny bundle)
- [x] **Session 1E** — #72 + #73 — Two small C# fixes in one commit (Tiny bundle)

### Phase 2 — Tooling

Set up analyzers and linting so they catch problems during all subsequent work.

- [x] **Session 2A** — #76 Milestone 1 — C# analyzers: Roslynator, IDisposableAnalyzers (Medium)
- [x] **Session 2B** — #76 Milestone 2 — ESLint for JavaScript (Medium)
- [x] **Session 2C** — #76 Milestone 3 — Lefthook pre-commit hooks (Small)

### Phase 3 — Backend Refactors

Clean up C# code while no frontend work is in flight.

- [x] **Session 3A** — #68 — Extract bulk operation helper (Small-Medium) `[plan first]`
- [x] **Session 3B** — #60 — Drop LastSyncDate column migration (Small-Medium)

### Phase 4 — Frontend Refactors

Large JS refactors that touch shared files. Do these before feature work to avoid merge conflicts.

- [x] **Session 4A** — #67 Milestones 1-2 — Design + implement shared inline editor (Medium) `[plan first]`
- [ ] **Session 4B** — #67 Milestones 3-5 — Migrate all 3 pages to shared editor (Medium-Large) `[plan first]`
- [ ] **Session 4C** — #70 — Debounce/guard buttons across pages (Small-Medium)
- [ ] **Session 4D** — #69 — Movie delete menu theme colors (Small)

### Phase 5 — Features

Build new functionality on the cleaned-up codebase.

- [ ] **Session 5A** — #61 — Dashboard coverage split + Detect button label (Medium)
- [ ] **Session 5B** — #63 — Season-level Actions dropdown (Medium) `[plan first]`

### Phase 6 — Documentation (last)

Screenshots and docs after all UI changes are settled.

- [ ] **Session 6A** — #62 — User Guide screenshots — do AFTER all UI changes (Medium)

---

## Session Prompts

Copy-paste these into Claude Code at the start of each session. Each prompt is self-contained.

---

### Session 1A — Custom Query SQL Hardening (#64)

```
Implement issue #64: Harden the custom query endpoint against SQL abuse.

File: segment_reporting/Data/SegmentRepository.cs, RunCustomQuery() method (around line 992).

The current first-word validation (SELECT/PRAGMA/EXPLAIN) can be bypassed. Fix by:
1. Open a READ-ONLY SQLite connection for custom queries (ConnectionFlags.ReadOnly) so SQLite itself enforces no-writes
2. As defense-in-depth, also reject queries containing semicolons, ATTACH, or load_extension (case-insensitive)
3. If PRAGMA is allowed, whitelist only safe read-only PRAGMAs (table_info, table_list, database_list, etc.)

Keep the existing first-word check as an additional layer. The read-only connection is the primary protection.

Bump the revision number in Properties/AssemblyInfo.cs before building. Build to verify: dotnet build segment_reporting/segment_reporting.csproj -c Release

When done, mark Session 1A as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 1B — MarkerTypes.GetColumnName Validation (#65)

```
Implement issue #65: Add input validation to MarkerTypes.GetColumnName().

File: segment_reporting/Data/MarkerTypes.cs, GetColumnName() method (around line 17).

Currently it blindly appends "Ticks" to any input, and the result gets interpolated into SQL. Add a whitelist check:
- If the markerType is not in MarkerTypes.Valid, throw ArgumentException
- This makes the method self-validating so callers can't accidentally bypass the check

This is a tiny change — just add the guard clause. Bump revision, build to verify.

When done, mark Session 1B as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 1C — Dispose Lock Ordering (#66)

```
Implement issue #66: Fix the potential deadlock in SegmentRepository.Dispose() lock ordering.

File: segment_reporting/Data/SegmentRepository.cs

Three problems to fix:
1. Dispose() acquires _instanceLock then _dbLock (A→B), but all DB methods acquire only _dbLock. Flatten the hierarchy: acquire _dbLock first inside Dispose, matching the order used everywhere else. Then handle _instance cleanup outside or after releasing _dbLock.

2. DropValidItemsTable() (around line 891) acquires _dbLock but is called from RemoveOrphanedRows() which already holds _dbLock. Extract a private _DropValidItemsTableUnlocked() that does the work without locking, called from inside the existing lock block.

3. DeleteAllData() (around line 906) acquires _dbLock then calls Initialize() which also acquires _dbLock. Same fix: extract _InitializeUnlocked() for the internal call path.

The pattern is: public methods acquire the lock and call *Unlocked private methods. Internal callers that already hold the lock call the *Unlocked versions directly.

Bump revision, build to verify.

When done, mark Session 1C as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 1D — Small JS Fixes Bundle (#71 + #74 + #75)

```
Implement three small JS fixes in one commit, covering issues #71, #74, and #75.

Fix 1 (#71): In segment_reporting/Pages/segment_series.js around line 260-273, wrap seasonLabel in helpers.escHtml() before inserting into innerHTML. The season.SeasonName value is currently unescaped.

Fix 2 (#74): In segment_reporting/Pages/segment_reporting_helpers.js, remove the clearNavParams function and its export from getSegmentReportingHelpers() — it's never called by any page. Also in segment_reporting/Pages/segment_custom_query.js line 2, change the copyright year from 2024 to 2026.

Fix 3 (#75): In segment_reporting/Pages/segment_custom_query.js around line 2349-2360, add URL.revokeObjectURL(url) after the CSV download link click. Use setTimeout with ~1000ms delay so the browser finishes the download first.

These are all one-line or few-line fixes. Bundle into a single commit. Bump revision, build to verify.

When done, mark Session 1D as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 1E — Small C# Fixes Bundle (#72 + #73)

```
Implement two small C# fixes in one commit, covering issues #72 and #73.

Fix 1 (#72): Centralize the DB filename constant. Move "segment_reporting.db" to a public const on SegmentRepository (e.g., public const string DbFileName = "segment_reporting.db"). Update SegmentReportingAPI.cs (line 301), TaskSyncSegments.cs (line 67), and TaskCleanSegmentDb.cs (line 63) to reference SegmentRepository.DbFileName instead of hardcoding the string.

Fix 2 (#73): In TaskCleanSegmentDb.cs around line 76, add a File.Exists(dbPath) check before creating FileInfo. If the file doesn't exist (first run before any sync), log an info message and return early. Match the pattern already used in the API class.

Bundle into a single commit. Bump revision, build to verify.

When done, mark Session 1E as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 2A — C# Analyzers (#76 Milestone 1)

```
Implement issue #76, Milestone 1: Add C# analyzer enhancements.

Changes to segment_reporting/segment_reporting.csproj:
1. Add <AnalysisLevel>latest-All</AnalysisLevel> in the main PropertyGroup to enable all built-in .NET analyzers
2. Add PackageReference for Roslynator.Analyzers (latest 4.x) with PrivateAssets="all"
3. Add PackageReference for IDisposableAnalyzers (latest 4.x) with PrivateAssets="all"

Then:
1. Build: dotnet build segment_reporting/segment_reporting.csproj -c Release
2. Triage all new warnings — for each:
   - If it's a real issue: fix it in this same session
   - If it's a false positive or intentional pattern: suppress in .editorconfig with a comment explaining why
3. The build uses -warnaserror in CI, so all warnings must be either fixed or suppressed
4. Verify the build is clean (zero warnings)

Bump revision, build to verify.

When done, mark Session 2A as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 2B — ESLint for JavaScript (#76 Milestone 2)

```
Implement issue #76, Milestone 2: Add ESLint for JavaScript.

1. In segment_reporting/package.json, add devDependencies:
   - eslint (latest v9)
   - eslint-plugin-no-unsanitized
   Add script: "lint:js": "eslint Pages/*.js --ignore-pattern '*.min.js'"

2. Create segment_reporting/eslint.config.mjs (flat config format) with:
   - sourceType: "script" (these are AMD modules, not ES modules)
   - Browser environment globals (window, document, setTimeout, etc.)
   - Emby globals: Dashboard, ApiClient, define, require
   - Plugin globals: getSegmentReportingHelpers, segmentReportingTicksToTime, segmentReportingTimeToTicks, segmentReportingEscHtml, segmentReportingFormatPalette, segmentReportingGetPaletteByName, segmentReportingGenerateChartPalette, segmentReportingGetContrastTextColor
   - Key rules: no-unused-vars (warn), no-undef (error), eqeqeq (warn), no-redeclare (error)
   - no-unsanitized/property and no-unsanitized/method rules
   - Ignore pattern for *.min.js files

3. Run the linter, fix genuine errors, suppress intentional patterns

4. Add ESLint step to .github/workflows/build.yml after the existing format check

5. Run npm ci && npm run lint:js to verify everything passes

Bump revision, build to verify.

When done, mark Session 2B as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 2C — Lefthook Pre-commit Hooks (#76 Milestone 3)

```
Implement issue #76, Milestone 3: Add Lefthook pre-commit hooks.

1. Install lefthook. Either add it as a devDependency in segment_reporting/package.json or install the standalone binary. If using npm: npm i -D lefthook

2. Create lefthook.yml at the REPO ROOT (not inside segment_reporting/) with:
   pre-commit:
     parallel: true
     commands:
       dotnet-format:
         glob: "*.cs"
         run: dotnet format segment_reporting/segment_reporting.csproj --verify-no-changes
       eslint:
         glob: "segment_reporting/Pages/*.js"
         exclude: "*.min.js"
         run: npx --prefix segment_reporting eslint {staged_files}
       whitespace:
         run: git diff --cached --check
       merge-conflict:
         run: git diff --cached -S "<<<<<<< " --name-only

3. Update docs/DEVELOPER.md to document the pre-commit hook setup:
   - How to install (lefthook install after cloning)
   - What it checks (format, lint, whitespace, conflict markers)
   - How to bypass if needed (git commit --no-verify — but discouraged)

No revision bump needed — this is infrastructure only, no code changes.

When done, mark Session 2C as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 3A — Extract Bulk Operation Logic (#68)

```
Implement issue #68: Extract shared bulk operation logic in the API.

File: segment_reporting/Api/SegmentReportingAPI.cs, around lines 534-660.

BulkApply and BulkDelete (and potentially BulkSetCreditsEnd) share identical structure: parse comma-separated IDs, validate MaxBulkItems, validate marker types, loop items × types with try/catch, accumulate succeeded/failed/errors.

Extract a private helper method like:

private object ExecuteBulkOperation(string itemIdsStr, string markerTypesStr, int maxItems, Action<SegmentRepository, long, string> perItemAction, string operationName)

The helper handles: SplitAndTrim, count validation, MarkerTypes.Valid check, nested iteration with try/catch, and returns the { succeeded, failed, errors } object.

Each bulk endpoint becomes a thin wrapper that calls ExecuteBulkOperation with its specific per-item action delegate.

Bump revision, build to verify.

When done, mark Session 3A as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 3B — Drop LastSyncDate Column (#60)

```
Implement issue #60: Drop the LastSyncDate column from MediaSegments.

File: segment_reporting/Data/SegmentRepository.cs, in the migration/initialization path.

In CheckMigration() or the initialization path:
1. Try: ALTER TABLE MediaSegments DROP COLUMN LastSyncDate
2. Catch: On failure (older SQLite without DROP COLUMN support), fall back to UPDATE MediaSegments SET LastSyncDate = NULL — this nulls out the data even if the column can't be dropped

Also:
- Remove any code that reads or writes the LastSyncDate column (grep for "LastSyncDate" across all files)
- Remove it from any INSERT/SELECT statements, SegmentInfo model properties, etc.
- Update docs if they mention per-segment sync timestamps

This follows up on #53 which stopped using the column but didn't physically remove it.

Bump revision, add release notes entry, build to verify.

When done, mark Session 3B as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 4A — Inline Editor: Design + Implement (#67 Milestones 1-2)

```
Implement issue #67, Milestones 1 and 2: Design and implement the shared inline editing module.

First, READ the three existing inline editing implementations to understand the common pattern:
- segment_reporting/Pages/segment_series.js — episode editing
- segment_reporting/Pages/segment_library.js — movie editing
- segment_reporting/Pages/segment_custom_query.js — query result editing

Identify the common lifecycle (start edit → show inputs → save → API call → refresh) and the per-page variations (column definitions, API endpoints, validation rules, post-save behavior).

Then implement a shared createInlineEditor() function in segment_reporting/Pages/segment_reporting_helpers.js that:
- Takes configuration: { columns: [...], apiEndpoint, validate, onSave, onCancel }
- Handles: input creation from cell values, value extraction, time-tick validation, API save with error handling, cancel/restore, loading state
- Provides hooks for per-page custom behavior

Do NOT migrate the pages yet — just add the new shared function alongside the existing code. The migrations happen in a separate session.

Bump revision, build to verify.

When done, mark Session 4A as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 4B — Inline Editor: Migrate Pages (#67 Milestones 3-5)

```
Implement issue #67, Milestones 3-5: Migrate all three pages to use the shared inline editor.

The shared createInlineEditor() helper was added in the previous session. Now migrate each page:

1. segment_series.js FIRST (most standard pattern) — replace its inline editing code with helpers.createInlineEditor(...) calls. Test: edit an episode's intro/credits timestamps, verify save/cancel/refresh all work, verify no regressions in season expand/collapse.

2. segment_library.js SECOND — same migration for movie editing. Test: edit a movie's timestamps.

3. segment_custom_query.js LAST (most customized — editable columns depend on query results). May need additional config options. Test: run a custom query, edit a result row.

After migrating all three, delete the now-dead inline editing code from each page.

Bump revision for each page migration (or once at the end if you do them all together). Build to verify.

When done, mark Session 4B as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 4C — Debounce Buttons (#70)

```
Implement issue #70: Add debounce/guard to save/delete buttons to prevent double-submission.

First, audit all action buttons across all 6 pages:
- segment_dashboard.js (Detect buttons)
- segment_library.js (save, delete buttons)
- segment_series.js (save, delete, detect buttons)
- segment_custom_query.js (save, delete, apply buttons)
- segment_settings.js (save button)
- segment_about.js (unlikely to have action buttons but check)

Check which already use helpers.withButtonLoading() and which are unguarded.

Then either extend withButtonLoading() in segment_reporting_helpers.js to also disable the button (btn.disabled = true at start, re-enable on completion/error), or create a new helpers.guardButton(btn, asyncFn) wrapper.

Apply to all unguarded action buttons. Test: rapid double-click on save and delete buttons should only fire one API call.

Bump revision, build to verify.

When done, mark Session 4C as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 4D — Movie Delete Menu Theme (#69)

```
Implement issue #69: Migrate the movie delete menu to use shared menu infrastructure.

File: segment_reporting/Pages/segment_library.js around lines 752-780.

The delete confirmation menu hardcodes dark-theme colors (#333, #555, rgba(255,255,255,0.1)). All other dropdown menus in the codebase use helpers.getMenuColors(view) and helpers.detectDropdownBg(view).

Replace the hardcoded style.cssText and hover colors with calls to the shared theme-aware helpers. Look at how other menus in the same file or segment_series.js create their dropdowns for the pattern to follow.

Bump revision, build to verify.

When done, mark Session 4D as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 5A — Dashboard Coverage Split (#61)

```
Implement issue #61: Split the Coverage % column by type and clarify the Detect button label.

Files:
- segment_reporting/Pages/segment_dashboard.js — main changes
- segment_reporting/Pages/segment_dashboard.html — update table header if needed

Changes:
1. Replace the single "Coverage" column in the library table with two columns: "Intro %" and "Credits %". Use helpers.percentage(withIntro, totalItems) and helpers.percentage(withCredits, totalItems) respectively.

2. Change the per-library button label from "Detect" to "Detect Credits" to match the global "Detect All Credits" button.

3. Review the stacked bar chart labels — update if they reference a single "Coverage" metric.

Also update:
- docs/USER_GUIDE.md — Dashboard section to reflect new columns and button label
- RELEASE_NOTES.md — add entry
- Properties/AssemblyInfo.cs — bump revision

Build to verify.

When done, mark Session 5A as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 5B — Season-Level Actions Dropdown (#63)

```
Implement issue #63: Replace the season-level Detect button with an Actions dropdown using EmbyCredit's ProcessSeason endpoints.

File: segment_reporting/Pages/segment_series.js

Changes:
1. Replace the standalone btn-season-detect button in the season header with an "Actions ▾" dropdown menu (same pattern as per-episode Actions from #58).

2. Menu items:
   - "Detect All" → POST /CreditsDetector/ProcessSeason with { SeriesId, SeasonNumber, SkipExistingMarkers: false }
   - "Detect Missing" → POST /CreditsDetector/ProcessSeasonMissingMarkers with { SeriesId, SeasonNumber }

3. Use existing shared helpers: createActionsMenu(), createMenuItem(), positionMenuBelowButton(), attachMenuCloseHandler(), getMenuColors().

4. Refactor detectCreditsForSeason() to make a single API call instead of looping ProcessEpisode per episode.

5. The season object from season_list has both SeasonId and SeasonNumber — use SeasonNumber as the new endpoints require it.

6. If ProcessSeason needs a JSON body (not query params), add a creditsDetectorPostJson() helper in segment_reporting_helpers.js.

Update docs/USER_GUIDE.md and docs/DEVELOPER.md for the new EmbyCredits integration pattern. Bump revision, build to verify.

When done, mark Session 5B as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```

---

### Session 6A — User Guide Screenshots (#62)

```
Implement issue #62: Add feature-highlight screenshots to the User Guide.

This should be done LAST, after all UI changes from other issues are complete.

Two categories of work:

1. CROPS of existing screenshots (no new captures needed):
   - Actions dropdown crop from series-detail.png
   - Delete submenu crop from query-results.png
   - Visual Query Builder crop from query-builder.png
   - Query Results crop from query-results.png
   - Coverage Chart crop from dashboard.png
   Use the crop commands documented in docs/DEVELOPER.md section 9.

2. NEW captures (via Playwright MCP + anonymization):
   - Inline editing: episode row in edit mode with Save/Cancel buttons
   - Episode selection: checkboxes checked with bulk action count
   - Copy segments: the copy banner with Apply button
   - Chart color palettes: palette preview chart

Cropped screenshots use a -crop.png suffix. Place each crop inline in docs/USER_GUIDE.md below the relevant subsection heading with an italic caption.

All captures must be anonymized per DEVELOPER.md section 9 patterns.

When done, mark Session 6A as [x] in docs/plans/issue-execution-guide.md and include the guide in the commit.
```
