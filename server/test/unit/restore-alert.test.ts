/**
 * "A failed database restore must never pass unnoticed."
 *
 * On hosts with an ephemeral disk the database is wiped on every restart and
 * brought back by Litestream. When that restore failed, the deploy used to come
 * up on a brand-new empty database that looked completely healthy — the exact
 * failure that lost the first live member record.
 *
 * The start script (deploy/render-start.sh) now writes RESTORE-FAILED.txt, and
 * this file proves the chain end to end: the marker is parsed at boot, it is
 * reported on GET /api/health (the web banner's source), and reportRestoreAlert
 * records one immutable audit entry plus one notification for the Chairman.
 *
 * The marker is written BEFORE anything is imported, because config.ts reads it
 * at module load — exactly as it does on a real boot.
 */
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-restore-alert-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "restore-alert-test-secret-16x"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
delete process.env.CHORALE_RESTORE_FAILED
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanRestoreAlert!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorRestoreAlert!2026bb"
process.env.JUNIOR_ADMIN_PASSWORD = "JuniorRestoreAlert!2026cc"
process.env.MEMBERS_ADMIN_PASSWORD = "MembersRestoreAlert!2026dd"

const MARKER_DETAIL = "AccessDenied: Transaction cap exceeded, see the Caps & Alerts page to increase your cap"
writeFileSync(
  path.join(dataDir, "RESTORE-FAILED.txt"),
  `at=2026-10-19T06:15:00Z\nreason=restore_failed\ndetail=${MARKER_DETAIL}\n`,
)

const { migrate, one } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { parseRestoreMarker, restoreAlert } = await import("../../src/config.js")
const { reportRestoreAlert, restoreAlertHeadline } = await import("../../src/services/data-integrity.js")

migrate()
seed()
seedDefaultAccounts(() => {}, undefined, "create-missing")

const app = createApp()
let server: Server | null = null

after(() => {
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

async function get(url: string): Promise<{ status: number; json: any }> {
  const res = await fetch(base + url)
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json }
}

let base = ""
test("start a throw-away server", async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  const address = server!.address()
  assert.ok(address && typeof address === "object")
  base = `http://127.0.0.1:${address.port}`
})

test("the marker left by the start script is parsed at boot", () => {
  assert.ok(restoreAlert, "config.restoreAlert should be set when the marker exists")
  assert.equal(restoreAlert.reason, "restore_failed")
  assert.equal(restoreAlert.at, "2026-10-19T06:15:00Z")
  assert.equal(restoreAlert.detail, MARKER_DETAIL)
})

test("GET /api/health reports the failure (this is what the web banner reads)", async () => {
  const res = await get("/api/health")
  assert.equal(res.status, 200)
  assert.equal(res.json.status, "ok")
  assert.equal(res.json.warning, "database_restore_failed")
  assert.equal(res.json.restoreAlert.reason, "restore_failed")
  assert.equal(res.json.restoreAlert.detail, MARKER_DETAIL)
})

test("the boot report writes one audit entry and rings the Chairman's bell once", () => {
  const chairman = one<{ id: string }>(
    `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.role_id = 'role_chairman' LIMIT 1`,
  )
  assert.ok(chairman, "the bootstrap chairman account should exist")

  const notificationsBefore = one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND type = 'system'",
    chairman.id,
  )!.c

  reportRestoreAlert(restoreAlert)

  const audits = one<{ c: number }>("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'system.database_restore_failed'")!.c
  assert.equal(audits, 1, "the failure must be in the audit trail exactly once")

  const notificationsAfter = one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND type = 'system'",
    chairman.id,
  )!.c
  assert.equal(notificationsAfter, notificationsBefore + 1, "the Chairman must be told about it")

  const body = one<{ body: string }>(
    "SELECT body FROM notifications WHERE user_id = ? AND type = 'system' ORDER BY created_at DESC LIMIT 1",
    chairman.id,
  )!.body
  assert.match(body, /Do not re-enter records/)

  // A second boot on the same database must not nag: still exactly one of each.
  reportRestoreAlert(restoreAlert)
  assert.equal(
    one<{ c: number }>("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'system.database_restore_failed'")!.c,
    1,
  )
  assert.equal(
    one<{ c: number }>("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND type = 'system'", chairman.id)!.c,
    notificationsAfter,
  )
})

test("a healthy boot reports nothing", () => {
  const healthy = path.join(dataDir, "no-marker-here.txt")
  assert.equal(parseRestoreMarker(healthy), null)
  assert.equal(reportRestoreAlert(null), undefined)
})

test("reasons are normalised, and an unknown reason falls back to a real restore failure", () => {
  const cases: Array<[string, string]> = [
    ["replication_disabled", "replication_disabled"],
    ["litestream_unavailable", "litestream_unavailable"],
    ["pinned_restore", "pinned_restore"],
    ["restore_failed", "restore_failed"],
    ["", "restore_failed"],
    ["something-else", "restore_failed"],
  ]
  for (const [written, expected] of cases) {
    const file = path.join(dataDir, `marker-${written || "empty"}.txt`)
    writeFileSync(file, `reason=${written}\n`)
    assert.equal(parseRestoreMarker(file)?.reason, expected, `reason=${written}`)
  }
})

test("each reason gets a headline that says what to do", () => {
  assert.match(restoreAlertHeadline({ reason: "restore_failed", at: null, detail: null }), /could not be restored/i)
  assert.match(restoreAlertHeadline({ reason: "replication_disabled", at: null, detail: null }), /durable storage is not configured/i)
  assert.match(restoreAlertHeadline({ reason: "litestream_unavailable", at: null, detail: null }), /backup tool is missing/i)
  // A pin is not a failure, and the headline must say what it does rather than
  // reusing the failure wording.
  assert.match(restoreAlertHeadline({ reason: "pinned_restore", at: null, detail: null }), /recovery pin is still set/i)
})

test("a pinned restore is reported distinctly and never suppresses a real failure", () => {
  // Both problems must be recordable: a pin is not a failed restore, so the
  // de-duplication guard must key on the action, not on "some restore problem".
  const alert = { reason: "pinned_restore" as const, at: "2026-10-21T03:00:00Z", detail: "RESTORE_TIMESTAMP is set" }
  reportRestoreAlert(alert)

  const pinned = one<{ action: string; summary: string }>(
    "SELECT action, summary FROM audit_logs WHERE action = 'system.database_restore_pinned'",
  )
  assert.ok(pinned, "the pin is recorded in the audit log")
  assert.match(pinned!.summary, /recovery pin is still set/i)

  const bell = one<{ title: string; body: string }>(
    `SELECT n.title AS title, n.body AS body FROM notifications n
       JOIN user_roles ur ON ur.user_id = n.user_id
      WHERE ur.role_id = 'role_chairman' AND n.title LIKE '%recovery pin%'`,
  )
  assert.ok(bell, "the Chairman is told")
  assert.match(bell!.body, /Remove RESTORE_TIMESTAMP/i, "the advice is how to stop it, not 'do not enter records'")
  assert.doesNotMatch(bell!.body, /Do not re-enter/i, "that advice belongs to a failed restore, not a pin")

  // A genuine failure recorded afterwards is not suppressed by the pin's entry.
  reportRestoreAlert({ reason: "restore_failed", at: "2026-10-21T04:00:00Z", detail: "bucket unreachable" })
  const failed = one<{ summary: string }>(
    "SELECT summary FROM audit_logs WHERE action = 'system.database_restore_failed'",
  )
  assert.ok(failed, "a real restore failure is still recorded after a pin was reported")
})
