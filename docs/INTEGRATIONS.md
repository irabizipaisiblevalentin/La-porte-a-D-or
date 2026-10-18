# Integrations setup

This document explains how to turn on the platform's external integrations. Everything here is
optional: the platform runs fully without any of it, and always reports the true status rather than
pretending an integration works.

Two ground rules apply throughout:

1. **No fabricated data.** If an integration is not configured, the API returns `configured: false`
   (or a `not_configured` status) and empty results — never invented channels, videos or messages.
2. **Secrets never leave the server.** Secret values are encrypted at rest (AES-256-GCM) and are
   **never** returned to the browser. The UI only shows "Set" / "Not set".

All of this is configured by the **Chairman** under **Settings → Integrations**. The stored
keys are:

| Key | Secret? | Meaning |
| --- | --- | --- |
| `youtube_api_key` | **yes** | YouTube Data API v3 key |
| `youtube_channel_id` | no | Official channel id (`UC…`) |
| `youtube_channel_title` | no | Official channel display name |
| `youtube_channel_verified_at` | no | Timestamp of channel confirmation |
| `google_sheet_id` | no | Spreadsheet id of the application register |
| `google_service_account` | **yes** | Service-account JSON for the Sheets API |
| `google_webhook_url` | no | Apps Script webhook URL (alternative to the Sheets API) |
| `google_webhook_secret` | **yes** | Shared secret used to verify inbound webhooks |
| `smtp_host` | no | SMTP host |
| `smtp_port` | no | SMTP port (587 STARTTLS or 465 TLS) |
| `smtp_user` | no | SMTP username |
| `smtp_password` | **yes** | SMTP password |
| `smtp_from` | no | From address on outgoing email |

Each integration's `status` is **computed from what is actually stored**: `configured` when the
required value(s) are present, otherwise `not_configured`. No status is set by hand.

---

## YouTube (official channel)

**Purpose:** discover and catalogue public videos from the choir's official channel. Metadata and
URLs are stored; **no media is ever downloaded, rehosted or proxied**, and playback always uses
YouTube's official embedded player (`https://www.youtube.com/embed/<videoId>`).

Without a key the platform is fully usable: `/discovery/status` reports `apiConfigured: false`, channel
search returns `configured: false`, and the **manual URL import** still lets an admin add a video by
URL. This manual path requires no API key.

### Steps

1. In the Google Cloud Console, create (or reuse) a project and **enable the YouTube Data API v3**.
2. Create an **API key**. Restrict it to the YouTube Data API v3 (and, if you like, to your server's
   IP address).
3. In the app, open **Settings → Integrations** and paste the key into **YouTube Data API key**.
   It is stored encrypted.
4. Use **Discovery → channel lookup** to search for the choir's channel, then **verify** it. This
   stores `youtube_channel_id`, `youtube_channel_title` and `youtube_channel_verified_at`.
5. Run **Discovery → run** to fetch candidate videos into the review queue. Approve them into the
   library, linking each to a song and choosing a primary video.

### Quota notes

The YouTube Data API has a daily quota. A single `search.list` or `playlistItems.list` page costs
quota units; keep `maxResults` modest and run discovery only when needed.

### What is deliberately *not* done

- No downloading, transcoding, rehosting or proxying of audio/video.
- No scraping of lyrics. Lyrics can be stored only when an administrator supplies them lawfully.

---

## Google Sheets (application register)

**Purpose:** bring applications in from the Google Form's linked spreadsheet.

There are two supported paths — pick one.

### Option A — inbound webhook (simplest)

The platform exposes `POST /api/applications/webhook`. It is **idempotent on `externalId`**, so
re-sends do not create duplicates. When `google_webhook_secret` is configured, every call must carry a
valid signature — an **HMAC-SHA256 of the request body** keyed by that secret (or, for a quick setup,
the raw secret itself). The bundled Apps Script at
[`docs/apps-script/Code.gs`](apps-script/Code.gs) computes the HMAC for you.

1. In the app, set **Google Apps Script webhook URL** (`google_webhook_url`) to your script's
   `/exec` URL for reference, and set **Google webhook signing secret** (`google_webhook_secret`) to
   a long random value. The secret is stored encrypted (AES-256-GCM) and never returned to the browser.
2. Paste the **Full Apps Script** ([`docs/apps-script/Code.gs`](apps-script/Code.gs)) into the Form's
   Apps Script project, set the endpoint and the
   same secret, and install its trigger. It POSTs each response to
   `https://<your-host>/api/applications/webhook` with an HMAC-SHA256 signature header and a stable
   `externalId` (the Form response id) so retries are deduplicated.

Applications then appear in **Applications** with status `pending` for review.

#### Full Apps Script (Option A)

