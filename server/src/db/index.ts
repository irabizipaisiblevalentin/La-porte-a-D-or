import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { databaseFile } from "../config.js"

const here = path.dirname(fileURLToPath(import.meta.url))

export const db = new Database(databaseFile)

// WAL keeps readers non-blocking during writes; FK enforcement is per-connection.
db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")
db.pragma("busy_timeout = 5000")
db.pragma("synchronous = NORMAL")

export function one<T = Row>(sql: string, ...params: SqlParam[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

export function all<T = Row>(sql: string, ...params: SqlParam[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}

export function run(sql: string, ...params: SqlParam[]): Database.RunResult {
  return db.prepare(sql).run(...params)
}

export type SqlParam = string | number | bigint | Buffer | null
export type Row = Record<string, unknown>

/** Runs `fn` inside an IMMEDIATE transaction so concurrent writers queue instead of failing. */
export function transaction<T>(fn: () => T): T {
  return db.transaction(fn).immediate()
}

interface MigrationFile {
  name: string
  sql: string
}

export function loadMigrations(): MigrationFile[] {
  const migrationsDir = path.join(here, "migrations")
  const files = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
    : []
  const baseline = fs.readFileSync(path.join(here, "schema.sql"), "utf8")
  return [{ name: "0001_baseline", sql: baseline }, ...files.map((f) => ({
    name: f.replace(/\.sql$/, ""),
    sql: fs.readFileSync(path.join(migrationsDir, f), "utf8"),
  }))]
}

export function migrate(log: (message: string) => void = () => {}): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
  const applied: string[] = []
  const already = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((r) => r.name),
  )
  for (const migration of loadMigrations()) {
    if (already.has(migration.name)) continue
    db.transaction(() => {
      db.exec(migration.sql)
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
        migration.name,
        new Date().toISOString(),
      )
    })()
    applied.push(migration.name)
    log(`applied ${migration.name}`)
  }
  return applied
}
