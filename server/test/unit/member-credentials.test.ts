/**
 * Sign-in credentials for approved applications.
 *
 * Two behaviours are covered against the real HTTP app and a throw-away
 * database:
 *
 *  1. the password generated at approval is readable on the member record by
 *     the administrators who may edit that member — and by nobody else;
 *  2. the same message is emailed to the member as soon as an SMTP relay is
 *     configured, and is never sent to a reserved placeholder address.
 *
 * The SMTP relay is a bare `net` server that speaks just enough of the protocol
 * (220 / EHLO / MAIL / RCPT / DATA / QUIT) to accept a message, so delivery is
 * proven without reaching the network.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import net from "node:net"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-credentials-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "member-credentials-test-secret-16"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanCredentials!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorCredentials!2026bb"
process.env.JUNIOR_ADMIN_PASSWORD = "JuniorCredentials!2026cc"

const { migrate, one } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")
const { decryptSecret } = await import("../../src/lib/secrets-box.js")

const COOKIE = config.session.cookieName
const CHAIRMAN_EMAIL = "chairman@laportedor.local"
const SENIOR_EMAIL = "senior.admin@laportedor.local"
const JUNIOR_EMAIL = "junior.admin@laportedor.local"

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

/** Submits through the signed-free webhook path, exactly as the Apps Script would. */
async function submitApplication(fullName: string, email: string | null, group: string): Promise<string> {
  const res = await api("POST", "/api/applications/webhook", {
    body: {
      externalId: `credentials-${fullName}-${Date.now()}`,
      submittedAt: new Date().toISOString(),
      fullName,
      email,
      phone: "0788000000",
      group,
      answers: [
        { question: "Full name", answer: fullName },
        { question: "Which choir group are you applying for?", answer: group },
      ],
    },
  })
  assert.equal(res.status, 201, `webhook intake failed: ${JSON.stringify(res.json)}`)
  return res.json.applicationId
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
// A minimal SMTP server: enough to accept one message and keep its bytes.
// ---------------------------------------------------------------------------

interface MockRelay {
  port: number
  received: string[]
  close: () => Promise<void>
}

async function startMockRelay(): Promise<MockRelay> {
  const received: string[] = []
  const relay = net.createServer((socket) => {
    let buffer = ""
    let inData = false
    let message = ""
    socket.write("220 mock ESMTP\r\n")
    socket.on("error", () => {})
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      let index = buffer.indexOf("\r\n")
      while (index !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (inData) {
          if (line === ".") {
            inData = false
            received.push(message)
            message = ""
            socket.write("250 Message accepted\r\n")
          } else {
            message += `${line}\n`
          }
        } else {
          const command = line.split(" ")[0].toUpperCase()
          if (command === "EHLO" || command === "HELO") socket.write("250-mock greeting\r\n250 SIZE 10485760\r\n")
          else if (command === "DATA") { inData = true; socket.write("354 End data with <CR><LF>.<CR><LF>\r\n") }
          else if (command === "QUIT") { socket.write("221 Bye\r\n"); socket.end() }
          else socket.write("250 OK\r\n")
        }
        index = buffer.indexOf("\r\n")
      }
    })
  })
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve))
  const address = relay.address() as net.AddressInfo
  return {
    port: address.port,
    received,
    close: () => new Promise<void>((resolve) => relay.close(() => resolve())),
  }
}

/** Undoes the quoted-printable encoding nodemailer uses for plain text bodies. */
function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

before(async () => {
  migrate()
  seed()
  seedDefaultAccounts(() => {}, defaultAccounts(), "create-missing")

  const app = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === "object", "server should be listening on a port")
  base = `http://127.0.0.1:${address.port}`
})

