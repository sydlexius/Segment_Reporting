#!/usr/bin/env bash
#
# gen-media.sh -- generate sparse synthetic media (black-frame H.264 clips +
# lockdata NFOs) for the UAT harness. Standalone-callable: prints the temp dir
# holding the generated tree on stdout so seed.sh can docker cp it.
#
# Static black frames temporally compress to almost nothing (a 600s clip is
# ~9.7 KB) while still reporting a true runtime, so markers sit at lifelike
# offsets. lockdata NFOs stop Emby's online matcher from renaming fake shows.
#
# This generator builds a DELIBERATELY RICH tree -- several libraries, many
# shows across multiple seasons, and two movie libraries -- so the plugin's
# charts, dashboard rows, and series views look realistic in screenshots
# (issue #117). Clip durations vary so runtime-derived marker offsets (computed
# in seed.sh from each item's RunTimeTicks) spread out across the charts.
#
# Beyond the generated tree, gen-media.sh writes a manifest at
# "$OUT_DIR/libraries.tsv" (one "<LibraryName>\t<collectionType>\t<containerPath>"
# row per library). seed.sh reads that manifest to create the Emby libraries, so
# the set of libraries is defined HERE in one place and never duplicated.
#
# Tunables (env, all optional):
#   SR_UAT_SHOWS_PER_LIB   shows generated per TV library      (default 5)
#   SR_UAT_MAX_SEASONS     max seasons per show                (default 2)
#   SR_UAT_MAX_EPISODES    max episodes per season             (default 6)
#   SR_UAT_MOVIES_PER_LIB  movies generated per movie library  (default 6)
#   SR_UAT_DUP_ROOTS       symlink duplicate-root libraries    (default 0)
#                          see the "DUPLICATE-ROOT" block below.

set -euo pipefail

SR_UAT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/uat/lib.sh disable=SC1091
. "$SR_UAT_DIR/lib.sh"

# This script prints ONLY the generated tree path on stdout (seed.sh captures it
# via command substitution). Redirect progress logging to stderr so it never
# pollutes that single stdout line.
log() { printf '[uat] %s\n' "$*" >&2; }

OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sr-uat-media.XXXXXX")"
MANIFEST="$OUT_DIR/libraries.tsv"
: > "$MANIFEST"

CONTAINER_MEDIA_ROOT="/uat-media"

# --- Tunables --------------------------------------------------------------
: "${SR_UAT_SHOWS_PER_LIB:=5}"
: "${SR_UAT_MAX_SEASONS:=2}"
: "${SR_UAT_MAX_EPISODES:=6}"
: "${SR_UAT_MOVIES_PER_LIB:=6}"
: "${SR_UAT_DUP_ROOTS:=0}"

# --- Fictional, privacy-safe title pools -----------------------------------
# Everything synthetic is clearly fictional. These never collide with a real
# library, so screenshots captured against UAT can skip anonymization.
SHOW_NAMES=(
    "The Hollow Coast" "Ember and Ash" "Northwind" "Glasshouse"
    "The Tidewater Files" "Lightfall" "Orbital Drift" "The Ninth Signal"
    "Vector Prime" "Cul-de-Sac" "The Breakroom" "Two Left Feet"
    "Paper Lanterns" "The Cartographer" "Saltmarsh" "Lowtide"
)
EP_TITLES=(
    "Cold Open" "The Long Way" "Static" "Homecoming"
    "Gridlock" "Afterglow" "The Cut" "Slipstream"
    "Landfall" "Quiet Hours" "The Margin" "Overcast"
    "Nightshift" "The Inland Sea" "Driftwood" "Last Call"
)
MOVIE_NAMES=(
    "The Last Horizon" "Echo Valley" "Northern Lights" "Glass City"
    "The Quiet Mile" "Paper Moon Rising" "Driftwater" "The Hollow Crown"
    "Silver Lining" "Open Road" "The Long Winter" "Coastline"
    "Midsummer" "The Far Shore" "Lantern Festival" "Stone and Sky"
)
# Varied runtimes (seconds). seed.sh derives marker offsets from RunTimeTicks,
# so varying these spreads the credits/intro markers across the charts.
EP_DURATIONS=(600 720 900 1080 1320)
MOVIE_DURATIONS=(1500 1800 2100 2400)

# --- Validate tunables -----------------------------------------------------
# These env knobs are part of the script's public contract, so fail fast on
# values the generation logic can't honor rather than producing modulo-by-zero
# errors, a silently-wrong shape, or pool wrap that overwrites earlier folders.
for v in SR_UAT_SHOWS_PER_LIB SR_UAT_MAX_SEASONS SR_UAT_MAX_EPISODES \
         SR_UAT_MOVIES_PER_LIB SR_UAT_DUP_ROOTS; do
    [[ ${!v} =~ ^[0-9]+$ ]] || { log "FATAL: $v must be a non-negative integer (got '${!v}')"; exit 1; }
