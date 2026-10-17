import type { PermissionScope, SessionUser } from "./AuthProvider"

/**
 * Maps a group key (as stored on `groups.key`) to the permission scope used to
 * authorise actions against that group. Mirrors the server's `GROUP_KEY_BY_ID`.
 */
export const GROUP_SCOPE_BY_KEY: Record<string, PermissionScope> = {
  senior: "senior",
  junior: "junior",
  members: "members",
}

export function groupScope(groupKey: string | null | undefined): PermissionScope | undefined {
  if (!groupKey) return undefined
  return GROUP_SCOPE_BY_KEY[groupKey]
}

type CanFn = (permission: string, scope?: PermissionScope) => boolean

/**
 * Filters a list of groups down to those a user may read/act on for `permission`.
 * A `global` grant (Chairman) keeps every group; scoped admins keep only theirs.
 */
export function permittedGroups<T extends { key: string }>(
  groups: T[],
  can: CanFn,
  permission: string,
): T[] {
  return groups.filter((group) => can(permission, groupScope(group.key)))
}

/** True when the user may act on the given group key for `permission`. */
export function canActOnGroup(can: CanFn, permission: string, groupKey: string | null | undefined): boolean {
  return can(permission, groupScope(groupKey))
}

/** Convenience: does this user hold `permission` at global scope? */
export function hasGlobal(user: SessionUser | null, permission: string): boolean {
  return Boolean(user?.permissions[permission]?.includes("global"))
}
