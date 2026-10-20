/**
 * The events API over HTTP: who sees an event, and who may change it.
 *
 * The service tests prove the rules; these prove the *routes* apply them. That
 * distinction matters, because an audience that is only honoured by the page is
 * a display setting — anyone who guesses an event id could still read it, and a
 * group administrator could re-aim an event or confirm a payment.
 *
 * Everything here runs against the real app, real sessions and a throw-away
 * database, so an authentication or CSRF mistake shows up as a failure.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-events-api-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "events-api-test-secret-at-least-16"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanEvents!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorEvents!2026bb"
process.env.JUNIOR_ADMIN_PASSWORD = "JuniorEvents!2026cc"
process.env.EVENTS_COORDINATOR_PASSWORD = "CoordinatorEvents!2026dd"

const { migrate, one, run } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")

const COOKIE = config.session.cookieName

let server: Server
let base: string

interface ApiResponse {
  status: number
  json: any
  setCookie: string | null
}

async function api(
  method: string,
  url: string,
  opts: { cookie?: string; body?: unknown } = {},
): Promise<ApiResponse> {
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

/**
 * Signs in. Mutations need no CSRF token: the session cookie is `sameSite: lax`
 * (see `src/auth/session.ts`), which is what stops a cross-site form from
 * riding on an administrator's session.
 */
async function login(email: string, password: string): Promise<Session> {
  const res = await api("POST", "/api/auth/login", { body: { identifier: email, password } })
  assert.equal(res.status, 200, `login failed for ${email}: ${JSON.stringify(res.json)}`)
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(res.setCookie ?? "")
  assert.ok(match, `no ${COOKIE} cookie returned for ${email}`)
  return { cookie: `${COOKIE}=${match[1]}` }
}

/** Creates an event through the API, as the owner of the events programme. */
async function createEvent(session: Session, body: Record<string, unknown>): Promise<string> {
  const res = await api("POST", "/api/events", { cookie: session.cookie, body })
  assert.equal(res.status, 201, `event creation failed: ${JSON.stringify(res.json)}`)
  return res.json.event.id
}

let chairman: Session
let coordinator: Session
let seniorAdmin: Session
let juniorAdmin: Session

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

  chairman = await login("chairman@laportedor.local", process.env.CHAIRMAN_PASSWORD!)
  coordinator = await login("events.coordinator@laportedor.local", process.env.EVENTS_COORDINATOR_PASSWORD!)
  seniorAdmin = await login("senior.admin@laportedor.local", process.env.SENIOR_ADMIN_PASSWORD!)
  juniorAdmin = await login("junior.admin@laportedor.local", process.env.JUNIOR_ADMIN_PASSWORD!)
})

