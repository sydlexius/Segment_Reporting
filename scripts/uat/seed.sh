#!/usr/bin/env bash
#
# seed.sh -- idempotent UAT seeding:
#   1. delete any prior SR-UAT libraries (idempotency)
#   2. generate sparse media + NFOs (many libraries/shows/seasons/episodes)
#   3. docker cp the tree into the container at /uat-media
#   4. create every library listed in the generated manifest, scan
#   5. sync_now so the plugin caches the new items
#   6. write a varied marker coverage matrix via update_segment
#   7. capture the discovered IDs into Local.bru

set -euo pipefail

SR_UAT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/uat/lib.sh disable=SC1091
. "$SR_UAT_DIR/lib.sh"

TICK=10000000  # ticks per second

# --- 1. idempotency: drop ALL prior SR-UAT libraries -----------------------
# Prefix-based teardown (see lib.sh) so it covers the primary pair, the themed
# extras, and any symlink duplicate-root libraries from a previous run.
delete_uat_libraries "SR-UAT"

# --- 2. generate media -----------------------------------------------------
log "Generating media"
MEDIA_DIR="$(bash "$SR_UAT_DIR/gen-media.sh")"
MANIFEST="$MEDIA_DIR/libraries.tsv"
log "Media at $MEDIA_DIR"
[ -f "$MANIFEST" ] || { echo "FATAL: gen-media did not produce $MANIFEST" >&2; exit 1; }

# --- 3. copy into container ------------------------------------------------
# docker cp preserves the symlinks used by the duplicate-root technique; the
# relative symlink targets resolve under /uat-media inside the container.
log "Clearing + copying /uat-media in container '$CONTAINER'"
docker exec "$CONTAINER" sh -c 'rm -rf /uat-media && mkdir -p /uat-media' || true
docker cp "$MEDIA_DIR/." "$CONTAINER:/uat-media/"

# --- 4. create libraries + scan -------------------------------------------
create_lib() {
    # create_lib <Name> <collectionType> <containerPath>
    local name="$1" ctype="$2" path="$3"
    log "Creating library '$name' ($ctype) -> $path"
    curl -fsS -X POST -H "X-Emby-Token: ${API_KEY}" \
        "${BASE_URL}/emby/Library/VirtualFolders?name=$(jq -rn --arg n "$name" '$n|@uri')&collectionType=${ctype}&paths=$(jq -rn --arg p "$path" '$p|@uri')&refreshLibrary=true" \
        -o /dev/null -w 'HTTP %{http_code}\n'
}

# Create every library declared in the generated manifest (single source of
# truth: gen-media.sh decides the set of libraries, seed.sh just realizes them).
while IFS=$'\t' read -r lib_name lib_type lib_path; do
    [ -n "$lib_name" ] || continue
    create_lib "$lib_name" "$lib_type" "$lib_path"
done < "$MANIFEST"

log "Triggering full library scan + waiting for ingest (tee -> $RUN_LOG_DIR/scan.log)"
sr_post /emby/Library/Refresh '' | tee "$RUN_LOG_DIR/scan.log" || true
# Give Emby time to ingest the tree. The dataset is larger now, so wait longer.
sleep 30

# --- 5. plugin sync --------------------------------------------------------
log "sync_now (tee -> $RUN_LOG_DIR/sync.log)"
sr_post /emby/segment_reporting/sync_now '' | tee "$RUN_LOG_DIR/sync.log"
sleep 12

# --- discover episode + movie IDs + runtimes for marker writes -------------
# (sr_get sends the api key via the X-Emby-Token header; pass only the real
# query params here). RunTimeTicks lets us place markers at lifelike, in-bounds
# offsets regardless of each clip's duration.
items_json="$(sr_get /emby/Items \
    'Recursive=true&IncludeItemTypes=Episode,Movie&Fields=Path,RunTimeTicks')"
