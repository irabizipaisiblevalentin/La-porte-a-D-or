/**
 * Device notifications (Web Push).
 *
 * A notification row is only seen by someone already looking at the site, which
 * is useless for the one person who has to answer a new application. These tests
 * cover the path that puts it on their phone instead: registering a device,
 * pushing the intake notification to the right administrator, dropping a device
 * the browser has thrown away, and keeping a failed delivery visible.
 *
 * The transport is replaced with a recorder (`setPushSenderForTesting`), so the
 * tests assert exactly what would leave for the browser's push service without
 * reaching the network.
 */
import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-push-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "push-test-secret-16ch"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanPush!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorPush!2026bb"
// A fixed identity keeps the assertions about the published key deterministic.
process.env.VAPID_PUBLIC_KEY = ""
process.env.VAPID_PRIVATE_KEY = ""

const { migrate, one, run } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")
const { pushIdle, sendToUsers, setPushSenderForTesting } = await import("../../src/services/push.js")

const COOKIE = config.session.cookieName

let server: Server
let base: string

interface Delivered {
  endpoint: string
  payload: { title: string; body: string; url: string }
}

const delivered: Delivered[] = []
/** When set, every delivery attempt fails with this status code. */
let failureStatus: number | null = null

before(async () => {
  migrate()
  seed()
  seedDefaultAccounts(() => {}, defaultAccounts(), "create-missing")
  setPushSenderForTesting(async (subscription, payload) => {
    if (failureStatus !== null) {
      throw Object.assign(new Error(`push failed with ${failureStatus}`), { statusCode: failureStatus })
    }
    delivered.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) })
    return { statusCode: 201 }
  })
  const app = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  base = `http://127.0.0.1:${(server.address() as any).port}`
})

