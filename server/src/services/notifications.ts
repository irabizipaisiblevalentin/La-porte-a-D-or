import { all, db, run } from "../db/index.js"
import { id } from "../lib/security.js"
import { nowIso } from "../lib/time.js"

export interface NotifyInput {
  userId: string
  type: string
  title: string
  body?: string | null
  link?: string | null
}

export function notify(input: NotifyInput): void {
  run(
    `INSERT INTO notifications (id, user_id, type, title, body, link, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    id(), input.userId, input.type, input.title, input.body ?? null, input.link ?? null, nowIso(),
  )
}

export function notifyMany(inputs: NotifyInput[]): void {
  if (inputs.length === 0) return
  const statement = db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, link, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
  const timestamp = nowIso()
  db.transaction(() => {
    for (const input of inputs) {
      statement.run(id(), input.userId, input.type, input.title, input.body ?? null, input.link ?? null, timestamp)
    }
  })()
}

/** Resolves the user IDs targeted by an audience selector, honouring group membership. */
export function audienceUserIds(audience: string): string[] {
  if (audience === "all") {
    return all<{ id: string }>("SELECT id FROM users WHERE status = 'active'").map((r) => r.id)
  }
  if (audience === "selected") return []
  const rows = all<{ id: string }>(
    `SELECT u.id
       FROM users u
       JOIN members m ON m.user_id = u.id
       JOIN groups g ON g.id = m.group_id
      WHERE g.key = ? AND u.status = 'active'`,
    audience,
  )
  return rows.map((r) => r.id)
}

export function unreadCount(userId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL").get(userId) as { c: number }
  return row.c
}

/** Role key of the administrator who reviews a given group's applications. */
function adminRoleForGroup(groupId: string | null | undefined): string | null {
  if (groupId === "grp_senior") return "senior_leader"
  if (groupId === "grp_junior") return "junior_admin"
  if (groupId === "grp_members") return "members_admin"
  return null
}

/**
 * Active administrators who should hear about an event in `groupId`: the Chairman
 * (who oversees all three groups) plus the group's own administrator, if any.
 * De-duplicated, so the Chairman is never notified twice.
 */
export function adminUserIdsForGroup(groupId: string | null | undefined): string[] {
  const ids = new Set<string>()
  const chairman = all<{ id: string }>(
    `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.key = 'chairman' AND u.status = 'active'`,
  )
  for (const row of chairman) ids.add(row.id)

  const roleKey = adminRoleForGroup(groupId)
  if (roleKey) {
    const groupAdmins = all<{ id: string }>(
      `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
        WHERE r.key = ? AND u.status = 'active'`,
      roleKey,
    )
    for (const row of groupAdmins) ids.add(row.id)
  }
  return [...ids]
}
