/**
 * The one-time channel import, as an admin action inside the app.
 *
 * The choir's songs were previously going to be written into the database file
 * directly, which does not replicate safely. They are imported through a normal
 * authenticated request instead, so the write is an ordinary transaction the
 * running application performs and Litestream records like any other.
 *
 * What has to hold:
 *  - only the Chairman may run it — every other role, and a signed-out caller,
 *    is refused;
 *  - the individual songs are imported, approved and playable;
 *  - nothing is left orphaned from the catalogue: each song belongs to all
 *    three groups;
 *  - running it again adds nothing, which is what "one-time" has to mean.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-import-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "channel-import-test-secret-16"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanImport!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorImport!2026bb"
process.env.JUNIOR_ADMIN_PASSWORD = "JuniorImport!2026cc"
process.env.MEMBERS_ADMIN_PASSWORD = "MembersImport!2026dd"

const { migrate, all, one } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config } = await import("../../src/config.js")
const { CHANNEL_SONGS, CHANNEL_ID } = await import("../../src/services/channel-import.js")

const COOKIE = config.session.cookieName

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

async function login(identifier: string, password: string): Promise<string> {
  const res = await api("POST", "/api/auth/login", { body: { identifier, password } })
  assert.equal(res.status, 200, `login failed for ${identifier}: ${JSON.stringify(res.json)}`)
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(res.setCookie ?? "")
  assert.ok(match, `no cookie for ${identifier}`)
  return `${COOKIE}=${match[1]}`
}

before(async () => {
  migrate()
  seed()
  seedDefaultAccounts(() => {}, defaultAccounts(), "create-missing")
  const app = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  base = `http://127.0.0.1:${(server.address() as any).port}`
})

after(() => {
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test("a signed-out caller cannot run the import", async () => {
  const res = await api("POST", "/api/songs/import-channel", { body: {} })
  assert.equal(res.status, 401)
})

test("a group administrator cannot run the import", async () => {
  const cookie = await login("senior.admin@laportedor.local", process.env.SENIOR_ADMIN_PASSWORD!)
  const res = await api("POST", "/api/songs/import-channel", { cookie, body: {} })
  assert.equal(res.status, 403)
})

test("the Chairman imports the channel's songs, approved and playable", async () => {
  const cookie = await login("chairman@laportedor.local", process.env.CHAIRMAN_PASSWORD!)
  const res = await api("POST", "/api/songs/import-channel", { cookie, body: {} })

  assert.equal(res.status, 200, JSON.stringify(res.json))
  // The songs plus Arakumva, which the catalogue tracks under the same channel.
  assert.equal(res.json.songsCreated, CHANNEL_SONGS.length + 1, "the channel's songs are created on the first run")

  // Every imported song is active and has an approved, playable video.
  for (const entry of CHANNEL_SONGS) {
    const song = one<{ id: string; status: string }>(
      "SELECT id, status FROM songs WHERE title = ?",
      entry.title,
    )
    assert.ok(song, `song "${entry.title}" is missing`)
    assert.equal(song.status, "active")

    const video = one<{ status: string; is_primary: number; youtube_video_id: string }>(
      `SELECT status, is_primary, youtube_video_id FROM videos
        WHERE song_id = ? AND youtube_video_id = ?`,
      song.id, entry.videoId,
    )
    assert.ok(video, `video ${entry.videoId} is not linked to "${entry.title}"`)
    assert.equal(video.status, "approved")
    assert.equal(video.is_primary, 1, "the imported video is the song's primary recording")
  }
})

test("every imported song is assigned to all three groups", async () => {
  const groupCount = one<{ c: number }>("SELECT COUNT(*) AS c FROM groups")!.c
  assert.equal(groupCount, 3)

  const unassigned = all<{ title: string; c: number }>(
    `SELECT s.title AS title, COUNT(a.group_id) AS c
       FROM songs s
       LEFT JOIN song_group_assignments a ON a.song_id = s.id
      WHERE s.youtube_channel_id = ?
      GROUP BY s.id
     HAVING COUNT(a.group_id) <> ?`,
    CHANNEL_ID, groupCount,
  )
  assert.deepEqual(unassigned, [], "each channel song belongs to every group")
})

test("running the import a second time changes nothing", async () => {
  const cookie = await login("chairman@laportedor.local", process.env.CHAIRMAN_PASSWORD!)
  const before = one<{ c: number }>("SELECT COUNT(*) AS c FROM songs")!.c

  const res = await api("POST", "/api/songs/import-channel", { cookie, body: {} })
  assert.equal(res.status, 200)
  assert.equal(res.json.songsCreated, 0, "no song is created twice")
  assert.equal(res.json.videosLinked, CHANNEL_SONGS.length + 1, "the same videos are re-linked, not duplicated")

  const after = one<{ c: number }>("SELECT COUNT(*) AS c FROM songs")!.c
  assert.equal(after, before, "the song count is unchanged")

  // And no video id was written twice.
  const duplicates = all<{ youtube_video_id: string }>(
    `SELECT youtube_video_id FROM videos GROUP BY youtube_video_id HAVING COUNT(*) > 1`,
  )
  assert.deepEqual(duplicates, [], "no video id is stored more than once")
})

test("the import is written to the audit trail", async () => {
  const entry = one<{ action: string; summary: string }>(
    "SELECT action, summary FROM audit_logs WHERE action = 'music.channel_import' ORDER BY created_at DESC LIMIT 1",
  )
  assert.ok(entry, "the import leaves an audit entry")
  assert.match(entry.summary, /channel/i)
})