after(() => {
  setPushSenderForTesting(null)
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

beforeEach(() => {
  delivered.length = 0
  failureStatus = null
  // Devices registered by an earlier test must not be visible to this one.
  run("DELETE FROM push_subscriptions")
})

interface ApiResponse {
  status: number
  json: any
  setCookie: string | null
}

async function api(method: string, url: string, opts: { cookie?: string; body?: unknown; userAgent?: string } = {}): Promise<ApiResponse> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers["content-type"] = "application/json"
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.userAgent) headers["user-agent"] = opts.userAgent
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

function senior(): Promise<string> {
  return login("senior.admin@laportedor.local", process.env.SENIOR_ADMIN_PASSWORD!)
}

function chairman(): Promise<string> {
  return login("chairman@laportedor.local", process.env.CHAIRMAN_PASSWORD!)
}

function device(endpoint: string) {
  return {
    endpoint,
    keys: { p256dh: "BNcRexampleKeyMaterialForTheTestDeviceOnly", auth: "authSecretForTestDevice" },
  }
}

async function submitApplication(fullName: string, email: string): Promise<void> {
  const res = await api("POST", "/api/applications/webhook", {
    body: {
      externalId: `push-${email}-${Date.now()}`,
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
  assert.equal(res.status, 201, `intake failed: ${JSON.stringify(res.json)}`)
}

test("a device registers, and the browser is given the key to subscribe with", async () => {
  const cookie = await senior()

  const before = await api("GET", "/api/push/config", { cookie })
  assert.equal(before.status, 200)
  assert.ok(before.json.publicKey, "the browser cannot subscribe without the public key")
  assert.equal(before.json.deviceCount, 0, "nothing registered yet")

  const subscribe = await api("POST", "/api/push/subscribe", {
    cookie,
    body: device("https://push.example.test/phone-1"),
    userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/131",
  })
  assert.equal(subscribe.status, 200, JSON.stringify(subscribe.json))
  assert.equal(subscribe.json.deviceCount, 1)

  const after = await api("GET", "/api/push/config", { cookie })
  assert.equal(after.json.deviceCount, 1)
  assert.equal(after.json.devices[0].userAgent, "Mozilla/5.0 (Linux; Android 14) Chrome/131")
  assert.equal(
    after.json.publicKey,
    before.json.publicKey,
    "the signing key must not change between requests — a new one would silence every subscribed phone",
  )
})

test("a new application is pushed to the group's administrator", async () => {
  const cookie = await senior()
  await api("POST", "/api/push/subscribe", { cookie, body: device("https://push.example.test/phone-1") })
  delivered.length = 0

  await submitApplication("Uwase Aline", "uwase.aline@example.com")
  await pushIdle()

  assert.equal(delivered.length, 1, "exactly one notification for one administrator's one device")
  const payload = delivered[0].payload
  assert.match(payload.title, /Uwase Aline/)
  assert.match(payload.body, /Senior/)
  assert.match(payload.url, /^\/app\/applications\//, "a tap must land on the application itself")
})

test("one device belongs to one account: signing in again re-points it", async () => {
  const seniorCookie = await senior()
  const endpoint = "https://push.example.test/shared-office-pc"
  await api("POST", "/api/push/subscribe", { cookie: seniorCookie, body: device(endpoint) })

  const chairmanCookie = await chairman()
  const moved = await api("POST", "/api/push/subscribe", { cookie: chairmanCookie, body: device(endpoint) })
  assert.equal(moved.json.deviceCount, 1)

  assert.equal(
    (await api("GET", "/api/push/config", { cookie: seniorCookie })).json.deviceCount,
    0,
    "the previous account must stop being notified on that device",
  )
  assert.equal((await api("GET", "/api/push/config", { cookie: chairmanCookie })).json.deviceCount, 1)
  assert.equal(one<{ c: number }>("SELECT COUNT(*) AS c FROM push_subscriptions")!.c, 1, "no duplicate rows")
})

test("a device the push service no longer knows is dropped, not retried forever", async () => {
  const cookie = await senior()
  await api("POST", "/api/push/subscribe", { cookie, body: device("https://push.example.test/old-phone") })

  failureStatus = 410
  const result = await api("POST", "/api/push/test", { cookie })
  assert.equal(result.status, 200)
  assert.equal(result.json.removed, 1, "a 410 means the browser threw the subscription away")
  assert.equal((await api("GET", "/api/push/config", { cookie })).json.deviceCount, 0)
})

test("a failed delivery is visible on the device, so a silent phone can be spotted", async () => {
  const cookie = await senior()
  await api("POST", "/api/push/subscribe", { cookie, body: device("https://push.example.test/flaky") })

  failureStatus = 500
  const result = await api("POST", "/api/push/test", { cookie })
  assert.equal(result.json.failed, 1)

  const config = await api("GET", "/api/push/config", { cookie })
  assert.equal(config.json.deviceCount, 1, "a temporary failure must not unregister the device")
  assert.ok(config.json.devices[0].lastFailureAt)
  assert.match(config.json.devices[0].failureReason, /push failed/)
})

test("the test notification goes to the account's own devices only", async () => {
  const cookie = await senior()
  await api("POST", "/api/push/subscribe", { cookie, body: device("https://push.example.test/phone-1") })
  await api("POST", "/api/push/subscribe", { cookie, body: device("https://push.example.test/laptop-1") })

  const result = await api("POST", "/api/push/test", { cookie })
  assert.equal(result.json.sent, 2, "both of this account's devices")
  assert.equal(delivered.length, 2)
  assert.match(delivered[0].payload.body, /notifications are on/i)
})

test("turning a device off removes it", async () => {
  const cookie = await senior()
  const endpoint = "https://push.example.test/to-remove"
  await api("POST", "/api/push/subscribe", { cookie, body: device(endpoint) })

  const off = await api("POST", "/api/push/unsubscribe", { cookie, body: { endpoint } })
  assert.equal(off.status, 200)
  assert.equal(off.json.deviceCount, 0)
  assert.equal((await api("GET", "/api/push/config", { cookie })).json.deviceCount, 0)
})

test("a long notification is shortened to one lock-screen line", async () => {
  const cookie = await senior()
  await api("POST", "/api/push/subscribe", { cookie, body: device("https://push.example.test/phone-1") })
  delivered.length = 0

  const userId = one<{ id: string }>("SELECT id FROM users WHERE email_normalized = ?", "senior.admin@laportedor.local")!.id
  await sendToUsers([userId], {
    title: "New application: Uwase Aline",
    body: "A new membership application was submitted for the Senior group.\n\nOpen Applications to review it, see the answers, and approve or decline.",
    link: "/app/applications/app_123",
  })

  assert.equal(delivered.length, 1)
  const { body } = delivered[0].payload
  assert.ok(body.length <= 181, `body too long: ${body.length}`)
  assert.ok(!body.includes("\n"), "a newline would break the lock-screen layout")
  assert.match(body, /Open Applications/)
})
