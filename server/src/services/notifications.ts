import { all, db, run } from "../db/index.js"
import { id } from "../lib/security.js"
import { nowIso } from "../lib/time.js"
import { sendInBackground, type PushPayload } from "./push.js"

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
  pushToDevices([input])
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
  pushToDevices(inputs)
}

/**
 * Mirrors notifications onto the recipients' own devices, so an administrator
 * hears about a new application while the site is closed rather than when he
 * next opens it. Identical messages are grouped, so one application to two
 * administrators is one push each — not one push per row.
 *
 * Delivery happens in the background: the notification is already stored, and a
 * slow or unreachable push service must never delay the request that caused it.
 */
function pushToDevices(inputs: NotifyInput[]): void {
  const groups = new Map<string, { payload: PushPayload; userIds: string[] }>()
  for (const input of inputs) {
    const key = [input.title, input.body ?? "", input.link ?? ""].join("\u0000")
    const group = groups.get(key) ?? {
      payload: { title: input.title, body: input.body ?? null, link: input.link ?? null },
      userIds: [],
    }
    group.userIds.push(input.userId)
    groups.set(key, group)
  }
  for (const group of groups.values()) sendInBackground(group.userIds, group.payload)
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
 * Active administrator(s) who own a group's applications: that group's own
 * administrator, and nobody else. The Chairman is deliberately NOT included —
 * he oversees every group from his dashboard, while each group's administrator
 * handles (and decides) that group's requests. Returns [] when the group is
 * unknown or has no active administrator.
 */
export function groupAdminUserIds(groupId: string | null | undefined): string[] {
  const roleKey = adminRoleForGroup(groupId)
  if (!roleKey) return []
  return all<{ id: string }>(
    `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.key = ? AND u.status = 'active'`,
    roleKey,
  ).map((row) => row.id)
}
