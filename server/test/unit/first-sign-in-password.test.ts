/**
 * A member's first sign-in, while the password the administrator handed them is
 * still temporary.
 *
 * Approval creates an account whose password must be changed on first use, and
 * the server closes everything except the `/api/auth` routes until it is. The
 * routes that *are* the way out have to stay open — `POST /password` above all.
 *
 * They did not. Inside a mounted router Express strips the mount point, so
 * `req.path` there is just "/password" and the exemption written as
 * "/api/auth/password" never matched: the member was refused the one call that
 * clears the flag and stayed locked out of the whole platform for good — the
 * dashboard showed "Could not load your dashboard", and "You must set a new
 * password before continuing" was the answer to every attempt to obey.
 *
 * So the point of these tests is the way back in: signing out, changing the
 * password, and everything reopening the moment the flag is cleared.
 */
import { test, after, before } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-first-sign-in-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "first-signin-test-secret-16"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanFirstSign!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorFirstSign!2026bb"

const { migrate, one } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")

const COOKIE = config.session.cookieName
const SENIOR_EMAIL = "senior.admin@laportedor.local"

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

async function login(identifier: string, password: string): Promise<string> {
  const res = await api("POST", "/api/auth/login", { body: { identifier, password } })
  assert.equal(res.status, 200, `login failed for ${identifier}: ${JSON.stringify(res.json)}`)
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(res.setCookie ?? "")
  assert.ok(match, `no cookie returned for ${identifier}`)
  return `${COOKIE}=${match[1]}`
}

/** Approves a brand-new application, returning the credentials the member receives. */
async function approvedMember(email: string, fullName = "First Signin"): Promise<{ email: string; password: string }> {
  const senior = await login("senior.admin@laportedor.local", process.env.SENIOR_ADMIN_PASSWORD!)
  const intake = await api("POST", "/api/applications/webhook", {
    body: {
      externalId: `first-signin-${email}-${Date.now()}`,
      submittedAt: new Date().toISOString(),
      fullName,
      email,
      phone: "0788000000",
      group: "Senior",
      answers: [
        { question: "Full name", answer: fullName },
        { question: "Which choir group do you want to join?", answer: "Senior" },
      ],
    },
  })
  assert.equal(intake.status, 201, `webhook intake failed: ${JSON.stringify(intake.json)}`)
  const approved = await api("POST", `/api/applications/${intake.json.applicationId}/decision`, {
    cookie: senior,
    body: { decision: "approve" },
  })
  assert.equal(approved.status, 201, `approval failed: ${JSON.stringify(approved.json)}`)
  return { email, password: approved.json.credentials.password }
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

test("a temporary password closes the platform but not the account routes", async () => {
  const member = await approvedMember("closed.platform@example.com")
  const cookie = await login(member.email, member.password)

  const me = await api("GET", "/api/auth/me", { cookie })
  assert.equal(me.status, 200, "the account itself is always readable")
  assert.equal(me.json.user.mustChangePassword, true, "the member is told a new password is required")

  const dashboard = await api("GET", "/api/dashboard", { cookie })
  assert.equal(dashboard.status, 403)
  assert.match(dashboard.json.error.message, /set a new password/i)

  const notifications = await api("GET", "/api/notifications/unread-count", { cookie })
  assert.equal(notifications.status, 403, "nothing else in the choir's data is reachable yet")
})

test("signing out still works while a temporary password is in place", async () => {
  const member = await approvedMember("sign.out@example.com")
  const cookie = await login(member.email, member.password)

  const out = await api("POST", "/api/auth/logout", { cookie })
  assert.equal(out.status, 200, "a member must always be able to leave")
  assert.equal((await api("GET", "/api/auth/me", { cookie })).json.user, null)
})

test("the password-change route stays open, and clearing the flag reopens everything", async () => {
  const member = await approvedMember("change.here@example.com")
  const cookie = await login(member.email, member.password)

  // Refused for the right reason — the gate must not answer this route.
  const wrong = await api("POST", "/api/auth/password", {
    cookie,
    body: { currentPassword: "DefinitelyNotIt1!", newPassword: "BrandNewPass1!" },
  })
  assert.equal(wrong.status, 400, JSON.stringify(wrong.json))
  assert.match(wrong.json.error.message, /current password is incorrect/i)

  const weak = await api("POST", "/api/auth/password", {
    cookie,
    body: { currentPassword: member.password, newPassword: "short" },
  })
  assert.equal(weak.status, 400, "the strength rules still apply")

  const changed = await api("POST", "/api/auth/password", {
    cookie,
    body: { currentPassword: member.password, newPassword: "BrandNewPass1!" },
  })
  assert.equal(changed.status, 200, JSON.stringify(changed.json))

  const me = await api("GET", "/api/auth/me", { cookie })
  assert.equal(me.json.user.mustChangePassword, false, "the flag is cleared")
  assert.equal((await api("GET", "/api/dashboard", { cookie })).status, 200, "the platform is open again")

  // The temporary password is spent; the member's own password signs them in.
  const old = await api("POST", "/api/auth/login", { body: { identifier: member.email, password: member.password } })
  assert.equal(old.status, 401)
  const fresh = await api("POST", "/api/auth/login", { body: { identifier: member.email, password: "BrandNewPass1!" } })
  assert.equal(fresh.status, 200, JSON.stringify(fresh.json))
})
