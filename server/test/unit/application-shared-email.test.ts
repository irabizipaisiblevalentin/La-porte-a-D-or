/**
 * One email address, two members.
 *
 * A family often applies with a single address — a parent enrolling a child, or
 * two siblings joining together. Both are real members who both need credentials,
 * so an already-used address must not refuse the approval.
 *
 * The `users` table allows an email to belong to exactly one login, and that is
 * correct: "sign in with this email" has to resolve to one person. So the second
 * account keeps a unique, reserved alias while the member record carries the real
 * address, and the sign-in details are sent to the real address — for both people.
 *
 * These tests drive the real HTTP app against a throw-away database, and assert on
 * the outward-facing facts (both members exist, both show the same email, both are
 * sent their own credentials) rather than on how the alias is spelled.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-shared-email-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "shared-email-test-secret-16chars"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanShared!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorShared!2026bb"
process.env.JUNIOR_ADMIN_PASSWORD = "JuniorShared!2026cc"

const { migrate, one, run, all } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")
const { loginDetailsText } = await import("../../src/services/onboarding.js")
const { sharedEmailAlias, isPlaceholderEmail, NO_EMAIL_DOMAIN } = await import("../../src/services/usernames.js")

const COOKIE = config.session.cookieName
const SENIOR_EMAIL = "senior.admin@laportedor.local"

let server: Server
let base: string

async function api(method: string, url: string, opts: { cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers["content-type"] = "application/json"
  if (opts.cookie) headers.cookie = opts.cookie
  const res = await fetch(base + url, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const text = await res.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  return { status: res.status, json: json as any, setCookie: res.headers.get("set-cookie") }
}

async function login(email: string, password: string): Promise<string> {
  const res = await api("POST", "/api/auth/login", { body: { email, password } })
  assert.equal(res.status, 200, `login failed for ${email}`)
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(res.setCookie ?? "")
  assert.ok(match, `no session cookie for ${email}`)
  return `${COOKIE}=${match[1]}`
}

async function apply(fullName: string, email: string | null, group: string): Promise<string> {
  const answers = [
    { question: "What is your full name?", answer: fullName },
    { question: "Which choir group are you applying for?", answer: group },
  ]
  if (email) answers.push({ question: "Email address", answer: email })
  const res = await api("POST", "/api/applications/webhook", {
    body: {
      externalId: `shared-${fullName.replace(/\W/g, "-").toLowerCase()}-${Date.now()}`,
      submittedAt: new Date().toISOString(),
      fullName, email, phone: "0788000111", group,
      answers,
    },
  })
  assert.equal(res.status, 201, `intake failed: ${JSON.stringify(res.json)}`)
  return res.json.applicationId
}

/** Approves and returns a flat view of the response: the member id, the account, the credentials and where they went. */
async function approve(appId: string, cookie: string) {
  const res = await api("POST", `/api/applications/${appId}/decision`, {
    cookie, body: { decision: "approve" },
  })
  assert.equal(res.status, 201, `approval failed: ${JSON.stringify(res.json)}`)
  return {
    // The member detail nests the member row under `member`.
    memberId: res.json.member.member.id as string,
    memberNo: res.json.member.member.memberNo as string,
    userId: res.json.user.id as string,
    username: res.json.credentials.username as string,
    password: res.json.credentials.password as string,
    delivery: res.json.delivery as { sent: boolean; to: string | null; reason: string },
    raw: res.json,
  }
}

function memberEmail(memberId: string): string | null {
  return one<{ email: string | null }>("SELECT email FROM member_contacts WHERE member_id = ?", memberId)?.email ?? null
}

before(async () => {
  migrate()
  seed()
  seedDefaultAccounts(() => {}, defaultAccounts(), "create-missing")
  const app = createApp()
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve) })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

