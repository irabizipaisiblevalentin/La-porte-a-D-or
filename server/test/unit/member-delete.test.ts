/**
 * Removing a member record for good.
 *
 * A withdrawn member can be erased by the Chairman (`member.delete`), together
 * with the sign-in account that approval created — while the application the
 * member came from is kept (its link is cleared) and the removal itself lands in
 * the immutable audit trail.
 *
 * Covered here: the permission is Chairman-only, an active member can never be
 * removed by accident, the account and its photograph really go, and the login
 * stops working.
 */
import { test, after } from "node:test"
import assert from "node:assert/strict"
import fs, { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-member-delete-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "member-delete-test-secret-16"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanDelete!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorDelete!2026bb"
process.env.JUNIOR_ADMIN_PASSWORD = "JuniorDelete!2026cc"

const { migrate, one } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")
const { saveUpload, absolutePathFor } = await import("../../src/services/uploads.js")

const COOKIE = config.session.cookieName
const CHAIRMAN_EMAIL = "chairman@laportedor.local"
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

async function login(email: string, password: string): Promise<string> {
  const res = await api("POST", "/api/auth/login", { body: { identifier: email, password } })
  assert.equal(res.status, 200, `login failed for ${email}: ${JSON.stringify(res.json)}`)
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(res.setCookie ?? "")
  assert.ok(match, `no ${COOKIE} cookie returned for ${email}`)
  return `${COOKIE}=${match[1]}`
}

/** Submits an application through the signed-free webhook, as Apps Script does. */
async function submitApplication(fullName: string, email: string, group: string): Promise<string> {
  const res = await api("POST", "/api/applications/webhook", {
    body: {
      externalId: `delete-${fullName}-${Date.now()}`,
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

interface ApprovedMember {
  memberId: string
  userId: string
  username: string
  password: string
  applicationId: string
}

/** Approves an application as the senior administrator and withdraws the result. */
async function createWithdrawnMember(
  cookie: string,
  fullName: string,
  email: string,
  options: { withdraw?: boolean } = {},
): Promise<ApprovedMember> {
  const applicationId = await submitApplication(fullName, email, "Senior")
  const decision = await api("POST", `/api/applications/${applicationId}/decision`, {
    cookie,
    body: { decision: "approve" },
  })
  assert.equal(decision.status, 201, `approval failed: ${JSON.stringify(decision.json)}`)
  const member = decision.json.member.member
  if (options.withdraw !== false) {
    const withdrawn = await api("PATCH", `/api/members/${member.id}`, {
      cookie,
      body: { status: "withdrawn" },
    })
    assert.equal(withdrawn.status, 200, `withdraw failed: ${JSON.stringify(withdrawn.json)}`)
  }
  return {
    memberId: member.id,
    userId: member.user_id,
    username: decision.json.credentials.username,
    password: decision.json.credentials.password,
    applicationId,
  }
}

test("setup", async () => {
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

test("a group administrator cannot remove a member record", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const member = await createWithdrawnMember(senior, "Delete Forbidden", "delete-forbidden@example.com")
  const res = await api("DELETE", `/api/members/${member.memberId}`, { cookie: senior })
  assert.equal(res.status, 403, JSON.stringify(res.json))
  assert.ok(one("SELECT id FROM members WHERE id = ?", member.memberId), "the record is untouched")
})

test("an active member is never removed by accident", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const member = await createWithdrawnMember(senior, "Delete Active", "delete-active@example.com", { withdraw: false })
  const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)

  const res = await api("DELETE", `/api/members/${member.memberId}`, { cookie: chairman })
  assert.equal(res.status, 400, JSON.stringify(res.json))
  assert.match(String(res.json?.error?.message ?? ""), /withdraw/i)
  assert.ok(one("SELECT id FROM members WHERE id = ?", member.memberId), "the active record stays")
})

test("an unknown member is not found", async () => {
  const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)
  const res = await api("DELETE", "/api/members/does-not-exist", { cookie: chairman })
  assert.equal(res.status, 404, JSON.stringify(res.json))
})

test("the Chairman removes a withdrawn record, its account, its photo and keeps the application", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const member = await createWithdrawnMember(senior, "Delete Me", "delete-me@example.com")

  // A private photograph on the record: the file must disappear from disk too.
  const uploader = one<{ id: string }>("SELECT id FROM users WHERE email_normalized = ?", SENIOR_EMAIL)!.id
  const photo = saveUpload({
    bucket: "private",
    entityType: "member_photo",
    entityId: member.memberId,
    originalName: "portrait.png",
    mimeType: "image/png",
    data: Buffer.from("not-a-real-png"),
    uploadedBy: uploader,
  })
  const photoPath = absolutePathFor(photo)
  assert.ok(fs.existsSync(photoPath), "the photograph was written to disk")

  const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)
  const res = await api("DELETE", `/api/members/${member.memberId}`, { cookie: chairman })
  assert.equal(res.status, 200, JSON.stringify(res.json))
  assert.match(String(res.json.memberNo), /^CHR-\d{4}-\d{4}$/, "the response names the record that was removed")

  assert.equal(one("SELECT id FROM members WHERE id = ?", member.memberId), undefined, "the member row is gone")
  assert.equal(one("SELECT id FROM users WHERE id = ?", member.userId), undefined, "the sign-in account is gone")
  assert.equal(one("SELECT id FROM file_uploads WHERE id = ?", photo.id), undefined, "the photograph is unregistered")
  assert.equal(fs.existsSync(photoPath), false, "the photograph is deleted from disk")

  // The application is history: kept, with its link to the deleted member cleared.
  const application = one<{ id: string; member_id: string | null }>(
    "SELECT id, member_id FROM applications WHERE id = ?",
    member.applicationId,
  )
  assert.ok(application, "the application is kept")
  assert.equal(application?.member_id, null, "the application no longer points at the deleted member")

  // The sign-in that approval created no longer works.
  const staleLogin = await api("POST", "/api/auth/login", {
    body: { identifier: member.username, password: member.password },
  })
  assert.equal(staleLogin.status, 401, JSON.stringify(staleLogin.json))

  const audited = one<{ n: number; summary: string }>(
    "SELECT COUNT(*) AS n, MAX(summary) AS summary FROM audit_logs WHERE action = 'member.delete'",
  )!
  assert.equal(audited.n, 1, "the removal is recorded once in the audit trail")
  assert.match(audited.summary, /removed from the register/i)
})

after(() => {
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})