done
# MAX_SEASONS feeds a modulo (idx % SR_UAT_MAX_SEASONS), so 0 would divide by zero.
[ "$SR_UAT_MAX_SEASONS" -ge 1 ] || { log "FATAL: SR_UAT_MAX_SEASONS must be >= 1"; exit 1; }
# Episode count floors at 4 (4..MAX_EPISODES), so anything below 4 is misleading.
[ "$SR_UAT_MAX_EPISODES" -ge 4 ] || { log "FATAL: SR_UAT_MAX_EPISODES must be >= 4"; exit 1; }
# Per-library counts index into fixed title pools; exceeding the pool wraps and
# overwrites earlier folders instead of creating distinct content.
[ "$SR_UAT_SHOWS_PER_LIB" -le "${#SHOW_NAMES[@]}" ] || { log "FATAL: SR_UAT_SHOWS_PER_LIB exceeds title pool size (${#SHOW_NAMES[@]})"; exit 1; }
[ "$SR_UAT_MOVIES_PER_LIB" -le "${#MOVIE_NAMES[@]}" ] || { log "FATAL: SR_UAT_MOVIES_PER_LIB exceeds title pool size (${#MOVIE_NAMES[@]})"; exit 1; }

# --- ffmpeg clip helper ----------------------------------------------------
# clip <out.mp4> <seconds>
clip() {
    ffmpeg -nostdin -loglevel error -y \
        -f lavfi -i "color=c=black:s=128x72:r=1" -t "$2" \
        -c:v libx264 -pix_fmt yuv420p -preset ultrafast -movflags +faststart \
        "$1"
}

# add_manifest <LibraryName> <collectionType> <relDir>
add_manifest() {
    printf '%s\t%s\t%s\n' "$1" "$2" "$CONTAINER_MEDIA_ROOT/$3" >> "$MANIFEST"
}

# --- TV generation ---------------------------------------------------------
# mk_episode <seasonDir> <Show> <seasonNo> <epNo> <epTitle> <duration>
mk_episode() {
    local seasonDir="$1" show="$2" sNo="$3" eNo="$4" title="$5" dur="$6"
    local base
    base="$(printf '%s S%02dE%02d %s' "$show" "$sNo" "$eNo" "$title")"
    clip "$seasonDir/$base.mp4" "$dur"
    cat > "$seasonDir/$base.nfo" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<episodedetails>
  <title>$title</title>
  <season>$sNo</season>
  <episode>$eNo</episode>
  <lockdata>true</lockdata>
</episodedetails>
EOF
}