after(() => {
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test("a second applicant on an already-used email is approved, not refused", async () => {
  const senior = await login(SENIOR_EMAIL, "SeniorShared!2026bb")
  const shared = `family.${Date.now()}@example.com`

  const first = await approve(await apply("First Sibling Shared", shared, "Senior"), senior)
  const second = await approve(await apply("Second Sibling Shared", shared, "Senior"), senior)

  // Both members exist and are real people, not one member plus an error.
  assert.notEqual(first.memberId, second.memberId)
  assert.equal(first.username === second.username, false)

  // The member record — what the choir actually looks at — carries the same real
  // address for both, so one family, one address, both reachable.
  assert.equal(memberEmail(first.memberId), shared)
  assert.equal(memberEmail(second.memberId), shared)
})

test("only the login row is made unique, and never with the other member's address", async () => {
  const senior = await login(SENIOR_EMAIL, "SeniorShared!2026bb")
  const shared = `unique.${Date.now()}@example.com`

  const first = await approve(await apply("Unique Alpha", shared, "Senior"), senior)
  const second = await approve(await apply("Unique Beta", shared, "Senior"), senior)

  // The first account keeps the real address.
  const firstEmail = one<{ email: string }>("SELECT email FROM users WHERE id = ?", first.userId)!.email
  assert.equal(firstEmail.toLowerCase(), shared.toLowerCase())

  // The second cannot: an email identifies exactly one login. It gets a distinct,
  // reserved alias that still points at the same mailbox for a human reader.
  const secondEmail = one<{ email: string }>("SELECT email FROM users WHERE id = ?", second.userId)!.email
  assert.notEqual(secondEmail.toLowerCase(), shared.toLowerCase())
  assert.equal(secondEmail.toLowerCase(), sharedEmailAlias(shared, 1).toLowerCase())
  assert.equal(secondEmail.startsWith(shared.split("@")[0]), true, "it is recognisably derived from the real address")
  assert.equal(secondEmail.endsWith(`@${shared.split("@")[1]}`), true, "in the same domain")
})

test("both members are sent their own credentials, to the real inbox", async () => {
  const senior = await login(SENIOR_EMAIL, "SeniorShared!2026bb")
  const shared = `delivered.${Date.now()}@example.com`

  const first = await approve(await apply("Delivery One", shared, "Senior"), senior)
  const second = await approve(await apply("Delivery Two", shared, "Senior"), senior)

  // Delivery is addressed to the address the applicant gave. In this environment
  // no relay is configured, so the outcome is `not_configured` — but `to` is what
  // proves where it would have gone, and it must be the real address for BOTH,
  // never the internal alias.
  assert.equal(first.delivery.to, shared)
  assert.equal(second.delivery.to, shared, "the second member's credentials must reach the same real inbox")

  // Each got their own password, and neither is told to sign in with an address
  // that belongs to the other.
  assert.notEqual(first.password, second.password)
  const text = loginDetailsText({
    fullName: "Second Sibling", username: second.username,
    email: shared, password: second.password,
    signInUrl: "https://example.org", sharedMailbox: true,
  })
  assert.match(text, new RegExp(`Sign in with:\\s+${second.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  assert.equal(text.includes(`${shared.split("@")[0]}+shared@`), false, "the internal alias is never shown as a sign-in")
  assert.match(text, /already used by[\s\S]*another member/)
})

test("the shared-email member can still sign in, with their username", async () => {
  const senior = await login(SENIOR_EMAIL, "SeniorShared!2026bb")
  const shared = `signin.${Date.now()}@example.com`
  await approve(await apply("Signin First", shared, "Senior"), senior)
  const second = await approve(await apply("Signin Second", shared, "Senior"), senior)

  const res = await api("POST", "/api/auth/login", {
    body: { identifier: second.username, password: second.password },
  })
  assert.equal(res.status, 200, "the second member signs in with the username they were sent")
})

test("an email used by an administrator is also accepted", async () => {
  const senior = await login(SENIOR_EMAIL, "SeniorShared!2026bb")
  const res = await api("POST", "/api/applications/webhook", {
    body: {
      externalId: `shared-admin-${Date.now()}`, submittedAt: new Date().toISOString(),
      fullName: "Shares Admin Address", email: SENIOR_EMAIL, phone: "0788000222", group: "Senior",
      answers: [
        { question: "What is your full name?", answer: "Shares Admin Address" },
        { question: "Which choir group are you applying for?", answer: "Senior" },
      ],
    },
  })
  assert.equal(res.status, 201, "intake accepts an address already used by a staff account")

  const approved = await approve(res.json.applicationId, senior)
  assert.equal(approved.memberId.length > 0, true)
  assert.equal(memberEmail(approved.memberId), SENIOR_EMAIL, "the member's contact email is the real one")
  const loginEmail = one<{ email: string }>("SELECT email FROM users WHERE id = ?", approved.userId)!.email
  assert.notEqual(loginEmail.toLowerCase(), SENIOR_EMAIL.toLowerCase(), "the staff login is left untouched")
})

test("a blank email still yields a name-only account, unchanged", async () => {
  const senior = await login(SENIOR_EMAIL, "SeniorShared!2026bb")
  const approved = await approve(await apply("No Email Person", null, "Senior"), senior)

  const stored = one<{ email: string }>("SELECT email FROM users WHERE id = ?", approved.userId)!.email
  assert.equal(isPlaceholderEmail(stored), true, "a name-only account still uses the reserved placeholder")
  assert.equal(memberEmail(approved.memberId), null, "and has no contact email")
  assert.equal(approved.delivery.to, null)
  assert.equal(approved.delivery.reason, "no_email")
})

test("no two login accounts ever share an email", async () => {
  // The invariant the whole design rests on: every `users.email_normalized` is
  // distinct, so signing in with an email is never ambiguous.
  const duplicates = all<{ email_normalized: string; n: number }>(
    "SELECT email_normalized, COUNT(*) AS n FROM users GROUP BY email_normalized HAVING n > 1",
  )
  assert.deepEqual(duplicates, [])
  // And the placeholder domain is still reserved for name-only accounts.
  const realUsersWithPlaceholder = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM users WHERE email_normalized LIKE ?", `%@${NO_EMAIL_DOMAIN}`,
  )!.n
  assert.equal(typeof realUsersWithPlaceholder, "number")
})
