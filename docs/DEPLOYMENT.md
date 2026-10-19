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
                 └── uploads  server/data/storage    ──▶ mirrored to the same bucket
                                                          (read back when the disk is wiped)
```

Render's free plan has an **ephemeral disk**: the SQLite file and all uploads
are wiped on every redeploy and on Render's periodic instance restarts. That is
why the database is continuously replicated to a **Backblaze B2** bucket (10 GB
free, sign-up without a credit card) with **Litestream** — on boot the database
is restored from the bucket before the app starts (`deploy/render-start.sh`) —
and why **every upload is mirrored into the same bucket** and pulled back the
first time it is requested (see *Uploads* below).

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

### Device notifications (optional)

Web Push reaches an administrator's phone or laptop while the platform is closed. **Nothing has to be
configured**: with none of these set, the deployment generates a VAPID signing pair on first use and
keeps it in the database, which Litestream restores on every boot. Set them only to pin a fixed
identity (for example to share one across several instances).

| Variable | Purpose |
| --- | --- |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Optional VAPID key pair (base64url). **Keep it stable** — a new pair silently silences every device that already subscribed. Generate one with `npx web-push generate-vapid-keys`. |
| `VAPID_SUBJECT` | Optional contact URI the push services may use, default `mailto:chairman@laportedor.local`. |
| `PUSH_TIMEOUT_MS` | Optional, default `8000` — how long to wait for a push service before recording a failure. |

A device is registered from **My Account → Notifications on your devices** (or the header bell icon);
only the public half of the key is ever sent to a browser (`GET /api/push/config`). On an iPhone or
iPad, the site must be added to the Home Screen first (iOS 16.4+).

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
| `LITESTREAM_SYNC_INTERVAL` | Optional, default `120s` — how often the database is pushed to the bucket (also the worst-case recovery point). See *Transaction budget*. |
| `LITESTREAM_L0_RETENTION`, `LITESTREAM_L0_CHECK_INTERVAL` | Optional, default `1h` — how long compacted files are kept / how often retention is enforced. |
| `LITESTREAM_L1_INTERVAL`, `LITESTREAM_L2_INTERVAL`, `LITESTREAM_L3_INTERVAL` | Optional, defaults `15m`/`1h`/`6h` — compaction windows (each run costs listing + upload calls). |
| `LITESTREAM_SNAPSHOT_INTERVAL` | Optional, default `24h` — how often a full copy of the database is written. |
| `REQUIRE_RESTORE` | Optional. `1` makes `deploy/render-start.sh` **stop** instead of starting on an unrestored (empty) database when the bucket is unreachable. The app then never serves wrong data; Render keeps the previous instance up. Default: start and warn loudly. |

With `S3_*` set the server also **mirrors every upload** into the bucket under
`S3_PREFIX`, and reads it back when the local copy is gone — which is the normal
case after a redeploy or an idle spin-down. The database and the media therefore
survive together; see *Uploads survive the disk* below.

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
6. **Know the traffic limit (Backblaze account → *Caps & Alerts*).** A B2 account
   without a credit card gets **2,500 Class A, 2,500 Class B and 2,500 Class C API
   calls per day** (A = uploads/writes, B = downloads/reads, C = listings),
   counters reset at 00:00 UTC — and Backblaze only lets you *edit* those caps on
   an account with a payment method. Once a class runs out, B2 answers
   `Transaction cap exceeded` and replication stops; if it is still exceeded at
   the next boot, the restore fails too (and if the counters have reset by then,
   the restore silently returns a **stale** database). Litestream's stock
   settings blow straight through the Class C allowance: the 15-second
   L0-retention check alone issues ~11,500 listings a day, and the default
   1-second sync sends thousands of uploads. `deploy/render-start.sh` therefore
   ships a **transaction budget** (below) that keeps the daily total in the
   hundreds. Nothing in the Backblaze console needs to change.

### Transaction budget (why the Litestream config is not the default)

A card-free B2 bucket is the whole point of this setup, so the replica is tuned
to live inside the free allowance rather than to Litestream's latency defaults:

| Setting | Default | Here | Why |
| --- | --- | --- | --- |
| `sync-interval` | `1s` | `120s` | at most 720 uploads/day instead of up to 86,400 |
| `l0-retention-check-interval` | `15s` | `1h` | ~11,500 listing calls/day → 48 |
| `l0-retention` | `5m` | `1h` | how long compacted L0 files are kept |
| `levels[0..2]` (L1/L2/L3) | `30s`/`5m`/`1h` | `15m`/`1h`/`6h` | each compaction lists + uploads |
| `snapshot.interval` | `24h` | `24h` | one full copy a day |

Every value can be overridden from the environment (`LITESTREAM_SYNC_INTERVAL`,
`LITESTREAM_L0_RETENTION`, `LITESTREAM_L0_CHECK_INTERVAL`,
`LITESTREAM_L1_INTERVAL`, `LITESTREAM_L2_INTERVAL`, `LITESTREAM_L3_INTERVAL`,
`LITESTREAM_SNAPSHOT_INTERVAL`), and the Docker entrypoint honours the same names.
The trade-off is the recovery point: with `sync-interval: 120s`, an **abrupt**
kill can lose up to two minutes of writes. A normal Render spin-down or deploy
sends `SIGTERM`, on which Litestream performs a final sync, so those lose
nothing. Lower `sync-interval` only if you are watching the Class A counter and
have room for the extra uploads. `watch` the alert e-mails B2 sends at 75 %/100%
of a cap.

Verify durability: after a few minutes of use, click *Restart* (or redeploy) in
Render and check that accounts and data are still there. The Litestream prefix
in the bucket is `chorale-db`.

**If a restore ever fails, the app now says so out loud** — a red banner for
group administrators and the Chairman, a `DATA INTEGRITY WARNING` in the logs, a
`system.database_restore_failed` entry in the audit log and a notification in the
Chairman's bell. See *Troubleshooting* below for what to do next.

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
- **A restore failed and the site came up empty (red banner / `DATA INTEGRITY
  WARNING` in the logs / `warning` on `/api/health`)** — the database could not be
  downloaded from the bucket after five attempts, so the app is running on a
  freshly created, empty database. **Do not re-enter records yet.** In order:
  1. Fix storage access. The usual cause is a Backblaze **transaction cap**
     (`AccessDenied: Transaction cap exceeded`) — the free allowance of 2,500
     Class A/B/C calls per day, which a card-free account **cannot raise**. Do not
     try to raise it: confirm the transaction budget above is in place
     (`git log deploy/render-start.sh`; the live log line says
     `msg="replicating to" … sync-interval=2m0s`) and that no other tool is using
     the same bucket/key. If the cap is still in force, replication resumes by
     itself after 00:00 UTC — but everything written since the freeze is gone, so
     restore first (step 2). A wrong/expired key or endpoint looks the same in the
     logs.
  2. The pre-failure data is normally still in the bucket (Litestream keeps
     previous generations). Recover it with
     `litestream restore -timestamp 2026-10-18T18:00:00Z -config <config> <file>`
     — pick a timestamp from before the wipe — or simply restart the service
     once storage access works, since the boot script restores when the local
     file is missing.
  3. Once recovered, delete `RESTORE-FAILED.txt` from the data directory (the
     boot script clears it on a successful restore) so the warning clears.
  The marker file, and what it contains, is described in
  `server/src/config.ts` (→ `parseRestoreMarker`) and `server/src/services/data-integrity.ts`.
- **Prefer a failed deploy over an empty site** — set `REQUIRE_RESTORE=1` in the
  Render environment. The start script then exits instead of serving an empty
  database, so Render keeps the previous instance serving instead of replacing it.
- **Are you warned about a "database backup tool is missing" banner?** — the
  Litestream download failed at boot, so nothing is being backed up. Redeploy
  (the binary is cached per instance) and check the logs for the GitHub download
  line.
- **Everyone logged out after a redeploy** — `APP_SECRET` changed; restore the
  original value in the dashboard.
- **A login demands a new password** — that account still carries the public
  sample password; it must be replaced on first sign-in.
- **429 responses** — per-IP rate limiting is active and generous; `trust proxy`
  is enabled so client IPs are correct behind Render's proxy.

## Uploads survive the disk

Every upload is written to `server/data/storage/...` **and** mirrored into the
bucket under `S3_PREFIX`. The mirror is best effort: a bucket outage never fails
the upload that carries the file.

When a file is requested:

1. `express.static` serves it from local disk — the common case, no bucket call;
2. only when it is missing (the disk was wiped) does the server look the path up
   in `file_uploads`, stream the object back out of the bucket, and write it to
   disk again as it streams, so later requests are local again;
3. private files (`/api/files/:id`, e.g. member photographs and song audio) take
   the same route, but only **after** the normal authorization check.

Two deliberate limits: a path with no `file_uploads` record is never turned into
a bucket request (an unknown URL cannot burn transactions), and traversal out of
`/media` (`..`, encoded or not) is refused. Deleting a file deletes the object
too, and reads are Class B transactions — cached to disk after the first request,
so they count against the free allowance at most once per instance lifetime.

## Known limitations

- Render free instances **spin down** after inactivity; the first request after
  an idle period takes ~30–60 seconds.
- Exactly one instance is expected: a local SQLite file must never be shared by
  multiple writers.

## Verified vs. not verified

Verified locally (automated tests + live checks):

- 50/50 unit tests, typecheck and production build.
- Fresh production boot creates all four administrators (env passwords),
  existing accounts are never reset on restart, sample passwords force a change.
- `deploy/render-start.sh` without `S3_*` falls back to a plain start; with
  `S3_*` it downloads Litestream, writes the config (env expansion verified
  against real Backblaze B2 endpoints) and attempts the restore.
- **The transaction budget is honoured, not silently ignored**: Litestream parses
  unknown YAML keys without complaint, so the generated config was fed to
  `litestream v0.5.17` directly — the startup log confirmed
  `sync-interval=2m0s`, `starting L0 retention monitor interval=1h0m0s
  retention=1h0m0s` and compaction monitors at `15m0s`/`1h0m0s`/`6h0m0s`
  (snapshot level `24h0m0s`). The Docker entrypoint generates the same keys for
  both the S3 and GCS replicas.
- **A failed restore is loud**: the start script leaves `RESTORE-FAILED.txt`, the
  server logs a `DATA INTEGRITY WARNING`, `GET /api/health` carries
  `warning: "database_restore_failed"` (shown as a red banner to group
  administrators and the Chairman), and exactly one audit entry plus one
  notification is written for the Chairman. Covered by
  `server/test/unit/restore-alert.test.ts`.
- Live on Render: SPA + API + health check; Google Form webhook → notification →
  approve → member + invitation link (form-to-credentials flow).
- **Litestream against the real Backblaze B2 bucket**: a test database was
  replicated to the bucket (`litestream replicate -once`), the local file was
  deleted, and `litestream restore` brought all 501 rows back correctly with the
  production credentials (bucket `la-port-dor-data`, region `us-east-005`). The
  test objects were then deleted, leaving the bucket empty.

Not verified end-to-end:

- The optional Docker image (`Dockerfile`, `deploy/entrypoint.sh`) — kept for
  self-hosting, not used by the Render deployment, and never built here (no
  `docker` CLI in this environment). It shares `deploy/restore-alert.sh` with the
  Render start script, so it writes the same `RESTORE-FAILED.txt` marker and the
  app shows the same warning.
- The red banner as rendered in a browser, and the live restore-failure path
  against the real B2 bucket (the marker → health → banner chain is covered by
  the unit test above, but was not exercised by a real Backblaze outage).

A real outage **did** occur: the first live member record was lost when a
Backblaze transaction cap blocked the restore and the free instance came up on an
empty database without saying so. Two things were wrong. The replica had burned
through the free Class C allowance because Litestream's defaults (a 15-second L0
retention check and a 30-second L1 compaction, each listing the bucket) spend
~17,000 listing calls a day against a 2,500/day allowance, and a card-free
account cannot raise that cap. And the failure was silent, because a failed
restore simply produced a fresh database. Both are now fixed: the transaction
budget above keeps the daily totals in the hundreds, and a failed (or
unavailable) restore is loud — `RESTORE-FAILED.txt`, `DATA INTEGRITY WARNING`,
`warning` on `/api/health`, red banner, audit entry, Chairman notification.

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
