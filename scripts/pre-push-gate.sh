#!/usr/bin/env bash
#
# pre-push-gate.sh -- deterministic pre-push checks that mirror the CI "build"
# job in .github/workflows/build.yml. Run by the lefthook pre-push stage so a
# push that would fail CI is caught locally first.
#
# CI runs, in order: minify JS, restore deps, `dotnet build <sln> -c Release
# -warnaserror`, `dotnet test <sln> -c Release --no-build`,
# `dotnet format --verify-no-changes`, `npm run lint:js`. A
# Release build already minifies the JS (MinifyJS target, BeforeTargets
# CoreCompile) and restores the originals (RestoreJS target, AfterTargets
# Build) on its own, so we do not minify separately. The catch: RestoreJS only
# runs when the build *succeeds*; a compile failure leaves the minified sources
# in the working tree. The cleanup trap below always runs `build:restore` so
# the tree is left untouched whether the gate passes or fails.
#
# Exit status: 0 = all checks passed; non-zero = a check failed.
#
# Skip the whole gate with: git push --no-verify (use sparingly).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

SLN="Segment_Reporting.sln"
NPM_PREFIX="segment_reporting"

# Always restore the original (un-minified) JS/HTML sources on exit so the
# working tree is identical before and after the gate, even if the Release
# build failed before its own RestoreJS target could run. build:restore is a
# no-op when there is no backup, so it is safe to call unconditionally.
cleanup() {
    local status=$?
    npm run build:restore --prefix "$NPM_PREFIX" >/dev/null 2>&1 || true
    exit "$status"
}
trap cleanup EXIT

echo "=== Release build (-warnaserror, mirrors CI) ==="
# Release config auto-minifies JS, embeds it as resources, compiles with
# analyzers as errors, then restores the JS. This is the single most important
# CI parity check: a clean pre-commit can still break this.
dotnet build "$SLN" --configuration Release -warnaserror

echo ""
echo "=== Unit tests (xUnit, --no-build reuses the Release build above) ==="
# The fast pure-logic suite (custom-query validators, marker types). Runs in
# CI's build job too; running it here catches a test regression before the push.
# It needs no Emby server. The UAT/fuzz gates are local-only and NOT run here.
dotnet test "$SLN" --configuration Release --no-build

echo ""
echo "=== Code formatting (dotnet format --verify-no-changes) ==="
dotnet format "$SLN" --verify-no-changes

echo ""
echo "=== JavaScript lint (npm run lint:js) ==="
npm run lint:js --prefix "$NPM_PREFIX"

echo ""
echo "=== HTML accessibility lint (npm run lint:html) ==="
# Static a11y/WCAG check on the embedded pages (missing labels, bad ARIA,
# duplicate ids, missing img alt, etc). Runtime contrast checks (axe) are a
# local UAT-only tool and are intentionally not part of this gate.
npm run lint:html --prefix "$NPM_PREFIX"

echo ""
echo "All pre-push checks passed (matches CI build job)."
