import { test } from "node:test"
import assert from "node:assert/strict"
import { ADMIN_ROLE_KEYS, PERMISSIONS, PERMISSION_KEYS, ROLES } from "../../src/auth/permissions.js"

test("every permission key is unique", () => {
  assert.equal(new Set(PERMISSION_KEYS).size, PERMISSION_KEYS.length)
})

test("role keys are unique", () => {
  const keys = ROLES.map((role) => role.key)
  assert.equal(new Set(keys).size, keys.length)
})

test("there are exactly the documented roles", () => {
  const keys = ROLES.map((role) => role.key).sort()
  assert.deepEqual(keys, [
    "chairman",
    "junior_admin",
    "junior_singer",
    "members_admin",
    "senior_leader",
    "senior_singer",
    "support_member",
  ])
})

test("there are exactly four administrator roles", () => {
  const admins = ROLES.filter((role) => ADMIN_ROLE_KEYS.includes(role.key)).map((role) => role.key).sort()
  assert.deepEqual(admins, [...ADMIN_ROLE_KEYS].sort())
  assert.equal(admins.length, 4)
})

test("every granted permission exists and every grant scope is allowed", () => {
  const byKey = new Map(PERMISSIONS.map((permission) => [permission.key, permission]))
  for (const role of ROLES) {
    for (const grant of role.grants) {
      const permission = byKey.get(grant.key)
      assert.ok(permission, `${role.key} grants unknown permission ${grant.key}`)
      // "global" is the super-scope and is always permitted.
      assert.ok(
        grant.scope === "global" || permission!.scopes.includes(grant.scope),
        `${role.key} grants ${grant.key} at disallowed scope ${grant.scope}`,
      )
    }
  }
})

test("the Chairman holds every permission at global scope", () => {
  const chairman = ROLES.find((role) => role.key === "chairman")!
  assert.equal(chairman.grants.length, PERMISSIONS.length)
  for (const grant of chairman.grants) assert.equal(grant.scope, "global")
})

test("junior_admin is scoped to the junior group and cannot reach settings", () => {
  const junior = ROLES.find((role) => role.key === "junior_admin")!
  const keys = new Set(junior.grants.map((grant) => grant.key))
  assert.equal(keys.has("settings.read"), false, "junior_admin must not read org-wide settings")
  assert.equal(keys.has("settings.write"), false)
  assert.equal(keys.has("audit.read"), false)

  const appRead = junior.grants.find((grant) => grant.key === "application.read")!
  assert.equal(appRead.scope, "junior")
})

test("members_admin is scoped to the members group and cannot reach settings", () => {
  const members = ROLES.find((role) => role.key === "members_admin")!
  const keys = new Set(members.grants.map((grant) => grant.key))
  assert.equal(keys.has("settings.read"), false, "members_admin must not read org-wide settings")
  assert.equal(keys.has("settings.write"), false)

  const appRead = members.grants.find((grant) => grant.key === "application.read")!
  assert.equal(appRead.scope, "members")
})

test("senior_leader is scoped to the senior group and cannot reach settings", () => {
  const senior = ROLES.find((role) => role.key === "senior_leader")!
  const keys = new Set(senior.grants.map((grant) => grant.key))
  assert.equal(keys.has("settings.read"), false, "senior_leader must not read org-wide settings")
  assert.equal(keys.has("settings.write"), false)
  assert.equal(keys.has("audit.read"), false)
  assert.equal(keys.has("users.manage"), false)
  // Sensitive junior (minor) data is for the Junior Administrator only.
  assert.equal(keys.has("member.sensitive.read"), false)

  const appRead = senior.grants.find((grant) => grant.key === "application.read")!
  assert.equal(appRead.scope, "senior")
  const memberRead = senior.grants.find((grant) => grant.key === "member.read")!
  assert.equal(memberRead.scope, "senior")
})

test("singers and support members are limited to their own records plus shared read", () => {
  for (const key of ["senior_singer", "junior_singer", "support_member"]) {
    const role = ROLES.find((r) => r.key === key)!
    const grants = new Map(role.grants.map((grant) => [grant.key, grant.scope]))
    assert.ok(grants.has("member.read"), `${key} should be able to read its own member record`)
    assert.equal(grants.get("member.read"), "own")
    assert.equal(grants.has("member.write") ? grants.get("member.write") : "own", "own")
    assert.equal(grants.has("settings.read"), false)
    assert.equal(grants.has("users.manage"), false)
    assert.equal(grants.has("application.decide"), false)
  }
})