after(() => {
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test("the approving group administrator can read the generated password back", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const applicationId = await submitApplication("Credentials Visible", "visible@example.com", "Senior")
  const approved = await approveAs(senior, applicationId)

  assert.ok(approved.credentials?.password, "approval returns the generated password")
  assert.equal(approved.delivery.sent, false, "no SMTP relay is configured yet")
  assert.equal(approved.delivery.reason, "not_configured")

  // The reversible copy on the account is exactly what the API hands back, and
  // it sits beside the scrypt hash that login actually verifies.
  const account = one<{ id: string; password_enc: string | null }>(
    "SELECT id, password_enc FROM users WHERE email_normalized = ?",
    "visible@example.com",
  )
  assert.ok(account, "the applicant's account exists")
  assert.equal(
    decryptSecret(account.password_enc),
    approved.credentials.password,
    "the stored copy is the generated password",
  )

  const memberId = approved.member.member.id
  assert.equal(approved.credentials.username, approved.member.member.username)

  const asSenior = await api("GET", `/api/members/${memberId}`, { cookie: senior })
  assert.equal(asSenior.status, 200, JSON.stringify(asSenior.json))
  assert.equal(asSenior.json.member.member.sign_in_password, approved.credentials.password)
  assert.equal(asSenior.json.member.member.username, approved.credentials.username)

  const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)
  const asChairman = await api("GET", `/api/members/${memberId}`, { cookie: chairman })
  assert.equal(asChairman.status, 200)
  assert.equal(asChairman.json.member.member.sign_in_password, approved.credentials.password)

  const junior = await login(JUNIOR_EMAIL, process.env.JUNIOR_ADMIN_PASSWORD!)
  const asJunior = await api("GET", `/api/members/${memberId}`, { cookie: junior })
  assert.equal(asJunior.status, 403, "another group's administrator sees nothing")

  // The reversed copy is not the verifier: signing in with it must still work.
  const signIn = await api("POST", "/api/auth/login", {
    body: { identifier: approved.credentials.username, password: approved.credentials.password },
  })
  assert.equal(signIn.status, 200, `the stored password must sign the member in: ${JSON.stringify(signIn.json)}`)
})

test("email delivery is attempted only once a relay is configured", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const applicationId = await submitApplication("Credentials Emailed", "emailed@example.com", "Senior")
  const approved = await approveAs(senior, applicationId)
  const memberId = approved.member.member.id
  const password: string = approved.credentials.password
  assert.equal(approved.delivery.reason, "not_configured")

  const relay = await startMockRelay()
  try {
    const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)
    const configured = await api("PATCH", "/api/settings/integrations", {
      cookie: chairman,
      body: {
        values: {
          smtp_host: "127.0.0.1",
          smtp_port: String(relay.port),
          smtp_from: "choir@example.test",
        },
      },
    })
    assert.equal(configured.status, 200, JSON.stringify(configured.json))

    const sent = await api("POST", `/api/members/${memberId}/send-credentials`, { cookie: senior })
    assert.equal(sent.status, 200, JSON.stringify(sent.json))
    assert.equal(sent.json.delivery.sent, true, `delivery failed: ${JSON.stringify(sent.json.delivery)}`)
    assert.equal(sent.json.delivery.to, "emailed@example.com")

    assert.equal(relay.received.length, 1, "exactly one message reached the relay")
    const body = decodeQuotedPrintable(relay.received[0])
    assert.ok(body.includes(password), "the message carries the member's password")
    assert.ok(body.includes("emailed@example.com"), "the message is addressed to the member")

    const audited = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'member.credentials_sent'",
    )!.n
    assert.equal(audited, 1, "sending the details is recorded in the audit trail")
  } finally {
    await relay.close()
  }
})

test("an applicant with no email is still approved, and nothing is sent", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const applicationId = await submitApplication("Credentials No Email", null, "Senior")
  const approved = await approveAs(senior, applicationId)

  assert.equal(approved.delivery.sent, false)
  assert.equal(approved.delivery.reason, "no_email", JSON.stringify(approved.delivery))
  assert.ok(approved.credentials.password, "a password is generated even with no address")

  // The placeholder the account is keyed on is reserved, never routable — and
  // never shown as the member's contact address.
  assert.equal(approved.member.member.email, null, "the reserved address is hidden from the member record")
  const account = one<{ email: string }>("SELECT email FROM users WHERE id = ?", approved.member.member.user_id)
  assert.match(String(account?.email), /@no-email\.invalid$/)

  const sent = await api("POST", `/api/members/${approved.member.member.id}/send-credentials`, { cookie: senior })
  assert.equal(sent.status, 200, JSON.stringify(sent.json))
  assert.equal(sent.json.delivery.sent, false)
  assert.equal(sent.json.delivery.reason, "no_email")
})
