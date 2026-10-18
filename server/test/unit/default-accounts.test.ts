import { test } from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_ACCOUNTS, OFFICIAL_GROUP_IDS, defaultAccounts } from "../../src/db/default-accounts.js"
import { ADMIN_ROLE_KEYS, ROLE_KEYS } from "../../src/auth/permissions.js"
import { validatePasswordStrength } from "../../src/lib/security.js"

test("default accounts: every password satisfies the strength policy", () => {
  for (const account of DEFAULT_ACCOUNTS) {
    const strength = validatePasswordStrength(account.password)
    assert.ok(strength.ok, `${account.email} password is weak: ${strength.errors.join(" ")}`)
  }
})

test("default accounts: every role key is a known role", () => {
  for (const account of DEFAULT_ACCOUNTS) {
    assert.ok(ROLE_KEYS.includes(account.roleKey), `${account.email} has unknown role ${account.roleKey}`)
  }
})

test("default accounts: emails are unique and normalised", () => {
  const emails = DEFAULT_ACCOUNTS.map((account) => account.email)
  assert.equal(new Set(emails).size, emails.length, "default account emails must be unique")
  for (const email of emails) {
    assert.equal(email, email.toLowerCase(), `${email} should be lower-case`)
    assert.ok(email.includes("@"), `${email} should be an email address`)
  }
})

test("default accounts: exactly four administrators, one per admin role", () => {
  assert.equal(DEFAULT_ACCOUNTS.length, 4)
  for (const account of DEFAULT_ACCOUNTS) {
    assert.equal(account.kind, "admin", `${account.email} should be an admin account`)
    assert.ok(ADMIN_ROLE_KEYS.includes(account.roleKey), `${account.email} should hold an admin role`)
    assert.equal(account.groupId, null, `${account.email} admin account should not be group-bound`)
  }
  assert.deepEqual(
    DEFAULT_ACCOUNTS.map((account) => account.roleKey).sort(),
    [...ADMIN_ROLE_KEYS].sort(),
  )
})

test("default accounts: every profile photo, when set, lives under /assets/avatars/", () => {
  for (const account of DEFAULT_ACCOUNTS) {
    if (!account.avatarPath) continue
    assert.ok(account.avatarPath.startsWith("/assets/avatars/"), `${account.email} avatar should live under /assets/avatars/`)
  }
})

test("default accounts: the three official groups are unchanged", () => {
  assert.deepEqual([...OFFICIAL_GROUP_IDS].sort(), ["grp_junior", "grp_members", "grp_senior"])
})

test("default accounts: environment variables override credentials", () => {
  const overridden = defaultAccounts({
    CHAIRMAN_EMAIL: "chair@example.org",
    CHAIRMAN_PASSWORD: "OverrideChair!99",
    JUNIOR_ADMIN_NAME: "Nana Junior",
  } as NodeJS.ProcessEnv)

  const chairman = overridden.find((account) => account.roleKey === "chairman")!
  assert.equal(chairman.email, "chair@example.org")
  assert.equal(chairman.password, "OverrideChair!99")
  assert.equal(chairman.displayName, "Chairman", "unset fields keep their default")

  const junior = overridden.find((account) => account.roleKey === "junior_admin")!
  assert.equal(junior.displayName, "Nana Junior")
  assert.equal(junior.email, DEFAULT_ACCOUNTS.find((a) => a.roleKey === "junior_admin")!.email)
})
