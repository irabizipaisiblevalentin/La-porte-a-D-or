#!/bin/sh
# Container entrypoint (optional Docker path — the production deployment runs
# directly on Render with deploy/render-start.sh; see docs/DEPLOYMENT.md).
#
# If S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are set (Backblaze B2
# or any S3-compatible store), or if REPLICA_BUCKET is set (Google Cloud
# Storage), run the app under Litestream: restore the SQLite database on boot,
# then continuously replicate WAL changes back to the bucket. This is what
# makes the database survive restarts, scale events, and redeploys.
#
# With neither set, start the app directly (data is ephemeral). That is fine
# for a local `docker run` smoke test, but do NOT use it for a real deployment.
set -eu

APP_ENTRY="${APP_ENTRY:-/app/server/dist/index.js}"
DATABASE_FILE="${DATABASE_FILE:-${DATA_DIR:-/data}/chorale.db}"
mkdir -p "$(dirname "$DATABASE_FILE")" 2>/dev/null || true

# Leaves a marker + a loud log line when the database could not be restored, so
# the app never comes up quietly on an empty database (see deploy/restore-alert.sh).
LOG_TAG="entrypoint"
MARKER_FILE="$(dirname "$DATABASE_FILE")/RESTORE-FAILED.txt"
. "$(dirname "$0")/restore-alert.sh"

if [ -n "${S3_BUCKET:-}" ] && [ -n "${S3_ACCESS_KEY_ID:-}" ] && [ -n "${S3_SECRET_ACCESS_KEY:-}" ]; then
  REPLICA_TYPE="s3"
elif [ -n "${REPLICA_BUCKET:-}" ]; then
  REPLICA_TYPE="gcs"
else
  echo "[entrypoint] S3_* and REPLICA_BUCKET not set — starting WITHOUT replication (ephemeral data)."
  mark_restore_problem replication_disabled "durable storage is not configured (S3_* / REPLICA_BUCKET are unset), so every restart erases all data"
  exec node "$APP_ENTRY"
fi

REPLICA_PREFIX="${REPLICA_PREFIX:-chorale}"
LITESTREAM_CONFIG="${LITESTREAM_CONFIG:-/etc/litestream.yml}"

# Transaction budget — see deploy/render-start.sh for the full explanation.
# Backblaze B2 gives 2,500 free Class A/B/C API calls per day and a card-free
# account cannot raise that cap, so the replica is tuned to a few hundred calls
# a day instead of Litestream's several thousand (1s sync, 15s L0-retention
# check, 30s L1 compaction). Override any of these with the env vars.
LITESTREAM_SYNC_INTERVAL="${LITESTREAM_SYNC_INTERVAL:-120s}"
LITESTREAM_L0_RETENTION="${LITESTREAM_L0_RETENTION:-1h}"
LITESTREAM_L0_CHECK_INTERVAL="${LITESTREAM_L0_CHECK_INTERVAL:-1h}"
LITESTREAM_L1_INTERVAL="${LITESTREAM_L1_INTERVAL:-15m}"
LITESTREAM_L2_INTERVAL="${LITESTREAM_L2_INTERVAL:-1h}"
LITESTREAM_L3_INTERVAL="${LITESTREAM_L3_INTERVAL:-6h}"
LITESTREAM_SNAPSHOT_INTERVAL="${LITESTREAM_SNAPSHOT_INTERVAL:-24h}"

# Shared by every replica backend below.
LITESTREAM_BUDGET_YAML="l0-retention: ${LITESTREAM_L0_RETENTION}
l0-retention-check-interval: ${LITESTREAM_L0_CHECK_INTERVAL}
levels:
  - interval: ${LITESTREAM_L1_INTERVAL}
  - interval: ${LITESTREAM_L2_INTERVAL}
  - interval: ${LITESTREAM_L3_INTERVAL}
snapshot:
  interval: ${LITESTREAM_SNAPSHOT_INTERVAL}
"

if [ "$REPLICA_TYPE" = "s3" ]; then
  cat > "$LITESTREAM_CONFIG" <<EOF
${LITESTREAM_BUDGET_YAML}dbs:
  - path: ${DATABASE_FILE}
    replicas:
      - type: s3
        bucket: ${S3_BUCKET}
        path: ${REPLICA_PREFIX}
        region: ${S3_REGION:-us-east-1}
        access-key-id: ${S3_ACCESS_KEY_ID}
        secret-access-key: ${S3_SECRET_ACCESS_KEY}
        force-path-style: ${S3_FORCE_PATH_STYLE:-true}
        sync-interval: ${LITESTREAM_SYNC_INTERVAL}
$([ -n "${S3_ENDPOINT:-}" ] && echo "        endpoint: ${S3_ENDPOINT}")
EOF
  echo "[entrypoint] Restoring database from s3://${S3_BUCKET}/${REPLICA_PREFIX} (if a replica exists)…"
else
  cat > "$LITESTREAM_CONFIG" <<EOF
${LITESTREAM_BUDGET_YAML}dbs:
  - path: ${DATABASE_FILE}
    replicas:
      - type: gcs
        bucket: ${REPLICA_BUCKET}
        path: ${REPLICA_PREFIX}
        sync-interval: ${LITESTREAM_SYNC_INTERVAL}
EOF
  echo "[entrypoint] Restoring database from gs://${REPLICA_BUCKET}/${REPLICA_PREFIX} (if a replica exists)…"
fi

# `-if-replica-exists` exits 0 when the bucket simply has no replica yet (a real
# first run). Any other failure is real: an unreachable bucket, a rejected key, or
# a Backblaze transaction cap — and that must not be mistaken for "nothing to
# restore" while the app starts up on an empty database.
if litestream restore -if-replica-exists -config "$LITESTREAM_CONFIG" "$DATABASE_FILE"; then
  clear_restore_marker
else
  mark_restore_problem restore_failed "the database could not be restored from the replica; starting with a fresh, empty database"
  echo "[entrypoint] Older snapshots may still be in the bucket: 'litestream restore -timestamp <time>' can recover them."
fi

echo "[entrypoint] Starting app under Litestream replication…"
exec litestream replicate -config "$LITESTREAM_CONFIG" -exec "node ${APP_ENTRY}"
