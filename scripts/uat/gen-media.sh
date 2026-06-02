#!/usr/bin/env bash
#
# gen-media.sh -- generate sparse synthetic media (black-frame H.264 clips +
# lockdata NFOs) for the UAT harness. Standalone-callable: prints the temp dir
# holding the generated tree on stdout so seed.sh can docker cp it.
#
# Static black frames temporally compress to almost nothing (~9.7 KB for a
# 600s clip) while still reporting a true runtime, so markers sit at lifelike
# offsets. lockdata NFOs stop Emby's online matcher from renaming fake shows.

set -euo pipefail

SR_UAT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/uat/lib.sh disable=SC1091
. "$SR_UAT_DIR/lib.sh"

OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sr-uat-media.XXXXXX")"

# clip <out.mp4> <seconds>
clip() {
    ffmpeg -nostdin -loglevel error -y \
        -f lavfi -i "color=c=black:s=128x72:r=1" -t "$2" \
        -c:v libx264 -pix_fmt yuv420p -preset ultrafast -movflags +faststart \
        "$1"
}

# --- TV: 2 shows, 1 season each, 4 episodes each (8 episodes total) --------
mk_show() {
    # mk_show <Show Name>
    local show="$1"
    local dir="$OUT_DIR/SR-UAT-TV/$show"
    mkdir -p "$dir/Season 01"
    cat > "$dir/tvshow.nfo" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<tvshow>
  <title>$show</title>
  <lockdata>true</lockdata>
</tvshow>
EOF
    local ep
    for ep in 1 2 3 4; do
        local base
        base="$(printf '%s S01E%02d' "$show" "$ep")"
        clip "$dir/Season 01/$base.mp4" 600
        cat > "$dir/Season 01/$base.nfo" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<episodedetails>
  <title>$show Episode $ep</title>
  <season>1</season>
  <episode>$ep</episode>
  <lockdata>true</lockdata>
</episodedetails>
EOF
    done
}

mk_show "SR Test Alpha"
mk_show "SR Test Bravo"

# --- Movies: 2 movies ------------------------------------------------------
mk_movie() {
    # mk_movie <Movie Name (Year)>
    local name="$1"
    local dir="$OUT_DIR/SR-UAT-Movies/$name"
    mkdir -p "$dir"
    clip "$dir/$name.mp4" 600
    cat > "$dir/$name.nfo" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>$name</title>
  <lockdata>true</lockdata>
</movie>
EOF
}

mk_movie "SR Test Movie One (2024)"
mk_movie "SR Test Movie Two (2024)"

echo "$OUT_DIR"
