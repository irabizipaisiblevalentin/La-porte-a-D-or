# Deploying to a `*.web.app` address

This guide puts the app on the public internet at **`https://<your-project>.web.app`**.

## Why this architecture

`*.web.app` is a **Firebase Hosting** domain. Firebase Hosting serves static
files and can proxy requests to Google serverless backends — it cannot run a
long-lived Node/Express server with a SQLite file. So:

```
Browser ──▶ Firebase Hosting (https://<project>.web.app)
                 │  rewrite  /**  ─▶
                 ▼
            Cloud Run service "chorale-app"  (Express + the built SPA)
                 │
                 ├── SQLite  /data/chorale.db ──▶ Litestream ──▶ Cloud Storage bucket
                 └── uploads /data/storage      ──▶ (optional) Cloud Storage mount
```

- **Cloud Run** runs the existing server unchanged (it already serves the SPA
  and exposes `/api/**` and `/media/**` on one origin, so no CORS changes).
- **Firebase Hosting** provides the `https://<project>.web.app` URL and forwards
  every request to Cloud Run (`firebase.json`).
- **Cloud Run disks are ephemeral**, so the database is continuously replicated
  to Cloud Storage by **Litestream** (see `deploy/entrypoint.sh`). On each boot
  the database is restored before the app starts.

The files that implement this already exist in the repo:

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage build (web + server) with Litestream baked in. |
| `deploy/entrypoint.sh` | Restores/replicates SQLite via Litestream, then starts the app. |
| `firebase.json` | Rewrites all Hosting traffic to the Cloud Run service. |
| `.firebaserc.example` | Template you copy to `.firebaserc` with your project id. |
| `deploy/deploy.sh` | Runs the whole sequence below. |

## Prerequisites

1. A Google Cloud project with **billing enabled**.
2. **Firebase added to that project** (Firebase console → *Add project* → choose
   the existing GCP project). This is what turns on a `.web.app` domain.
3. CLIs authenticated:
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   npm i -g firebase-tools
   firebase login
   ```
4. The code on the machine running the deploy. This folder is not a git repo, so
   either upload/`scp` it, use Cloud Shell (which includes `gcloud`), or
   `git init` and push it somewhere the machine can clone.

## Deploy (one command)

```bash
PROJECT_ID=your-project-id ./deploy/deploy.sh
```

That script: enables the required APIs, creates the Cloud Storage bucket, creates
the `APP_SECRET` secret, deploys Cloud Run from the `Dockerfile`, and deploys
Firebase Hosting. When it finishes it prints your `https://<project>.web.app` URL.

## Deploy (manual, if you prefer step by step)

```bash
PROJECT_ID=your-project-id
REGION=us-central1
BUCKET="${PROJECT_ID}-chorale-data"

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com \
  storage.googleapis.com firebase.googleapis.com

# Bucket for Litestream (and, optionally, uploads).
gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" --uniform-bucket-level-access

# Application secret (session hashing + encrypted integration secrets).
# Keep it: changing it logs everyone out and makes stored secrets unreadable.
printf '%s' "$(openssl rand -base64 48)" | \
  gcloud secrets create chorale-app-secret --data-file=- --replication-policy=automatic

# Let the Cloud Run runtime service account read/write the bucket.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# Deploy the app (Cloud Build builds the Dockerfile in this folder).
gcloud run deploy chorale-app \
  --source . --region "$REGION" --allow-unauthenticated \
  --min-instances 1 --max-instances 1 \
  --execution-environment gen2 --cpu 1 --memory 1Gi \
  --set-env-vars "NODE_ENV=production,DATA_DIR=/data,DATABASE_FILE=/data/chorale.db,WEB_DIST_DIR=/app/web/dist,HOST=0.0.0.0,PORT=8080,SESSION_COOKIE_SECURE=true,REPLICA_BUCKET=${BUCKET},REPLICA_PREFIX=chorale" \
  --set-secrets "APP_SECRET=chorale-app-secret:latest"

# Firebase Hosting front door.
cp .firebaserc.example .firebaserc   # then set YOUR_GCP_PROJECT_ID
firebase deploy --only hosting
```

## Create the first administrator

On first boot there are no admins, so the server prints a one-time **setup token**
and writes it to `/data/FIRST-ADMIN-SETUP.txt` (not reachable over the web — use
the logs):

```bash
gcloud run services logs read chorale-app --region us-central1 --limit 80 | grep -i token
```

Then open `https://<project>.web.app/setup`, paste the token, and create the
Chairman account. The token expires after 24 hours; redeploy/restart to reissue.

> Prefer the built-in admins instead? They refuse to be created in production
> unless you set `ALLOW_DEFAULT_ACCOUNTS=1`, which is **not recommended**. The
> `/setup` flow is the intended path.

## Persisting uploaded media (photos, audio, documents)

The database is safe automatically (Litestream). **Uploaded files** live under
`/data/storage`, which is ephemeral unless you mount a bucket. To persist them,
mount a Cloud Storage bucket at `/data/storage` when deploying:

```bash
# Use a bucket that is NOT the Litestream replica (to keep SQLite and media apart).
gcloud run services update chorale-app --region us-central1 \
  --add-volume name=media,type=cloud-storage,bucket="${BUCKET}-media" \
  --add-volume-mount volume=media,mount-path=/data/storage
```

Caveats: Cloud Run's Cloud Storage mount is suited to write-once media, not to a
database (which is why SQLite uses Litestream instead). If you would rather keep
deployment simple for now, skip this and re-upload media after a redeploy.

## How the moving parts stay correct

- **`min-instances=1`, `max-instances=1`** — a single SQLite writer + Litestream
  pair. Do not scale out with a local SQLite file.
- **`APP_SECRET`** must be stable. If it were regenerated (the app writes a local
  `.app-secret` otherwise), every session would be invalidated and stored
  integration secrets would become undecryptable. That is why it comes from
  Secret Manager.
- **`SESSION_COOKIE_SECURE=true`** — the site is HTTPS end to end, so the session
  cookie is marked `Secure`.
- On boot the container runs `migrate()` and `seed()` (reference data + the three
  groups), exactly as in development.

## Updating an already-deployed instance

```bash
git pull            # or re-upload the changed files
gcloud run deploy chorale-app --source . --region us-central1   # picks up the same settings
firebase deploy --only hosting   # only needed if firebase.json changed
```

## Troubleshooting

- **`.web.app` 500 / "Service not found"** — the rewrite in `firebase.json` names
  the service and region; make sure `serviceId`/`region` match your Cloud Run
  deploy. Redeploy Hosting after changing it.
- **Data resets after redeploy** — `REPLICA_BUCKET` is unset, or the runtime
  service account lacks `roles/storage.objectAdmin` on the bucket. Check the logs
  for `[entrypoint]` lines.
- **Everyone logged out after redeploy** — `APP_SECRET` changed. Restore the
  original secret version.
- **429 from Google** — general rate limiting is on; it is per-IP and generous,
  but Firebase Hosting forwards the client IP via `x-forwarded-for`
  (`trust proxy` is enabled server-side).

## Running the container locally (optional smoke test)

```bash
docker build -t chorale .
docker run --rm -p 8080:8080 -e APP_SECRET=dev-secret-at-least-16-chars chorale
# open http://localhost:8080  (no REPLICA_BUCKET → ephemeral, fine for a test)
```