# Emit "<id>\t<runtimeTicks>" rows, filtered to the synthetic media path. The
# query order is stable across calls, so capture-ids.sh later resolves the same
# first-N items as sample IDs.
mapfile -t ep_rows < <(echo "$items_json" | jq -r '
    .Items | map(select(.Type=="Episode" and ((.Path // "")|startswith("/uat-media"))))
    | .[] | [ .Id, (.RunTimeTicks // 0) ] | @tsv')
mapfile -t movie_rows < <(echo "$items_json" | jq -r '
    .Items | map(select(.Type=="Movie" and ((.Path // "")|startswith("/uat-media"))))
    | .[] | [ .Id, (.RunTimeTicks // 0) ] | @tsv')

[ "${#ep_rows[@]}" -ge 4 ] || { echo "FATAL: expected >=4 episodes, got ${#ep_rows[@]}" >&2; exit 1; }
[ "${#movie_rows[@]}" -ge 1 ] || { echo "FATAL: expected >=1 movie, got ${#movie_rows[@]}" >&2; exit 1; }
log "Discovered ${#ep_rows[@]} episodes + ${#movie_rows[@]} movies under /uat-media"

set_marker() {
    # set_marker <itemId> <MarkerType> <ticks>
    sr_post /emby/segment_reporting/update_segment \
        "ItemId=$1&MarkerType=$2&Ticks=$3" >/dev/null
}

# apply_coverage <id> <runtimeTicks> <bucket 0..3>
# Buckets: 0=Intro+Credits, 1=Intro only, 2=Credits only, 3=none. Marker offsets
# are derived from the item's runtime so they always land inside the clip:
#   IntroStart = 5s, IntroEnd = 35s, CreditsStart = runtime - 30s.
apply_coverage() {
    local id="$1" rt="$2" bucket="$3"
    local intro_start=$(( 5 * TICK )) intro_end=$(( 35 * TICK )) credits
    [ "$rt" -gt 0 ] 2>/dev/null || rt=$(( 600 * TICK ))   # fallback: 600s
    credits=$(( rt - 30 * TICK ))
    # Guard against unrealistically short clips.
    [ "$credits" -gt "$intro_end" ] || credits=$(( rt - 5 * TICK ))
    case "$bucket" in
        0) set_marker "$id" IntroStart "$intro_start"
           set_marker "$id" IntroEnd "$intro_end"
           set_marker "$id" CreditsStart "$credits" ;;
        1) set_marker "$id" IntroStart "$intro_start"
           set_marker "$id" IntroEnd "$intro_end" ;;
        2) set_marker "$id" CreditsStart "$credits" ;;
        3) : ;;  # WithNeither -- leave bare
    esac
}

# --- 6. coverage matrix ----------------------------------------------------
# Cycle the four buckets across all episodes so every library_summary bucket
# (WithBoth / WithIntro / WithCredits / WithNeither) is well populated for the
# charts. Index 0 -> Both and index 1 -> Intro keeps the first two sample
# episodes (sampleItemId / sampleItemId2 in Bruno) marked as before.
log "Writing coverage matrix across ${#ep_rows[@]} episodes (4-bucket cycle)"
i=0
for row in "${ep_rows[@]}"; do
    IFS=$'\t' read -r id rt <<< "$row"
    apply_coverage "$id" "$rt" "$(( i % 4 ))"
    i=$(( i + 1 ))
done

# Movies cycle Both / Credits / Intro so the null series/season path is exercised
# with mixed coverage too.
log "Writing coverage matrix across ${#movie_rows[@]} movies"
movie_buckets=(0 2 1)
i=0
for row in "${movie_rows[@]}"; do
    IFS=$'\t' read -r id rt <<< "$row"
    apply_coverage "$id" "$rt" "${movie_buckets[$(( i % ${#movie_buckets[@]} ))]}"
    i=$(( i + 1 ))
done

log "re-sync to reflect markers in cache"
sr_post /emby/segment_reporting/sync_now '' >/dev/null
sleep 10

# --- 7. capture IDs --------------------------------------------------------
bash "$SR_UAT_DIR/capture-ids.sh"
log "Seed complete."
