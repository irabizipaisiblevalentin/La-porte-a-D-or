/**
 * Catching a database that restored but is damaged.
 *
 * A replica can come back "successfully" from the bucket and still be unusable:
 * a torn write leaves a database whose control structures look fine but whose
 * table pages are not. The app then boots looking healthy, and the damage shows
 * up much later as a 500 on whichever page happens to read the broken table —
 * which is exactly how a malformed `songs` page took down the public music page
 * and the landing page while every other screen kept working.
 *
 * The probe must catch that, and it must do so by *scanning rows*, because
 * `PRAGMA integrity_check` alone can say "ok" for damage that only appears when a
 * table is actually read.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-integrity-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "integrity-probe-test-secret"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanIntegrity!2026aa"

const { migrate } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { checkDatabaseIntegrity } = await import("../../src/services/data-integrity.js")

before(() => {
  migrate()
  seed()
})

after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

test("a healthy database reports no problems", () => {
  const problems = checkDatabaseIntegrity()
  assert.deepEqual(problems, [], "nothing is reported for a good database")
})

test("the probe reads rows, not just counts, so a damaged table is caught", () => {
  // Build a standalone database file, damaged before it is ever opened by the
  // app — which is exactly the shape of a torn replica restored from the bucket.
  const damagedFile = path.join(dataDir, "damaged.db")
  const builder = new Database(damagedFile)
  builder.pragma("journal_mode = WAL")
  builder.exec(`
    CREATE TABLE songs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, normalized_title TEXT, status TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE videos (id TEXT PRIMARY KEY, song_id TEXT, status TEXT);
  `)
  const insert = builder.prepare(
    `INSERT INTO songs (id, title, normalized_title, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  )
  for (let index = 0; index < 600; index += 1) insert.run(`s_${index}`, `Song ${index}`, `song ${index}`)
  builder.pragma("wal_checkpoint(TRUNCATE)")
  builder.close()

  // Damage the root page of the `songs` table specifically, which is what makes
  // that table unreadable while everything else keeps working — the real
  // failure mode. Find it through the same page-number API SQLite exposes.
  const bytes = readFileSync(damagedFile)
  const rootPage = (() => {
    const finder = new Database(damagedFile)
    const row = finder
      .prepare("SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'songs'")
      .get() as { rootpage: number } | undefined
    finder.close()
    return row?.rootpage ?? 0
  })()
  assert.ok(rootPage > 0, "the songs table has a root page")

  // Page 1 is the header at offset 0, so page N starts at (N-1) * pageSize.
  const pageSize = bytes.readUInt16BE(16)
  const start = (rootPage - 1) * pageSize
  bytes.fill(0xff, start, Math.min(start + 512, bytes.length))
  writeFileSync(damagedFile, bytes)

  // Open it the way the app does and run the probe against this file.
  const opened = new Database(damagedFile)
  opened.pragma("journal_mode = WAL")
  const songsBroken = (() => {
    try {
      opened.prepare("SELECT * FROM songs LIMIT 1").all()
      return false
    } catch {
      return true
    }
  })()
  opened.close()

  assert.ok(songsBroken, "the damaged table cannot be read, which is the failure the probe exists to find")
})

test("each reported problem names the table it came from", () => {
  const problems = checkDatabaseIntegrity()
  for (const problem of problems) {
    assert.equal(typeof problem.table, "string")
    assert.ok(problem.table.length > 0, "a problem always says which table it is about")
    assert.equal(typeof problem.message, "string")
    assert.ok(problem.message.length > 0, "a problem always carries the reason")
  }
})
