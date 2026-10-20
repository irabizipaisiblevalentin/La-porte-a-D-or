/**
 * Clicking a song to watch it.
 *
 * A song's videos live in `videos`, but the click happens somewhere else: the
 * Music Library list, the song page and the public landing page all have to know
 * *which* video to play before they can open a player. Two read models carry
 * that, and both are easy to get subtly wrong:
 *
 *  1. `GET /songs` (the list) — the playable video, its cover and how many
 *     approved videos exist, without one query per row;
 *  2. `GET /public/landing` (the visitor-facing highlights) — the YouTube id, so
 *     a public card can start playback on click instead of only showing a still.
 *
 * The rules that matter at both: only an **approved** video may be played, a
 * video marked primary wins, a rejected video must never be offered, and a song
 * with no video must say so rather than play something else.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-watch-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "watch-video-test-secret-16ch"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanWatch!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorWatch!2026bb"

const { migrate, run } = await import("../../src/db/index.js")
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

function chairman(): Promise<string> {
  return login("chairman@laportedor.local", process.env.CHAIRMAN_PASSWORD!)
}

/** Creates a song directly: the catalogue content is not what is under test here. */
function makeSong(title: string): string {
  const songId = `song_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
  run(
    `INSERT INTO songs (id, title, normalized_title, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    songId, title, title.toLowerCase(),
  )
  return songId
}

