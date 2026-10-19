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

## Optional: send the platform's e-mail through this Google account

The same script can send the platform's e-mail — the member's sign-in details
after an approval — straight from this Google account. **No SMTP relay, no app
password, no extra account.** This is the free, code-only alternative to signing
up with a mail provider (see [Email](../INTEGRATIONS.md#email)).

1. Paste the current `Code.gs` (it contains the mail `doPost` handler) and
   **Save**.
2. In the **function dropdown**, choose **`sendTestMail`** and click **Run**.
   Approve the new *"Send email as you"* permission; a test message arrives in
   this account's inbox.
3. Deploy the web app:
   - **First time:** **Deploy → New deployment → Web app**:
     - **Execute as:** *Me*
     - **Who has access:** **Anyone**
     Copy the resulting `/exec` URL.
   - **Already deployed (you added the mail code afterwards):**
     **Deploy → Manage deployments →** pencil icon **→ Version: New version →
     Deploy**. The URL stays the same, and this step is what actually puts
     `doPost` on it — skip it and the URL only ever answers *"Script function not
     found: doPost"*, so nothing is ever sent.
4. Paste that URL into the app under **Settings → Integrations → Apps Script mail
   web app URL**. The **Google webhook signing secret** must already be set: it
   signs every mail call, and the URL is ignored without it.

Quota (Google's, not ours): a free consumer account may send to **100
recipients/day** (1,500 on Workspace). One approval sends one message, so this is
far more than the choir needs.

### Why "Who has access: Anyone" is safe

The URL alone cannot send anything: every call must carry an HMAC-SHA256
signature over the recipient, subject and body, keyed by `CONFIG.SECRET`, and a
call older than 15 minutes is refused. A stranger who finds the URL can only make
the script answer `{"ok":false,"error":"bad signature"}`.

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

### The mail web app answers "Script function not found: doGet"

Opening the `/exec` URL in a browser sends a **GET**, and only `doPost` exists.
This is expected — the browser is not how the platform calls it. To prove the
mail path works, run `sendTestMail` from the editor instead.

### The mail web app answers "Script function not found: doPost"

The **deployed version** predates the mail code. Saving `Code.gs` is not enough:
go to **Deploy → Manage deployments →** pencil icon **→ Version: New version →
Deploy** and try again.

### Approvals are not e-mailed ("bad signature" / "stale request")

- **bad signature** — the platform's **Google webhook signing secret** differs
  from `CONFIG.SECRET` in the script. Re-copy one to the other.
- **stale request** — the server clock and Google's are more than 15 minutes
  apart, or an old request was replayed.

Both are recorded in **Settings → Integrations → Recent integration runs** with
the script's own wording. Check **Apps Script → Executions** for the same call.

### E-mail quota reached

`MailApp.sendEmail` throws *"Service invoked too many times: email"* once a
consumer account has mailed to 100 recipients in a day (1,500 on Workspace). The
platform records exactly that message and tells the approver; credentials can
still be handed over with the WhatsApp/SMS/Copy buttons on the member's page.

### Nothing is delivered (HTTP 5xx / network)

- Confirm the host is reachable and `ENDPOINT` has no trailing slash.
- Failures are written to **Apps Script → Executions** (and to the sheet in
  `LOG_SHEET_ID` if you set one).

## Optional manifest

If you use the manifest view (**Project Settings → "Show appsscript.json"**), you
can paste `appsscript.json` to pin the V8 runtime and list the exact scopes
(`script.external_request`, `script.scriptapp`, `script.send_mail`,
`forms.currentonly`, `spreadsheets`).
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
