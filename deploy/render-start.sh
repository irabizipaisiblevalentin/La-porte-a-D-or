#!/bin/sh
# Render (native environment) start command — see docs/DEPLOYMENT.md.
#
# Render's free plan has an EPHEMERAL disk: the SQLite file is wiped on every
# deploy and instance restart. When S3_* variables are set (Backblaze B2 or any
# S3-compatible store) this script keeps the database durable with Litestream:
#
#   1. download the Litestream binary once per instance (cached in .render/bin),
#   2. write a Litestream config that references the S3_* env vars — Litestream
#      expands ${...} itself, so NO secret is ever written to disk,
#   3. restore the database from the bucket when the local file is missing,
#   4. run `npm start` under continuous replication.
#
# With no S3 configuration the app starts directly (data is ephemeral — fine
# before the bucket exists, NOT durable). Uploads mirror to the same bucket via
# the app's own S3_* handling (see server/src/config.ts).
set -eu

# Repo root (Render runs the start command from here, but stay explicit).
cd "$(dirname "$0")/.."

# Mirror the server's own resolution (server/src/config.ts):
# DATABASE_FILE wins, then DATA_DIR/chorale.db, then server/data/chorale.db.
DATABASE_FILE="${DATABASE_FILE:-${DATA_DIR:-$PWD/server/data}/chorale.db}"

# Written when this boot could NOT recover the database. The server reads it on
# startup and says so out loud (red banner + /api/health) instead of quietly
# serving an empty database, which is how real records disappeared once already.
MARKER_FILE="$(dirname "$DATABASE_FILE")/RESTORE-FAILED.txt"
LOG_TAG="render-start"
# shellcheck source=deploy/restore-alert.sh
. "$(dirname "$0")/restore-alert.sh"

if [ -z "${S3_BUCKET:-}" ] || [ -z "${S3_ACCESS_KEY_ID:-}" ] || [ -z "${S3_SECRET_ACCESS_KEY:-}" ]; then
  echo "[render-start] S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY not set — starting WITHOUT database replication (data is wiped on every deploy/restart)."
  mark_restore_problem replication_disabled "durable storage is not configured (S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are unset), so every restart erases all data"
  exec npm start
fi

mkdir -p "$(dirname "$DATABASE_FILE")"

# --- Litestream binary -------------------------------------------------------
LITESTREAM_VERSION="${LITESTREAM_VERSION:-0.5.17}"
LITESTREAM_BIN="${LITESTREAM_BIN:-$PWD/.render/bin/litestream}"

if [ ! -x "$LITESTREAM_BIN" ]; then
  case "$(uname -m)" in
    aarch64|arm64) LITESTREAM_ARCH="arm64" ;;
    *)             LITESTREAM_ARCH="x86_64" ;;
  esac
  echo "[render-start] downloading litestream v${LITESTREAM_VERSION} (${LITESTREAM_ARCH})…"
  mkdir -p "$(dirname "$LITESTREAM_BIN")"
  LITESTREAM_TARBALL="litestream-${LITESTREAM_VERSION}-linux-${LITESTREAM_ARCH}.tar.gz"
  if curl -fsSL --retry 3 "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/${LITESTREAM_TARBALL}" \
      | tar -xz -C "$(dirname "$LITESTREAM_BIN")" litestream; then
    chmod +x "$LITESTREAM_BIN"
  else
    echo "[render-start] could not download litestream — starting WITHOUT replication (the site still runs; the database is not being backed up until this succeeds)."
    mark_restore_problem litestream_unavailable "the Litestream binary could not be downloaded, so the database is neither restored nor backed up"
    exec npm start
  fi
fi

# --- Litestream configuration ------------------------------------------------
# The bucket/keys/region/endpoint are referenced as ${S3_*} literals and
# expanded by Litestream when it loads the file, so this file contains no
# secrets. Shell defaults are exported so Litestream can see them.
export S3_REGION="${S3_REGION:-us-east-1}"
export S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"
LITESTREAM_CONFIG="${LITESTREAM_CONFIG:-${TMPDIR:-/tmp}/litestream.yml}"
LITESTREAM_DB_PREFIX="${LITESTREAM_DB_PREFIX:-chorale-db}"

