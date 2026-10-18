# Deploying on Render (production)

The choir platform runs live on **Render** at
**<https://la-porte-ador.onrender.com>** — one origin serving the API, the web
app and `/media`, no credit card required (Render free plan).

```
Browser ──▶ https://la-porte-ador.onrender.com   (Render proxy, TLS)
                 │
                 ▼
        Render web service (native Node environment)
        Express server + built React SPA
                 │
                 ├── SQLite   server/data/chorale.db ──▶ Litestream ──▶ Backblaze B2 bucket (S3 API)
                 └── uploads  server/data/storage    ──▶ mirrored to the same bucket (best effort)
```

Render's free plan has an **ephemeral disk**: the SQLite file and all uploads
are wiped on every redeploy and on Render's periodic instance restarts. That is
why the database is continuously replicated to a **Backblaze B2** bucket (10 GB
free, sign-up without a credit card) with **Litestream** — on boot the database
is restored from the bucket before the app starts (`deploy/render-start.sh`).

## Service settings (Render dashboard)

Service → *Environment* / *Build & Deploy*:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `sh deploy/render-start.sh` |
| Health Check Path | `/api/health` |

The repository also contains a `render.yaml` blueprint documenting the same
settings; it is a reference only (the existing service is configured in the
dashboard).

`deploy/render-start.sh` behaviour:

- **No `S3_*` variables set** → starts the app directly (`npm start`). The site
  works, but the database is wiped on every restart.
- **`S3_*` set** → downloads Litestream v0.5.17 (once per instance), restores the
  database from the bucket if the local file is missing, then runs the app under
  continuous replication. The Litestream config references the `S3_*` variables
  via `${…}` expansion performed by Litestream itself, so **no secret is ever
  written to disk**.

## Environment variables

Set them in the dashboard (service → *Environment* → *Add Environment Variable*),
then redeploy (*Manual Deploy* → *Deploy latest commit*) — env changes only take
effect on the next deploy.

### Required

| Variable | Purpose |
| --- | --- |
| `APP_SECRET` | Hashes sessions and encrypts stored integration secrets (webhook secret, SMTP password…). **Must be stable**: if it changes, everyone is logged out and previously stored secrets become undecryptable. Generate once with `openssl rand -base64 48` and never change it. |
| `ALLOW_DEFAULT_ACCOUNTS=1` | Opt-in: on boot, create any of the four administrator accounts that do not exist yet. Existing accounts (passwords, roles) are **never modified**. Once all four accounts exist you may remove the variable. |

### Administrator passwords (recommended)

One per administrator; used only when that account does not exist yet.
In production, an account still carrying the public **sample password** from the
repository is forced to choose its own password at first sign-in.

| Variable | Account |
| --- | --- |
| `CHAIRMAN_PASSWORD` | Chairman (`chairman@laportedor.local`) |
| `SENIOR_ADMIN_PASSWORD` | Senior Administrator (`senior.admin@laportedor.local`) |
| `JUNIOR_ADMIN_PASSWORD` | Junior Administrator (`junior.admin@laportedor.local`) |
| `MEMBERS_ADMIN_PASSWORD` | Members Administrator (`members.admin@laportedor.local`) |

Optional per account: `<PREFIX>_EMAIL`, `<PREFIX>_NAME` (e.g.
`CHAIRMAN_NAME="Bunani Jean Marie Vianney"`). Passwords must be ≥10 characters
with upper + lower + digit.

### Durable storage (Backblaze B2)

| Variable | Purpose |
| --- | --- |
| `S3_BUCKET` | Bucket name (e.g. `la-porte-ador-data`). |
| `S3_ENDPOINT` | `https://s3.<region>.backblazeb2.com` (shown in the B2 console under the bucket → *Endpoint*). |
| `S3_REGION` | e.g. `us-west-004` (shown next to the endpoint). |
| `S3_ACCESS_KEY_ID` | B2 application key ID. |
| `S3_SECRET_ACCESS_KEY` | B2 application key. |
| `S3_FORCE_PATH_STYLE` | `true` (the default) — required for B2. |
| `S3_PREFIX` | Optional, e.g. `uploads` — key prefix for uploaded media in the bucket. |