after(() => {
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

// --- Who may read an event ---------------------------------------------------

test("a senior-only event is invisible to the junior group, even by id", async () => {
  const eventId = await createEvent(coordinator, {
    name: "Senior retreat",
    eventType: "retreat",
    date: "2026-12-05",
    audienceGroupIds: ["grp_senior"],
  })

  const seniorView = await api("GET", `/api/events/${eventId}`, { cookie: seniorAdmin.cookie })
  assert.equal(seniorView.status, 200, "the addressed group must be able to open it")

  // The route must not merely hide it from the list: guessing the id must fail too.
  const juniorView = await api("GET", `/api/events/${eventId}`, { cookie: juniorAdmin.cookie })
  assert.equal(juniorView.status, 404, "a group must not read an event it is not addressed to")
})

test("a junior-only event does not appear in the senior group's list", async () => {
  await createEvent(coordinator, {
    name: "Junior rehearsal",
    eventType: "rehearsal",
    date: "2026-12-06",
    audienceGroupIds: ["grp_junior"],
  })

  const seniorList = await api("GET", "/api/events?limit=100", { cookie: seniorAdmin.cookie })
  assert.equal(seniorList.status, 200)
  const names = (seniorList.json.items ?? []).map((item: any) => item.name)
  assert.equal(names.includes("Junior rehearsal"), false, "the senior list must not carry a junior-only event")
  assert.equal(names.includes("Senior retreat"), true, "the senior list must carry its own event")
})

test("an event for the whole choir is seen by every group", async () => {
  const eventId = await createEvent(coordinator, {
    name: "Choir anniversary",
    eventType: "community",
    date: "2026-12-07",
    audienceGroupIds: [],
  })

  for (const session of [seniorAdmin, juniorAdmin]) {
    const res = await api("GET", `/api/events/${eventId}`, { cookie: session.cookie })
    assert.equal(res.status, 200, "an event with no audience is for everyone")
  }
})

// --- Who may change the audience and the money --------------------------------

test("a group administrator cannot set who an event is for or what it costs", async () => {
  const res = await api("POST", "/api/events", {
    cookie: seniorAdmin.cookie,
    body: {
      name: "Sneaky re-aim",
      eventType: "concert",
      date: "2026-12-08",
      audienceGroupIds: ["grp_members"],
    },
  })
  assert.equal(res.status, 403, "only the coordinator decides an event's audience")
})

test("a group administrator may still create a plain event", async () => {
  const res = await api("POST", "/api/events", {
    cookie: seniorAdmin.cookie,
    body: { name: "Senior sectional", eventType: "rehearsal", date: "2026-12-09" },
  })
  assert.equal(res.status, 201, `a group administrator still runs their own events: ${JSON.stringify(res.json)}`)
})

test("only the coordinator may confirm a contribution", async () => {
  const eventId = await createEvent(coordinator, {
    name: "Gala concert",
    eventType: "concert",
    date: "2026-12-10",
    audienceGroupIds: ["grp_senior", "grp_junior", "grp_members"],
    requiresContribution: true,
    contributionAmount: 5000,
  })

  const asGroup = await api("GET", `/api/events/${eventId}/contributions`, { cookie: seniorAdmin.cookie })
  assert.equal(asGroup.status, 403, "a group administrator cannot read the paid list")

  const asCoordinator = await api("GET", `/api/events/${eventId}/contributions`, { cookie: coordinator.cookie })
  assert.equal(asCoordinator.status, 200)
  assert.equal(asCoordinator.json.contribution.required, true)
  assert.equal(asCoordinator.json.contribution.amount, 5000)
})

test("the chairman keeps full access to the events programme", async () => {
  const eventId = await createEvent(coordinator, { name: "Chairman check", eventType: "meeting", date: "2026-12-11" })
  const res = await api("GET", `/api/events/${eventId}/contributions`, { cookie: chairman.cookie })
  assert.equal(res.status, 200, "the Chairman oversees every group's events")
})

// --- The paid path, end to end ------------------------------------------------

test("confirming a payment issues a pass that admits its holder once, and only once", async () => {
  const memberId = "mbr_pass_test"
  run(
    `INSERT INTO members (id, member_no, full_name, group_id, status, joined_at, created_at, updated_at)
     VALUES (?, 'CHR-2026-9001', 'Pass Holder', 'grp_senior', 'active', '2026-01-01',
             '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    memberId,
  )

  const eventId = await createEvent(coordinator, {
    name: "Ticketed concert",
    eventType: "concert",
    date: "2026-12-12",
    audienceGroupIds: ["grp_senior"],
    requiresContribution: true,
    contributionAmount: 7500,
  })
  run(
    "INSERT INTO event_participants (event_id, member_id, role, added_at) VALUES (?, ?, NULL, ?)",
    eventId, memberId, "2026-01-01T00:00:00.000Z",
  )

  const synced = await api("POST", `/api/events/${eventId}/contributions/sync`, {
    cookie: coordinator.cookie,
  })
  assert.equal(synced.status, 200, JSON.stringify(synced.json))
  assert.equal(synced.json.added, 1)
  assert.equal(synced.json.contributions.length, 1)
  assert.equal(synced.json.contributions[0].status, "due")

  const confirmed = await api("POST", `/api/events/${eventId}/contributions/confirm`, {
    cookie: coordinator.cookie,
    body: { memberId },
  })
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json))
  assert.equal(confirmed.json.contributions[0].status, "paid")
  assert.ok(confirmed.json.pass?.token, "confirming a payment must issue the pass")
  const token = confirmed.json.pass.token as string

  // The scanned QR opens a public preview that names the holder and admits nobody.
  const preview = await api("GET", `/api/public/pass/${encodeURIComponent(token)}`)
  assert.equal(preview.status, 200)
  assert.equal(preview.json.holder.name, "Pass Holder")
  assert.equal(preview.json.alreadyIn, false)

  const first = await api("POST", `/api/events/${eventId}/checkin`, {
    cookie: coordinator.cookie, body: { credential: token },
  })
  assert.equal(first.status, 200, JSON.stringify(first.json))
  assert.equal(first.json.outcome, "admitted")

  const second = await api("POST", `/api/events/${eventId}/checkin`, {
    cookie: coordinator.cookie, body: { credential: token },
  })
  assert.equal(second.json.outcome, "repeat", "a reused QR must be reported, not silently accepted")
})

test("a group administrator cannot work the door", async () => {
  const eventId = await createEvent(coordinator, { name: "Guarded door", eventType: "concert", date: "2026-12-13" })
  const res = await api("POST", `/api/events/${eventId}/checkin`, {
    cookie: seniorAdmin.cookie, body: { credential: "ABCD-EFGH-JKLM" },
  })
  assert.equal(res.status, 403, "checking people in is the coordinator's job")
})

test("an unknown pass token previews as invalid", async () => {
  const res = await api("GET", "/api/public/pass/definitely-not-a-pass")
  assert.equal(res.status, 404)
  assert.equal(res.json.valid, false)
})

// --- The public calendar --------------------------------------------------------

test("the public calendar lists only events the coordinator published", async () => {
  const eventId = await createEvent(coordinator, {
    name: "Open air concert",
    eventType: "concert",
    date: "2026-12-14",
    isPublic: true,
    audiencePublic: true,
    location: "Kigali",
    requiresContribution: true,
    contributionAmount: 2000,
  })
  const hidden = await createEvent(coordinator, {
    name: "Internal planning",
    eventType: "meeting",
    date: "2026-12-15",
    isPublic: false,
  })

  const res = await api("GET", "/api/public/events")
  assert.equal(res.status, 200, JSON.stringify(res.json))
  const names = (res.json.events ?? []).map((event: any) => event.name)
  assert.equal(names.includes("Open air concert"), true)
  assert.equal(names.includes("Internal planning"), false, "an unpublished event must stay internal")

  const open = (res.json.events ?? []).find((event: any) => event.id === eventId)
  assert.equal(open.location, "Kigali")
  assert.deepEqual(open.contribution, { amount: 2000, note: null })

  // No participant, payment or pass detail belongs on a public page.
  const serialised = JSON.stringify(res.json)
  for (const leak of ["Pass Holder", "memberId", "token", "passcode", "contributions"]) {
    assert.equal(serialised.includes(leak), false, `the public calendar must not expose ${leak}`)
  }
  assert.ok(hidden)
})

// --- A member's own answer -----------------------------------------------------

test("a member may answer for themselves, and nobody else", async () => {
  const eventId = await createEvent(coordinator, { name: "RSVP event", eventType: "rehearsal", date: "2026-12-16" })

  // An administrator is not a member, so they have no standing to reply.
  const asAdmin = await api("PUT", `/api/events/${eventId}/rsvp`, {
    cookie: seniorAdmin.cookie, body: { rsvp: "yes" },
  })
  assert.equal(asAdmin.status, 403, "only members reply to an event")
})
