#!/usr/bin/env bash
# Installs git hooks for this repository.
# Usage: ./scripts/setup-hooks.sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SCRIPTS_DIR="$REPO_ROOT/scripts"

echo "Installing git hooks..."

# Install pre-commit hook
cp "$SCRIPTS_DIR/pre-commit" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"
echo "  Installed pre-commit hook"

echo "Done. Hooks installed to $HOOKS_DIR"