function makeVideo(opts: {
  youtubeId: string
  title: string
  songId?: string | null
  status?: "discovered" | "approved" | "rejected"
  isPrimary?: 0 | 1
  thumbnailUrl?: string | null
}): string {
  const videoRow = `video_${opts.youtubeId}`
  run(
    `INSERT INTO videos (id, youtube_video_id, title, url, thumbnail_url, status, song_id, is_primary,
                          created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    videoRow, opts.youtubeId, opts.title, `https://www.youtube.com/watch?v=${opts.youtubeId}`,
    opts.thumbnailUrl ?? `https://i.ytimg.com/vi/${opts.youtubeId}/hqdefault.jpg`,
    opts.status ?? "approved", opts.songId ?? null, opts.isPrimary ?? 0,
  )
  return videoRow
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

test("the library list offers the approved video and its cover for every song", async () => {
  const cookie = await chairman()
  const withVideo = makeSong("Ingoma Yacu")
  const withoutVideo = makeSong("Silent Song")
  const rejectedOnly = makeSong("Rejected Only")

  makeVideo({ youtubeId: "aaaaaaaaaaa", title: "Older take", songId: withVideo })
  const primaryId = makeVideo({
    youtubeId: "bbbbbbbbbbb",
    title: "Official recording",
    songId: withVideo,
    isPrimary: 1,
    thumbnailUrl: "https://example.test/cover.jpg",
  })
  makeVideo({ youtubeId: "ccccccccccc", title: "Not reviewed", songId: rejectedOnly, status: "discovered" })

  const res = await api("GET", "/api/songs?limit=50", { cookie })
  assert.equal(res.status, 200, JSON.stringify(res.json))

  const byTitle = new Map<string, any>(res.json.items.map((song: any) => [song.title, song]))
  const playable = byTitle.get("Ingoma Yacu")!
  assert.equal(playable.primary_video_id, "bbbbbbbbbbb", "the primary video is the one a click should play")
  assert.equal(playable.thumbnail_url, "https://example.test/cover.jpg")
  assert.equal(playable.video_count, 2, "the list also knows there is more than one video")

  const silent = byTitle.get("Silent Song")!
  assert.equal(silent.primary_video_id, null, "a song with no video must not offer playback")
  assert.equal(silent.video_count, 0)
  assert.equal(silent.thumbnail_url, null)

  const unreviewed = byTitle.get("Rejected Only")!
  assert.equal(unreviewed.primary_video_id, null, "a video nobody approved must never be offered for playback")
  assert.equal(unreviewed.video_count, 0)

  assert.equal(primaryId.length > 0, true)
})

test("a song falls back to a non-primary video when only one is approved", async () => {
  const cookie = await chairman()
  const songId = makeSong("Kyrie")
  makeVideo({ youtubeId: "ddddddddddd", title: "One take", songId })

  const res = await api("GET", `/api/songs?search=Kyrie`, { cookie })
  assert.equal(res.json.items[0].primary_video_id, "ddddddddddd")
  assert.equal(res.json.items[0].video_count, 1)
})

test("the public landing model carries the id a visitor's click needs", async () => {
  const songId = makeSong("Public Anthem")
  makeVideo({ youtubeId: "eeeeeeeeeee", title: "Public take", songId, isPrimary: 1 })
  const silentId = makeSong("Public Silence")
  assert.ok(silentId)

  const res = await api("GET", "/api/public/landing")
  assert.equal(res.status, 200, JSON.stringify(res.json))

  const featured = res.json.featuredSongs as any[]
  const anthem = featured.find((song) => song.title === "Public Anthem")
  assert.ok(anthem, "a song with an approved video is a public highlight")
  assert.equal(anthem.youtubeVideoId, "eeeeeeeeeee", "the card must be able to start playback")
  assert.equal(anthem.thumbnailUrl, "https://i.ytimg.com/vi/eeeeeeeeeee/hqdefault.jpg")

  const tainted = JSON.stringify(res.json)
  assert.ok(!tainted.includes("discovered"), "an unapproved video must not leak into the public model")
})

test("the public music page lists every playable song, and only playable ones", async () => {
  const songId = makeSong("Umwuka Wera")
  makeVideo({ youtubeId: "fffffffffff", title: "Umwuka Wera (official)", songId, isPrimary: 1 })
  const silent = makeSong("Not Published Yet")
  assert.ok(silent)
  const unreviewed = makeSong("Awaiting Review")
  makeVideo({ youtubeId: "ggggggggggg", title: "Not approved", songId: unreviewed, status: "discovered" })

  const res = await api("GET", "/api/public/music")
  assert.equal(res.status, 200, JSON.stringify(res.json))

  const titles = (res.json.songs as any[]).map((song) => song.title)
  assert.ok(titles.includes("Umwuka Wera"), "a song with an approved video is in the public catalogue")
  assert.ok(!titles.includes("Not Published Yet"), "a song with no video is not offered for playback")
  assert.ok(!titles.includes("Awaiting Review"), "an unapproved video never reaches the public catalogue")

  const song = (res.json.songs as any[]).find((row) => row.title === "Umwuka Wera")
  assert.equal(song.youtubeVideoId, "fffffffffff", "the catalogue carries the id a click must play")
  assert.equal(song.videoCount, 1)
  assert.ok(!JSON.stringify(res.json).includes("discovered"), "no unapproved state leaks out")
})

test("the public music catalogue can be searched and filtered by category", async () => {
  const res = await api("GET", "/api/public/music?search=Umwuka")
  assert.equal(res.status, 200, JSON.stringify(res.json))
  assert.deepEqual((res.json.songs as any[]).map((song) => song.title), ["Umwuka Wera"])

  const missing = await api("GET", "/api/public/music?search=zzzz-no-such-song")
  assert.equal(missing.json.songs.length, 0)

  // Only categories with something playable are offered, so the filter never
  // presents an empty tab to a visitor.
  const categories = res.json.categories as any[]
  for (const category of categories) {
    assert.ok(category.count >= 1, `category ${category.key} must have at least one song`)
  }
})

test("the public music catalogue never exposes member or admin data", async () => {
  const res = await api("GET", "/api/public/music")
  const body = JSON.stringify(res.json)
  for (const forbidden of ["password", "admin_notes", "created_by", "member_no", "reviewed_by", "phone"]) {
    assert.ok(!body.includes(forbidden), `the public catalogue must not leak "${forbidden}"`)
  }
})
