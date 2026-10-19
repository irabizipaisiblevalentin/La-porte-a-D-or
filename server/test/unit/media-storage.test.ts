/**
 * "An upload must outlive the disk it was written to."
 *
 * Render's free plan wipes the filesystem on every restart and idle spin-down, so
 * a member photograph or a song uploaded yesterday was simply gone today: the
 * database came back from Litestream, the files did not.
 *
 * This file proves the whole chain against the real HTTP app and a throw-away
 * database, with a stand-in S3 endpoint (a bare `http` server that stores the
 * bytes it is handed):
 *
 *  1. every upload is mirrored into the bucket;
 *  2. `/media/...` is served from local disk while it is there, and from the
 *     bucket — re-caching it — once the disk has been wiped;
 *  3. private files (`/api/files/:id`) do the same after their authorization
 *     check;
 *  4. a path that is not a known upload never becomes a bucket request, and
 *     traversal (`..`, encoded or not) is refused.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "node:http"

// ---------------------------------------------------------------------------
// A stand-in object store. Speaks just enough S3 (path-style PUT/GET/DELETE).
// ---------------------------------------------------------------------------
interface StoredObject {
  body: Buffer
  contentType: string
}

const objects = new Map<string, StoredObject>()
const requests: string[] = []

const store = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  const key = decodeURIComponent(url.pathname.replace(/^\/[^/]+\//, ""))
  requests.push(`${req.method} ${key}`)

  if (req.method === "PUT") {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(chunk as Buffer))
    req.on("end", () => {
      objects.set(key, { body: Buffer.concat(chunks), contentType: String(req.headers["content-type"] ?? "") })
      res.writeHead(200).end()
    })
    return
  }
  if (req.method === "GET") {
    const object = objects.get(key)
    if (!object) {
      res.writeHead(404, { "content-type": "application/xml" })
      res.end("<Error><Code>NoSuchKey</Code><Message>missing</Message><RequestId>x</RequestId><HostId>y</HostId></Error>")
      return
    }
    res.writeHead(200, { "content-type": object.contentType, "content-length": String(object.body.length) })
    res.end(object.body)
    return
  }
  if (req.method === "DELETE") {
    objects.delete(key)
    res.writeHead(204).end()
    return
  }
  res.writeHead(405).end()
})

await new Promise<void>((resolve) => store.listen(0, "127.0.0.1", resolve))
const storePort = (store.address() as { port: number }).port

// ---------------------------------------------------------------------------
// Environment must be complete BEFORE config.ts is imported.
// ---------------------------------------------------------------------------
const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-media-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "media-storage-test-secret-16x"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
delete process.env.WEB_DIST_DIR
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanMedia!2026aa"
process.env.S3_BUCKET = "test-bucket"
process.env.S3_ENDPOINT = `http://127.0.0.1:${storePort}`
process.env.S3_REGION = "us-east-1"
process.env.S3_ACCESS_KEY_ID = "test-key"
process.env.S3_SECRET_ACCESS_KEY = "test-secret"

const { migrate, one, run } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { config, publicStorageDir } = await import("../../src/config.js")

const COOKIE = config.session.cookieName
const CHAIRMAN_EMAIL = "chairman@laportedor.local"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 64 }, (_, i) => i)])
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x03, ...Array.from({ length: 128 }, (_, i) => 255 - i)])

let server: Server
let base = ""
let chairman = ""

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await sleep(25)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const localPathOf = (relativeUrl: string) =>
  path.join(publicStorageDir, ...relativeUrl.replace("/media/", "").split("/"))

const bucketGets = (key: string) => requests.filter((r) => r === `GET ${key}`).length

/** Sends a request whose path is NOT normalised by the client, so `..` reaches the server. */
function rawGet(rawPath: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port: (server.address() as { port: number }).port, path: rawPath, method: "GET" },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(chunk as Buffer))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
      },
    )
    request.on("error", reject)
    request.end()
  })
}

before(async () => {
  migrate()
  seed()
  seedDefaultAccounts(() => {}, undefined, "create-missing")

  const app = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: CHAIRMAN_EMAIL, password: process.env.CHAIRMAN_PASSWORD }),
  })
  assert.equal(login.status, 200)
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(login.headers.get("set-cookie") ?? "")
  assert.ok(match, "the chairman must be signed in")
  chairman = `${COOKIE}=${match[1]}`
})

after(() => {
  server?.close()
  store.close()
  rmSync(dataDir, { recursive: true, force: true })
})

