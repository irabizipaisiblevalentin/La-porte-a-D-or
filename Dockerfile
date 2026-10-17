# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Chorale La Porte d'Or — production image for Cloud Run (behind Firebase
# Hosting, which provides the https://<project>.web.app address).
#
# The app is an Express server that also serves the built SPA. It owns a
# SQLite database (better-sqlite3). Cloud Run disks are ephemeral, so the
# entrypoint restores/replicates the database to Cloud Storage via Litestream.
# ---------------------------------------------------------------------------

# ---- Stage 1: build -------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Build tools so better-sqlite3 can compile if a prebuilt binary is unavailable.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching). The root lockfile covers
# the npm workspaces (server + web).
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

# Build the SPA and the server (tsc + copy of schema.sql/migrations into dist).
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    DATABASE_FILE=/data/chorale.db \
    WEB_DIST_DIR=/app/web/dist \
    HOST=0.0.0.0 \
    PORT=8080

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Litestream — continuous SQLite replication to Cloud Storage.
ARG LITESTREAM_VERSION=0.3.13
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin && rm -f /tmp/litestream.tar.gz && litestream version

WORKDIR /app
COPY --from=build /app /app
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Ephemeral by default; uploaded media should be mounted from Cloud Storage
# (see docs/DEPLOYMENT.md). The database is protected by Litestream instead.
VOLUME ["/data"]
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
