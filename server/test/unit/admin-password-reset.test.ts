/**
 * The one-time administrator password reset.
 *
 * This is a deliberately sharp tool: it sets the password for every account that
 * runs the choir, without a session, from a bare HTTP call. The tests are
 * accordingly about the *limits* rather than the happy path — that it does
 * nothing unless armed, that it refuses a wrong secret, that it cannot run twice,
 * and that it never writes the password anywhere it could later be read.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-admin-reset-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "admin-reset-test-secret-16"
process.env.NODE_ENV = "production"
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.ADMIN_PASSWORD_RESET_TOKEN = "test-reset-token-abc123"
process.env.ADMIN_PASSWORD_RESET_PASSWORD = "Jeanluc22!"

const { migrate, one, run, all } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { hashPassword, verifyPassword } = await import("../../src/lib/security.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")
const { RESET_SPENT_KEY, resetIsArmed, resetAdministratorPasswords } = await import(
  "../../src/services/admin-password-reset.js"
)

const COOKIE = config.session.cookieName
const ADMIN_EMAILS = [
  "chairman@laportedor.local",
  "senior.admin@laportedor.local",
  "junior.admin@laportedor.local",
  "members.admin@laportedor.local",
  "events.coordinator@laportedor.local",
]

let server: Server
let base: string

async function call(method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers["content-type"] = "application/json"
  const res = await fetch(base + url, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null, setCookie: res.headers.get("set-cookie") }
}

async function signIn(email: string, password: string) {
  const res = await call("POST", "/api/auth/login", { identifier: email, password })
  return res.status === 200 ? { ok: true, cookie: res.setCookie } : { ok: false, cookie: null }
}

before(async () => {
  migrate()
  seed()
  seedDefaultAccounts(() => {}, defaultAccounts(), "create-missing")

  // Stand in for the live service: the four older accounts already exist with
  // other passwords. This is the state the reset exists to fix.
  for (const [email, password] of [
    ["chairman@laportedor.local", "JubileeQuartz!92907b"],
    ["senior.admin@laportedor.local", "CedarCedar!7031ac"],
    ["junior.admin@laportedor.local", "LanternCrimson!6585d9"],
    ["members.admin@laportedor.local", "FalconHarbour!238ae5"],
  ] as const) {
    const row = one<{ id: string }>("SELECT id FROM users WHERE email_normalized = ?", email)
    if (row) run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password), row.id)
  }

  // A member account, which the reset must never touch.
  const group = one<{ id: string }>("SELECT id FROM groups LIMIT 1")!
  run(
    `INSERT INTO members (id, member_no, full_name, group_id, status, joined_at, created_at, updated_at)
     VALUES ('mbr_reset_test', 'CHR-2026-Z001', 'Reset Bystander', ?, 'active', '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    group.id,
  )

  const app = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

after(() => {
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test("the reset is refused while the deployment has not armed it", () => {
  // Same call, with the secret removed from the environment: the feature simply
  // does not exist on an ordinary deployment.
  const { ADMIN_PASSWORD_RESET_TOKEN: _omit, ...withoutToken } = process.env
  assert.equal(resetIsArmed(withoutToken as NodeJS.ProcessEnv), false)
  assert.throws(
    () => resetAdministratorPasswords({
      token: "test-reset-token-abc123", actorId: null, actorName: "test", env: withoutToken as NodeJS.ProcessEnv,
    }),
    /no administrator password reset enabled/i,
  )
})

test("a wrong or missing secret is refused", async () => {
  const wrong = await call("POST", "/api/admin-reset", { token: "not-the-token" })
  assert.equal(wrong.status, 403)
  const missing = await call("POST", "/api/admin-reset", {})
  assert.equal(missing.status, 400, "a body with no token is a bad request, not a 403")
})

test("the reset sets every administrator password, once", async () => {
  const before = await signIn("chairman@laportedor.local", "JubileeQuartz!92907b")
  assert.equal(before.ok, true, "the old password works before the reset")

  const done = await call("POST", "/api/admin-reset", { token: "test-reset-token-abc123" })
  assert.equal(done.status, 200, JSON.stringify(done.json))
  assert.ok(Array.isArray(done.json.changed) && done.json.changed.length >= 5)
  // The password itself must never come back over the wire.
  assert.equal(JSON.stringify(done.json).includes("Jeanluc22!"), false)

  for (const email of ADMIN_EMAILS) {
    const signedIn = await signIn(email, "Jeanluc22!")
    assert.equal(signedIn.ok, true, `${email} should sign in with the new password`)
  }

  const oldPassword = await signIn("chairman@laportedor.local", "JubileeQuartz!92907b")
  assert.equal(oldPassword.ok, false, "the superseded password must stop working")

  // Nobody is sent to choose a new password: the value came from the deployment,
  // not from the repository, so it is trusted as the operator's own choice.
  const flags = all<{ email: string; must_change_password: number }>(
    "SELECT email, must_change_password FROM users WHERE email LIKE '%@laportedor.local'",
  )
  assert.equal(flags.every((row) => row.must_change_password === 0), true)
})

test("it runs only once, even with the correct secret", async () => {
  const again = await call("POST", "/api/admin-reset", { token: "test-reset-token-abc123" })
  assert.equal(again.status, 400, JSON.stringify(again.json))
  assert.match(String(again.json?.error?.message ?? again.json?.message ?? ""), /already been used/i)

  const stored = one<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", RESET_SPENT_KEY)
  assert.ok(stored?.value, "the use is recorded in the database, so a restart cannot re-arm it")
})

test("the status is public but says nothing secret", async () => {
  const res = await call("GET", "/api/admin-reset/status")
  assert.equal(res.status, 200)
  assert.equal(res.json.armed, true)
  assert.ok(res.json.spentAt)
  assert.equal(JSON.stringify(res.json).includes("test-reset-token-abc123"), false, "the token is never echoed")
})

test("it touches only administrator accounts", async () => {
  const member = one<{ user_id: string | null }>("SELECT user_id FROM members WHERE id = 'mbr_reset_test'")
  // The member has no user account in this scenario, which is the point: nothing
  // outside the five administrator accounts was considered.
  assert.equal(member?.user_id ?? null, null)
  const changed = all<{ email: string }>(
    "SELECT email FROM users WHERE email LIKE '%@laportedor.local' ORDER BY email",
  ).map((row) => row.email)
  assert.deepEqual([...ADMIN_EMAILS].sort(), changed.sort())
})

test("a member given an administrator role by hand is reported, never overwritten", async () => {
  // Someone granted a role outside the five configured accounts: the reset must
  // leave their password alone, because it may be the only way they can sign in.
  const group = one<{ id: string }>("SELECT id FROM groups LIMIT 1")!
  const bystanderEmail = "helper@laportedor.local"
  const bystanderPassword = "BystanderOnly!7712"
  const adminRole = one<{ id: string }>("SELECT id FROM roles WHERE key = 'junior_admin'")!
  run(
    `INSERT INTO members (id, member_no, full_name, group_id, status, joined_at, created_at, updated_at)
     VALUES ('mbr_role_bystander', 'CHR-2026-Z002', 'Role Bystander', ?, 'active', '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    group.id,
  )
  run(
    `INSERT INTO users (id, email, email_normalized, password_hash, display_name, status,
                        must_change_password, failed_login_count, created_at, updated_at)
     VALUES ('usr_role_bystander', ?, ?, ?, 'Role Bystander', 'active', 0, 0, ?, ?)`,
    bystanderEmail, bystanderEmail, hashPassword(bystanderPassword), "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  )
  run(
    "INSERT INTO user_roles (user_id, role_id, granted_at) VALUES ('usr_role_bystander', ?, ?)",
    adminRole.id, "2026-01-01T00:00:00.000Z",
  )

  // Re-arm the spent flag for this one check, then run the reset again directly.
  run("DELETE FROM app_settings WHERE key = ?", RESET_SPENT_KEY)
  const outcome = resetAdministratorPasswords({
    token: "test-reset-token-abc123", actorId: null, actorName: "test",
  })
  assert.equal(
    outcome.untouched.some((entry) => entry.email === bystanderEmail), true,
    "the hand-granted role holder is reported as untouched",
  )
  const row = one<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE email_normalized = ?", bystanderEmail,
  )
  assert.equal(verifyPassword(bystanderPassword, row?.password_hash), true, "their password is unchanged")
  assert.equal(verifyPassword("Jeanluc22!", row?.password_hash), false)
})

test("the password is never written to the audit log", () => {
  const row = one<{ summary: string; change_detail: string | null }>(
    "SELECT summary, change_detail FROM audit_logs WHERE action = 'auth.admin_password_reset_all'",
  )
  assert.ok(row, "the reset is recorded")
  assert.equal(JSON.stringify(row).includes("Jeanluc22!"), false)
  assert.match(row!.summary, /5 accounts/)
})

test("the stored hash really is the new password", () => {
  for (const email of ADMIN_EMAILS) {
    const row = one<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email_normalized = ?", email,
    )
    assert.equal(verifyPassword("Jeanluc22!", row?.password_hash), true, `${email} hash should verify`)
    assert.equal(verifyPassword("JubileeQuartz!92907b", row?.password_hash), false)
  }
  assert.ok(COOKIE, "the session cookie name is available to the other tests")
})