# --- Daily transaction budget -------------------------------------------------
# Backblaze B2's free allowance is 2,500 Class A (writes), Class B (reads) and
# Class C (listings) calls per day, and an account without a payment method
# cannot raise that cap. Litestream's stock settings (1s sync, a 15-second
# L0-retention check and a 30s L1 compaction) issue up to ~12,000 *listing*
# calls a day on their own, so a busy day silently exhausts the Class C
# allowance: replication freezes, and the next boot restores an old database (or,
# while the cap is still exceeded, none at all).
#
# The settings below keep every class in the low hundreds per day while still
# restoring the database on every boot. Each one can be overridden from the
# Render dashboard (`LITESTREAM_*`), but there is normally no reason to: raise
# them only with the transaction counters in *Caps & Alerts* in front of you.
LITESTREAM_SYNC_INTERVAL="${LITESTREAM_SYNC_INTERVAL:-120s}"        # 1s default → ≤720 uploads/day
LITESTREAM_L0_RETENTION="${LITESTREAM_L0_RETENTION:-1h}"            # 5m default
LITESTREAM_L0_CHECK_INTERVAL="${LITESTREAM_L0_CHECK_INTERVAL:-1h}"  # 15s default → was ~11.5k listings/day
LITESTREAM_L1_INTERVAL="${LITESTREAM_L1_INTERVAL:-15m}"            # 30s default
LITESTREAM_L2_INTERVAL="${LITESTREAM_L2_INTERVAL:-1h}"             # 5m default
LITESTREAM_L3_INTERVAL="${LITESTREAM_L3_INTERVAL:-6h}"             # 1h default
LITESTREAM_SNAPSHOT_INTERVAL="${LITESTREAM_SNAPSHOT_INTERVAL:-24h}" # 24h default

{
  # Keep the whole daily API-call total far below Backblaze B2's 2,500/class
  # free allowance: a card-free account cannot raise the cap, and a frozen
  # replica is the silent data loss we are guarding against.
  echo "l0-retention: ${LITESTREAM_L0_RETENTION}"
  echo "l0-retention-check-interval: ${LITESTREAM_L0_CHECK_INTERVAL}"
  echo "levels:"
  echo "  - interval: ${LITESTREAM_L1_INTERVAL}"
  echo "  - interval: ${LITESTREAM_L2_INTERVAL}"
  echo "  - interval: ${LITESTREAM_L3_INTERVAL}"
  echo "snapshot:"
  echo "  interval: ${LITESTREAM_SNAPSHOT_INTERVAL}"
  echo "dbs:"
  echo "  - path: '${DATABASE_FILE}'"
  echo "    replicas:"
  echo "      - type: s3"
  echo "        bucket: \${S3_BUCKET}"
  echo "        path: ${LITESTREAM_DB_PREFIX}"
  echo "        region: \${S3_REGION}"
  echo "        access-key-id: \${S3_ACCESS_KEY_ID}"
  echo "        secret-access-key: \${S3_SECRET_ACCESS_KEY}"
  echo "        force-path-style: \${S3_FORCE_PATH_STYLE}"
  echo "        sync-interval: ${LITESTREAM_SYNC_INTERVAL}"
  if [ -n "${S3_ENDPOINT:-}" ]; then
    echo "        endpoint: \${S3_ENDPOINT}"
  fi
} > "$LITESTREAM_CONFIG"
chmod 600 "$LITESTREAM_CONFIG"

# --- Restore, then replicate -------------------------------------------------
if [ -f "$DATABASE_FILE" ]; then
  echo "[render-start] local database present — skipping restore."
else
  # Clear any marker from an earlier boot on this disk; it is rewritten below if
  # this restore fails, so the app knows to complain loudly.
  clear_restore_marker
  echo "[render-start] restoring database from s3://${S3_BUCKET}/${LITESTREAM_DB_PREFIX} (if a replica exists)…"
  attempt=1
  restore_failed=0
  until "$LITESTREAM_BIN" restore -if-replica-exists -config "$LITESTREAM_CONFIG" "$DATABASE_FILE"; do
    if [ "$attempt" -ge 5 ]; then
      restore_failed=1
      break
    fi
    echo "[render-start] restore attempt ${attempt} failed — retrying in 10s…"
    attempt=$((attempt + 1))
    sleep 10
  done
  if [ "$restore_failed" = "1" ]; then
    # An empty database is about to be created. Say so in the logs AND to the
    # app (marker + env), because silently serving an empty database is exactly
    # how real member records disappeared unnoticed.
    mark_restore_problem restore_failed "the database could not be restored from the bucket after ${attempt} attempts; starting with a fresh, empty database"
    echo "[render-start] older snapshots may still be in the bucket: 'litestream restore -timestamp <time>' can recover them."
  fi
fi

echo "[render-start] starting app under Litestream replication…"
exec "$LITESTREAM_BIN" replicate -config "$LITESTREAM_CONFIG" -exec "npm start"