With `S3_*` set the server also **mirrors every upload** into the bucket under
`S3_PREFIX`. Note the known limitation below: after a redeploy the mirrored
files are not served again automatically — the **database** is what is durably
protected.

### Other

| Variable | Purpose |
| --- | --- |
| `SESSION_COOKIE_SECURE=true` | Session cookie only over https (Render terminates TLS). |
| `NODE_ENV` | Render sets `production`; no need to change. |

## First boot and the four administrators

With `ALLOW_DEFAULT_ACCOUNTS=1` and the four password variables set, the first
boot after a redeploy creates all four administrator accounts. Sign in at
`/admin/login` (Chairman, Senior, Junior, Members administrators) or `/login`
(singers and support members).

If `ALLOW_DEFAULT_ACCOUNTS` is **not** set and no administrator exists, the
server prints a one-time **setup token** in the logs and writes
`server/data/FIRST-ADMIN-SETUP.txt`. Open `/setup`, paste the token and create
the Chairman account; the other administrators are then created from the
dashboard under *Administration → Accounts* (or enable the flag and redeploy).

Group responsibilities (fixed, three official groups):

| Group | Administrator role |
| --- | --- |
| Senior | `senior_leader` (Senior Administrator) |
| Junior | `junior_admin` (Junior Administrator) |
| Members/Support | `members_admin` (Members Administrator) |
| — all three | `chairman` (sees every group; does not decide applications) |

## Google Form → application → automatic credentials

1. Applicants fill in the choir's Google Form
   (<https://forms.gle/JZJmWZNMQAYNm5uq5>).
2. The Google Apps Script (`docs/apps-script/Code.gs`, pasted into the Form's
   linked spreadsheet) POSTs each submission to
   `https://la-porte-ador.onrender.com/api/applications/webhook`.
3. The application appears under *Applications* for the applied-for group's
   administrator (the Chairman is notified too).
4. When the administrator **approves** it, the server automatically creates the
   person's member record **and** their login account, and shows a one-time
   **invitation link** (`/invite/<token>`) the administrator shares with the new
   user; on first sign-in the user sets their own password. Accounts are never
   created before approval — there is no public registration.

Configure the Apps Script once (its `CONFIG` block at the top of the file):

```js
ENDPOINT: 'https://la-porte-ador.onrender.com/api/applications/webhook',
SECRET:   '<copy from Administration → Settings → Integrations → Google webhook secret>',
```

Until a webhook secret is configured in the app, the endpoint accepts unsigned
requests; as soon as one is set, every call must carry the HMAC signature the
script already computes.

## Updating the app

Push to GitHub (`main`), then in Render: *Manual Deploy* → *Deploy latest
commit* (if automatic deploys are enabled, pushing is enough). Every deploy wipes
the ephemeral disk, so the database is restored from B2 on the next boot —
that is the normal, expected path.

## Backblaze B2 setup (one time)

1. Create a free account at <https://www.backblaze.com/cloud-storage> (no credit
   card needed for sign-up).
2. *Buckets* → *Create a Bucket*: name it (e.g. `la-porte-ador-data`), region of
   your choice, *Files* type, private.
3. Note the bucket's **S3 API endpoint** and **region** (bucket → *Endpoint*).
4. *Application Keys* → *Add Application Key*: restrict it to that bucket, copy
   the **key ID** and **applicationKey** (shown once).
5. Paste the five values into Render as `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`,
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, then redeploy.

Verify durability: after a few minutes of use, click *Restart* (or redeploy) in
Render and check that accounts and data are still there. The Litestream prefix
in the bucket is `chorale-db`.

## Security checklist

- The repository is **public** — every secret must live only in the Render
  dashboard, never in code. Sample passwords in the code are public knowledge;
  set the four `*_PASSWORD` variables (or let the forced password change run).