The complete, production-ready script is a single, copy-safe file:
**[`docs/apps-script/Code.gs`](apps-script/Code.gs)**. It extracts the applicant's details, maps the
chosen group to a canonical group id, signs the request with **HMAC-SHA256**, retries transient
failures with backoff, and records failures. Setup and troubleshooting are in
**[`docs/apps-script/README.md`](apps-script/README.md)**; the optional manifest is
**[`docs/apps-script/appsscript.json`](apps-script/appsscript.json)**.

To install it:

1. Open the **Google Form** and choose **Extensions → Apps Script** (this binds the script to the form).
2. Delete the placeholder `myFunction` and paste the entire contents of `docs/apps-script/Code.gs`.
3. Set `ENDPOINT` and `SECRET`, then **Save** (`Ctrl/Cmd + S`).
4. Select **`installTrigger`** in the function dropdown and click **Run** once, approving the
   permissions. This creates the form-submit trigger for you — you do **not** need the Triggers dialog.

**Troubleshooting the Apps Script install.**

- **“You cannot create a trigger without a target function, please add functions to the attached
  script.”** — the editor found no functions, which means the file was not saved, was pasted empty,
  or has a syntax error. Re-paste the whole script, press **Save**, and confirm the function dropdown
  lists `onFormSubmit`, `installTrigger`, and `sendTestApplication`. Then run `installTrigger` (this
  avoids the Triggers dialog entirely).
- **“This project has been renamed.”** — a Google Drive / Apps Script notice shown when the parent
  Form was renamed or moved. It does not affect the script or the trigger; just continue. If you see
  it after creating a *new* project, you are probably in an unbound/standalone script — reopen it from
  the Form (**Extensions → Apps Script**) so `FormApp.getActiveForm()` works.
- **Empty function dropdown** — save the file first; unsaved or syntactically broken code lists no
  functions. Make sure you pasted into the `.gs` file, not a `.html` file.
- **Submissions rejected with HTTP 403** — the script's `SECRET` does not match the platform's
  signing secret; re-copy it from **Settings → Integrations**.

**Signature scheme.** The script sends `x-chorale-signature: <hex HMAC-SHA256 of the request body,
keyed by the secret>`. The server recomputes it over the exact received bytes and compares in constant
time; a tampered body fails. (For a quick setup you may instead send the raw secret in that header, or
as a `secret` field in the body — the server also accepts that — but HMAC is recommended because the
secret itself never travels over the wire.)

**What the platform reads from the answers:**

- a question whose title contains **“name”** (e.g. *Full name*) — the applicant's name. Questions about
  an **emergency contact / guardian / parent / next of kin** are ignored, so the applicant's own name is
  always used;
- a question whose title contains **“email”** / **“phone”** — contact details. Emergency-contact phone
  numbers are ignored for the primary phone;
- a question asking **which group** they are applying for, with an answer naming one of the three
  groups (**Junior**, **Senior**, or **Members / Support Members**). The answer is mapped to
  `grp_junior` / `grp_senior` / `grp_members`, so the corresponding group administrator (and the
  Chairman) are notified immediately. An explicit “which choir **group**…” question always wins over a
  later “which singing **section**…” question.

If no group can be recognised, the application is stored unassigned and stays visible to the Chairman
to route at approval time.

**What is stored when an application is approved.** The full set of answers is always kept on the
application itself (visible under **Applications → [applicant] → Answers**). On approval the platform
also copies the recognised values onto the new member record:

| Form question (by keyword) | Member field |
| --- | --- |
| date of birth | `members.date_of_birth` |
| gender | `members.gender` |
| singing section (Soprano/Alto/Tenor/Bass) | `members.voice_section_id` |
| province / district / sector / additional address | `member_contacts.region` / `city` / `address` |
| occupation / main activity | `member_senior.occupation` |
| describe previous choir/singing experience | `member_senior.singing_experience` |
| current class / trend (junior) | `member_junior.current_class` |
| emergency contact name / phone | `member_junior.emergency_contact_name` / `emergency_contact_phone` |
| additional skills or talents (support) | `member_support.skills` |

Anything not recognised simply stays on the application answers — the platform never guesses. The
**photo upload** answer is a Drive link and is deliberately **not** copied into the member's photograph
field (a Drive link would render as a broken image); it stays clickable on the application page, and an
administrator can upload a proper photograph from the member's page.

#### About the “upload a recent photo” question

Google Forms **file-upload questions always require the respondent to sign in with a Google account** —
this cannot be turned off, and it can exclude applicants without a Google account (for example some
junior applicants). The files are stored in the **form owner's** Drive against their storage quota.
Recommended options:

1. **Make the photo question optional** (untick *Required*). Anyone can still submit; those with a
   Google account may attach a photo, and administrators can collect the rest later. *(Recommended.)*
