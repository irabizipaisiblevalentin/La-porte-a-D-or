/**
 * Boot-time administrator bootstrap (see `bootstrapAdministrators()` in
 * `src/index.ts` and `seedDefaultAccounts()` in `src/db/seed-admins.ts`).
 *
 * These tests exercise the database-backed seeding directly, in production mode
 * with a throw-away database in a temporary directory.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-admin-bootstrap-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.NODE_ENV = "production"
process.env.APP_SECRET = "admin-bootstrap-test-secret-at-least-16-chars"
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.CHAIRMAN_PASSWORD = "ChairmanTest!2026aa"
process.env.SENIOR_ADMIN_PASSWORD = "SeniorTest!2026bb"
process.env.JUNIOR_ADMIN_PASSWORD = "JuniorTest!2026cc"
process.env.MEMBERS_ADMIN_PASSWORD = "MembersTest!2026dd"
process.env.EVENTS_COORDINATOR_PASSWORD = "CoordinatorTest!2026ee"

const { migrate, one, run } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { DEFAULT_ACCOUNTS } = await import("../../src/db/default-accounts.js")

interface UserRow {
  id: string
  email: string
  display_name: string
  password_hash: string
  must_change_password: number
}

function userByEmail(email: string): UserRow | undefined {
  return one<UserRow>(
    "SELECT id, email, display_name, password_hash, must_change_password FROM users WHERE email_normalized = ?",
    email.toLowerCase(),
  )
}

before(() => {
  migrate()
  seed()
})

after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

test("boot bootstrap creates every missing administrator with the env password", () => {
  seedDefaultAccounts(() => {}, defaultAccounts(), "create-missing")

  for (const account of defaultAccounts()) {
    const user = userByEmail(account.email)
    assert.ok(user, `${account.email} should have been created`)
    assert.equal(user.must_change_password, 0, "an env-provided password must not force a change")
  }
})

test("boot bootstrap never modifies an existing account (password, name, roles survive)", () => {
  const chairman = defaultAccounts().find((account) => account.roleKey === "chairman")!
  const before = userByEmail(chairman.email)!

  // Simulate a change made by the chairman in the UI.
  run("UPDATE users SET password_hash = ?, display_name = ?, updated_at = ? WHERE id = ?",
    "scrypt$changed$hash", "Bunani Jean Marie Vianney", new Date().toISOString(), before.id)

  seedDefaultAccounts(() => {}, defaultAccounts(), "create-missing")

  const now = userByEmail(chairman.email)!
  assert.equal(now.password_hash, "scrypt$changed$hash", "password must not be reset on boot")
  assert.equal(now.display_name, "Bunani Jean Marie Vianney", "profile must not be reset on boot")
})

test("the explicit seed:admins reset still rewrites accounts (CLI behaviour unchanged)", () => {
  const chairman = defaultAccounts().find((account) => account.roleKey === "chairman")!
  seedDefaultAccounts(() => {}, defaultAccounts(), "reset")
  const now = userByEmail(chairman.email)!
  assert.equal(now.display_name, chairman.displayName)
  assert.notEqual(now.password_hash, "scrypt$changed$hash")
})

test("production accounts still carrying the public sample password must change it", () => {
  const sampleAccounts = DEFAULT_ACCOUNTS.map((account) => ({
    ...account,
    email: account.email.replace("@", "+sample@"),
  }))
  seedDefaultAccounts(() => {}, sampleAccounts, "create-missing")

  for (const account of sampleAccounts) {
    const user = userByEmail(account.email)
    assert.ok(user, `${account.email} should have been created`)
    assert.equal(user.must_change_password, 1, "the public sample password must force a change")
  }
})