- Change the Chairman password immediately if the site was ever used with a
  sample password.
- `APP_SECRET` must be set and stable; otherwise a fresh random one is generated
  on each boot and stored integration secrets become unreadable after a restart.
- All administrator actions are recorded in the append-only audit log
  (*Administration → Audit log*).

## Troubleshooting

- **Build fails with `tsc`/`vite` not found** — `NODE_ENV=production` is set for
  the app, and Render applies environment variables during the build as well, so
  a plain `npm ci` skips devDependencies (which the build needs). That is why the
  build command is `npm ci --include=dev && npm run build`.
- **Data reset after a redeploy** — the `S3_*` variables are missing/wrong, or
  the start command is not `sh deploy/render-start.sh`. Check the logs for
  `[render-start]` lines.
- **Logs show `restore still failing … continuing with an empty local database`**
  — B2 is unreachable or the key is wrong. Litestream keeps replicating the
  current data; older snapshots stay in the bucket and can be recovered with
  `litestream restore -timestamp`.
- **Everyone logged out after a redeploy** — `APP_SECRET` changed; restore the
  original value in the dashboard.
- **A login demands a new password** — that account still carries the public
  sample password; it must be replaced on first sign-in.
- **429 responses** — per-IP rate limiting is active and generous; `trust proxy`
  is enabled so client IPs are correct behind Render's proxy.

## Known limitations

- **Mirrored uploads are not served after a redeploy.** Uploads are written to
  the bucket as a mirror, but the server currently reads media from local disk
  only. After a redeploy, previously uploaded photos/audio are no longer served
  (re-upload them). The database — members, applications, songs, audit trail —
  is fully durable.
- Render free instances **spin down** after inactivity; the first request after
  an idle period takes ~30–60 seconds.
- Exactly one instance is expected: a local SQLite file must never be shared by
  multiple writers.

## Verified vs. not verified

Verified locally (automated tests + live checks):

- 30/30 unit tests, typecheck and production build.
- Fresh production boot creates all four administrators (env passwords),
  existing accounts are never reset on restart, sample passwords force a change.
- `deploy/render-start.sh` without `S3_*` falls back to a plain start; with
  `S3_*` it downloads Litestream, writes the config (env expansion verified
  against real Backblaze B2 endpoints) and attempts the restore.
- Live on Render: SPA + API + health check; Google Form webhook → notification →
  approve → member + invitation link (form-to-credentials flow).
- **Litestream against the real Backblaze B2 bucket**: a test database was
  replicated to the bucket (`litestream replicate -once`), the local file was
  deleted, and `litestream restore` brought all 501 rows back correctly with the
  production credentials (bucket `la-port-dor-data`, region `us-east-005`). The
  test objects were then deleted, leaving the bucket empty.

Not verified end-to-end:

- The optional Docker image (`Dockerfile`, `deploy/entrypoint.sh`) — kept for
  self-hosting, not used by the Render deployment.

## Optional: Docker (self-hosting)

`Dockerfile` + `deploy/entrypoint.sh` provide a container build that behaves the
same way (Litestream with `S3_*`, or GCS with `REPLICA_BUCKET`):

```bash
docker build -t chorale .
docker run --rm -p 8080:8080 \
  -e APP_SECRET=dev-secret-at-least-16-chars \
  -e S3_BUCKET=... -e S3_ENDPOINT=... -e S3_REGION=... \
  -e S3_ACCESS_KEY_ID=... -e S3_SECRET_ACCESS_KEY=... \
  -e ALLOW_DEFAULT_ACCOUNTS=1 chorale
```

Without those variables the container is ephemeral — fine for a smoke test.

> The legacy Firebase/Cloud Run files (`firebase.json`, `.firebaserc.example`,
> `deploy/deploy.sh`, `deploy/hosting/`) are kept for reference only — they are
> **not** part of the Render deployment and are unused.
