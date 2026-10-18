/**
 * Application decision state machine (see `POST /:id/decision` in
 * `src/routes/applications.ts`).
 *
 * Regression coverage for two defects found against the live site:
 *   1. a `reject` was accepted on an already-approved application, flipping it
 *      to `rejected` while the member account it created stayed active;
 *   2. re-approving that application did not repair the status, leaving the
 *      application and its member permanently out of sync (no API could put the
 *      status back to `approved`).
 *
 * The test drives the real HTTP app against a throw-away database.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-decision-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "decision-test-secret-at-least-16-chars"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanDecision!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorDecision!2026bb"

const { migrate, one, run } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")

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
  const res = await api("POST", "/api/auth/login", { body: { email, password } })
  assert.equal(res.status, 200, `login failed for ${email}`)
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(res.setCookie ?? "")
  assert.ok(match, `no ${COOKIE} cookie returned for ${email}`)
  return `${COOKIE}=${match[1]}`
}

async function submitApplication(fullName: string, email: string, group: string): Promise<string> {
  const res = await api("POST", "/api/applications/webhook", {
    body: {
      fullName, email, phone: "0700000000", group,
      answers: [
        { question: "Full name", answer: fullName },
        { question: "Email address", answer: email },
        { question: "Which group are you applying for?", answer: group },
      ],
      submittedAt: new Date().toISOString(),
    },
  })
  assert.equal(res.status, 201, `webhook intake failed: ${JSON.stringify(res.json)}`)
  assert.equal(res.json.requestedGroupId, `grp_${group.toLowerCase()}`)
  return res.json.applicationId
}

function applicationStatus(id: string): string {
  return one<{ status: string }>("SELECT status FROM applications WHERE id = ?", id)!.status
}

function memberCountFor(email: string): number {
  return one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM members m JOIN users u ON u.id = m.user_id WHERE u.email_normalized = ?`,
    email.toLowerCase(),
  )!.n
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

test("rejecting an already-approved application is refused and changes nothing", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const email = "decision.reject@example.com"
  const appId = await submitApplication("Decision Reject", email, "Senior")

  const approve = await api("POST", `/api/applications/${appId}/decision`, {
    cookie: senior, body: { decision: "approve", note: "Looks good" },
  })
  assert.equal(approve.status, 201, `approve should create the member: ${JSON.stringify(approve.json)}`)
  assert.ok(approve.json.member?.member?.member_no, "member record expected")
  assert.ok(approve.json.invitation?.url, "invitation expected on first approval")
  assert.equal(applicationStatus(appId), "approved")
  assert.equal(memberCountFor(email), 1)

  const reject = await api("POST", `/api/applications/${appId}/decision`, {
    cookie: senior, body: { decision: "reject", note: "changed my mind" },
  })
  assert.equal(reject.status, 409, `reject-after-approve must be refused: ${JSON.stringify(reject.json)}`)

  // Nothing moved: status, note and member are exactly as after the approval.
  assert.equal(applicationStatus(appId), "approved")
  assert.equal(memberCountFor(email), 1)
  const note = one<{ decision_note: string | null }>(
    "SELECT decision_note FROM applications WHERE id = ?", appId,
  )!.decision_note
  assert.equal(note, "Looks good", "the approval note must survive the refused attempt")
})

test("re-approving repairs an application whose status drifted from its member", async () => {
  const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)
  const email = "decision.repair@example.com"
  const appId = await submitApplication("Decision Repair", email, "Junior")

  const approve = await api("POST", `/api/applications/${appId}/decision`, {
    cookie: chairman, body: { decision: "approve", note: "Approved by Chairman" },
  })
  assert.equal(approve.status, 201)
  assert.equal(applicationStatus(appId), "approved")
  const existingMemberNo = approve.json.member?.member?.member_no as string
  assert.ok(existingMemberNo, "member number expected from the first approval")

  // Simulate the state the pre-fix release could leave behind: a rejected
  // application that still owns an active member.
  run("UPDATE applications SET status = 'rejected', decision_note = 'late attempt' WHERE id = ?", appId)
  assert.equal(applicationStatus(appId), "rejected")

  const reapprove = await api("POST", `/api/applications/${appId}/decision`, {
    cookie: chairman, body: { decision: "approve", note: "Re-confirmed" },
  })
  assert.equal(reapprove.status, 200, JSON.stringify(reapprove.json))
  assert.equal(reapprove.json.duplicate, true, "must not mint a second member")
  assert.equal(applicationStatus(appId), "approved", "status must be repaired to approved")
  assert.equal(memberCountFor(email), 1, "still exactly one member")
  assert.equal(reapprove.json.member?.member?.member_no, existingMemberNo, "the same member is returned")
  assert.equal(reapprove.json.user?.email, email)

  // The repair is recorded, not silent.
  const reviews = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM application_reviews WHERE application_id = ? AND action = 'approve'",
    appId,
  )!.n
  assert.equal(reviews, 2, "both approvals (original + repair) are in the review trail")
})

test("rejecting a pending application still works", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const email = "decision.pending@example.com"
  const appId = await submitApplication("Decision Pending", email, "Senior")

  const reject = await api("POST", `/api/applications/${appId}/decision`, {
    cookie: senior, body: { decision: "reject", note: "Not eligible" },
  })
  assert.equal(reject.status, 200, JSON.stringify(reject.json))
  assert.equal(applicationStatus(appId), "rejected")
  assert.equal(memberCountFor(email), 0, "rejecting must never create a member")
})
