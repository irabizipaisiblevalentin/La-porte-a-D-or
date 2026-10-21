/**
 * A record about a member must reach that member.
 *
 * Recording attendance, a fault or a training result is only half the job: if the
 * member is never told and cannot open the page, the record is a private note that
 * changes nothing. These tests drive the real routes and then read the member's own
 * notifications and lists, so a wrong column name, a missing permission or a silent
 * `try {} catch {}` shows up as a failure instead of as an empty page nobody checks.
 *
 * The junior member is used deliberately: junior members are the ones most often
 * forgotten when a new permission is added, and they must still see their own record.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-member-notify-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "member-notify-test-secret-at-least-16"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanNotify!2026aa"
process.env.JUNIOR_ADMIN_PASSWORD = "JuniorNotify!2026bb"

const { migrate, one, run } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")
const { hashPassword } = await import("../../src/lib/security.js")
const { nowIso } = await import("../../src/lib/time.js")

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

interface Session { cookie: string }

async function login(identifier: string, password: string): Promise<Session> {
  const res = await api("POST", "/api/auth/login", { body: { identifier, password } })
  assert.equal(res.status, 200, `login failed for ${identifier}: ${JSON.stringify(res.json)}`)
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(res.setCookie ?? "")
  assert.ok(match, `no ${COOKIE} cookie returned for ${identifier}`)
  return { cookie: `${COOKIE}=${match[1]}` }
}

let chairman: Session
let juniorAdmin: Session
let junior: Session

const MEMBER_ID = "mem_notify"
const MEMBER_USER_ID = "usr_notify"

before(async () => {
  migrate()
  seed()
  seedDefaultAccounts(() => {}, defaultAccounts(), "create-missing")

  // A junior member with a real sign-in account, so notifications have somewhere to go.
  const group = one<{ id: string }>("SELECT id FROM groups WHERE key = 'junior'")
  assert.ok(group, "the junior group must exist")
  const timestamp = nowIso()
  const password = hashPassword("JuniorMember!2026cc")
  run(
    `INSERT INTO users (id, email, email_normalized, display_name, password_hash, must_change_password,
                        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)`,
    MEMBER_USER_ID, "notify@laportedor.local", "notify@laportedor.local",
    "Notify Member", password, timestamp, timestamp,
  )
  run(
    `INSERT INTO members (id, member_no, group_id, user_id, full_name, status, joined_at, created_at, updated_at)
     VALUES (?, 'CHR-NOTIFY-1', ?, ?, 'Notify Member', 'active', ?, ?, ?)`,
    MEMBER_ID, group.id, MEMBER_USER_ID, timestamp, timestamp, timestamp,
  )
  run(
    `INSERT INTO user_roles (user_id, role_id, granted_at)
     SELECT ?, id, ? FROM roles WHERE key = 'junior_singer'`,
    MEMBER_USER_ID, timestamp,
  )

  const app = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === "object")
  base = `http://127.0.0.1:${address.port}`

  chairman = await login("chairman@laportedor.local", process.env.CHAIRMAN_PASSWORD!)
  juniorAdmin = await login("junior.admin@laportedor.local", process.env.JUNIOR_ADMIN_PASSWORD!)
  junior = await login("notify@laportedor.local", "JuniorMember!2026cc")
})

after(() => {
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

/** The member's own notifications, newest first. */
async function myNotifications(): Promise<any[]> {
  const res = await api("GET", "/api/notifications?pageSize=100", { cookie: junior.cookie })
  assert.equal(res.status, 200, `notifications failed: ${JSON.stringify(res.json)}`)
  return res.json.items ?? []
}

// --- Attendance --------------------------------------------------------------

