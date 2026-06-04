#!/usr/bin/env bash
#
# run-fuzz.sh -- build + instrument + fuzz the pure validator targets.
# Intended to run INSIDE the scripts/fuzz Docker image (see `make fuzz`).
# Local manual gate only: never invoked by CI or a git hook.
#
#   MAX_TOTAL_TIME  per-target campaign seconds (default 60; 0 = unbounded)
#   FUZZ_TARGETS    space-separated target names (default: dangerous pragma)
#   BUILD_CONFIG    dotnet configuration (default Debug)
#   EMBY_ABI        plugin Emby ABI to build against (default 4.9)
#
# Why Debug + EmbyAbi=4.9 by default (deviates from the original plan): the
# plugin's Release build minifies its embedded JS via npm (no Node in this
# image), and the default 4.10 ABI references gitignored embylibs/ that are not
# present in the container. The 4.9 ABI resolves the Emby SDK from NuGet, and a
# Debug build skips the Release-only JS minification. The fuzzed predicates are
# pure string logic, so neither the ABI choice nor JS minification affects them.

set -euo pipefail

MAX_TOTAL_TIME="${MAX_TOTAL_TIME:-60}"
# 'marker' is intentionally excluded: MarkerTypes.Valid.Contains routes only
# through framework collection code, so SharpFuzz/AFL sees no instrumented
# branches and aborts ("No instrumentation detected"). It provably never throws
# on a non-null string and is covered by an xUnit test instead.
FUZZ_TARGETS="${FUZZ_TARGETS:-dangerous pragma}"
BUILD_CONFIG="${BUILD_CONFIG:-Debug}"
EMBY_ABI="${EMBY_ABI:-4.9}"

FUZZ_DIR="tests/segment_reporting.Fuzz"
OUT="$FUZZ_DIR/bin/$BUILD_CONFIG/net8.0"

echo "[fuzz] building fuzz project ($BUILD_CONFIG, EmbyAbi=$EMBY_ABI)"
dotnet build "$FUZZ_DIR/segment_reporting.Fuzz.csproj" -c "$BUILD_CONFIG" -p:EmbyAbi="$EMBY_ABI"

echo "[fuzz] instrumenting plugin assembly with sharpfuzz"
sharpfuzz "$OUT/segment_reporting.dll"

mkdir -p "$FUZZ_DIR/testcases" "$FUZZ_DIR/findings"
# Seed corpus: a benign SELECT so AFL has a starting input.
[ -f "$FUZZ_DIR/testcases/seed" ] || printf 'SELECT 1 FROM MediaSegments' > "$FUZZ_DIR/testcases/seed"

for target in $FUZZ_TARGETS; do
    echo "[fuzz] === target: $target (max ${MAX_TOTAL_TIME}s) ==="
    AFL_SKIP_BIN_CHECK=1 timeout "${MAX_TOTAL_TIME}"s \
        afl-fuzz -i "$FUZZ_DIR/testcases" -o "$FUZZ_DIR/findings/$target" -m none -- \
        dotnet "$OUT/segment_reporting.Fuzz.dll" "$target" || rc=$?
    # timeout returns 124 when the time box elapses cleanly; that is success.
    if [ "${rc:-0}" -ne 0 ] && [ "${rc:-0}" -ne 124 ]; then
        echo "[fuzz] target $target exited $rc (crash or setup error) -- inspect $FUZZ_DIR/findings/$target/crashes"
        exit "$rc"
    fi
    unset rc
done

echo "[fuzz] done. Any crashes are under $FUZZ_DIR/findings/<target>/crashes/"
