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
    "events_coordinator",
    "junior_admin",
    "junior_singer",
    "members_admin",
    "senior_leader",
    "senior_singer",
    "support_member",
  ])
})

test("there are exactly five administrator roles", () => {
  const admins = ROLES.filter((role) => ADMIN_ROLE_KEYS.includes(role.key)).map((role) => role.key).sort()
  assert.deepEqual(admins, [...ADMIN_ROLE_KEYS].sort())
  assert.equal(admins.length, 5)
})

test("the Events Coordinator runs events and nothing else", () => {
  const coordinator = ROLES.find((role) => role.key === "events_coordinator")!
  const grants = new Map(coordinator.grants.map((grant) => [grant.key, grant.scope]))

  // Everything the events programme needs.
  for (const key of ["events.read", "events.write", "events.manage", "events.payment.approve", "events.checkin"]) {
    assert.equal(grants.get(key), "global", `the coordinator must hold ${key}`)
  }

  // The register is read-only, so participants can be picked without any group's
  // records being changed, and without reading sensitive minor data.
  assert.equal(grants.get("member.read"), "global")
  for (const key of ["member.write", "member.reset_password", "member.delete", "member.sensitive.read"]) {
    assert.equal(grants.has(key), false, `the coordinator must not hold ${key}`)
  }

  // Applications belong to each group's own administrator.
  for (const key of ["application.read", "application.review", "application.decide"]) {
    assert.equal(grants.has(key), false, `the coordinator must not hold ${key}`)
  }

  // Nor does it administer the platform.
  for (const key of ["settings.read", "settings.write", "roles.manage", "users.manage", "audit.read"]) {
    assert.equal(grants.has(key), false, `the coordinator must not hold ${key}`)
  }
})

test("only the coordinator may set an audience or a contribution, besides the Chairman", () => {
  // The three permissions that gate the audience, the money and the door must not
  // leak to the group administrators, or every group could re-aim every event.
  for (const key of ["events.manage", "events.payment.approve", "events.checkin"]) {
    const holders = ROLES.filter((role) => role.grants.some((grant) => grant.key === key)).map((role) => role.key).sort()
    assert.deepEqual(holders, ["chairman", "events_coordinator"], `${key} should be the coordinator's and the Chairman's alone`)
  }
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

test("the Chairman holds every permission at global scope except deciding applications", () => {
  const chairman = ROLES.find((role) => role.key === "chairman")!
  const keys = new Set(chairman.grants.map((grant) => grant.key))
  assert.equal(keys.has("application.decide"), false, "the Chairman must not approve/reject applications")
  for (const grant of chairman.grants) assert.equal(grant.scope, "global")
  for (const permission of PERMISSIONS) {
    if (permission.key === "application.decide") continue
    assert.ok(keys.has(permission.key), `the Chairman should still hold ${permission.key}`)
  }
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
