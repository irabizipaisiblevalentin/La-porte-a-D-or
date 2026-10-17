# Google Apps Script — Google Form → membership applications

`Code.gs` is the **complete** script. Copy it into your Google Form's Apps Script
project. It forwards every form submission to the platform, which files the
application under the group the applicant chose and notifies the Chairman and
that group's administrator for an approve/reject decision.

> **The official form:** <https://forms.gle/JZJmWZNMQAYNm5uq5>
> **Webhook endpoint:** `POST /api/applications/webhook`

## Setup (5 minutes)

1. Open the **Google Form** (the real one, not a copy).
2. **Extensions → Apps Script.** This opens a script *bound* to the form.
   > Do **not** go to `script.google.com` → **New project**. A standalone script
   > is not bound to the form, so `FormApp.getActiveForm()` returns `null` and
   > `installTrigger` fails.
3. Delete the placeholder `myFunction`, then paste the **whole** of `Code.gs`.
4. Edit the `CONFIG` block at the top:
   - `ENDPOINT` → `https://<your-host>/api/applications/webhook`
   - `SECRET`   → the value in **Settings → Integrations → "Google webhook signing secret"**
5. **Save** (`Ctrl/Cmd + S`).
6. In the **function dropdown** at the top of the editor, choose **`installTrigger`**
   and click **Run**. Approve the permissions when Google asks.
7. (Optional) Choose **`sendTestApplication`** and click **Run**, then check
   **Applications** in the app for a `pending` "Apps Script Test" row.

That's it. You never have to open the **Triggers** dialog — step 6 creates the
form-submit trigger for you.

## Troubleshooting

### "You cannot create a trigger without a target function, please add functions to the attached script."

The editor could not find **any** functions in the project. That happens when:

- the file was **not saved** after pasting, or
- the paste produced an **empty file** (pasted into the wrong project/file), or
- the code has a **syntax error** (the editor underlines it).

**Fix:** paste the whole `Code.gs`, press **Save**, and confirm the function
dropdown now lists `onFormSubmit`, `installTrigger`, `sendTestApplication`, …
Then run `installTrigger` (no need to use the Triggers dialog).

### "This project has been renamed."

This is a Google Drive / Apps Script notice shown when the **bound Form** (the
script's container) was renamed or moved. It does **not** affect the script or
the trigger — just continue.

If you see it right after creating a **new project**, you are likely in an
**unbound/standalone** script. Reopen the script from the form
(**Extensions → Apps Script**) so it is bound. If you genuinely need a
standalone script, use `installTriggerById('<form id>')` instead of
`installTrigger`.

### The function dropdown is empty

- **Save the file.** Unsaved or syntactically broken code lists no functions.
- Make sure you pasted into the **`.gs` file** (e.g. `Code.gs`), not into a
  `.html` file.

### Authorization / scope errors when running `installTrigger`

- Approve the Google consent screen. The script needs to make external requests
  (the webhook) and create triggers.
- On a managed Google Workspace, an admin may have to allow Apps Script and the
  `script.external_request` / `script.scriptapp` / `forms.currentonly` scopes.

### Submissions arrive but are rejected (HTTP 403)

The `SECRET` in `Code.gs` does not match the platform's signing secret. Re-copy
it from **Settings → Integrations**, or clear the platform secret to accept
unsigned requests while testing.

### Nothing is delivered (HTTP 5xx / network)

- Confirm the host is reachable and `ENDPOINT` has no trailing slash.
- Failures are written to **Apps Script → Executions** (and to the sheet in
  `LOG_SHEET_ID` if you set one).

## Optional manifest

If you use the manifest view (**Project Settings → "Show appsscript.json"**), you
can paste `appsscript.json` to pin the V8 runtime and list the exact scopes.
It is **not required** — Apps Script auto-detects scopes from the code.

## How a submission flows

1. Applicant submits the Google Form.
2. `onFormSubmit` reads the answers, detects **name / email / phone / group**,
   and builds a JSON payload.
3. `sendToPlatform_` signs the raw body with **HMAC-SHA256** (lowercase hex) and
   POSTs it to the webhook with header `x-chorale-signature`, retrying on
   transient errors.
4. The platform verifies the signature, deduplicates on `externalId`, files the
   application under the inferred group, and notifies the Chairman and that
   group's admin.
5. An admin approves it — **only then** is the applicant's record stored and an
   account/invitation created.
