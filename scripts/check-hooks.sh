#!/usr/bin/env bash
#
# check-hooks.sh -- verify the lefthook-managed git hooks are actually wired up.
# Analog to a "are my hooks installed" check: a hook that silently is not
# installed gives a false sense of safety (pre-commit / pre-push never fire).
#
# Exits 0 when configuration is correct, non-zero otherwise.
# Run it after cloning, or any time you suspect hooks are not firing:
#   bash scripts/check-hooks.sh   (or: npm run verify:hooks --prefix segment_reporting)
#
# Fix wiring with: npm run prepare --prefix segment_reporting
# (the `prepare` script runs `lefthook install`, which regenerates the stubs).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

fail() {
    echo "FAIL: $1" >&2
    echo "Fix: npm run prepare --prefix segment_reporting" >&2
    exit 1
}

# lefthook may be a global binary or the project-local npm install. Resolve a
# command we can actually invoke before relying on it.
if command -v lefthook >/dev/null 2>&1; then
    LEFTHOOK="lefthook"
else
    LEFTHOOK="npx --prefix segment_reporting lefthook"
fi

# 1. lefthook config itself must be valid (catches YAML / schema errors that
#    would make the hooks no-op or error at commit time).
if ! $LEFTHOOK validate >/dev/null 2>&1; then
    echo "FAIL: 'lefthook validate' did not pass for lefthook.yml" >&2
    $LEFTHOOK validate || true
    exit 1
fi

# 2. The generated stubs must exist in .git/hooks and delegate to lefthook.
#    `lefthook install` writes these; if they are missing, hooks never fire.
HOOKS_DIR="$(git rev-parse --git-path hooks)"
for h in pre-commit pre-push; do
    stub="$HOOKS_DIR/$h"
    if [ ! -f "$stub" ]; then
        fail ".git hook '$h' is not installed ($stub missing)"
    fi
    if [ ! -x "$stub" ]; then
        fail ".git hook '$h' exists but is not executable ($stub)"
    fi
    # Match the actual delegation line the lefthook stub emits
    # (`call_lefthook run "<hook>"`), not just any mention of the word
    # "lefthook" in a comment. The literal string "lefthook run" never
    # appears in the generated stub, so this is the correct specific pattern.
    if ! grep -q "call_lefthook run" "$stub"; then
        fail ".git hook '$h' exists but does not delegate to lefthook ($stub)"
    fi
done

# 3. The pre-push gate script must be present and runnable.
if [ ! -f "scripts/pre-push-gate.sh" ]; then
    fail "scripts/pre-push-gate.sh is missing (pre-push stage would error)"
fi
if [ ! -x "scripts/pre-push-gate.sh" ]; then
    fail "scripts/pre-push-gate.sh exists but is not executable (chmod +x scripts/pre-push-gate.sh)"
fi

echo "OK: hooks wired -- lefthook.yml valid, pre-commit + pre-push stubs delegate to lefthook, pre-push-gate present."
