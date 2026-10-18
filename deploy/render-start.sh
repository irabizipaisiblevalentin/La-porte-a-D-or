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

if [ -z "${S3_BUCKET:-}" ] || [ -z "${S3_ACCESS_KEY_ID:-}" ] || [ -z "${S3_SECRET_ACCESS_KEY:-}" ]; then
  echo "[render-start] S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY not set — starting WITHOUT database replication (data is wiped on every deploy/restart)."
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

{
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
  if [ -n "${S3_ENDPOINT:-}" ]; then
    echo "        endpoint: \${S3_ENDPOINT}"
  fi
} > "$LITESTREAM_CONFIG"
chmod 600 "$LITESTREAM_CONFIG"

# --- Restore, then replicate -------------------------------------------------
if [ -f "$DATABASE_FILE" ]; then
  echo "[render-start] local database present — skipping restore."
else
  echo "[render-start] restoring database from s3://${S3_BUCKET}/${LITESTREAM_DB_PREFIX} (if a replica exists)…"
  attempt=1
  until "$LITESTREAM_BIN" restore -if-replica-exists -config "$LITESTREAM_CONFIG" "$DATABASE_FILE"; do
    if [ "$attempt" -ge 3 ]; then
      echo "[render-start] WARNING: restore still failing after ${attempt} attempts — continuing with an empty local database. Replication stays ON, so current data will be backed up; older snapshots remain in the bucket (litestream restore -timestamp can recover them)."
      break
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
fi

echo "[render-start] starting app under Litestream replication…"
exec "$LITESTREAM_BIN" replicate -config "$LITESTREAM_CONFIG" -exec "npm start"
