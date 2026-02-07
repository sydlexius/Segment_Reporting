# Segment Reporting API Tests

Bruno collection for testing issue #7 admin API endpoints.

## Setup

### 1. Store API Key in 1Password

```bash
# Add your Emby API key to 1Password CLI
op item create --category="API Credential" \
  --title="Emby API Key (Local)" \
  --field="label=api_key,type=concealed,value=YOUR_API_KEY_HERE"
```

### 2. Set Environment Variable

```bash
# Retrieve from 1Password and export
export EMBY_API_KEY=$(op item get "Emby API Key (Local)" --fields api_key)

# Or manually set it
export EMBY_API_KEY="your-api-key-here"
```

### 3. Open Collection in Bruno

**Option A: VSCode Extension**
1. Open Command Palette (Ctrl+Shift+P)
2. Search: "Bruno: Open Collection"
3. Select `bruno-tests/segment-reporting-api`

**Option B: Bruno Desktop**
1. File → Open Collection
2. Navigate to `bruno-tests/segment-reporting-api`

## Running Tests

### Recommended Test Order

1. **Get Sync Status** - Baseline check (works even before first sync)
2. **Get Canned Queries** - Verify all 6 queries are returned
3. **Sync Now** - Trigger initial sync
   - Wait for task to complete (check Dashboard → Scheduled Tasks)
4. **Submit Custom Query** - Test with valid SELECT query
5. **Submit Custom Query - Invalid** - Verify security (should reject DELETE)
6. **Auth Test - No Token** - Verify authentication required
7. **Force Rescan** - Test destructive operation (use with caution)

### Quick Test All (bash)

```bash
# Set API key
export EMBY_API_KEY="your-key"

# Test each endpoint
curl -H "X-Emby-Token: $EMBY_API_KEY" \
  "http://localhost:8096/emby/segment_reporting/sync_status" | jq

curl -H "X-Emby-Token: $EMBY_API_KEY" \
  "http://localhost:8096/emby/segment_reporting/canned_queries" | jq

curl -X POST -H "X-Emby-Token: $EMBY_API_KEY" \
  "http://localhost:8096/emby/segment_reporting/sync_now" | jq

curl -X POST -H "X-Emby-Token: $EMBY_API_KEY" \
  "http://localhost:8096/emby/segment_reporting/submit_custom_query?query=SELECT%20COUNT(*)%20FROM%20MediaSegments" | jq
```

## Acceptance Criteria Checklist

Per [issue #7](https://github.com/faush01/segment_reporting/issues/7):

- [ ] **sync_now** triggers TaskSyncSegments and returns status
  - Check: Task appears in Dashboard → Scheduled Tasks
  - Check: Returns `{"success": true, "message": "Sync task queued"}`

- [ ] **sync_status** returns last sync information
  - Check: Before first sync returns "No sync has been performed yet"
  - Check: After sync returns lastFullSync, itemsScanned, syncDuration

- [ ] **force_rescan** drops and rebuilds the cache
  - Check: MediaSegments table is dropped
  - Check: Sync task is queued
  - Check: Data is repopulated after sync completes

- [ ] **Custom queries** execute read-only against the cache
  - Check: Valid SELECT query returns QueryResult with columns/rows
  - Check: Invalid INSERT/UPDATE/DELETE query is rejected
  - Check: Error message: "Only SELECT, PRAGMA, and EXPLAIN queries are allowed"

- [ ] **Canned queries** return correct pre-built SQL
  - Check: Returns array of 6 queries
  - Check: Each has `name` and `sql` fields
  - Check: Queries match specification in issue #7

- [ ] **All endpoints require admin authentication**
  - Check: Request without X-Emby-Token header returns 401/403
  - Check: Request with invalid token returns 401/403
  - Check: Request with valid admin token succeeds

## Notes

- The plugin must be installed and Emby restarted before testing
- Sync task may take several minutes depending on library size
- Use `force_rescan` sparingly - it's a destructive operation
- Check Emby logs at `%AppData%\Emby-Server\logs` for detailed output
