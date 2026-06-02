#!/usr/bin/env bash
#
# deploy.sh -- build the Release DLL and install it into the UAT Emby container.
# Uses docker cp uniformly (no host bind-mount knowledge required), restarts the
# container, and waits for Emby to report healthy.

set -euo pipefail

SR_UAT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/uat/lib.sh disable=SC1091
. "$SR_UAT_DIR/lib.sh"

DLL="$REPO_ROOT/segment_reporting/bin/Release/netstandard2.0/segment_reporting.dll"

# The Release build minifies JS via an MSBuild target that runs `npm ci` when
# segment_reporting/node_modules is absent. In a worktree, npm's `prepare`
# lifecycle (lefthook install) can exit non-zero even though the dependencies
# (esbuild) install fine. Pre-install here tolerating that prepare failure so the
# build's MinifyJS step has esbuild available; once node_modules exists the
# MSBuild target (and this block) are skipped.
NM_MARKER="$REPO_ROOT/segment_reporting/node_modules/.package-lock.json"
if [ ! -f "$NM_MARKER" ]; then
    log "Installing JS build deps (tolerating worktree prepare-hook failure)"
    ( cd "$REPO_ROOT/segment_reporting" && npm ci ) \
        || log "npm prepare step failed (ignored); JS deps are installed"
fi

log "Building Release DLL (tee -> $RUN_LOG_DIR/build.log)"
dotnet build "$REPO_ROOT/segment_reporting/segment_reporting.csproj" -c Release \
    2>&1 | tee "$RUN_LOG_DIR/build.log"

[ -f "$DLL" ] || { echo "FATAL: DLL not found at $DLL" >&2; exit 1; }

log "Copying DLL into container '$CONTAINER':/config/plugins/"
docker cp "$DLL" "$CONTAINER:/config/plugins/segment_reporting.dll"

log "Restarting container '$CONTAINER'"
docker restart "$CONTAINER" >/dev/null

wait_for_healthy
log "Deploy complete."
