# Segment Reporting API Tests

Bruno collection for testing all Segment Reporting REST API endpoints against a
live Emby server.

## Setup

### 1. Configure API Key

The collection authenticates using a secret `apiKey` variable sent via the
`X-Emby-Token` header. Set it in Bruno's environment editor, or export it as
an environment variable:

```bash
# Option A: set directly
export EMBY_API_KEY="your-emby-admin-api-key"

# Option B: retrieve from 1Password CLI
export EMBY_API_KEY=$(op item get "Emby API Key (Local)" --fields api_key)
```

You can find your API key in Emby under Settings > API Keys.

### 2. Configure Environment Variables

Open `segment-reporting-api/environments/Local.bru` and replace the placeholder
values with real IDs from your Emby server:

| Variable | Description |
|----------|-------------|
| `baseUrl` | Emby server URL (default `http://localhost:8096`) |
| `sampleLibraryId` | A library ID from the `library_summary` response |
| `sampleSeriesId` | A series ID from the `series_list` response |
| `sampleSeasonId` | A season ID from the `season_list` response |
| `sampleItemId` | An episode or movie ID with existing segments |
| `sampleItemId2` | A second item ID (used by bulk operation tests) |

Run the Browse tests first (they only need `sampleLibraryId`) and use the
responses to find IDs for the remaining variables.

### 3. Open Collection in Bruno

**Option A: VS Code Extension.** Open Command Palette (Ctrl+Shift+P), search
"Bruno: Open Collection", and select `bruno-tests/segment-reporting-api`.

**Option B: Bruno Desktop.** File > Open Collection, then navigate to
`bruno-tests/segment-reporting-api`.

## Test Organization

Tests are organized into folders matching the API categories:

| Folder | Tests | Endpoints Covered |
|--------|-------|-------------------|
| Browse | 10 | `library_summary`, `series_list`, `season_list`, `episode_list` |
| Items | 3 | `item_segments` |
| Edit | 5 | `update_segment`, `delete_segment` |
| Bulk | 7 | `bulk_apply`, `bulk_delete`, `bulk_set_credits_end` |
| Saved Queries | 4 | `saved_queries` (GET, POST, DELETE) |
| Preferences | 3 | `preferences` (GET, POST) |
| Info | 1 | `plugin_info` |
| Sync & Cache | 4 | `sync_status`, `sync_now`, `force_rescan`, `cache_stats` |
| Custom Queries | 3 | `canned_queries`, `submit_custom_query` |
| Auth | 1 | Authentication enforcement (no token) |

Each `.bru` file includes inline documentation with expected responses and
acceptance criteria.

## Recommended Test Order

Run tests in this order to build up state progressively:

1. **Sync & Cache > Get Sync Status** -- baseline check, works before first sync
2. **Sync & Cache > Sync Now** -- trigger initial sync (wait for it to finish)
3. **Browse > Get Library Summary** -- verify libraries appear after sync
4. **Browse > Get Series List** -- drill into a library
5. **Items > Get Item Segments** -- verify segment detail for an item
6. **Custom Queries > Get Canned Queries** -- verify built-in queries
7. **Custom Queries > Submit Custom Query** -- test a valid SELECT
8. **Custom Queries > Submit Custom Query - Invalid** -- verify rejection
9. **Auth > Auth Test - No Token** -- verify authentication enforcement
10. **Edit** and **Bulk** tests -- after confirming reads work
11. **Sync & Cache > Force Rescan** -- run last (destructive, see below)

## Destructive and Long-Running Tests

Some tests modify data or take significant time. Review this before running.

### Destructive -- Modifies Emby Data

These tests write through to Emby's chapter system. Changes are permanent and
will affect the Emby player UI:

- **Edit > Update Segment** -- writes a segment marker to an item
- **Edit > Delete Segment** -- removes a segment marker from an item
- **Bulk > Bulk Apply** -- copies segments from a source to target items
- **Bulk > Bulk Delete** -- removes segment types from multiple items
- **Bulk > Bulk Set Credits End** -- sets CreditsStart on multiple items

### Destructive -- Modifies Cache Only

These only affect the plugin's SQLite cache, not Emby's actual data:

- **Sync & Cache > Force Rescan** -- drops the entire cache and queues a
  rebuild. The plugin returns empty results until the sync finishes.

### Long-Running

- **Sync & Cache > Sync Now** -- queues a full library crawl. Returns
  immediately but the task runs in the background. Duration depends on library
  size (seconds for small libraries, minutes for 50K+ items).
- **Sync & Cache > Force Rescan** -- same background sync, plus the cache is
  empty until it completes.

### Safe (Read-Only)

All other tests are safe to run repeatedly with no side effects:

- All **Browse** and **Items** tests (read from the SQLite cache)
- All **Custom Queries** tests (writes are rejected at the database level)
- All **Saved Queries** and **Preferences** tests (only modify the plugin's
  own database tables, not Emby data)
- **Info**, **Sync & Cache > Get Sync Status / Cache Stats**, **Auth**

## Quick Smoke Test (curl)

For a fast check without Bruno:

```bash
export EMBY_API_KEY="your-key"

# Check sync status (read-only)
curl -s -H "X-Emby-Token: $EMBY_API_KEY" \
  "http://localhost:8096/emby/segment_reporting/sync_status" | jq

# Get library summary (read-only)
curl -s -H "X-Emby-Token: $EMBY_API_KEY" \
  "http://localhost:8096/emby/segment_reporting/library_summary" | jq

# Run a custom query (read-only)
curl -s -X POST -H "X-Emby-Token: $EMBY_API_KEY" \
  "http://localhost:8096/emby/segment_reporting/submit_custom_query?query=SELECT%20COUNT(*)%20as%20TotalSegments%20FROM%20MediaSegments" | jq

# Verify auth enforcement (should return 401/403)
curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:8096/emby/segment_reporting/sync_status"
```

## Notes

- The plugin must be installed and Emby restarted before testing
- Sync task may take several minutes depending on library size
- Check Emby server logs for detailed output (`%AppData%\Emby-Server\logs` on
  Windows, `/var/log/emby-server/` on Linux)
