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

if [ -n "${S3_BUCKET:-}" ] && [ -n "${S3_ACCESS_KEY_ID:-}" ] && [ -n "${S3_SECRET_ACCESS_KEY:-}" ]; then
  REPLICA_TYPE="s3"
elif [ -n "${REPLICA_BUCKET:-}" ]; then
  REPLICA_TYPE="gcs"
else
  echo "[entrypoint] S3_* and REPLICA_BUCKET not set — starting WITHOUT replication (ephemeral data)."
  exec node "$APP_ENTRY"
fi

REPLICA_PREFIX="${REPLICA_PREFIX:-chorale}"
LITESTREAM_CONFIG="${LITESTREAM_CONFIG:-/etc/litestream.yml}"

if [ "$REPLICA_TYPE" = "s3" ]; then
  cat > "$LITESTREAM_CONFIG" <<EOF
dbs:
  - path: ${DATABASE_FILE}
    replicas:
      - type: s3
        bucket: ${S3_BUCKET}
        path: ${REPLICA_PREFIX}
        region: ${S3_REGION:-us-east-1}
        access-key-id: ${S3_ACCESS_KEY_ID}
        secret-access-key: ${S3_SECRET_ACCESS_KEY}
        force-path-style: ${S3_FORCE_PATH_STYLE:-true}
$([ -n "${S3_ENDPOINT:-}" ] && echo "        endpoint: ${S3_ENDPOINT}")
EOF
  echo "[entrypoint] Restoring database from s3://${S3_BUCKET}/${REPLICA_PREFIX} (if a replica exists)…"
else
  cat > "$LITESTREAM_CONFIG" <<EOF
dbs:
  - path: ${DATABASE_FILE}
    replicas:
      - type: gcs
        bucket: ${REPLICA_BUCKET}
        path: ${REPLICA_PREFIX}
EOF
  echo "[entrypoint] Restoring database from gs://${REPLICA_BUCKET}/${REPLICA_PREFIX} (if a replica exists)…"
fi

litestream restore -if-replica-exists -config "$LITESTREAM_CONFIG" "$DATABASE_FILE" \
  || echo "[entrypoint] No replica found yet — starting with a fresh database."

echo "[entrypoint] Starting app under Litestream replication…"
exec litestream replicate -config "$LITESTREAM_CONFIG" -exec "node ${APP_ENTRY}"
