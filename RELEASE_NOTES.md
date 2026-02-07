# Segment Reporting v0.0.6 - Initial Release

An Emby server plugin that caches media segment markers (Intros, Credits) into a local SQLite database and provides comprehensive reporting, charts, inline editing, and bulk management through embedded web pages.

## 🚀 Features

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

## 🏗️ Infrastructure

- **Core Plugin Framework** (#1) - Plugin entry point, configuration, and Emby integration
- **CI/CD Pipeline** (#14) - GitHub Actions for automated builds and releases
- **Code Quality** (#16) - StyleCop analyzers with pre-commit hooks
- **Quality Gates** - Enforced code formatting and analyzer rules in CI

## 📋 System Requirements

- Emby Server 4.8.x
- .NET Standard 2.0 runtime
- SQLite support (included)

## 📦 Installation

1. Download `segment_reporting.dll` from the release assets
2. Copy to your Emby server's plugins directory
3. Restart Emby server
4. Access via Dashboard → Plugins → Segment Reporting

## 📄 License

GPL-3.0 License

---

**Full Changelog**: https://github.com/sydlexius/Segment_Reporting/commits/v0.0.6
