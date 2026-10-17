#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-shot deploy for Chorale La Porte d'Or:
#   Cloud Run (the app)  +  Firebase Hosting (the https://<project>.web.app URL)
#
# Prerequisites:
#   - gcloud CLI authenticated:  gcloud auth login
#   - firebase CLI installed:    npm i -g firebase-tools  (then: firebase login)
#   - A Google Cloud project with billing enabled, and Firebase added to it.
#
# Usage:
#   PROJECT_ID=my-project ./deploy/deploy.sh
#
# Optional overrides:
#   REGION=us-central1  SERVICE=chorale-app
#   BUCKET=my-bucket    SECRET_NAME=chorale-app-secret
# ---------------------------------------------------------------------------
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID, e.g. PROJECT_ID=my-project ./deploy/deploy.sh}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-chorale-app}"
BUCKET="${BUCKET:-${PROJECT_ID}-chorale-data}"
SECRET_NAME="${SECRET_NAME:-chorale-app-secret}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

echo "==> Project ${PROJECT_ID} (region ${REGION}, service ${SERVICE})"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "==> Enabling APIs (this can take a minute)…"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  firebase.googleapis.com >/dev/null

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "==> Ensuring Cloud Storage bucket gs://${BUCKET} exists…"
if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" --location="${REGION}" --uniform-bucket-level-access
fi
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/storage.objectAdmin" >/dev/null

echo "==> Ensuring application secret ${SECRET_NAME} exists…"
if ! gcloud secrets describe "${SECRET_NAME}" >/dev/null 2>&1; then
  printf '%s' "$(openssl rand -base64 48)" | \
    gcloud secrets create "${SECRET_NAME}" --data-file=- --replication-policy=automatic >/dev/null
  echo "    created (keep it — rotating it invalidates sessions and stored integration secrets)"
else
  echo "    already exists, leaving it unchanged"
fi

echo "==> Deploying to Cloud Run (builds the Dockerfile via Cloud Build)…"
gcloud run deploy "${SERVICE}" \
  --source . \
  --region "${REGION}" \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --execution-environment gen2 \
  --cpu 1 \
  --memory 1Gi \
  --timeout 300 \
  --set-env-vars "NODE_ENV=production,DATA_DIR=/data,DATABASE_FILE=/data/chorale.db,WEB_DIST_DIR=/app/web/dist,HOST=0.0.0.0,PORT=8080,SESSION_COOKIE_SECURE=true,REPLICA_BUCKET=${BUCKET},REPLICA_PREFIX=chorale" \
  --set-secrets "APP_SECRET=${SECRET_NAME}:latest"

echo "==> Wiring Firebase Hosting…"
if [ ! -f .firebaserc ]; then
  sed "s/YOUR_GCP_PROJECT_ID/${PROJECT_ID}/" .firebaserc.example > .firebaserc
  echo "    wrote .firebaserc"
fi
firebase deploy --only hosting --project "${PROJECT_ID}"

cat <<EOF

==> Done.

   App URL:  https://${PROJECT_ID}.web.app

   First administrator: open https://${PROJECT_ID}.web.app/setup and paste the
   one-time token found in the logs:
     gcloud run services logs read ${SERVICE} --region ${REGION} --limit 80 | grep -i token

EOF