2. **Keep it required** only if you accept that every applicant needs a Google account.
3. **Remove the upload** and collect photographs by WhatsApp/email after approval.

Either way, approving an application does not depend on the photo being present.

### Option B — Sheets API pull

1. Create a Google service account, enable the **Google Sheets API**, and share the spreadsheet with
   the service account's email address (read access).
2. Copy the service-account JSON into **Google service account credentials (JSON)**
   (`google_service_account`) — stored encrypted.
3. Set **Google Sheet ID of the application register** (`google_sheet_id`) to the spreadsheet id from
   its URL (`https://docs.google.com/spreadsheets/d/<THIS_IS_THE_ID>/edit`).

### Note

In both options, submitting the form **never** creates an account. It only creates an application
record that must be reviewed and approved by an administrator.

The form's email question is **optional**. Approving an application always creates the member and
the sign-in account, and returns an automatically generated **username and password** to the
administrator — the username comes from the applicant's full name, and is what they sign in with when
no email address was given. The member is asked to choose their own password at first sign-in.

The same credentials are **emailed to the applicant automatically at approval** (see
[Email (SMTP)](#email-smtp)). When the applicant left the email question blank, or no relay is
configured, nothing is sent and the approving administrator is told why — the credentials stay on the
application screen and on the member's record, where **WhatsApp**, **SMS** and **Copy** buttons hand
them over for free.

The password is readable for the whole life of the account: the member's record shows it under
**Sign-in password**, and the administrator who manages that member can **Send sign-in details** again
at any time. It is stored as AES-256-GCM ciphertext in `users.password_enc` (key: `APP_SECRET`) next
to the one-way scrypt verifier in `users.password_hash`, and is rewritten every time the password
changes — approval, self-service change, and reset.

---

## Email (SMTP)

**Purpose:** email sign-in details to an approved member, plus invitation, password-reset and
notification emails. **This is not configured by default, and nothing here is required for the
platform to work.**

Until SMTP is configured:

- Notifications are delivered **in-app only** — this is real and works.
- Invitation links and password-reset links are **returned to the administrator** in the UI (with a
  copy button) so they can be shared manually. The UI states plainly that no email was sent.
- Approval does not email the new member. The generated username and password stay on the application
  screen and on the member's record, so they can be handed over by hand. Every member record also has
  a **Send sign-in details** button that starts working the moment a relay is configured.

### Steps

1. Obtain SMTP credentials from your mail provider (e.g. a transactional provider or your domain's
   mail host). For Gmail: turn on 2-Step Verification, create an **App password**, then use host
   `smtp.gmail.com` and port `587` with that 16-character password.
2. In **Settings → Integrations**, set:
   - **Email (SMTP) host** — `smtp_host`
   - **Email (SMTP) port** — `smtp_port` (587 STARTTLS, or 465 implicit TLS)
   - **Email (SMTP) username** — `smtp_user`
   - **Email (SMTP) password** — `smtp_password` (stored encrypted)
   - **Email sender address** — `smtp_from`
3. Once a host **and** a sender address are present the app reports email delivery as available,
   approvals email the member their credentials, and the settings screen reflects the computed
   status. Every attempt is recorded in `integration_runs` and the audit log.

### Free options

- **Email (free):** a personal Gmail account with an **App password** — Google account → Security →
  2-Step Verification → App passwords. Use host `smtp.gmail.com`, port `587`, the Gmail address as
  both username and sender. Free, no card, roughly 500 messages a day, which is far more than a choir
  approves. Free transactional providers (e.g. Brevo's free tier) work with the same four fields.
- **SMS (not free):** there is no reliable free server-side SMS gateway that can reach ordinary
  Rwandan mobile numbers — trial credits only reach pre-verified numbers. Rather than pretend
  otherwise, the app offers two channels that cost nothing and need no account:
  - **WhatsApp** and **SMS** buttons next to the credentials on the member record and in the approval
    result. They open the administrator's own WhatsApp or messaging app with the whole message
    (sign-in page, name, password) already written, so nothing is typed and nothing is billed.
  - **Copy details**, for reading out over the phone.
  If you later buy an SMS gateway (Africa's Talking, Twilio, …), it can be wired in behind the same
  `delivery` result the email path already uses.

---

## Verifying what is configured

- `GET /api/discovery/status` → `{ apiConfigured, channel, lastRun }` for YouTube.
- `GET /api/settings` → `{ settings, integrations }` where each integration carries its computed
  `status` and a boolean-safe representation (secrets show no value).
- `POST /api/auth/password/request` returns `emailDeliveryConfigured`, which the login screen uses to
  explain whether a reset email can be sent or whether an administrator must share the link.

None of these endpoints ever expose a secret value.
