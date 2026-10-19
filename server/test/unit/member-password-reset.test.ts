/**
 * Group administrators resetting a member's sign-in password.
 *
 * Changing a password used to be the Chairman's alone (`users.manage`), so a
 * member who forgot theirs waited on one person. A group administrator now gets
 * `member.reset_password`, scoped like the rest of their member work: their own
 * group only, never another's, and never for a member who has no account.
 *
 * The interesting parts are what a reset must break as well as what it grants:
 * the old password stops working, the member's live sessions are closed (a reset
 * is often the answer to "someone else is using my account"), outstanding reset
 * links are voided, and the new password never reaches the audit trail.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-member-reset-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "member-reset-test-secret-16"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanReset!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorReset!2026bb"
process.env.JUNIOR_ADMIN_PASSWORD = "JuniorReset!2026cc"

const { migrate, one } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")
const { rememberedPassword } = await import("../../src/services/credentials.js")

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

async function login(identifier: string, password: string): Promise<string> {
  const res = await api("POST", "/api/auth/login", { body: { identifier, password } })
  assert.equal(res.status, 200, `login failed for ${identifier}: ${JSON.stringify(res.json)}`)
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(res.setCookie ?? "")
  assert.ok(match, `no cookie returned for ${identifier}`)
  return `${COOKIE}=${match[1]}`
}

async function submitApplication(fullName: string, email: string, group: string): Promise<string> {
  const res = await api("POST", "/api/applications/webhook", {
    body: {
      externalId: `reset-${fullName}-${Date.now()}`,
      submittedAt: new Date().toISOString(),
      fullName, email, phone: "0788000000", group,
      answers: [
        { question: "Full name", answer: fullName },
        { question: "Which choir group do you want to join?", answer: group },
      ],
    },
  })
  assert.equal(res.status, 201, `webhook intake failed: ${JSON.stringify(res.json)}`)
  return res.json.applicationId
}

interface TestMember {
  memberId: string
  userId: string
  username: string
  password: string
  email: string
}

/** Approves one application into `group` and returns the member it created. */
async function memberFor(approver: string, group: "Senior" | "Junior", name: string): Promise<TestMember> {
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`
  const applicationId = await submitApplication(name, email, group)
  const approved = await api("POST", `/api/applications/${applicationId}/decision`, {
    cookie: approver, body: { decision: "approve" },
  })
  assert.equal(approved.status, 201, `approval failed: ${JSON.stringify(approved.json)}`)
  return {
    memberId: approved.json.member.member.id,
    userId: approved.json.user.id,
    username: approved.json.credentials.username,
    password: approved.json.credentials.password,
    email,
  }
}

function unusedResetLinks(userId: string): number {
  return one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND used_at IS NULL", userId,
  )!.n
}

before(async () => {
  migrate()
  seed()
  seedDefaultAccounts(() => {}, defaultAccounts(), "create-missing")
  const app = createApp()
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve) })
  base = `http://127.0.0.1:${(server.address() as any).port}`
})

after(() => {
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test("a group administrator resets a password for their own group's member", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const member = await memberFor(senior, "Senior", "Reset Own Member")

  // The member is signed in, and has a reset link pending: both belong to the
  // old password and must not outlive the reset.
  const memberCookie = await login(member.username, member.password)
  const requested = await api("POST", "/api/auth/password/request", { body: { email: member.email } })
  assert.equal(requested.status, 200, JSON.stringify(requested.json))
  assert.equal(unusedResetLinks(member.userId), 1, "a reset link was pending before the reset")

  const res = await api("POST", `/api/members/${member.memberId}/reset-password`, { cookie: senior })
  assert.equal(res.status, 200, JSON.stringify(res.json))
  const fresh: string = res.json.credentials.password
  assert.notEqual(fresh, member.password, "a different password is issued")
  assert.equal(res.json.credentials.username, member.username)
  assert.equal(res.json.delivery.sent, false, "no mail channel is configured in this test")
  assert.equal(res.json.delivery.reason, "not_configured", "the administrator gets the password in the response instead")

  // The old password is dead; the new one signs in.
  const stale = await api("POST", "/api/auth/login", { body: { identifier: member.username, password: member.password } })
  assert.equal(stale.status, 401, "the old password no longer works")
  await login(member.username, fresh)

  // Everything that belonged to the old password is gone.
  assert.equal(unusedResetLinks(member.userId), 0, "the pending reset link was voided")
  const closed = await api("GET", "/api/auth/me", { cookie: memberCookie })
  assert.equal(closed.json?.user, null, "the member's existing session was closed")

  // Stored state agrees with what the administrator was handed.
  assert.equal(rememberedPassword(member.userId), fresh, "the remembered copy matches")
  assert.equal(
    one<{ m: number }>("SELECT must_change_password AS m FROM users WHERE id = ?", member.userId)!.m, 1,
    "the member is asked to choose their own password at the next sign-in",
  )

  // Audited — but never with the password itself.
  assert.equal(
    one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'member.password_reset'")!.n, 1,
    "the reset is in the audit trail",
  )
  assert.equal(
    one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE change_detail LIKE ?", `%${fresh}%`)!.n, 0,
    "the new password is never written to the trail",
  )
})

test("a group administrator cannot reset another group's member", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const junior = await login(JUNIOR_EMAIL, process.env.JUNIOR_ADMIN_PASSWORD!)
  const member = await memberFor(senior, "Senior", "Reset Cross Group")

  const res = await api("POST", `/api/members/${member.memberId}/reset-password`, { cookie: junior })
  assert.equal(res.status, 403, JSON.stringify(res.json))
  assert.equal(rememberedPassword(member.userId), member.password, "the password is untouched")
  await login(member.username, member.password)
})

test("a member cannot reset a password through the administrator route", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const member = await memberFor(senior, "Senior", "Reset As Singer")
  const own = await login(member.username, member.password)

  // Singers change their own password through Account → Password, not here.
  const res = await api("POST", `/api/members/${member.memberId}/reset-password`, { cookie: own })
  assert.equal(res.status, 403, JSON.stringify(res.json))
  await login(member.username, member.password)
})

test("the Chairman can reset a password in any group", async () => {
  const junior = await login(JUNIOR_EMAIL, process.env.JUNIOR_ADMIN_PASSWORD!)
  const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)
  const member = await memberFor(junior, "Junior", "Reset By Chairman")

  const res = await api("POST", `/api/members/${member.memberId}/reset-password`, { cookie: chairman })
  assert.equal(res.status, 200, JSON.stringify(res.json))
  await login(member.username, res.json.credentials.password)
})

test("a member record with no sign-in account is refused with a reason", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const created = await api("POST", "/api/members", {
    cookie: senior,
    body: { groupId: "grp_senior", fullName: "Reset No Account" },
  })
  assert.equal(created.status, 201, JSON.stringify(created.json))

  const res = await api("POST", `/api/members/${created.json.member.member.id}/reset-password`, { cookie: senior })
  assert.equal(res.status, 400, JSON.stringify(res.json))
  assert.match(String(res.json?.error?.message ?? ""), /no sign-in account/i)
})