async function uploadGalleryImage(): Promise<{ id: string; url: string }> {
  const form = new FormData()
  form.append("file", new Blob([PNG], { type: "image/png" }), "choir.png")
  const res = await fetch(`${base}/api/uploads/gallery`, { method: "POST", headers: { cookie: chairman }, body: form })
  const json = await res.json()
  assert.equal(res.status, 201, JSON.stringify(json))
  assert.match(json.file.url, /^\/media\/gallery\//)
  return json.file
}

test("every upload is mirrored into the bucket", async () => {
  const file = await uploadGalleryImage()
  const key = `public${file.url.replace("/media", "")}`
  await waitFor(() => objects.has(key), `the mirror of ${key}`)
  assert.deepEqual(objects.get(key)!.body, PNG, "the mirrored bytes are the uploaded image")
  assert.equal(objects.get(key)!.contentType, "image/png", "the mirrored object keeps its content type")
})

test("while the file is on disk the bucket is never contacted", async () => {
  const file = await uploadGalleryImage()
  const key = `public${file.url.replace("/media", "")}`
  await waitFor(() => objects.has(key), "the mirror")

  const res = await fetch(base + file.url)
  assert.equal(res.status, 200)
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG)
  assert.equal(bucketGets(key), 0, "a file that is still on disk must not cost a bucket read")
})

test("after the disk is wiped the public file comes back from the bucket and is re-cached", async () => {
  const file = await uploadGalleryImage()
  const key = `public${file.url.replace("/media", "")}`
  const local = localPathOf(file.url)
  await waitFor(() => objects.has(key), "the mirror")
  assert.ok(existsSync(local), "the upload starts on the local disk")

  // The wipe: on Render this is every restart and idle spin-down.
  rmSync(local, { force: true })
  assert.ok(!existsSync(local))

  const first = await fetch(base + file.url)
  assert.equal(first.status, 200, "the file must still be served")
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), PNG, "…with its original bytes")
  assert.equal(bucketGets(key), 1, "exactly one bucket read was needed")

  await waitFor(() => existsSync(local), "the re-cached local copy")

  const second = await fetch(base + file.url)
  assert.equal(second.status, 200)
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), PNG)
  assert.equal(bucketGets(key), 1, "the second request is served from the re-cached disk copy")
})

test("a private file (song audio) is served from the bucket after a wipe, but only to an authorised reader", async () => {
  const fileId = "file_private_test"
  const storedPath = `private/song_audio/${fileId}.mp3`
  run(
    `INSERT INTO file_uploads (id, bucket, path, original_name, mime_type, file_size, entity_type, entity_id, uploaded_by, created_at)
     VALUES (?, 'private', ?, 'anthem.mp3', 'audio/mpeg', ?, 'song_audio', 'song_test', NULL, ?)`,
    fileId, storedPath, MP3.byteLength, new Date().toISOString(),
  )
  const key = storedPath
  const local = path.join(dataDir, "storage", "private", "song_audio", `${fileId}.mp3`)
  assert.ok(!existsSync(local), "the private file is not on this disk")
  objects.set(key, { body: MP3, contentType: "audio/mpeg" })

  const anonymous = await fetch(`${base}/api/files/${fileId}`)
  assert.equal(anonymous.status, 401, "private files are never public")

  const res = await fetch(`${base}/api/files/${fileId}`, { headers: { cookie: chairman } })
  assert.equal(res.status, 200, "the chairman may read approved shared music")
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), MP3)
  assert.equal(bucketGets(key), 1)
  await waitFor(() => existsSync(local), "the private file is cached locally again")
})

test("an unknown path is never turned into a bucket request", async () => {
  const requestsBefore = requests.length
  const res = await fetch(`${base}/media/gallery/does-not-exist.png`)
  assert.equal(res.status, 404)
  assert.equal(requests.length, requestsBefore, "no bucket call was made for a path with no upload record")
})

test("traversal out of /media is refused, encoded or not", async () => {
  const privateKey = "private/song_audio/file_private_test.mp3"
  const before = bucketGets(privateKey)

  // Raw request: undici would normalise `..` away before it ever left the client.
  const raw = await rawGet("/media/../private/song_audio/file_private_test.mp3")
  assert.equal(raw.status, 404, "a literal ../ path must not be served")
  assert.notDeepEqual(raw.body, MP3)

  const encoded = await fetch(`${base}/media/%2e%2e%2fprivate%2fsong_audio%2ffile_private_test.mp3`)
  assert.equal(encoded.status, 404, "an encoded ../ path must not be served")
  assert.notDeepEqual(Buffer.from(await encoded.arrayBuffer()), MP3)

  assert.equal(bucketGets(privateKey), before, "and no private key was fetched")
})

test("deleting a file removes it from the bucket too", async () => {
  const file = await uploadGalleryImage()
  const key = `public${file.url.replace("/media", "")}`
  await waitFor(() => objects.has(key), "the mirror")

  const res = await fetch(`${base}/api/uploads/${file.id}`, { method: "DELETE", headers: { cookie: chairman } })
  assert.equal(res.status, 200, JSON.stringify(await res.json()))
  await waitFor(() => !objects.has(key), "the object to disappear from the bucket")
  assert.equal(one<{ c: number }>("SELECT COUNT(*) AS c FROM file_uploads WHERE id = ?", file.id)!.c, 0)
})
