/**
 * Email delivery through a Google Apps Script mail web app.
 *
 * The point of this channel is that the choir needs no mail account at all: the
 * Apps Script it already runs for the application form sends the member's
 * sign-in details from its own Gmail. So the interesting parts to prove are:
 *
 *  - an approval really posts the credentials to the configured web app;
 *  - the call is signed, and the reply survives the 302 that Apps Script always
 *    answers with — the POST to `/exec` is what sends the message, and the
 *    one-time target it redirects to serves the answer over GET only, so a
 *    client that re-POSTs it would see a 405 and report a false failure for a
 *    message that was in fact delivered;
 *  - a refusal from the script (MailApp quota, bad address) is reported as a
 *    failure rather than a success;
 *  - an unsigned endpoint setting is not treated as "configured", so the app
 *    still says delivery is not configured rather than pretending.
 */
import { test, after, before } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-mail-webhook-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "mail-webhook-test-secret-16"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanMail!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorMail!2026bb"

const { migrate, one } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")
const { hmacSha256Hex } = await import("../../src/lib/security.js")

const COOKIE = config.session.cookieName
const CHAIRMAN_EMAIL = "chairman@laportedor.local"
const SENIOR_EMAIL = "senior.admin@laportedor.local"
const SECRET = "mail-webhook-shared-secret"

let server: Server
let base: string

interface ApiResponse {
  status: number
  json: any
  setCookie: string | null
}

async function api(method: string, url: string, opts: { cookie?: string; body?: unknown } = {}): Promise<ApiResponse> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers["content-type"] = "application/json"
  if (opts.cookie) headers.cookie = opts.cookie
  const res = await fetch(base + url, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") }
}

async function login(email: string, password: string): Promise<string> {
  const res = await api("POST", "/api/auth/login", { body: { identifier: email, password } })
  assert.equal(res.status, 200, `login failed for ${email}: ${JSON.stringify(res.json)}`)
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(res.setCookie ?? "")
  assert.ok(match, `no ${COOKIE} cookie returned for ${email}`)
  return `${COOKIE}=${match[1]}`
}

/**
 * Submits through the signed webhook path, exactly as the Apps Script does.
 *
 * Always signed with the same shared secret the mail calls use: once a secret is
 * configured, an unsigned application webhook is refused — in production and
 * here alike.
 */
async function submitApplication(fullName: string, email: string, group: string): Promise<string> {
  const payload = {
    externalId: `mail-${fullName}-${Date.now()}`,
    submittedAt: new Date().toISOString(),
    fullName,
    email,
    phone: "0788000000",
    group,
    answers: [
      { question: "Full name", answer: fullName },
      { question: "Which choir group are you applying for?", answer: group },
    ],
  }
  const raw = JSON.stringify(payload)
  const res = await fetch(`${base}/api/applications/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-chorale-signature": hmacSha256Hex(SECRET, raw) },
    body: raw,
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  assert.equal(res.status, 201, `webhook intake failed: ${JSON.stringify(json)}`)
  return json.applicationId
}

async function approveAs(cookie: string, applicationId: string): Promise<any> {
  const res = await api("POST", `/api/applications/${applicationId}/decision`, {
    cookie,
    body: { decision: "approve" },
  })
  assert.equal(res.status, 201, `approval failed: ${JSON.stringify(res.json)}`)
  return res.json
}

// ---------------------------------------------------------------------------
// A stand-in for the Apps Script web app, matching what a real deployment does
// (verified against one): the POST to /exec is what runs `doPost` and sends the
// message, and it answers 302 to a one-time URL that serves the buffered reply
// over GET only — a POST there is refused. Getting this backwards would either
// lose the reply or report a failure for a message that was in fact sent.
// ---------------------------------------------------------------------------

interface MailCall {
  ts: string
  to: string
  subject: string
  text: string
  signature: string
  method: string
}

interface StandIn {
  url: string
  calls: MailCall[]
  setReply: (reply: { status: number; body: string }) => void
  postHops: number
  close: () => Promise<void>
}

async function startMailWebApp(): Promise<StandIn> {
  const calls: MailCall[] = []
  let reply = { status: 200, body: JSON.stringify({ ok: true }) }
  let postHops = 0

  const readBody = (req: http.IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => resolve(body))
    })

  const app = http.createServer(async (req, res) => {
    const body = await readBody(req)
    if (req.url === "/exec") {
      if ((req.method ?? "") !== "POST") {
        res.writeHead(405, { "content-type": "text/plain" })
        res.end("Script function not found: doGet")
        return
      }
      let parsed: any = null
      try { parsed = JSON.parse(body) } catch { parsed = null }
      if (parsed) calls.push({ ...parsed, method: req.method ?? "" })
      res.writeHead(302, { location: `http://127.0.0.1:${(app.address() as any).port}/usercontent` })
      res.end()
      return
    }
    // The buffered reply: GET only, exactly like script.googleusercontent.com.
    if ((req.method ?? "") !== "GET") {
      postHops += 1
      res.writeHead(405, { "content-type": "text/html" })
      res.end("<html><body>Page introuvable</body></html>")
      return
    }
    res.writeHead(reply.status, { "content-type": "application/json" })
    res.end(reply.body)
  })

  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
  const port = (app.address() as any).port
  return {
    url: `http://127.0.0.1:${port}/exec`,
    calls,
    setReply: (next) => { reply = next },
    get postHops() { return postHops },
    close: () => new Promise<void>((resolve) => app.close(() => resolve())),
  }
}