# mk_show <libRootDir> <Show> <showIndex>
mk_show() {
    local root="$1" show="$2" idx="$3"
    local dir="$root/$show"
    mkdir -p "$dir"
    cat > "$dir/tvshow.nfo" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<tvshow>
  <title>$show</title>
  <lockdata>true</lockdata>
</tvshow>
EOF
    # Deterministic per-show shape so reruns are stable: 1..MAX_SEASONS seasons,
    # 4..MAX_EPISODES episodes per season.
    local seasons epRange
    seasons=$(( (idx % SR_UAT_MAX_SEASONS) + 1 ))
    epRange=$(( SR_UAT_MAX_EPISODES - 3 ))
    [ "$epRange" -ge 1 ] || epRange=1
    local s e eps title dur seasonDir tIdx dIdx
    for s in $(seq 1 "$seasons"); do
        seasonDir="$(printf '%s/Season %02d' "$dir" "$s")"
        mkdir -p "$seasonDir"
        eps=$(( 4 + ((idx + s) % epRange) ))
        for e in $(seq 1 "$eps"); do
            tIdx=$(( (idx * 7 + s * 3 + e) % ${#EP_TITLES[@]} ))
            dIdx=$(( (idx + s + e) % ${#EP_DURATIONS[@]} ))
            title="${EP_TITLES[$tIdx]}"
            dur="${EP_DURATIONS[$dIdx]}"
            mk_episode "$seasonDir" "$show" "$s" "$e" "$title" "$dur"
        done
    done
}

# mk_tv_library <LibraryName> <relDir> <showStartIdx>
mk_tv_library() {
    local name="$1" rel="$2" start="$3"
    local root="$OUT_DIR/$rel"
    mkdir -p "$root"
    log "TV library '$name' -> $rel ($SR_UAT_SHOWS_PER_LIB shows)"
    local i sIdx show
    for i in $(seq 0 $(( SR_UAT_SHOWS_PER_LIB - 1 ))); do
        sIdx=$(( (start + i) % ${#SHOW_NAMES[@]} ))
        show="${SHOW_NAMES[$sIdx]}"
        mk_show "$root" "$show" "$(( start + i ))"
    done
    add_manifest "$name" tvshows "$rel"
}

# --- Movie generation ------------------------------------------------------
# mk_movie <libRootDir> <Movie> <year> <duration>
mk_movie() {
    local root="$1" name="$2" year="$3" dur="$4"
    local folder="$name ($year)"
    local dir="$root/$folder"
    mkdir -p "$dir"
    clip "$dir/$folder.mp4" "$dur"
    cat > "$dir/$folder.nfo" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>$name</title>
  <year>$year</year>
  <lockdata>true</lockdata>
</movie>
EOF
}

# mk_movie_library <LibraryName> <relDir> <movieStartIdx>
mk_movie_library() {
    local name="$1" rel="$2" start="$3"
    local root="$OUT_DIR/$rel"
    mkdir -p "$root"
    log "Movie library '$name' -> $rel ($SR_UAT_MOVIES_PER_LIB movies)"
    local i mIdx movie year dIdx dur
    for i in $(seq 0 $(( SR_UAT_MOVIES_PER_LIB - 1 ))); do
        mIdx=$(( (start + i) % ${#MOVIE_NAMES[@]} ))
        movie="${MOVIE_NAMES[$mIdx]}"
        year=$(( 2008 + ((start + i) % 16) ))
        dIdx=$(( (start + i) % ${#MOVIE_DURATIONS[@]} ))
        dur="${MOVIE_DURATIONS[$dIdx]}"
        mk_movie "$root" "$movie" "$year" "$dur"
    done
    add_manifest "$name" movies "$rel"
}

# --- Build the library set -------------------------------------------------
# The FIRST TV library MUST be named "SR-UAT-TV" and the first movie library
# "SR-UAT-Movies": capture-ids.sh keys the Bruno sample IDs off those names. The
# extra themed libraries exist purely to make the dashboard show several library
# rows. Every library name starts with "SR-UAT" so delete_uat_libraries() (in
# lib.sh) can tear the whole set down by prefix.
mk_tv_library    "SR-UAT-TV"            "SR-UAT-TV"            0
mk_tv_library    "SR-UAT-TV-Classics"   "SR-UAT-TV-Classics"  "$SR_UAT_SHOWS_PER_LIB"
mk_movie_library "SR-UAT-Movies"        "SR-UAT-Movies"       0
mk_movie_library "SR-UAT-Movies-Indie"  "SR-UAT-Movies-Indie" "$SR_UAT_MOVIES_PER_LIB"

# --- DUPLICATE-ROOT (library-count inflation) ------------------------------
# Issue #117 asks for a "merge-disable + duplicate-root" technique to inflate the
# number of libraries cheaply. Multiple Emby VirtualFolders that point at the
# SAME directory path are the natural way to do that, but Emby may refuse a
# second library at an already-registered path. The fallback implemented here:
# generate one shared content tree, then create N sibling SYMLINKS to it, each a
# DISTINCT path string, and register each symlink as its own library.
#
# Relative symlink targets are used so they still resolve after `docker cp` lands
# the tree at /uat-media inside the container (docker cp preserves symlinks).
#
# >>> VERIFIED on Emby (UAT, 4.9.x), acceptance criterion #3 <<<
# Distinct symlink roots pointing at the same target register as SEPARATE
# libraries: a SR_UAT_DUP_ROOTS=2 run produced SR-UAT-Dup-1 and SR-UAT-Dup-2 as
# two distinct VirtualFolders, each with its own items. Emby does NOT canonicalize
# (realpath) the root or dedupe to the shared inode. Likewise, multiple
# same-content-type libraries at genuinely distinct paths (the 4 defaults) each
# render separately, so no explicit merge-disable option is needed. This stays an
# optional capability: default is 0 (off) since the 4 distinct-path libraries
# already give the dashboard several rows.
if [ "$SR_UAT_DUP_ROOTS" -gt 0 ] 2>/dev/null; then
    log "DUP-ROOT: generating shared tree + $SR_UAT_DUP_ROOTS symlink libraries (EMPIRICAL - see comment)"
    SHARED_REL="SR-UAT-Shared"
    SHARED_ROOT="$OUT_DIR/$SHARED_REL"
    mkdir -p "$SHARED_ROOT"
    # A small but real show so the duplicate libraries are not empty.
    mk_show "$SHARED_ROOT" "Shared Signal" 0
    n=1
    while [ "$n" -le "$SR_UAT_DUP_ROOTS" ]; do
        link="SR-UAT-Dup-$n"
        # Relative target so it resolves inside the container at /uat-media.
        ln -s "$SHARED_REL" "$OUT_DIR/$link"
        add_manifest "$link" tvshows "$link"
        n=$(( n + 1 ))
    done
fi

log "Generated $(grep -c . "$MANIFEST") libraries; manifest at $MANIFEST"
echo "$OUT_DIR"
