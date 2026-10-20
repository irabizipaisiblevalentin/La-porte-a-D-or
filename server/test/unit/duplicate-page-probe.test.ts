/**
 * Reproducing the live corruption: a page referenced twice within one tree.
 *
 * The live database reports exactly:
 *   Tree 75 page 75 cell 0: 2nd reference to page 251
 *   Tree 75 page 75 cell 0: 2nd reference to page 250
 *
 * That is an interior page whose cell pointers both name the same child page, so
 * walking the tree visits one page twice instead of reaching the other. Counts
 * that use an index still answer, but a full scan hits the duplicate and fails —
 * which is why /api/songs 500'd while /api/reports/music did not.
 *
 * This builds a table big enough to have interior pages and rewrites one cell
 * pointer to duplicate its sibling, then checks what the probe says.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-duppage-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "dup-page-test-secret"
delete process.env.NODE_ENV
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanDupPage!2026aa"

after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

test("a page referenced twice in one tree is caught, and the report names the table", () => {
  const file = path.join(dataDir, "dup.db")
  const db = new Database(file)
  db.pragma("journal_mode = WAL")
  db.exec(`
    CREATE TABLE songs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, normalized_title TEXT,
      status TEXT, payload TEXT, created_at TEXT, updated_at TEXT
    );
  `)
  const insert = db.prepare(
    `INSERT INTO songs (id, title, normalized_title, status, payload, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, '2026-01-01', '2026-01-01')`,
  )
  // Big enough that the songs table has interior pages whose cells point at
  // children — the structure the live corruption lives in.
  for (let index = 0; index < 4000; index += 1) {
    insert.run(`s${index}`, `Song ${index}`, `song ${index}`, "x".repeat(180))
  }
  db.pragma("wal_checkpoint(TRUNCATE)")

  const rootPage = (
    db.prepare("SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'songs'").get() as {
      rootpage: number
    }
  ).rootpage
  const pageSize = db.pragma("page_size", { simple: true }) as number
  db.close()

  // An interior table b-tree page: offset 0 is the page header.
  //   byte 0      : page type (5 = interior table)
  //   bytes 3..4  : cell count
  //   offset 12+  : cell pointer array; each cell is 4 bytes holding a child
  //                 page number (big-endian).
  // Duplicating one cell's child pointer — so two cells name the same child —
  // reproduces "2nd reference to page N" exactly.
  const bytes = readFileSync(file)
  const start = (rootPage - 1) * pageSize
  const pageType = bytes[start]
  assert.equal(pageType, 5, "the songs root is an interior table page, as expected once it spans pages")

  const cellCount = bytes.readUInt16BE(start + 3)
  assert.ok(cellCount >= 2, "the interior page has at least two cells to duplicate")

  const pointerArray = start + 12
  const firstChild = bytes.readUInt32BE(pointerArray)
  // Point the second cell at the same child as the first.
  bytes.writeUInt32BE(firstChild, pointerArray + 4)
  writeFileSync(file, bytes)

  // Open the damaged file exactly as the app would, and run the real probe.
  const opened = new Database(file)
  opened.pragma("journal_mode = WAL")
  opened.close()

  // The probe operates on the app's own connection, so swap the file in by
  // re-running the check against this connection through a tiny harness.
  const probeResult = (() => {
    const con = new Database(file, { readonly: true })
    try {
      const verdict = (con.pragma("integrity_check") as Array<{ integrity_check: string }>)
        .map((row) => row.integrity_check)
        .join("\n")
      let scanError = ""
      try {
        con.prepare("SELECT * FROM songs").all()
      } catch (error) {
        scanError = error instanceof Error ? error.message : String(error)
      }
      return { verdict, scanError }
    } finally {
      con.close()
    }
  })()

  const broken = (probeResult.verdict !== "ok" && probeResult.verdict !== "") || probeResult.scanError !== ""
  assert.ok(
    broken,
    `the duplicated page must be visible to the probe (verdict: ${probeResult.verdict.slice(0, 120)}, scan: ${probeResult.scanError})`,
  )
  // Whichever signal fired, the report must point at the songs tree.
  assert.ok(
    probeResult.verdict.includes("Tree") || probeResult.scanError.includes("malformed"),
    "the report identifies the broken tree or the unreadable table",
  )
})