test("marking attendance tells the member, and the member can open the session", async () => {
  const group = one<{ id: string }>("SELECT id FROM groups WHERE key = 'junior'")!
  const created = await api("POST", "/api/attendance/sessions", {
    cookie: juniorAdmin.cookie,
    body: { title: "Junior rehearsal", activityType: "rehearsal", date: "2026-11-05", targetGroupId: group.id },
  })
  assert.equal(created.status, 201, `session creation failed: ${JSON.stringify(created.json)}`)
  const sessionId = created.json.session.id

  const marked = await api("PUT", `/api/attendance/sessions/${sessionId}/records`, {
    cookie: juniorAdmin.cookie,
    body: { records: [{ memberId: MEMBER_ID, status: "present" }] },
  })
  assert.equal(marked.status, 200, `marking failed: ${JSON.stringify(marked.json)}`)

  const notices = await myNotifications()
  const notice = notices.find((row) => row.type === "attendance")
  assert.ok(notice, "the member must be told about the attendance mark")
  assert.match(notice.body ?? "", /Junior rehearsal/)

  // Being told is useless if the page then refuses to load: the member must be
  // able to read the session they were just marked in.
  const sessions = await api("GET", "/api/attendance/sessions?pageSize=100", { cookie: junior.cookie })
  assert.equal(sessions.status, 200, `the member could not list sessions: ${JSON.stringify(sessions.json)}`)
  assert.ok(
    (sessions.json.items ?? []).some((row: any) => row.id === sessionId),
    "the member must see the session they were marked in",
  )
})

// --- Discipline --------------------------------------------------------------

test("recording a fault tells the member and appears on their own discipline list", async () => {
  const category = one<{ id: string; label: string }>(
    "SELECT id, label FROM discipline_categories WHERE kind = 'negative' AND active = 1 LIMIT 1",
  )
  assert.ok(category, "a negative discipline category must exist")

  const created = await api("POST", "/api/discipline", {
    cookie: juniorAdmin.cookie,
    body: {
      memberId: MEMBER_ID,
      date: "2026-11-06",
      categoryId: category.id,
      description: "Missed two rehearsals without notice.",
      actionTaken: "Written warning.",
      status: "open",
    },
  })
  assert.equal(created.status, 201, `discipline creation failed: ${JSON.stringify(created.json)}`)

  const notices = await myNotifications()
  const notice = notices.find((row) => row.type === "discipline")
  assert.ok(notice, "the member must be told about the fault")
  // The punishment is the useful part; a notice that only says "a fault was
  // recorded" sends the member to the page still not knowing what happened.
  assert.match(notice.body ?? "", /Written warning/)

  // The member's dashboard reads this list, so it must be the member's own records.
  const own = await api("GET", "/api/discipline?pageSize=100", { cookie: junior.cookie })
  assert.equal(own.status, 200, `the member could not read their discipline: ${JSON.stringify(own.json)}`)
  assert.ok(
    (own.json.items ?? []).some((row: any) => row.memberId === MEMBER_ID),
    "the fault must appear on the member's own discipline page",
  )
})

test("a junior member holds discipline.read at own scope", () => {
  const grant = one<{ scope: string }>(
    `SELECT rp.scope FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.key = 'junior_singer' AND p.key = 'discipline.read'`,
  )
  assert.ok(grant, "junior_singer must be granted discipline.read")
  assert.equal(grant.scope, "own", "and only for their own record")
})

// --- Training ----------------------------------------------------------------

test("recording a training result tells the member", async () => {
  const group = one<{ id: string }>("SELECT id FROM groups WHERE key = 'junior'")!
  const created = await api("POST", "/api/training", {
    cookie: juniorAdmin.cookie,
    body: { title: "Vocal technique", date: "2026-11-07", groupId: group.id },
  })
  assert.equal(created.status, 201, `training creation failed: ${JSON.stringify(created.json)}`)
  const trainingId = created.json.training.id

  const saved = await api("PUT", `/api/training/${trainingId}/participants`, {
    cookie: juniorAdmin.cookie,
    body: { participants: [{ memberId: MEMBER_ID, attendance: "present", completed: true }] },
  })
  assert.equal(saved.status, 200, `participant save failed: ${JSON.stringify(saved.json)}`)

  const notices = await myNotifications()
  assert.ok(
    notices.some((row) => row.type === "training" && /Vocal technique/.test(row.body ?? "")),
    "the member must be told about the training result",
  )
})

