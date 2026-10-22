/**
 * A person's own profile picture.
 *
 * The photograph in the top bar belongs to the signed-in account, not to a member
 * record, so that an administrator who never applied to the choir still has one.
 * Anyone signed in may set or remove their own — there is deliberately no route
 * that lets one account change another's picture.
 *
 * A profile picture is served from the *private* bucket (`/api/files/:id`), not the
 * public one: a person's face is theirs, and a URL that happens to leak should not
 * hand it to anyone who guesses the id. A signed-in request reads it; an anonymous
 * one does not.
 *
 * Covered here: an upload stores the file and serves it back to the owner,
 * replacing a picture deletes the file it supersedes, removing it clears the
 * account, an anonymous caller is refused outright, and a non-image is rejected.
 */
import { test, after } from "node:test"
import assert from "node:assert/strict"
import fs, { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-avatar-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "avatar-test-secret-16"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanAvatar!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorAvatar!2026bb"

const { migrate, one, run } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")
const { hashPassword } = await import("../../src/lib/security.js")
const { absolutePathFor, findUploadByUrl } = await import("../../src/services/uploads.js")

const COOKIE = config.session.cookieName
const CHAIRMAN_EMAIL = "chairman@laportedor.local"

/** A 1x1 PNG — the smallest thing the image filter accepts. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

let server: Server
let base: string

migrate()
seed()
seedDefaultAccounts()

const app = createApp()
await new Promise<void>((resolve) => {
  server = app.listen(0, () => {
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
    resolve()
  })
})

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: email, password }),
  })
  assert.equal(res.status, 200, `login failed for ${email}`)
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(res.headers.get("set-cookie") ?? "")
  assert.ok(match, "no session cookie returned")
  return `${COOKIE}=${match[1]}`
}

const chairman = await login(CHAIRMAN_EMAIL, process.env.CHAIRMAN_PASSWORD!)

/** Uploads a picture and returns the stored path. */
async function upload(cookie: string | null, bytes = PNG): Promise<{ status: number; avatarPath?: string; json: any }> {
  const form = new FormData()
  form.append("file", new Blob([bytes], { type: "image/png" }), "me.png")
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  const res = await fetch(`${base}/api/auth/avatar`, { method: "POST", headers, body: form })
  const json = await res.json().catch(() => null)
  return { status: res.status, avatarPath: json?.avatarPath, json }
}

/** The absolute path on disk of the file behind an avatar URL. */
function fileOnDisk(avatarPath: string): string {
  const row = findUploadByUrl(avatarPath)
  assert.ok(row, `no stored file for ${avatarPath}`)
  return absolutePathFor(row!)
}

after(() => {
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test("a signed-in account can set its own profile picture", async () => {
  const { status, avatarPath, json } = await upload(chairman)
  assert.equal(status, 201, JSON.stringify(json))
  assert.match(avatarPath!, /^\/api\/files\//, "the picture is served from the private bucket")

  // The path is stored on the account and comes back from /auth/me, which is what
  // the top bar reads to decide between a photograph and an initial.
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: chairman } })
  const body = await me.json()
  assert.equal(body.user.avatarPath, avatarPath)

  const row = findUploadByUrl(avatarPath!)
  assert.equal(row?.entity_type, "user_avatar", "the file is registered as an avatar")
  assert.equal(row?.mime_type, "image/png")
})

test("the owner can read their own picture back", async () => {
  const { avatarPath } = await upload(chairman)
  const res = await fetch(base + avatarPath, { headers: { cookie: chairman } })
  assert.equal(res.status, 200)
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG)
})

test("an anonymous caller cannot read the picture", async () => {
  const { avatarPath } = await upload(chairman)
  const res = await fetch(base + avatarPath)
  assert.equal(res.status, 401, "a profile picture is not public")
})

test("replacing a picture discards the file it supersedes", async () => {
  const first = await upload(chairman)
  const firstPath = fileOnDisk(first.avatarPath!)
  assert.ok(fs.existsSync(firstPath), "the first picture is on disk")

  const second = await upload(chairman)
  assert.notEqual(second.avatarPath, first.avatarPath, "a replacement is stored under a new name")
  assert.ok(!fs.existsSync(firstPath), "the superseded file is gone")
  assert.ok(fs.existsSync(fileOnDisk(second.avatarPath!)), "the replacement is on disk")

  const row = one<{ avatar_path: string | null }>(
    "SELECT avatar_path FROM users WHERE email = ?", CHAIRMAN_EMAIL,
  )
  assert.equal(row?.avatar_path, second.avatarPath, "the account points at the replacement")
})

test("the account can remove its picture and falls back to an initial", async () => {
  const { avatarPath } = await upload(chairman)
  const stored = fileOnDisk(avatarPath!)

  const res = await fetch(`${base}/api/auth/avatar`, { method: "DELETE", headers: { cookie: chairman } })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.avatarPath, null)
  assert.ok(!fs.existsSync(stored), "the file is deleted with the picture")

  const row = one<{ avatar_path: string | null }>(
    "SELECT avatar_path FROM users WHERE email = ?", CHAIRMAN_EMAIL,
  )
  assert.equal(row?.avatar_path, null)
})

test("removing a picture that was never set is harmless", async () => {
  const res = await fetch(`${base}/api/auth/avatar`, { method: "DELETE", headers: { cookie: chairman } })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).avatarPath, null)
})

test("an anonymous caller cannot set a picture", async () => {
  const { status } = await upload(null)
  assert.equal(status, 401)
})

test("a file that is not an image is refused", async () => {
  const form = new FormData()
  form.append("file", new Blob([Buffer.from("not an image")], { type: "text/plain" }), "notes.txt")
  const res = await fetch(`${base}/api/auth/avatar`, { method: "POST", headers: { cookie: chairman }, body: form })
  assert.equal(res.status, 400)
})

test("a request with no file at all is refused", async () => {
  const res = await fetch(`${base}/api/auth/avatar`, {
    method: "POST",
    headers: { cookie: chairman },
    body: new FormData(),
  })
  assert.equal(res.status, 400)
})

test("another member cannot read somebody else's picture", async () => {
  // The picture under test belongs to the Chairman; a plain member holds no
  // account-administration permission and must be refused.
  const { avatarPath } = await upload(chairman)
  const timestamp = new Date().toISOString()
  run(
    `INSERT INTO users (id, email, email_normalized, display_name, password_hash, must_change_password,
                        status, created_at, updated_at)
     VALUES ('usr_avatar_other', 'other@laportedor.local', 'other@laportedor.local', 'Other Member', ?, 0, 'active', ?, ?)`,
    hashPassword("OtherMember!2026cc"), timestamp, timestamp,
  )
  run(
    `INSERT INTO user_roles (user_id, role_id, granted_at)
     SELECT 'usr_avatar_other', id, ? FROM roles WHERE key = 'junior_singer'`,
    timestamp,
  )

  const other = await login("other@laportedor.local", "OtherMember!2026cc")
  const res = await fetch(base + avatarPath, { headers: { cookie: other } })
  assert.equal(res.status, 403, "a member must not read another member's face")
})

