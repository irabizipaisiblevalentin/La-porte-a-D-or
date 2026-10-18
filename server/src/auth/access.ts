import { all, one } from "../db/index.js"
import type { PermissionScope } from "./permissions.js"

export interface AuthUser {
  id: string
  email: string
  /** Sign-in name for accounts without an email (else null); see services/usernames. */
  username: string | null
  displayName: string
  status: string
  mustChangePassword: boolean
  avatarPath: string | null
  memberId: string | null
  memberNo: string | null
  groupId: string | null
  groupName: string | null
  roles: string[]
  /** permission key -> scopes granted to this user */
  permissions: Record<string, PermissionScope[]>
}

interface UserRow {
  id: string
  email: string
  username: string | null
  display_name: string
  status: string
  must_change_password: number
  avatar_path: string | null
  member_id: string | null
  member_no: string | null
  group_id: string | null
  group_name: string | null
}

interface GrantRow {
  key: string
  scope: string
}

/** Loads the full authorization context for a user from the database. */
export function loadAuthUser(userId: string): AuthUser | null {
  const row = one<UserRow>(
    `SELECT u.id, u.email, u.username, u.display_name, u.status, u.must_change_password, u.avatar_path,
            m.id AS member_id, m.member_no, g.id AS group_id, g.name AS group_name
       FROM users u
       LEFT JOIN members m ON m.user_id = u.id
       LEFT JOIN groups g ON g.id = m.group_id
      WHERE u.id = ?`,
    userId,
  )
  if (!row) return null

  const roles = all<{ key: string }>(
    `SELECT DISTINCT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    userId,
  ).map((r) => r.key)

  const grants = all<GrantRow>(
    `SELECT DISTINCT p.key, rp.scope
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ?`,
    userId,
  )

  const permissions: Record<string, PermissionScope[]> = {}
  for (const grant of grants) {
    const scope = grant.scope as PermissionScope
    const list = permissions[grant.key] ?? []
    if (!list.includes(scope)) list.push(scope)
    permissions[grant.key] = list
  }

  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    status: row.status,
    mustChangePassword: row.must_change_password === 1,
    avatarPath: row.avatar_path,
    memberId: row.member_id,
    memberNo: row.member_no,
    groupId: row.group_id,
    groupName: row.group_name,
    roles,
    permissions,
  }
}

/**
 * Returns true when the user holds `key` at `scope`.
 * Omitting scope asks only "does the user hold this permission at all?".
 * A `global` grant satisfies every scope; an `own` grant satisfies only own-record checks.
 */
export function can(user: AuthUser | null | undefined, key: string, scope?: PermissionScope): boolean {
  if (!user) return false
  const granted = user.permissions[key]
  if (!granted || granted.length === 0) return false
  if (!scope) return true
  if (granted.includes("global")) return true
  return granted.includes(scope)
}

/** True when the user may act on a specific member record, honouring group scoping and own-record access. */
export function canActOnMember(user: AuthUser, key: string, member: { id: string; group_id: string } | null | undefined): boolean {
  if (!member) return can(user, key, "global")
  if (can(user, key, "global")) return true
  if (can(user, key, member.group_id as PermissionScope)) return true
  return can(user, key, "own") && user.memberId === member.id
}

export const GROUP_KEY_BY_ID: Record<string, PermissionScope> = {
  grp_senior: "senior",
  grp_junior: "junior",
  grp_members: "members",
}

export function groupScope(groupId: string | null | undefined): PermissionScope | undefined {
  if (!groupId) return undefined
  return GROUP_KEY_BY_ID[groupId]
}
