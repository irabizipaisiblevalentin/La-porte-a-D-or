#!/bin/sh
# Container entrypoint.
#
# If REPLICA_BUCKET is set, run the app under Litestream: restore the SQLite
# database from Cloud Storage on boot, then continuously replicate WAL changes
# back to the bucket. This is what makes the database survive Cloud Run
# restarts, scale events, and redeploys.
#
# If REPLICA_BUCKET is not set, start the app directly (data is ephemeral).
# That is fine for a local `docker run` smoke test, but do NOT use it for a
# real deployment.
set -eu

APP_ENTRY="${APP_ENTRY:-/app/server/dist/index.js}"
DATABASE_FILE="${DATABASE_FILE:-${DATA_DIR:-/data}/chorale.db}"
mkdir -p "$(dirname "$DATABASE_FILE")" 2>/dev/null || true

if [ -z "${REPLICA_BUCKET:-}" ]; then
  echo "[entrypoint] REPLICA_BUCKET not set — starting WITHOUT replication (ephemeral data)."
  exec node "$APP_ENTRY"
fi

REPLICA_PREFIX="${REPLICA_PREFIX:-chorale}"
LITESTREAM_CONFIG="${LITESTREAM_CONFIG:-/etc/litestream.yml}"

cat > "$LITESTREAM_CONFIG" <<EOF
dbs:
  - path: ${DATABASE_FILE}
    replicas:
      - type: gcs
        bucket: ${REPLICA_BUCKET}
        path: ${REPLICA_PREFIX}
EOF

echo "[entrypoint] Restoring database from gs://${REPLICA_BUCKET}/${REPLICA_PREFIX} (if a replica exists)…"
litestream restore -if-replica-exists -config "$LITESTREAM_CONFIG" "$DATABASE_FILE" \
  || echo "[entrypoint] No replica found yet — starting with a fresh database."

echo "[entrypoint] Starting app under Litestream replication…"
exec litestream replicate -config "$LITESTREAM_CONFIG" -exec "node ${APP_ENTRY}"
