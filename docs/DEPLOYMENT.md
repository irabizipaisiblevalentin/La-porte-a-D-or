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
| `RESTORE_TIMESTAMP` | Optional, and **dangerous to leave set**. Pins this boot's restore to a point in time (e.g. `2026-10-20T13:00:00Z`) instead of the newest — the recovery step when the latest generation is damaged. A pinned restore that fails **stops the deploy** rather than overwriting the bucket with an empty database. **While it is set, every restart rolls the data back to that moment and discards everything written since**, so remove it as soon as the recovery is done. The app now refuses to look healthy in the meantime: `/api/health` reports `warning: "database_restore_pinned"` and administrators get a red banner, an audit entry and a notification. |
| `DATABASE_FILE` / `DATA_DIR` | Optional. Where `chorale.db` lives. Default `server/data/chorale.db`. |

With `S3_*` set the server also **mirrors every upload** into the bucket under
`S3_PREFIX`, and reads it back when the local copy is gone — which is the normal
case after a redeploy or an idle spin-down. The database and the media therefore
survive together; see *Uploads survive the disk* below.

### Other

| Variable | Purpose |
| --- | --- |
| `SESSION_COOKIE_SECURE=true` | Session cookie only over https (Render terminates TLS). |
| `NODE_ENV` | Render sets `production`; no need to change. |
| `PUBLIC_SITE_URL` | Optional. The site's own public address, used for the `canonical` links, the `og:url` tags and the `Sitemap:` line in `robots.txt`. Defaults to `https://la-porte-ador.onrender.com`. **Set this if the site ever moves to its own domain** (e.g. `https://laportedor.org`) — otherwise every canonical URL would still point at the old address, which tells Google the real page is elsewhere. |
| `PUBLIC_YOUTUBE_URL` | Optional. The choir's YouTube channel address, published as `sameAs` in the `MusicGroup` structured data so search engines can link the choir to its channel. |

### Search engines

The public site is a client-rendered React app, so the HTML the server sends by
default is a ~1.4 KB shell with an empty `<div id="root">` and one identical
`<title>` on every URL. A crawler fetching `/about` and `/events` would see two
empty documents that look the same.

The server therefore renders the genuinely public pages — `/`, `/about`,
`/events`, `/music`, `/contact` and the gallery pages — to real HTML, built from
the same data the public JSON endpoints serve, and answers `robots.txt` and
`sitemap.xml` as themselves. The rendered content sits **inside** `#root`, so
React replaces it on mount: a visitor gets the app, a crawler (or a visitor whose
bundle is slow on a sleeping instance) gets readable content.

Only pages listed in `publicPages()` (`server/src/services/seo.ts`) are rendered
and advertised. Everything else — `/app`, `/login`, `/admin`, `/setup`,
invitation and reset links, `/checkin`, and every `/api` route — is disallowed in
`robots.txt` and never appears in the sitemap. A URL that is neither a public
page nor a real client route is answered with **404**, not the app shell: a 200
for every address is a "soft 404" and teaches a search engine that the whole site
is a duplicate of the home page.

Adding a new public page therefore takes two deliberate edits: add it to
`publicPages()` and (for a client-rendered page) to the exact route list in
`server/src/routes/seo.ts`. This is on purpose — a new private route cannot leak
into the sitemap by accident.

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

## Importing the YouTube channel's music

The channel's songs are brought into the catalogue by a **Chairman-only button
inside the application**:

1. Sign in as the Chairman.
2. *Music Library* → **Import from YouTube** → **Import songs**.

Nothing needs a YouTube API key: the song list is read from the channel's public
feed and lives in `server/src/services/channel-import.ts`.

**Why it runs inside the app.** Writing the catalogue into the database file
directly (with `litestream restore` and a script) is what corrupted the replica:
a WAL-mode database was copied with a write still in flight, and the running
instance was writing to the same prefix at the same time. `POST
/api/songs/import-channel` runs in one transaction, performed by the one writer
that replicates healthily, so the change is an ordinary, durable write.

Rules the import follows:

- live streams and concert recordings are **not** songs, so they are not listed;
- each song is created once, its video approved and **primary**, which is what
  makes it playable and visible on `/music`;