async function configureMail(cookie: string, values: Record<string, string | null>): Promise<void> {
  const res = await api("PATCH", "/api/settings/integrations", { cookie, body: { values } })
  assert.equal(res.status, 200, JSON.stringify(res.json))
}

before(async () => {
  migrate()
  seed()
  seedDefaultAccounts(() => {}, defaultAccounts(), "create-missing")
  const app = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  base = `http://127.0.0.1:${(server.address() as any).port}`
})

after(() => {
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test("the mail web app is not used until both the URL and the signing secret are set", async () => {
  const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const relay = await startMailWebApp()
  try {
    // URL only: the endpoint would be open to anyone, so it is not usable yet.
    await configureMail(chairman, { mail_webhook_url: relay.url })
    const approved = await approveAs(senior, await submitApplication("Mail No Secret", "no-secret@example.com", "Senior"))
    assert.equal(approved.delivery.sent, false, JSON.stringify(approved.delivery))
    assert.equal(approved.delivery.reason, "not_configured")
    assert.equal(relay.calls.length, 0, "nothing is posted to an unsigned endpoint")
  } finally {
    await relay.close()
    await configureMail(chairman, { mail_webhook_url: null })
  }
})

test("an approval delivers the sign-in details through the Apps Script web app", async () => {
  const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const relay = await startMailWebApp()
  try {
    await configureMail(chairman, { mail_webhook_url: relay.url, google_webhook_secret: SECRET })

    const approved = await approveAs(senior, await submitApplication("Mail Delivered", "delivered@example.com", "Senior"))
    assert.equal(approved.delivery.sent, true, JSON.stringify(approved.delivery))
    assert.equal(approved.delivery.to, "delivered@example.com")

    assert.equal(relay.calls.length, 1, "exactly one mail call reached the web app")
    const call = relay.calls[0]
    assert.equal(call.method, "POST", "the message is delivered by the POST to /exec")
    assert.equal(relay.postHops, 0, "the 302 is followed with a GET; a POST there is refused by Apps Script")
    assert.equal(call.to, "delivered@example.com")
    assert.ok(call.text.includes(approved.credentials.password), "the message carries the member's password")
    assert.ok(call.text.includes(approved.credentials.username), "the message carries the sign-in name")

    // The signature the script checks: HMAC-SHA256 over the newline-joined parts.
    const expected = hmacSha256Hex(SECRET, [call.ts, call.to, call.subject, call.text].join("\n"))
    assert.equal(call.signature, expected)

    const runs = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM integration_runs WHERE integration = 'apps_script_mail' AND status = 'success'",
    )!
    assert.equal(runs.n, 1, "the attempt is recorded as an Apps Script mail run")
  } finally {
    await relay.close()
    await configureMail(chairman, { mail_webhook_url: null })
  }
})

test("a refusal from the script is reported as a failure, not a success", async () => {
  const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const relay = await startMailWebApp()
  try {
    await configureMail(chairman, { mail_webhook_url: relay.url, google_webhook_secret: SECRET })
    relay.setReply({ status: 200, body: JSON.stringify({ ok: false, error: "Service invoked too many times: email" }) })

    const approved = await approveAs(senior, await submitApplication("Mail Quota", "quota@example.com", "Senior"))
    assert.equal(approved.delivery.sent, false, JSON.stringify(approved.delivery))
    assert.equal(approved.delivery.reason, "send_failed")
    assert.match(String(approved.delivery.error), /too many times/i)

    const failed = one<{ detail: string | null }>(
      "SELECT detail FROM integration_runs WHERE integration = 'apps_script_mail' AND status = 'error' ORDER BY rowid DESC LIMIT 1",
    )
    assert.match(String(failed?.detail), /too many times/i, "the reason is kept for the Chairman to read")
  } finally {
    await relay.close()
    await configureMail(chairman, { mail_webhook_url: null })
  }
})

test("an unreachable mail web app does not undo the membership", async () => {
  const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  // A port nothing is listening on.
  await configureMail(chairman, { mail_webhook_url: "http://127.0.0.1:1/exec", google_webhook_secret: SECRET })
  try {
    const approved = await approveAs(senior, await submitApplication("Mail Down", "down@example.com", "Senior"))
    assert.equal(approved.delivery.sent, false, JSON.stringify(approved.delivery))
    assert.equal(approved.delivery.reason, "send_failed")
    assert.ok(approved.member?.member?.id, "the member still exists")
    assert.equal(approved.member.member.status, "active")
  } finally {
    await configureMail(chairman, { mail_webhook_url: null })
  }
})
