#!/bin/sh
# Shared by deploy/render-start.sh (Render) and deploy/entrypoint.sh (Docker).
#
# A database that could not be restored from the bucket must never start up
# looking healthy. The app reads this marker on boot (server/src/config.ts →
# restoreAlert) and shouts about it: a red banner in the web app, a warning on
# /api/health, one audit entry and a notification in the Chairman's bell. See
# docs/DEPLOYMENT.md → Troubleshooting.
#
# Usage (from a script that has already set -eu):
#
#   LOG_TAG=render-start
#   MARKER_FILE=/data/RESTORE-FAILED.txt
#   . "$(dirname "$0")/restore-alert.sh"
#   mark_restore_problem restore_failed "the database could not be restored"
#   clear_restore_marker
#
# `reason` is a machine-readable token ("restore_failed", "replication_disabled",
# "litestream_unavailable"); `detail` is shown to administrators.

if [ -z "${MARKER_FILE:-}" ]; then
  echo "[restore-alert] MARKER_FILE must be set before sourcing restore-alert.sh" >&2
  exit 1
fi

LOG_TAG="${LOG_TAG:-restore-alert}"

# Records why this boot could not recover the database, and complains loudly.
# Set REQUIRE_RESTORE=1 to refuse to start instead of running without the data.
mark_restore_problem() {
  reason="$1"
  detail="$2"
  mkdir -p "$(dirname "$MARKER_FILE")" 2>/dev/null || true
  {
    echo "at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "reason=${reason}"
    echo "detail=${detail}"
  } > "$MARKER_FILE" 2>/dev/null || true
  # Also exported, so the warning survives even when the disk was not writable.
  export CHORALE_RESTORE_FAILED=1
  export CHORALE_RESTORE_DETAIL="$detail"
  echo "[${LOG_TAG}] ##########################################################################"
  echo "[${LOG_TAG}] # DATA INTEGRITY WARNING: ${detail}"
  echo "[${LOG_TAG}] # Starting anyway — the running app is NOT on the real database."
  echo "[${LOG_TAG}] # Re-enter nothing until storage access is fixed and this restores."
  echo "[${LOG_TAG}] ##########################################################################"
  if [ "${REQUIRE_RESTORE:-0}" = "1" ]; then
    echo "[${LOG_TAG}] REQUIRE_RESTORE=1 — refusing to start with an unrestored database (the previous instance keeps serving)."
    exit 1
  fi
}

# Called after a successful restore (or when a local database is already there).
clear_restore_marker() {
  rm -f "$MARKER_FILE" 2>/dev/null || true
}
