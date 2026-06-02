#!/usr/bin/env bash
#
# capture-ids.sh -- discover the seeded item IDs from Emby and write them into
# the Bruno Local.bru environment. Names are unstable, so we key off IDs and
# filter by the in-container media path (/uat-media).

set -euo pipefail

SR_UAT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/uat/lib.sh disable=SC1091
. "$SR_UAT_DIR/lib.sh"

LOCAL_BRU="$REPO_ROOT/bruno-tests/segment-reporting-api/environments/Local.bru"

# Pull all seeded items (Series, Season, Episode, Movie) with their Path.
items_json="$(sr_get /emby/Items \
    'Recursive=true&IncludeItemTypes=Episode,Series,Season,Movie&Fields=Path,ParentId')"

sampleSeriesId="$(echo "$items_json" | jq -r '
    .Items | map(select(.Type=="Series" and ((.Name // "") | startswith("SR Test")))) | (.[0].Id // empty)')"
sampleSeasonId="$(echo "$items_json" | jq -r --arg s "$sampleSeriesId" '
    .Items | map(select(.Type=="Season" and (.SeriesId == $s or .ParentId == $s))) | (.[0].Id // empty)')"
# Two episodes under /uat-media for sampleItemId / sampleItemId2.
mapfile -t eps < <(echo "$items_json" | jq -r '
    .Items | map(select(.Type=="Episode" and ((.Path // "") | startswith("/uat-media")))) | .[].Id')
sampleItemId="${eps[0]:-}"
sampleItemId2="${eps[1]:-}"

# Library ID: take it from the plugin's own library_summary so it matches the
# LibraryId the other plugin endpoints key off (the top-parent folder id, which
# differs from the Emby VirtualFolder ItemId). LibraryName is the media path
# leaf folder ("SR-UAT-TV").
ls_json="$(sr_get /emby/segment_reporting/library_summary '')"
sampleLibraryId="$(echo "$ls_json" | jq -r '
    map(select(.LibraryName=="SR-UAT-TV")) | (.[0].LibraryId // empty)')"

for v in sampleLibraryId sampleSeriesId sampleSeasonId sampleItemId sampleItemId2; do
    eval "val=\$$v"
    [ -n "$val" ] || { echo "FATAL: could not resolve $v -- did seed run?" >&2; exit 1; }
    log "$v=$val"
done

# Rewrite the vars block in Local.bru, preserving the secret block.
cat > "$LOCAL_BRU" <<EOF
vars {
  baseUrl: ${BASE_URL}
  sampleLibraryId: ${sampleLibraryId}
  sampleSeriesId: ${sampleSeriesId}
  sampleSeasonId: ${sampleSeasonId}
  sampleItemId: ${sampleItemId}
  sampleItemId2: ${sampleItemId2}
}
vars:secret [
  apiKey
]
EOF

log "Wrote sample IDs into $LOCAL_BRU"
