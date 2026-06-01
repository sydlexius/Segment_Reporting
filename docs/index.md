# Segment Reporting

Segment Reporting is an [Emby](https://emby.media/) server plugin that caches
media segment markers (Intros and Credits) into a local SQLite database and
provides admin-facing reporting, charts, inline editing, and bulk management
through embedded web pages.

## Documentation

- **[User Guide](USER_GUIDE.md)** -- for Emby admins: dashboard, library
  browsing, custom queries, bulk operations, settings, and troubleshooting.
- **[Developer Guide](DEVELOPER.md)** -- for contributors: architecture,
  SQLite schema, REST API reference, helper functions, build pipeline, and
  page lifecycle.

## Features at a glance

- Dashboard with coverage charts and per-library breakdowns.
- Library browsing with inline segment editing and Actions dropdowns.
- Custom query builder over the cached `MediaSegments` table.
- Bulk detect/clear operations.
- Display preferences: five named, theme-aware chart color palettes
  (Green, Blue, Red, Pink, Purple), plus Auto (accent-matched) and Custom
  colors. Palettes adapt automatically to light and dark Emby themes.

## Project links

- Source: [github.com/sydlexius/Segment_Reporting](https://github.com/sydlexius/Segment_Reporting)
- License: GPL-3.0
