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
process.env.JUNIOR_ADMIN_PASSWORD = "JuniorDecision!2026cc"

const { migrate, one, run } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")

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

test("webhook accepts a form submission whose optional email is null", async () => {
  // Regression: the Google Form script sends an explicit `null` (not a missing
  // key) for every contact field the applicant left blank, plus array answers
  // for checkbox/file-upload questions. The webhook schema rejected the null
  // with 400 before the handler ran, silently dropping real applications.
  const res = await api("POST", "/api/applications/webhook", {
    body: {
      externalId: `regression-null-contact-${Date.now()}`,
      submittedAt: new Date().toISOString(),
      fullName: "Regression Null Contact",
      email: null,
      phone: "0792785573",
      group: "grp_junior",
      answers: [
        { question: "Confirm", answer: ["I have read and understood the information above."] },
        { question: "Which choir group are you applying for?", answer: "Junior" },
        { question: "What is your full name?", answer: "Regression Null Contact" },
        { question: "Please upload a recent photo of yourself", answer: ["1ztcly9hYzXXz8yFf9q5Hx2_cc9wIPoa_"] },
        { question: "Email Address", answer: "" },
        { question: "Phone Number", answer: "0792785573" },
      ],
    },
  })
  assert.equal(res.status, 201, `null contact fields must not be rejected: ${JSON.stringify(res.json)}`)

  const row = one<{ email: string | null; phone: string | null; status: string }>(
    "SELECT email, phone, status FROM applications WHERE id = ?",
    res.json.applicationId as string,
  )!
  assert.equal(row.email, null, "a blank email is stored as null, not rejected")
  assert.equal(row.phone, "0792785573")
  assert.equal(row.status, "pending")
})

test("approving an application without an email creates a name-based account", async () => {
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const submitted = await api("POST", "/api/applications/webhook", {
    body: {
      externalId: `regression-no-email-${Date.now()}`,
      submittedAt: new Date().toISOString(),
      fullName: "No Email Applicant",
      email: null,
      phone: "0792785574",
      group: "grp_senior",
      answers: [{ question: "What is your full name?", answer: "No Email Applicant" }],
    },
  })
  assert.equal(submitted.status, 201)
  const appId = submitted.json.applicationId as string

  const approve = await api("POST", `/api/applications/${appId}/decision`, {
    cookie: senior, body: { decision: "approve" },
  })
  assert.equal(approve.status, 201, `a blank email must still be approvable: ${JSON.stringify(approve.json)}`)
  assert.ok(approve.json.member?.member?.member_no, "a member record is created")
  assert.ok(approve.json.invitation?.url, "an invitation is created")
  assert.equal(approve.json.invitation.username, "No Email Applicant", "the sign-in name comes from the full name")

  // The stored email is a reserved placeholder, never a real address.
  const account = one<{ email: string; username: string; username_normalized: string; status: string }>(
    "SELECT email, username, username_normalized, status FROM users WHERE username_normalized = ?",
    "no-email-applicant",
  )!
  assert.ok(account, "the account exists")
  assert.match(account.email, /@no-email\.invalid$/)
  assert.equal(account.status, "invited")

  // Accept the invitation, then sign in with the name (any case / spacing).
  const invitationToken = String(approve.json.invitation.url).replace(/^\/invite\//, "")
  const activate = await api("POST", `/api/auth/invitation/${invitationToken}`, { body: { password: "NameLogin!2026dd" } })
  assert.equal(activate.status, 200, JSON.stringify(activate.json))

  const byExactName = await api("POST", "/api/auth/login", {
    body: { identifier: "No Email Applicant", password: "NameLogin!2026dd" },
  })
  assert.equal(byExactName.status, 200, `signing in by name must work: ${JSON.stringify(byExactName.json)}`)
  assert.equal(byExactName.json.user.displayName, "No Email Applicant")

  // The lookup is forgiving about case and spacing.
  const byLooseName = await api("POST", "/api/auth/login", {
    body: { identifier: "  no email   applicant ", password: "NameLogin!2026dd" },
  })
  assert.equal(byLooseName.status, 200, "case/spacing must not matter")
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
  const junior = await login(JUNIOR_EMAIL, process.env.JUNIOR_ADMIN_PASSWORD!)
  const email = "decision.repair@example.com"
  const appId = await submitApplication("Decision Repair", email, "Junior")

  const approve = await api("POST", `/api/applications/${appId}/decision`, {
    cookie: junior, body: { decision: "approve", note: "Approved by the Junior Administrator" },
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
    cookie: junior, body: { decision: "approve", note: "Re-confirmed" },
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

test("the Chairman oversees every application but cannot approve or reject one", async () => {
  const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)
  const senior = await login(SENIOR_EMAIL, process.env.SENIOR_ADMIN_PASSWORD!)
  const appId = await submitApplication("Chairman Oversight", "oversight@example.com", "Senior")

  // The Chairman can READ any application (oversight)...
  const read = await api("GET", `/api/applications/${appId}`, { cookie: chairman })
  assert.equal(read.status, 200, "the Chairman must be able to see every application")

  // ...but only the group's own administrator may decide.
  const byChairman = await api("POST", `/api/applications/${appId}/decision`, {
    cookie: chairman, body: { decision: "approve" },
  })
  assert.equal(byChairman.status, 403, `the Chairman must not decide: ${JSON.stringify(byChairman.json)}`)
  assert.equal(applicationStatus(appId), "pending", "a refused decision changes nothing")

  const bySenior = await api("POST", `/api/applications/${appId}/decision`, {
    cookie: senior, body: { decision: "approve" },
  })
  assert.equal(bySenior.status, 201, JSON.stringify(bySenior.json))
  assert.equal(applicationStatus(appId), "approved")
})
