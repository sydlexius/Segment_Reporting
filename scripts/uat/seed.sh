#!/usr/bin/env bash
#
# seed.sh -- idempotent UAT seeding:
#   1. delete any prior SR-UAT libraries (idempotency)
#   2. generate sparse media + NFOs
#   3. docker cp the tree into the container at /uat-media
#   4. create TV + Movies libraries via the VirtualFolders API, scan
#   5. sync_now so the plugin caches the new items
#   6. write a varied marker coverage matrix via update_segment
#   7. capture the discovered IDs into Local.bru

set -euo pipefail

SR_UAT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/uat/lib.sh disable=SC1091
. "$SR_UAT_DIR/lib.sh"

TICK=10000000  # ticks per second

delete_lib() {
    # delete_lib <Name> -- best-effort removal of a virtual folder. Name-based
    # delete throws a NullReferenceException on Emby 4.9.5, so resolve the
    # VirtualFolder's ItemId and delete by id (which returns 204).
    local name="$1" id
    id="$(sr_get /emby/Library/VirtualFolders '' \
        | jq -r --arg n "$name" 'map(select(.Name==$n)) | (.[0].ItemId // .[0].Id // empty)')"
    if [ -n "$id" ]; then
        log "Removing prior library '$name' (id=$id)"
        curl -s -o /dev/null -X DELETE \
            "${BASE_URL}/emby/Library/VirtualFolders?api_key=${API_KEY}&id=${id}" || true
    fi
}

# --- 1. idempotency: drop prior SR-UAT libraries ---------------------------
delete_lib "SR-UAT-TV"
delete_lib "SR-UAT-Movies"

# --- 2. generate media -----------------------------------------------------
log "Generating media"
MEDIA_DIR="$(bash "$SR_UAT_DIR/gen-media.sh")"
log "Media at $MEDIA_DIR"

# --- 3. copy into container ------------------------------------------------
log "Clearing + copying /uat-media in container '$CONTAINER'"
docker exec "$CONTAINER" sh -c 'rm -rf /uat-media && mkdir -p /uat-media' || true
docker cp "$MEDIA_DIR/." "$CONTAINER:/uat-media/"

# --- 4. create libraries + scan -------------------------------------------
create_lib() {
    # create_lib <Name> <collectionType> <path>
    local name="$1" ctype="$2" path="$3"
    log "Creating library '$name' ($ctype) -> $path"
    curl -fsS -X POST \
        "${BASE_URL}/emby/Library/VirtualFolders?api_key=${API_KEY}&name=$(jq -rn --arg n "$name" '$n|@uri')&collectionType=${ctype}&paths=${path}&refreshLibrary=true" \
        -o /dev/null -w 'HTTP %{http_code}\n'
}
create_lib "SR-UAT-TV"     tvshows /uat-media/SR-UAT-TV
create_lib "SR-UAT-Movies" movies  /uat-media/SR-UAT-Movies

log "Triggering full library scan + waiting for ingest (tee -> $RUN_LOG_DIR/scan.log)"
sr_post /emby/Library/Refresh '' | tee "$RUN_LOG_DIR/scan.log" || true
# Give Emby time to ingest the small tree.
sleep 20

# --- 5. plugin sync --------------------------------------------------------
log "sync_now (tee -> $RUN_LOG_DIR/sync.log)"
sr_post /emby/segment_reporting/sync_now '' | tee "$RUN_LOG_DIR/sync.log"
sleep 10

# --- discover episode + movie IDs for marker writes ------------------------
# (sr_get appends api_key itself; pass only the real query params)
items_json="$(sr_get /emby/Items \
    'Recursive=true&IncludeItemTypes=Episode,Movie&Fields=Path')"
mapfile -t ep_ids < <(echo "$items_json" | jq -r '
    .Items | map(select(.Type=="Episode" and ((.Path // "")|startswith("/uat-media")))) | .[].Id')
mapfile -t movie_ids < <(echo "$items_json" | jq -r '
    .Items | map(select(.Type=="Movie" and ((.Path // "")|startswith("/uat-media")))) | .[].Id')

[ "${#ep_ids[@]}" -ge 4 ] || { echo "FATAL: expected >=4 episodes, got ${#ep_ids[@]}" >&2; exit 1; }
[ "${#movie_ids[@]}" -ge 1 ] || { echo "FATAL: expected >=1 movie, got ${#movie_ids[@]}" >&2; exit 1; }

set_marker() {
    # set_marker <itemId> <MarkerType> <ticks>
    sr_post /emby/segment_reporting/update_segment \
        "ItemId=$1&MarkerType=$2&Ticks=$3" >/dev/null
}

# --- 6. coverage matrix ----------------------------------------------------
# Offsets validated on a 600s clip: Intro 0:05-0:35, CreditsStart 9:30.
INTRO_START=$((5  * TICK))    #   50000000
INTRO_END=$((35   * TICK))    #  350000000
CREDITS=$((570    * TICK))    # 5700000000

# ep[0] = Intro + Credits (WithBoth)
log "ep ${ep_ids[0]}: Intro + Credits"
set_marker "${ep_ids[0]}" IntroStart  "$INTRO_START"
set_marker "${ep_ids[0]}" IntroEnd    "$INTRO_END"
set_marker "${ep_ids[0]}" CreditsStart "$CREDITS"
# ep[1] = Intro only (WithIntro)
log "ep ${ep_ids[1]}: Intro only"
set_marker "${ep_ids[1]}" IntroStart  "$INTRO_START"
set_marker "${ep_ids[1]}" IntroEnd    "$INTRO_END"
# ep[2] = Credits only (WithCredits)
log "ep ${ep_ids[2]}: Credits only"
set_marker "${ep_ids[2]}" CreditsStart "$CREDITS"
# ep[3] = None (WithNeither) -- leave bare.
log "ep ${ep_ids[3]}: none (WithNeither)"
# movie[0] = Intro + Credits (exercises null series/season path)
log "movie ${movie_ids[0]}: Intro + Credits"
set_marker "${movie_ids[0]}" IntroStart   "$INTRO_START"
set_marker "${movie_ids[0]}" IntroEnd     "$INTRO_END"
set_marker "${movie_ids[0]}" CreditsStart "$CREDITS"

log "re-sync to reflect markers in cache"
sr_post /emby/segment_reporting/sync_now '' >/dev/null
sleep 8

# --- 7. capture IDs --------------------------------------------------------
bash "$SR_UAT_DIR/capture-ids.sh"
log "Seed complete."
