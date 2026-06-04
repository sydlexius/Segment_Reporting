#!/usr/bin/env bash
#
# lib.sh -- shared helpers for the UAT Emby harness (scripts/uat/*).
#
# SAFETY: this file reads ONLY EMBY_UAT_* from .env and refuses to run unless the
# target host is a local UAT host (localhost / 127.0.0.1 / ::1). It never reads
# EMBY_PROD_*. The harness performs destructive writes (marker edits, bulk ops,
# library deletes); pointing it at production is a hard error.
#
# Source this from the other scripts:  . "$(dirname "$0")/lib.sh"
# Not meant to be executed directly.

set -euo pipefail

# --- Require bash 4+ -------------------------------------------------------
# The harness uses bash 4+ features (mapfile, ${!var} indirection). macOS ships
# bash 3.2; install a newer one with `brew install bash`.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
    echo "FATAL: the UAT harness requires bash >= 4 (found ${BASH_VERSION:-unknown})." >&2
    echo "       Install a newer bash: brew install bash" >&2
    exit 1
fi

# --- Resolve repo root (scripts/uat/lib.sh -> two levels up) ---------------
SR_UAT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SR_UAT_DIR/../.." && pwd)"

# --- Load .env (only the keys we explicitly read below) --------------------
# Inline/pre-set environment variables take precedence over .env values:
# only load a key from .env when it is not already set in the environment.
ENV_FILE="$REPO_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
    while IFS='=' read -r key val; do
        case "$key" in
            EMBY_UAT_URL|EMBY_UAT_API_KEY)
                val="${val%$'\r'}"; val="${val%\"}"; val="${val#\"}"
                # Only set if not already present in the environment
                if [ -z "${!key+set}" ]; then
                    export "$key=$val"
                fi
                ;;
        esac
    done < <(grep -E '^EMBY_UAT_(URL|API_KEY)=' "$ENV_FILE" || true)
fi

BASE_URL="${EMBY_UAT_URL:-}"
API_KEY="${EMBY_UAT_API_KEY:-}"
CONTAINER="${CONTAINER:-emby}"

# --- Safety guard ----------------------------------------------------------
if [ -z "$BASE_URL" ] || [ -z "$API_KEY" ]; then
    echo "FATAL: EMBY_UAT_URL and EMBY_UAT_API_KEY must be set in $ENV_FILE" >&2
    exit 1
fi

# Extract the host, handling bracketed IPv6 literals like [::1]:8096
# (a naive %%:* would split [::1] at its first colon and yield "[").
_hostport="${BASE_URL#*://}"; _hostport="${_hostport%%/*}"
case "$_hostport" in
    \[*\]*) _host="${_hostport#\[}"; _host="${_host%%\]*}" ;;  # [::1]:8096 -> ::1
    *)      _host="${_hostport%%:*}" ;;                        # host:port   -> host
esac
case "$_host" in
    localhost|127.0.0.1|::1) : ;;
    *)
        echo "FATAL: refusing to run -- EMBY_UAT_URL host '$_host' is not a UAT/localhost host." >&2
        echo "       This harness is destructive and must never target a remote/production Emby." >&2
        exit 1
        ;;
esac

# --- Per-run log dir -------------------------------------------------------
RUN_LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sr-uat.XXXXXX")"
export BASE_URL API_KEY CONTAINER RUN_LOG_DIR

# Curl timeouts so an unresponsive target (e.g. an IPv6-only or wrong-port
# host) fails fast instead of hanging the whole harness.
SR_CURL_OPTS=(--connect-timeout 5 --max-time 30)

log() { printf '[uat] %s\n' "$*"; }

# The API key travels in the X-Emby-Token header (not the URL query string) so
# it never lands in Emby's access logs or the local process table (ps).
sr_get() {
    local path="$1"; shift || true
    local qs="${1:-}"
    local url="${BASE_URL}${path}"
    [ -n "$qs" ] && url="${url}?${qs}"
    curl -fsS "${SR_CURL_OPTS[@]}" -H "X-Emby-Token: ${API_KEY}" "$url"
}

sr_post() {
    local path="$1"; shift || true
    local qs="${1:-}"
    local url="${BASE_URL}${path}"
    [ -n "$qs" ] && url="${url}?${qs}"
    curl -fsS "${SR_CURL_OPTS[@]}" -H "X-Emby-Token: ${API_KEY}" -X POST "$url"
}

sr_status() {
    local path="$1"; shift || true
    local qs="${1:-}"
    local url="${BASE_URL}${path}"
    [ -n "$qs" ] && url="${url}?${qs}"
    curl -s -o /dev/null -w '%{http_code}' "${SR_CURL_OPTS[@]}" -H "X-Emby-Token: ${API_KEY}" "$url"
}

jqf() { jq -r "$1"; }

# delete_uat_libraries [prefix] -- remove every Emby VirtualFolder whose name
# starts with the synthetic UAT prefix (default "SR-UAT"). Name-based delete
# throws a NullReferenceException on Emby 4.9.5, so we resolve each
# VirtualFolder's ItemId and delete by id (which returns 204).
#
# This is the shared idempotency + "merge-disable" reset used by both seed.sh and
# clean.sh: it guarantees a prior run's libraries (the primary SR-UAT-TV /
# SR-UAT-Movies pair, the themed extra libraries, and any symlink duplicate-root
# libraries) are all torn down before a fresh seed re-creates them. Matching by
# prefix (instead of by exact name) is what lets the seed grow or shrink the set
# of synthetic libraries without leaving orphans behind.
delete_uat_libraries() {
    local prefix="${1:-SR-UAT}" id name status
    sr_get /emby/Library/VirtualFolders '' \
        | jq -r --arg p "$prefix" '
            map(select((.Name // "") | startswith($p)))
            | .[] | [ (.ItemId // .Id // ""), (.Name // "") ] | @tsv' \
    | while IFS=$'\t' read -r id name; do
        [ -n "$id" ] || continue
        log "Removing library '$name' (id=$id)"
        status="$(curl -s -o /dev/null -w '%{http_code}' "${SR_CURL_OPTS[@]}" -X DELETE \
            -H "X-Emby-Token: ${API_KEY}" \
            "${BASE_URL}/emby/Library/VirtualFolders?id=${id}" || echo "000")"
        if [ "$status" != "204" ] && [ "$status" != "404" ]; then
            log "WARN: failed to remove library '$name' (id=$id, status=$status)"
        fi
    done
}

wait_for_healthy() {
    # Short per-attempt timeout (2s) so a non-responding target can't stall each
    # of the 60 iterations; the loop still bounds total wait to ~60s.
    local i code
    for i in $(seq 1 60); do
        code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 3 \
            "${BASE_URL}/System/Info/Public" || true)"
        if [ "$code" = "200" ]; then
            log "Emby healthy after ${i}s"
            return 0
        fi
        sleep 1
    done
    echo "FATAL: Emby did not become healthy within 60s at $BASE_URL" >&2
    return 1
}