- every song is assigned to **all three groups** (the full-choir repertoire);
- a song already in the catalogue is re-used by normalised title and an existing
  video link is refreshed, never duplicated — so a second run changes nothing
  (verified: the second run creates 0 rows, and the test suite asserts it).

To change the list, edit `CHANNEL_SONGS` in
`server/src/services/channel-import.ts` and press the button again.

For a **local** database only, the same code can be run from a shell:

```bash
DATA_DIR=/tmp/importtest DATABASE_FILE=/tmp/importtest/chorale.db \
  APP_SECRET=... npx tsx scripts/import-channel-music.ts
```

Do not point that at the live database file.

## The choir's gallery photographs

The site's gallery is built from the choir's own photographs, which are **not**
committed at full resolution. The originals live in `images/choir pics/images/`
(hundreds of MB, ignored by Git); the web-sized copies the site serves are
committed under `web/public/assets/gallery/choir/`.

Regenerate them after adding photographs:

```bash
python3 scripts/process-gallery-images.py     # downscale -> full/ and thumb/
python3 scripts/generate-gallery-manifest.py  # -> web/src/pages/public/gallery/photos.generated.ts
```

`process-gallery-images.py` needs Pillow. It applies EXIF rotation, writes a
1400 px copy for the lightbox and a 640 px copy for the grid, and prints the
total size. `generate-gallery-manifest.py` turns that manifest into the typed
catalogue the pages import, grouping photos into their collections.

Photographs the Chairman uploads in *Settings → Brand & gallery* take priority
over the bundled ones on the landing page; the bundled photographs remain the
fallback so the gallery is never empty.

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
- **The site boots looking healthy but one page returns "Something went wrong"
  (a `500`), while everything else works** — the database **restored but is
  damaged**. A torn write in the bucket left a table page unreadable, so counts
  and other tables still work but *reading rows* from one table fails. This is why
  the public music and landing pages broke while login and members kept working:
  a malformed `songs` page.

  The app now catches this at boot. Look for:

  - `status: "degraded"` and `warning: "database_damaged"` on `GET /api/health`,
    with `integrityProblems` naming the table(s) that failed;
  - a `DATA INTEGRITY WARNING: The database restored but is damaged` block in the
    boot log;
  - a `system.database_damaged` entry in the audit log and a notification in the
    Chairman's bell.

  **Recover by restoring a clean point — do not write to the damaged database**
  (editing over damaged pages makes recovery harder):

  1. In the Render dashboard, open the service → **Environment**, and note the
     `S3_*` values.
  2. Find a **timestamp before the damage** — the last boot that served every page
     correctly. Then add an environment variable **`RESTORE_TIMESTAMP`** set to
     that time (e.g. `2026-10-20T13:00:00Z`) and redeploy. The boot script
     restores *that* point instead of the newest one — no tool needed on your own
     machine, and a pinned restore that fails **stops the deploy** rather than
     overwriting the bucket with an empty database.

     > **Delete `RESTORE_TIMESTAMP` as soon as the recovery is confirmed — this is
     > not optional.** While it is set, *every* restart rolls the data back to that
     > moment, so anything entered in between is silently discarded. A pinned
     > restore that succeeds looks perfectly healthy, so do not wait for
     > `/api/health` to complain before removing it — from the moment the pin is
     > set the app reports `warning: "database_restore_pinned"` (red banner, audit
     > entry, notification) precisely so the pin cannot be forgotten, and that
     > warning disappears only when the variable is gone.
  3. Confirm `/api/health` reports `status: "ok"` — with **no** `warning` field —
     and reopen the pages that were failing.

  The probe lives in `server/src/services/data-integrity.ts`
  (`checkDatabaseIntegrity`), and is asserted by
  `server/test/unit/database-integrity.test.ts` and
  `server/test/unit/duplicate-page-probe.test.ts`.

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

- 91/91 unit tests, typecheck and production build.
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
- **The public music catalogue**: `scripts/import-channel-music.ts` was run twice
  against a restore of the live database — the first run created 9 songs and
  linked 10 videos (30 group assignments), the second created **0** rows and
  re-used all 10, proving it is idempotent. `GET /api/public/music` was then read
  back with no cookie: 10 songs, only approved videos, search and category
  filters both correct, and no member or admin field present. Covered by
  `server/test/unit/song-video.test.ts`.

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
