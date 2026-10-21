# Chorale La Porte d'Or — Digital Choir Management & Music Library Platform

A complete, database-backed platform for managing the choir's members, admissions, music
library, attendance, discipline, goals, events, training, communication, reporting and
administration — with three official groups (Senior, Junior, Support Members) and a
gold/charcoal premium interface in light and dark themes.

> **No public registration.** Every applicant applies through the official Google Form
> (`https://forms.gle/JZJmWZNMQAYNm5uq5`). There are no Sign Up / Register controls anywhere.
> An account is created only after an administrator approves an application.

---

## Contents

- [What is built](#what-is-built)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick start (development)](#quick-start-development)
- [First administrator setup](#first-administrator-setup)
- [Default development sign-in accounts](#default-development-sign-in-accounts)
- [Production build & run](#production-build--run)
- [Deploying on Render (live)](#deploying-on-render-live)
- [Environment variables](#environment-variables)
- [Roles & permissions](#roles--permissions)
- [Integrations](#integrations)
- [The membership lifecycle](#the-membership-lifecycle)
- [Testing status](#testing-status)
- [Security notes](#security-notes)
- [Project structure](#project-structure)

---

## What is built

| Module | Capability |
| --- | --- |
| **Public site** | One page per navigation item — Home, About, Music, Gallery, Events and Contact — with the choir's real logo and its own photographs. Each opens on its own address. |
| **Our music (public)** | `/music` — the whole catalogue on one page, no sign-in, searchable and filterable, every performance playable in the official YouTube player on click. |
| **Gallery (public)** | `/gallery` — the choir's own photographs (307 of them) with its own sub-pages: All photos, one page per collection, Performances and Members. Click any photo to open it full-screen; arrow keys or a swipe move between them. |
| **Opening animation** | A spinning-logo boot splash while the application starts, played once per visit and skipped when the browser asks for reduced motion. |
| **Admissions** | Applications arrive from the Google Form (webhook/sheet), can also be entered manually, then reviewed. Statuses: pending, under review, more information required, approved, rejected. Approving creates **exactly one** member plus an invited account; rejecting preserves the record. |
| **Members** | Three groups only (Senior, Junior, Support Members), voice sections, contact details, and protected guardian/emergency records for juniors. Member numbers like `CHR-2026-0001`. |
| **Music library** | Songs, categories, learning stages, per-group assignments, progress history, lyrics (only when lawfully supplied), private audio resources, and video links to the official channel. |
| **Discovery** | YouTube Data API discovery of the official channel with a review queue, plus **manual URL import** that works without an API key. |
| **Attendance** | Sessions by activity type, markable rosters, and rates computed from a configurable policy (nullable and explained when there is no data). |
| **Discipline & recognition** | Negative and positive records with categories, history, and per-member views. |
| **Goals** | Annual/monthly/custom goals with cumulative progress entries, percent complete, deadlines and overdue flags. |
| **Events & training** | Events with participants and sung songs; training sessions with per-participant attendance and completion. |
| **Communication** | Announcements (targeted audiences, priorities, scheduling) with starter templates and read tracking; in-app notifications; free device notifications (Web Push) on a phone or laptop, including while the site is closed. |
| **Reports** | Membership, attendance, discipline, music, goals, events and personal reports, all computed from the database. |
| **Administration** | User accounts, role assignment, invitations, password resets, an append-only audit log, global search, application settings, integration settings and brand uploads. |

The backend is real and authoritative: **all important information lives in the database**, never
only in React state, local storage or hardcoded arrays. Where an external service is not yet
configured, the platform says so honestly ("awaiting setup") rather than showing fabricated data.

---

## Tech stack

- **Runtime:** Node.js 24, TypeScript (ESM, `.js` import extensions).
- **Server:** Express 5, `better-sqlite3` (SQLite with WAL and real foreign keys).
- **Web:** React 19, Vite 7, Tailwind CSS v4, React Router v7, `recharts`, `lucide-react`.
- **Auth:** scrypt password hashing (`node:crypto`), httpOnly cookie sessions with an opaque
  token stored **hashed** in the database, rolling expiry, and account lockout after 8 failed logins.
- **Secrets at rest:** AES-256-GCM, key derived from `APP_SECRET`.

---

## Prerequisites

- **Node.js 24+** and npm 10+. (Node 22 may work, but 24 is what was used.)
- A writable data directory (defaults to `server/data/`).
- No Docker, Postgres or external database is required.

---

## Quick start (development)

```bash
# 1. Install all workspaces
npm install

# 2. Create the database schema and seed reference data
npm run migrate
npm run seed        # optional; the server also seeds on boot

# 3. Run the API and the web app together
npm run dev
#   API  -> http://localhost:4000
#   Web  -> http://localhost:5173  (Vite proxies /api and /media to the API)
```

Then open the web app. If no administrator exists yet you will be guided to first-time setup
(see below). The API health check is at `http://localhost:4000/api/health`.

Want ready-made logins instead of going through first-time setup? Seed the
[default development accounts](#default-development-sign-in-accounts):

```bash
npm run seed:admins
```

Individual commands:

```bash
npx tsx src/index.ts        # server only (from ./server), port 4000
npm run dev -w web          # web only, Vite on 5173
```

---

## First administrator setup

There is **no public endpoint that grants the Chairman role.** The first administrator (the Chairman —
the founder and supreme administrator) is created once, using a one-time token:

1. Start the server. On first boot, because no administrator exists, the server writes a token to
   - the server console, and
   - `server/data/FIRST-ADMIN-SETUP.txt` (permissions `0600`).
2. Open `/setup` in the web app (the login page links to it automatically while setup is pending).
3. Enter the token and choose the Chairman's name, email and a strong password.

`GET /api/setup/status` reports whether setup is still needed. `POST /api/setup` only works while no
administrator exists and requires the one-time token. Once the first Chairman exists the setup route
closes permanently.

> Delete `server/data/FIRST-ADMIN-SETUP.txt` after setup if you wish; it is not needed again.

**Reset a development database** (destructive):

```bash
rm -f server/data/chorale.db*
cd server && npx tsx src/db/migrate.ts && npx tsx src/db/seed.ts
```

---

## Administrator accounts

The four administrator accounts can be created (or reset) with a single command:

```bash
npm run seed:admins
```

This creates — or resets — the **four real administrator accounts** for the choir. It is
**idempotent** (re-running resets the passwords to the values below). It refuses to run when
`NODE_ENV=production` unless you pass `ALLOW_DEFAULT_ACCOUNTS=1`.

> **On server boot** the same logic runs in *create-missing* mode, but **only** when the deployer
> opted in with `ALLOW_DEFAULT_ACCOUNTS=1`: accounts that already exist are never modified (a
> password changed in the UI survives every restart), and only the missing ones are inserted. In
> production an account still carrying a sample password below is forced to choose its own at first
> sign-in. Without the flag, boot behaviour is unchanged: a one-time setup token is issued while no
> administrator exists (see [First administrator setup](#first-administrator-setup)).

| Role | Email | Password | Sign-in page |
| --- | --- | --- | --- |
| **Chairman** (oversees all three groups, heads the Founders section) | `chairman@laportedor.local` | `Jeanluc22!` | `/admin/login` |
| Senior Leader (Senior group) | `senior.admin@laportedor.local` | `Jeanluc22!` | `/admin/login` |
| Junior Administrator (Junior group) | `junior.admin@laportedor.local` | `Jeanluc22!` | `/admin/login` |
| Members Administrator (Members/Support group) | `members.admin@laportedor.local` | `Jeanluc22!` | `/admin/login` |
| **Events Coordinator** (runs the events programme across all groups) | `events.coordinator@laportedor.local` | `Jeanluc22!` | `/admin/login` |

All five administrators share one password by choice: they sign in from a phone at a rehearsal, and one
password they all know is worth more than five they have to look up. Because that value is published
here, an account created with it is normally **forced to choose its own** at first sign-in in
production — the live service avoids that by supplying it through `<ROLE>_PASSWORD`, and a password
supplied by the environment is trusted and never forces a change. A fresh deployment with no
environment variables gets the accounts but must set real passwords at first sign-in.

The Chairman, Junior and Members accounts are given the matching profile photo from
`web/public/assets/avatars/` (`chairman.png`, `junior-admin.jpg`, `members-admin.jpg`); the Senior
Leader account has no photo yet — add one from **Administration → Accounts** after signing in. Each
group administrator handles their own group's applications and members; the **Chairman sees
everything happening across all three groups**, can act anywhere, and is the only account with
organisation-wide settings, integrations and audit access. A Google Form application for the Senior
group lands in the Senior Leader's queue (the Chairman is notified too). The **Events Coordinator**
answers to no group: it owns the events programme — who each event is for, whether it costs money,
who has paid, and who comes in at the door — but cannot manage members, applications or settings.
The Chairman has full events access as well.

**Override the credentials per deployment** without editing code — set any of these before running
`seed:admins` (or on the server before first boot):

| Variable | Purpose |
| --- | --- |
| `CHAIRMAN_EMAIL`, `CHAIRMAN_NAME`, `CHAIRMAN_PASSWORD` | Chairman account. |
| `SENIOR_ADMIN_EMAIL`, `SENIOR_ADMIN_NAME`, `SENIOR_ADMIN_PASSWORD` | Senior Leader. |
| `JUNIOR_ADMIN_EMAIL`, `JUNIOR_ADMIN_NAME`, `JUNIOR_ADMIN_PASSWORD` | Junior administrator. |
| `MEMBERS_ADMIN_EMAIL`, `MEMBERS_ADMIN_NAME`, `MEMBERS_ADMIN_PASSWORD` | Members administrator. |
| `EVENTS_COORDINATOR_EMAIL`, `EVENTS_COORDINATOR_NAME`, `EVENTS_COORDINATOR_PASSWORD` | Events Coordinator. |

> **These credentials are published.** Change them — by supplying the environment overrides above, or
> from **Administration → Accounts** after signing in — before any real deployment. An account that
> still carries the value from this file is forced to choose its own password at first sign-in; one
> given its password through the environment is trusted and is not.

### Setting a password for administrators who already exist

A boot only ever *creates* accounts that are missing; it will not overwrite an existing account's
password, because that password may have been changed deliberately and a restart must never undo it.
To deliberately give every administrator account a password — for example to move five accounts onto
one shared value — use the one-time reset:

1. Set `ADMIN_PASSWORD_RESET_TOKEN` to any long random string, and `ADMIN_PASSWORD_RESET_PASSWORD` to
   the password you want, then deploy.
2. Call it once: `curl -X POST <site>/api/admin-reset -H 'content-type: application/json' -d '{"token":"<the token>"}'`
3. It reports which accounts changed and then **refuses to run again** — the use is recorded in the
   database, so a restart cannot re-arm it. Remove both variables afterwards.

`GET <site>/api/admin-reset/status` says whether the deployment is armed and whether the single use has
been spent. While `ADMIN_PASSWORD_RESET_TOKEN` is unset, the endpoint does nothing at all.

Administrators sign in at **`/admin/login`** (linked from the public site as "Admin"); everyone else
signs in at **`/login`**. After signing in, all land on the role-appropriate dashboard at `/app`.
Real member accounts are created by approving applications (or inviting a user) — there is no public
registration.

---

## Production build & run

```bash
npm run build          # builds web (vite) then server (tsc)
npm start              # starts the API, which also serves the built web app
```

When `web/dist` exists the API serves the single-page app (with history fallback) and the public
media bucket at `/media/*`. Put a TLS-terminating proxy in front and set:

```
NODE_ENV=production
APP_SECRET=<a long random secret, at least 16 chars>
SESSION_COOKIE_SECURE=true
```

---

## Deploying on Render (live)

The production deployment runs on **Render** (free plan, no credit card) at
**<https://la-porte-ador.onrender.com>** — one origin for the API, the web app and `/media`.

Because Render's free plan has an ephemeral disk, the SQLite database is continuously replicated to
a **Backblaze B2** bucket with **Litestream** (`deploy/render-start.sh`); on boot the database is
restored from the bucket before the app starts. Uploaded media is durable the same way: every upload
is mirrored into that bucket and pulled back (then re-cached locally) the first time it is requested
after a wipe, so member photographs, song audio and application documents survive restarts too.
Set in the Render dashboard:

```
Build Command    npm ci --include=dev && npm run build
Start Command    sh deploy/render-start.sh
Health Check     /api/health

APP_SECRET=<stable random string>          ALLOW_DEFAULT_ACCOUNTS=1
CHAIRMAN_PASSWORD=…  SENIOR_ADMIN_PASSWORD=…  JUNIOR_ADMIN_PASSWORD=…  MEMBERS_ADMIN_PASSWORD=…
SESSION_COOKIE_SECURE=true

# Durable storage (Backblaze B2, free tier, no credit card):
S3_BUCKET=…  S3_ENDPOINT=https://s3.<region>.backblazeb2.com  S3_REGION=…
S3_ACCESS_KEY_ID=…  S3_SECRET_ACCESS_KEY=…
```

Full instructions — including the Backblaze B2 setup, the Google Form webhook wiring and the
troubleshooting table — are in **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**. A `render.yaml`
blueprint documenting the same settings is included.

A restore can fail (an expired key, or a Backblaze *Caps & Alerts* transaction cap, are the usual
causes). When it does, the app no longer pretends everything is fine: it logs a `DATA INTEGRITY
WARNING`, reports `warning` on `/api/health`, shows a red banner to group administrators and the
Chairman, and records an audit entry plus a notification. `REQUIRE_RESTORE=1` makes the boot fail
instead. See *Troubleshooting* in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the recovery steps.

A card-free B2 account gets **2,500 Class A/B/C API calls per day** and cannot raise that cap, while
Litestream's stock settings (1 s sync, 15 s L0-retention check, 30 s L1 compaction) spend thousands
of listing calls a day — enough to freeze replication and lose records. `deploy/render-start.sh`
therefore ships a **transaction budget** (`sync-interval: 120s`, L0 retention checks hourly,
compaction at 15 m/1 h/6 h) that keeps every class in the hundreds; see
[*Transaction budget*](docs/DEPLOYMENT.md#transaction-budget-why-the-litestream-config-is-not-the-default).

---

## Environment variables

All are optional in development; the ones marked **prod** should be set in production.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `NODE_ENV` | `development` | `production` enables production behaviour. **prod** |
| `APP_SECRET` | generated → `data/.app-secret` | Key for session-token hashing and secret encryption. **prod** |
| `DATA_DIR` | `server/data` | Data directory (database, uploads, `.app-secret`). |
| `DATABASE_FILE` | `data/chorale.db` | SQLite file path. |
| `WEB_DIST_DIR` | `../web/dist` | Built web app to serve. |
| `SESSION_COOKIE_NAME` | `cldo_session` | Session cookie name. |
| `SESSION_COOKIE_SECURE` | `false` | Set `true` behind HTTPS. **prod** |
| `SESSION_TTL_DAYS` | `7` | Session lifetime (rolling). |
| `REQUIRE_RESTORE` | `0` | Read by `deploy/render-start.sh`: when `1`, the app **refuses to start** if the database could not be restored, instead of running on an empty one. |
| `MAX_IMAGE_BYTES` | `8388608` | Upload limit for images. |
| `MAX_AUDIO_BYTES` | `83886080` | Upload limit for audio. |
| `MAX_DOCUMENT_BYTES` | `16777216` | Upload limit for documents. |
| `ALLOW_DEFAULT_ACCOUNTS` | unset | `1` → on boot, create any default administrator account that doesn't exist yet (existing accounts are never modified). **prod** |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PREFIX` | unset | S3-compatible storage (Backblaze B2). Enables Litestream database replication **and** upload durability: every upload is mirrored to the bucket and read back (then re-cached) when the local disk has been wiped. **prod** |
| `LITESTREAM_SYNC_INTERVAL` | `120s` | How often the database is pushed to the bucket (worst-case recovery point). Tuned for B2's 2,500/day free API-call allowance — see [*Transaction budget*](docs/DEPLOYMENT.md#transaction-budget-why-the-litestream-config-is-not-the-default). |
| `LITESTREAM_L0_RETENTION`, `LITESTREAM_L0_CHECK_INTERVAL` | `1h`, `1h` | How long compacted files are kept and how often retention is enforced (Litestream defaults: `5m`, `15s` — the latter alone costs ~11,500 listing calls/day). |
| `LITESTREAM_L1_INTERVAL`, `LITESTREAM_L2_INTERVAL`, `LITESTREAM_L3_INTERVAL` | `15m`, `1h`, `6h` | Compaction windows (Litestream defaults: `30s`, `5m`, `1h`). |
| `LITESTREAM_SNAPSHOT_INTERVAL` | `24h` | How often a full copy of the database is written to the bucket. |

Secrets for integrations (YouTube, Google Sheets, e-mail) are **not** environment variables — they are
entered in the app under **Settings → Integrations** and stored encrypted at rest. E-mail needs no
account at all: an Apps Script web app sends it from the choir's own Google account (see
[Email](docs/INTEGRATIONS.md#email)).

---

## Roles & permissions

Permissions are keyed values with scopes: `global`, `senior`, `junior`, `members`, `own`.
`global` satisfies everything; `own` is limited to the user's own records. Authorization is enforced
server-side on every protected request (`can`, `canActOnMember`, `assertGroupAccess`,
`permittedGroupIds`), including group isolation — a Junior Admin can never read senior or
support-member records, even by guessing an id (the API returns 403/404).

| Role | Scope | Summary |
| --- | --- | --- |
| `chairman` | global | **Chairman of the choir** — the founder and supreme administrator. Sees **all three groups** plus settings, integrations and audit. He does **not** approve/reject applications: each group's own administrator decides its applicants. |
| `junior_admin` | junior + shared | Junior applications, members, attendance, discipline, progress; shared music/goals/events/training/announcements. |
| `members_admin` | members + shared | Support-member applications, profiles, attendance, training, events, reports; shared read of the rest. |
| `senior_singer` | own + shared read | Own profile/attendance, shared music, events, training, announcements. |
| `junior_singer` | own + shared read | As above; no discipline view by default. |
| `support_member` | own + shared read | Support member's own records and shared read. |

Settings, integrations, brand uploads and the audit log are **Chairman only** (organisation-wide).
So is **removing a withdrawn member record** (`member.delete`), which erases the record and the
sign-in account created at approval while keeping the application and the audit trail.

Each group's administrator can also **issue a fresh sign-in password** for a member of their own
group (`member.reset_password`), so a locked-out member never has to wait for the Chairman. A reset
retires the old password, voids any pending reset link and signs the member's other devices out.

Any signed-in member also has `messages.send`, which powers the **“Message the Chairman”** button
(the floating button on every app screen, and the **Messages** page). The Chairman holds
`messages.read` / `messages.reply` and answers from their inbox; the conversation — including the
reply — is preserved for both sides. There is no SMS gateway: messages are delivered in-app (and the
Chairman is notified).

---

## Integrations

Two integrations are scaffolded with **honest status reporting** and a working manual fallback.
Full setup steps are in [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md).

- **YouTube (official channel).** Uses the YouTube Data API for *discovery and metadata only*.
  Performances always play through YouTube's official embedded player; media is **never downloaded,
  rehosted or proxied**, and lyrics are shown only when lawfully provided. Until an API key is added,
  `/api/discovery/status` reports `apiConfigured: false`, channel search returns `configured: false`
  with an empty list, and **manual URL import** still works.
- **Watching a video.** Every place a video appears — the Music Library list, the song page, the
  Discovery review queue and the public highlights — shows its cover with a play badge, and a click
  opens the **official YouTube player** in a dialog on the site (`?watch=<id>` on a song page, so the
  back button closes the player and one video can be linked directly). Nothing is fetched from YouTube
  until somebody asks to watch, and only **approved** videos are ever playable: a discovered or
  rejected one keeps its cover and says so.
- **Our music, on one public page.** `/music` shows the whole catalogue to anyone, without signing in,
  with search and category filters and a click-to-play player. It is the same library the choir uses
  internally, presented as the choir's own music rather than a link out to YouTube.
- **Google Sheets (application register).** Applications arrive via the signed webhook
  (`POST /api/applications/webhook`, idempotent on `externalId`). When a signing secret is configured,
  each call must carry an **HMAC-SHA256 signature** of the request body (the raw secret is also
  accepted for quick setups). The webhook infers the applicant's name/email/phone and their chosen
  group from the Google Form answers, then notifies the Chairman and that group's administrator. The
  complete, copy-paste **Google Apps Script** (HMAC signing, retries, failure logging) is a single
  copy-safe file at [`docs/apps-script/Code.gs`](docs/apps-script/Code.gs), with a setup and
  troubleshooting guide in [`docs/apps-script/README.md`](docs/apps-script/README.md) and the
  integration explained in [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md).
- **Email / SMS.** Credential e-mails are delivered through the choir's own **Apps Script** mail web app
  (or SMTP) once configured; **SMS** has no free server-side gateway, so the member record offers
  WhatsApp / SMS / copy buttons that open the administrator's own messaging app with the message already
  written. Password-reset links are surfaced to the administrator whenever e-mail is not configured —
  the UI states which of the two it is.

---

## The membership lifecycle

```
Google Form ─▶ Sheet ─▶ webhook/manual ─▶ application record ─▶ review
        ─▶ approve ─▶ (exactly one) member + account with generated username & password
        ─▶ role ─▶ administrator shares the credentials ─▶ member signs in, sets their own password
```

Submitting the form never creates an account. Only an approve decision — which requires the
`application.decide` permission at the correct group scope — creates a member and a sign-in account,
in a single transaction, and writes an audit entry.

**Credentials are generated at approval.** Approving an application mints the account **username and
password** immediately, sends them to the new member through the configured delivery channel, and
shows them to the approving administrator once with a copy button (the fallback when delivery is not
configured). The password is random and easy to read aloud
(`Ingoma!4821-umwuka`), the account is active straight away, and the member is asked to choose their
own password the first time they sign in.

**Signing in.** The form's email question is optional. Every approved applicant receives a username
derived from their full name (`Irabizi Valentin`, or `Irabizi Valentin 2` if that name is already
taken), so they can sign in with either their email address or that username. When an applicant left
the email blank, the account stores a reserved, non-routable placeholder address
(`…@no-email.invalid`) — never shown anywhere — and the username becomes the permanent sign-in name
on their member record. The lookup is forgiving about case and spacing.

**Which administrator sees a submission.** The webhook reads the applicant's name, email/phone and
the group from the Google Form answers (a flat `"Question": "Answer"` payload works as-is). The
group answer — *Junior*, *Senior*, or *Support member* — is mapped to the official group, so the
application lands in that group's queue: **Junior Admin** sees junior applications, **Members Admin**
sees members/support applications, and the **Chairman** sees every application across all three
groups. Only the group's own administrator is notified the moment an application arrives, and only
they can approve or reject it — the Chairman oversees the queue but never decides. A group
administrator can always route an unassigned submission by choosing a group at approval.

Approving an application stores the applicant's details on the new member: date of birth, gender,
voice section, province/district/sector (as region/city/address), occupation and singing experience
(senior), current class and emergency contact (junior), and skills (support). The complete answer set
is always kept on the application. The photo-upload answer is kept as a clickable link rather than
copied into the member photograph. See `docs/INTEGRATIONS.md` for the field-by-field mapping and a
note on Google Forms' sign-in requirement for file uploads.

Paste [`docs/apps-script/Code.gs`](docs/apps-script/Code.gs) into the Form's Apps Script project and
run `installTrigger` once (see [`docs/apps-script/README.md`](docs/apps-script/README.md) for setup,
including the “no target function” trigger fix). `docs/INTEGRATIONS.md` explains the webhook and the
field mapping.

---

## Testing status

**Verified green on this machine** (`node`/`tsx` against a running server and dev database):

- `npm test` — 67 unit tests pass: password hashing/verification and strength rules, opaque token
  hashing, constant-time comparison, AES-256-GCM secret encryption (incl. tamper rejection),
  role/permission invariants (exactly seven roles, exactly four admin roles, `senior_leader` /
  `junior_admin` / `members_admin` cannot reach settings or audit, singers limited to own records,
  every granted permission exists at an allowed scope), the administrator-account definitions
  (strong passwords, known roles, exactly the four admin roles, profile photos when set, env overrides),
  approval-generated credentials (readable by the group's own administrator, emailed to the member,
  never sent to a placeholder address), the failed-restore alarm (marker parsed at boot, reported
  on `/api/health`, one audit entry + one Chairman notification, no nagging on a healthy boot), and
  upload durability (every upload mirrored into the bucket, served from the bucket — and re-cached —
  after the disk is wiped, private files only after the authorization check, deletion propagated,
  no bucket call for unknown paths and traversal refused), removing a member record (Chairman
  only, withdrawn records only, account and photograph erased, application and audit trail kept —
  including when the removed account had itself written to the append-only trail, whose pointer to
  that account is cleared while the history stays uneditable), and
  e-mail through a Google Apps Script mail web app (the credentials are posted to the configured web
  app and the signature verifies, the 302 Apps Script answers with is followed as Google requires
  (POST delivers the message, GET reads the reply — against a real deployment), the signed text is
  folded to plain ASCII first because `Utilities.computeHmacSha256Signature` signs a 7-bit view of a
  String — every other character counts as one `?` — so an accented name or an arrow would otherwise
  be refused with "bad signature", a refusal from the
  script is reported as a
  failure, an endpoint without the signing secret is not treated as configured, and an unreachable web
  app never undoes the membership).
- `npm run typecheck` — server **and** web TypeScript compile with zero errors.
- `npm run build` — Vite production build succeeds (28 pages); the server build copies `schema.sql`
  into `dist/` so `npm start` (compiled output) boots.
- Server boots, migrates, seeds (38 permissions, 6 roles, 3 groups, 4 voice sections, 8 song
  categories, 5 learning stages, 10 discipline categories).
- First-admin setup token issuance and `POST /api/setup` (creates the first **Chairman**).
- Login, session cookie, `GET /api/auth/me`, logout.
- **Admission lifecycle:** create application → under review → approve (creates one member + invited
  account) → invitation valid → activate → new member logs in → `GET /members/me`.
- Approve is **idempotent** (re-approving returns the same member, no second member, no new invite).
- **Group isolation:** a Junior Admin sees junior members but zero senior members, is blocked (403/404)
  from reading a senior member by id, cannot approve a senior application, and search does not leak
  senior records.
- **RBAC:** a Junior Admin is denied the audit log and settings (403); a plain member cannot read
  another member. The Chairman reads all three groups org-wide.
- **Chairman controls all three groups:** logs in with role `chairman`, sees Senior + Junior +
  Members/Support Members in the group metadata, and holds every permission at global scope.
- **“Message the Chairman”:** a non-Chairman can send (`POST /messages`), is **denied** the inbox
  (`GET /messages?box=inbox` → 403) and denied replying (403); the Chairman sees the unread count,
  reads the inbox, replies, and the sender then sees the reply in their sent box.
- **Legacy role migration:** re-seeding a database that still holds the old `senior_admin` role moves
  the assignments to `chairman` and removes the old role — the account keeps its supreme-admin access
  and the one-time setup route stays closed.
- Admin avatars are served (`/assets/avatars/chairman.png`, `junior-admin.jpg`, `members-admin.jpg`)
  and attached to the three accounts.
- Audit log is populated with `application.approve` and is append-only (read-only routes).
- CRUD + honesty checks: songs (create, 409 on duplicate, detail shape, progress), discovery
  (honest `configured:false`, manual import, queue), attendance (session create, detail, nullable
  rate + policy), discipline, goals (progress math: current=3, numeric percent), events, training,
  announcements (templates, create, publish), notifications, all seven reports, settings
  (returns settings + integrations, **never** returns secret plaintext), integrations patch, roles.
- SPA served with deep-link fallback (`/`, `/login`, `/admin/login`, `/admin`, `/app` → HTML) and
  static assets (`/logo.png`, `/assets/gallery/*`, `/assets/avatars/*`).
- **Administrator accounts:** `npm run seed:admins` creates the four accounts idempotently and
  **all four log in successfully** — the Chairman and the three group administrators each get the admin
  dashboard (`role` = chairman/senior_leader/junior_admin/members_admin). The admin sign-in page
  (`/admin/login`, plus `/admin`) and the member sign-in page (`/login`) both serve.
- **Role-differentiated dashboards:** the dashboard payload differs by role — the Chairman gets all
  three groups plus the Founders of the Choir section, each group admin gets exactly their own group,
  and members get their personal view. A live run confirmed each admin dashboard reports its own scope
  label and only the Chairman receives the member-message and Founders panels.
- **Senior Leader role (live, 32/32 e2e checks):** the Senior Leader logs in, sees only the Senior
  group, and is denied Junior-group member reads and settings. A webhook application for the Senior
  group lands in the Senior Leader's queue (and the Chairman's, for oversight), notifies both, stays
  invisible to the Junior Admin, and the Senior Leader's approval creates exactly one active Senior
  member. The Chairman can save a Founders list (invalid JSON is rejected with 400) which the
  dashboard renders; the Senior Leader cannot edit it.
- **Group-aware webhook intake (live):** a Google-Forms-style flat POST with only a *“Which group are
  you applying for?”* answer had its **Junior** group inferred, produced a `pending` application, and
  was visible to the Chairman **and** the Junior Admin while staying invisible to the Members Admin.
  The Chairman and Junior Admin were each notified. Approving it created exactly one `CHK-…` member in
  the junior group with an invitation URL, visible to the Chairman and Junior Admin but not the Members
  Admin.
- **Signed webhook (HMAC-SHA256, live):** with a secret configured, a correctly HMAC-signed request is
  accepted (hex, case-insensitively), an uppercase digest is accepted, the raw shared secret is still
  accepted, and a wrong digest, a missing signature, or a **tampered body** are all rejected with `403`.
  A known-vector unit test pins the HMAC implementation.
- **Chairman messaging notifications:** the Chairman's unread-count response now carries the latest
  sender, the dashboard surfaces recent senders (“who is texting him”), the sidebar shows a live unread
  badge on Messages, and the web app raises a device/desktop notification (Web Notifications API) when a
  new message arrives.
- **Device notifications (Web Push, free):** a group administrator registers a phone or laptop (My
  Account → *Notifications on your devices*, or the bell icon in the header) and the server pushes a
  real operating-system notification when a new application arrives — **even with the site closed**,
  because the browser's push service holds the message and wakes the device. The VAPID signing key is
  generated on first use and kept in the database (so it survives a deploy through Litestream); no
  hosting-dashboard step and no third-party account. `push.test.ts` covers registration and the
  published key, the intake push reaching the right group's administrator (one device, one push, link
  on the application), a device following the account that signs in on it, `404`/`410` pruning of a
  subscription the browser threw away, a failed delivery being recorded on the device, unsubscribing,
  and a long body being shortened to one lock-screen line. Delivery uses a recorded transport in the
  tests, so nothing leaves for a real push service during them.

> The development database was reset for this launch: the previous test/demo rows (test singers,
> testers, smoke songs) were removed. Reference data is re-seeded, so the site starts clean with only
> the four real administrator accounts.

**Not verified / requires setup or a browser:**

- **YouTube Data API discovery** (`/discovery/channels`, `/discovery/run`) — needs an API key and a
  verified channel before real results appear. Without them the honest "not configured" states were
  verified instead.
- **Google Sheets sync / webhook against a real sheet** — the signed, idempotent webhook endpoint was
  exercised with a realistic flat Google-Forms payload (name/email/group inferred), but not against a
  live Google Form/Apps Script deployment.
- **Email/SMS delivery** — the Apps Script mail channel is configured and sends credential e-mails (the
  post, its signature and the 302 Apps Script answers with were verified live); **SMS** remains manual,
  through the WhatsApp/SMS/copy buttons on the member record. The *“Message the Chairman”* feature
  raises an in-app notification and a device notification — while a tab is open through the Web
  Notifications API, and while the site is closed through Web Push (see *Device notifications* above).
  The push path is unit-tested end to end with a recorded transport but has **not** been exercised from
  a real phone or desktop browser in this environment.
- **Browser/UI click-through and automated browser tests** — the UI compiles and builds and its API
  contracts are exercised, but no Playwright/end-to-end browser suite was run here.
- **Multipart uploads against the real bucket** — member photos, song audio, application documents
  and brand/gallery uploads are now exercised end to end (mirror on upload, serve-from-bucket and
  re-cache after a simulated disk wipe, private-file authorization, deletion propagation, traversal
  refusal) against a stand-in S3 endpoint in `media-storage.test.ts`. The identical flow against
  Backblaze itself, with real multipart file bodies, has not been run from this environment.
- Attendance rate arithmetic beyond the default policy values.
- **The Render deployment** — the live service was verified to serve the built SPA, `/api/health`
  and a real administrator sign-in over https. `deploy/render-start.sh` falls back correctly without
  `S3_*` and takes the Litestream path with them. The durable-storage path was verified **against the
  real Backblaze B2 bucket** with the production credentials: `litestream replicate -once` uploaded a
  test database, the local file was deleted, and `litestream restore` returned all 501 rows intact
  (test objects were removed afterwards). The transaction-budget config generated by the start
  script was additionally run through `litestream v0.5.17` to confirm the settings are honoured
  (unknown YAML keys are *silently ignored* by Litestream, so this was checked, not assumed):
  `sync-interval=2m0s`, L0 retention monitor `interval=1h0m0s retention=1h0m0s`, compaction
  monitors `15m0s`/`1h0m0s`/`6h0m0s`, snapshot level `24h0m0s`. The optional Docker image
  (`Dockerfile`, `deploy/entrypoint.sh`) was never built — no `docker` CLI in this environment.
- **A real durability failure is no longer silent** (see *Security notes* below and
  `docs/DEPLOYMENT.md`, Troubleshooting). A Backblaze transaction cap once blocked the restore, the
  free instance came up on an empty database and simply looked healthy. The cap itself is now
  avoided (the transaction budget above keeps the daily API-call totals ~10× under the free
  allowance), and the marker → `/api/health` → red banner → audit entry → Chairman notification
  chain is covered by `server/test/unit/restore-alert.test.ts`; the banner as painted in a browser
  was not opened here. One gap remains by design: if a cap is exhausted and *resets* before the next
  boot, the restore succeeds silently from a stale replica — the app cannot tell "no writes since
  then" from "writes that never got backed up".

---

## Security notes

- Passwords: scrypt with per-password salt; never logged. The app also keeps an AES-256-GCM copy of
  each account password (`users.password_enc`, key = `APP_SECRET`) so an administrator can read back
  the credentials generated at approval and email them to the member — this is a deliberate,
  documented trade-off: anyone with the database **and** `APP_SECRET` can recover member passwords.
  Only an administrator who may edit the member can see it; it is never included in list responses.
- Sessions: opaque random token, stored **hashed**; httpOnly cookie; rolling expiry; lockout.
- Default accounts (`npm run seed:admins`) are **opt-in** and refuse to run under
  `NODE_ENV=production` unless `ALLOW_DEFAULT_ACCOUNTS=1` is set. On boot, that same flag only
  **creates missing** accounts and never modifies existing ones; in production, accounts still
  carrying a sample password must choose their own at first sign-in. Change or delete the sample
  credentials before any real deployment (or set the `*_PASSWORD` environment variables).
- A temporary password (a sample account's, or the one approval e-mails to a new member) closes the
  platform until it is changed: every authenticated route answers 403 except the `/auth` router, so
  changing the password, requesting a reset, accepting an invitation and signing out all still work.
  The web app sends such a user straight to **My Account** — the only page it renders — instead of
  leaving them on a dashboard that cannot load.
- Secrets (integration keys/credentials): AES-256-GCM at rest; never returned to the browser.
- Every protected request checks authorization server-side, including group isolation; id/param
  tampering cannot bypass it.
- Audit log is append-only and excludes passwords, tokens and sensitive personal data.
- Uploads: MIME/type and size limited; private files are streamed only after an authorization check
  (`GET /api/files/:id`); public media is a separate bucket at `/media/*`.

---

## Project structure

```
choir/
├─ Dockerfile             # OPTIONAL container image (web + server + Litestream; not used by Render)
├─ render.yaml            # Render blueprint reference (service settings + env vars)
├─ deploy/                # render-start.sh (Render + Litestream→B2), entrypoint.sh (Docker), restore-alert.sh (shared "restore failed" alarm), hosting/
├─ docs/
│  ├─ API.md              # canonical endpoint contract
│  ├─ CONVENTIONS.md      # stack, imports, auth, audit, UI conventions
│  ├─ DEPLOYMENT.md       # Render + Backblaze B2 (https://la-porte-ador.onrender.com)
│  ├─ INTEGRATIONS.md     # YouTube / Google Sheets / e-mail setup steps
│  └─ apps-script/        # Code.gs + README.md (ready-to-paste Google Apps Script)
├─ server/                # Express 5 + better-sqlite3 API
│  ├─ src/
│  │  ├─ auth/            # permissions, access control, sessions
│  │  ├─ db/              # schema.sql, migrate, seed, seed-admins (default accounts)
│  │  ├─ lib/             # security, secrets, errors, audit, http
│  │  ├─ middleware/      # auth, rate-limit, error handling, uploads
│  │  ├─ routes/          # one router per module
│  │  ├─ services/        # groups, members, uploads, notifications, scheduler
│  │  ├─ integrations/    # youtube
│  │  ├─ app.ts, index.ts
│  └─ data/               # database, uploads, first-admin token (git-ignored)
└─ web/                   # React 19 + Vite + Tailwind v4
   ├─ public/             # logo.png, assets/gallery/* (provided photographs)
   └─ src/
      ├─ api/             # fetch client + hooks
      ├─ auth/            # AuthProvider, route guards
      ├─ components/      # ui kit, layout shell
      └─ pages/           # public, auth and app pages
```