test("a participant left pending with no completion is not disturbed", async () => {
  const group = one<{ id: string }>("SELECT id FROM groups WHERE key = 'junior'")!
  const created = await api("POST", "/api/training", {
    cookie: juniorAdmin.cookie,
    body: { title: "Quiet session", date: "2026-11-08", groupId: group.id },
  })
  const trainingId = created.json.training.id

  const before = (await myNotifications()).length
  const saved = await api("PUT", `/api/training/${trainingId}/participants`, {
    cookie: juniorAdmin.cookie,
    body: { participants: [{ memberId: MEMBER_ID, attendance: "pending", completed: false }] },
  })
  assert.equal(saved.status, 200)

  const after = (await myNotifications()).length
  assert.equal(after, before, "a 'nothing happened' message would only teach the member to ignore notices")
})

// --- Event roll-call ---------------------------------------------------------

test("an event roll-call tells the member", async () => {
  const created = await api("POST", "/api/events", {
    cookie: chairman.cookie,
    body: {
      name: "Junior concert",
      eventType: "concert",
      date: "2026-11-20",
      audienceGroupIds: ["grp_junior"],
    },
  })
  assert.equal(created.status, 201, `event creation failed: ${JSON.stringify(created.json)}`)
  const eventId = created.json.event.id

  const rolled = await api("PUT", `/api/events/${eventId}/roll-call`, {
    cookie: chairman.cookie,
    body: { records: [{ memberId: MEMBER_ID, status: "present" }] },
  })
  assert.equal(rolled.status, 200, `roll-call failed: ${JSON.stringify(rolled.json)}`)

  const notices = await myNotifications()
  assert.ok(
    notices.some((row) => /Junior concert/.test(row.body ?? "")),
    "the member must be told about the event roll-call",
  )
})

// --- A session created for a specific event ----------------------------------

test("a session can be created in one step for a date, an event and a group", async () => {
  const group = one<{ id: string }>("SELECT id FROM groups WHERE key = 'junior'")!
  const event = await api("POST", "/api/events", {
    cookie: chairman.cookie,
    body: {
      name: "Junior party",
      eventType: "community",
      date: "2026-12-01",
      audienceGroupIds: ["grp_junior"],
    },
  })
  assert.equal(event.status, 201, `event creation failed: ${JSON.stringify(event.json)}`)
  const eventId = event.json.event.id

  const created = await api("POST", "/api/attendance/sessions", {
    cookie: juniorAdmin.cookie,
    body: {
      title: "Junior party",
      activityType: "other",
      date: "2026-12-01",
      targetGroupId: group.id,
      eventId,
    },
  })
  assert.equal(created.status, 201, `session creation failed: ${JSON.stringify(created.json)}`)
  assert.equal(created.json.session.eventId, eventId, "the session must carry the event it belongs to")

  // One roll-call per event: a second would be two answers to "who came?".
  const second = await api("POST", "/api/attendance/sessions", {
    cookie: juniorAdmin.cookie,
    body: {
      title: "Junior party again",
      activityType: "other",
      date: "2026-12-01",
      targetGroupId: group.id,
      eventId,
    },
  })
  assert.equal(second.status, 400, "an event must not get a second roll-call")
})

test("a session cannot be aimed at an event belonging to another group", async () => {
  const event = await api("POST", "/api/events", {
    cookie: chairman.cookie,
    body: {
      name: "Senior gathering",
      eventType: "meeting",
      date: "2026-12-02",
      audienceGroupIds: ["grp_senior"],
    },
  })
  const eventId = event.json.event.id
  const juniorGroup = one<{ id: string }>("SELECT id FROM groups WHERE key = 'junior'")!

  const created = await api("POST", "/api/attendance/sessions", {
    cookie: juniorAdmin.cookie,
    body: {
      title: "Mismatched",
      activityType: "meeting",
      date: "2026-12-02",
      targetGroupId: juniorGroup.id,
      eventId,
    },
  })
  assert.equal(created.status, 400, `an event for one group must not take a roll-call for another: ${JSON.stringify(created.json)}`)
})

test("a session cannot be attached to an event that does not exist", async () => {
  const group = one<{ id: string }>("SELECT id FROM groups WHERE key = 'junior'")!
  const created = await api("POST", "/api/attendance/sessions", {
    cookie: juniorAdmin.cookie,
    body: {
      title: "Ghost event",
      activityType: "rehearsal",
      date: "2026-12-03",
      targetGroupId: group.id,
      eventId: "evt_does_not_exist",
    },
  })
  assert.equal(created.status, 404, `a made-up event id must be refused, not silently stored: ${JSON.stringify(created.json)}`)
})
