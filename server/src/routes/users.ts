import { Router } from "express"
import { z } from "zod"
import { ASSIGNABLE_ROLE_KEYS } from "../auth/permissions.js"
import { revokeAllSessions } from "../auth/session.js"
import { config } from "../config.js"
import { all, one, run, transaction } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, conflict, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryString } from "../lib/http.js"
import { hashToken, id, token } from "../lib/security.js"
import { isoPlusMs, nowIso } from "../lib/time.js"
import { requireAuth, requirePermission } from "../middleware/auth.js"

export const usersRouter: Router = Router()

const roleKeysSchema = z.enum(ASSIGNABLE_ROLE_KEYS as [string, ...string[]])

interface UserListRow {
  id: string
  email: string
  display_name: string
  status: string
  must_change_password: number
  avatar_path: string | null
  last_login_at: string | null
  created_at: string
  updated_at: string
  deactivated_at: string | null
  member_id: string | null
  member_no: string | null
  member_full_name: string | null
  member_group_id: string | null
  member_group_key: string | null
}

interface UserTargetRow {
  id: string
  email: string
  display_name: string
  status: string
}

const USER_SELECT = `SELECT u.id, u.email, u.display_name, u.status, u.must_change_password, u.avatar_path,
                            u.last_login_at, u.created_at, u.updated_at, u.deactivated_at,
                            m.id AS member_id, m.member_no AS member_no, m.full_name AS member_full_name,
                            m.group_id AS member_group_id, g.key AS member_group_key
                       FROM users u
                       LEFT JOIN members m ON m.user_id = u.id
                       LEFT JOIN groups g ON g.id = m.group_id`

function rolesByUserId(userIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (userIds.length === 0) return map
  const rows = all<{ user_id: string; key: string }>(
    `SELECT ur.user_id AS user_id, r.key AS key
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id IN (${userIds.map(() => "?").join(",")})
      ORDER BY r.key`,
    ...userIds,
  )
  for (const row of rows) {
    const list = map.get(row.user_id) ?? []
    list.push(row.key)
    map.set(row.user_id, list)
  }
  return map
}

function toUserDto(row: UserListRow, roleKeys: string[]) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    mustChangePassword: row.must_change_password === 1,
    avatarPath: row.avatar_path,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deactivatedAt: row.deactivated_at,
    roles: roleKeys,
    member: row.member_id
      ? {
          id: row.member_id,
          memberNo: row.member_no,
          fullName: row.member_full_name,
          groupId: row.member_group_id,
          groupKey: row.member_group_key,
        }
      : null,
  }
}

function loadUserDto(userId: string) {
  const row = one<UserListRow>(`${USER_SELECT} WHERE u.id = ?`, userId)
  if (!row) return null
  return toUserDto(row, rolesByUserId([userId]).get(userId) ?? [])
}

function requireUser(userId: string): UserTargetRow {
  const row = one<UserTargetRow>("SELECT id, email, display_name, status FROM users WHERE id = ?", userId)
  if (!row) throw notFound("That account does not exist.")
  return row
}

function isChairman(userId: string): boolean {
  return Boolean(one<{ x: number }>(
    `SELECT 1 AS x
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.key = 'chairman'`,
    userId,
  ))
}

function countActiveChairmenExcluding(userId: string): number {
  return one<{ c: number }>(
    `SELECT COUNT(*) AS c
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN users u ON u.id = ur.user_id
      WHERE r.key = 'chairman' AND u.status = 'active' AND ur.user_id != ?`,
    userId,
  )?.c ?? 0
}

function assignRoles(userId: string, roleKeys: string[], grantedBy: string, timestamp: string): void {
  for (const key of roleKeys) {
    const role = one<{ id: string }>("SELECT id FROM roles WHERE key = ?", key)
    if (!role) throw badRequest(`Unknown role: ${key}.`)
    run(
      "INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)",
      userId, role.id, grantedBy, timestamp,
    )
  }
}

usersRouter.get("/", requireAuth, requirePermission("users.manage"), (req, res) => {
  const p = pagination(req)
  const statusFilter = queryString(req, "status")
  const roleFilter = queryString(req, "role")
  const search = queryString(req, "search")

  const clauses: string[] = []
  const params: string[] = []
  if (statusFilter) {
    clauses.push("u.status = ?")
    params.push(statusFilter)
  }
  if (roleFilter) {
    clauses.push("EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key = ?)")
    params.push(roleFilter)
  }
  if (search) {
    clauses.push("(u.email LIKE ? OR u.display_name LIKE ?)")
    params.push(`%${search}%`, `%${search}%`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM users u ${where}`, ...params)?.c ?? 0
  const rows = all<UserListRow>(
    `${USER_SELECT} ${where} ORDER BY u.display_name COLLATE NOCASE LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  )
  const roleMap = rolesByUserId(rows.map((row) => row.id))
  const items = rows.map((row) => toUserDto(row, roleMap.get(row.id) ?? []))
  res.json(makePage(items, total, p))
})

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(200),
  displayName: z.string().trim().min(2, "Enter the person's name.").max(160),
  roles: z.array(roleKeysSchema).min(1, "Choose at least one role."),
  memberId: z.string().trim().min(1).nullable().optional(),
})

usersRouter.post("/invite", requireAuth, requirePermission("users.manage"), (req, res) => {
  const input = parse(inviteSchema, req.body)
  const email = input.email.trim()
  const emailNormalized = email.toLowerCase()

  const existing = one<{ id: string }>("SELECT id FROM users WHERE email_normalized = ?", emailNormalized)
  if (existing) throw conflict("An account with that email address already exists.")

  let member: { id: string; full_name: string } | undefined
  if (input.memberId) {
    const found = one<{ id: string; full_name: string; user_id: string | null }>(
      "SELECT id, full_name, user_id FROM members WHERE id = ?",
      input.memberId,
    )
    if (!found) throw badRequest("The selected member does not exist.", { fields: { memberId: "Member not found." } })
    if (found.user_id) throw conflict("That member is already linked to a user account.")
    member = { id: found.id, full_name: found.full_name }
  }

  const userId = id()
  const rawToken = token(32)
  const expiresAt = isoPlusMs(config.security.invitationTtlMs)
  const timestamp = nowIso()
  const roleKeys = [...new Set(input.roles)]

  transaction(() => {
    run(
      `INSERT INTO users (id, email, email_normalized, password_hash, display_name, status, must_change_password,
                          failed_login_count, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, 'invited', 0, 0, ?, ?)`,
      userId, email, emailNormalized, input.displayName.trim(), timestamp, timestamp,
    )
    assignRoles(userId, roleKeys, req.auth!.id, timestamp)
    if (member) {
      run("UPDATE members SET user_id = ?, updated_at = ? WHERE id = ?", userId, timestamp, member.id)
    }
    run(
      `INSERT INTO account_invitations (id, user_id, email, token_hash, invited_by, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      id(), userId, email, hashToken(rawToken), req.auth!.id, expiresAt, timestamp,
    )
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "user.invite", entityType: "user", entityId: userId,
    summary: `Invitation sent to ${email}${member ? ` linked to member ${member.full_name}` : ""}`,
    detail: { roles: roleKeys, memberId: member?.id ?? null },
    ip: req.ip,
  })

  res.status(201).json({
    user: loadUserDto(userId),
    invitation: { url: `/invite/${rawToken}`, expiresAt },
  })
})

const rolesSchema = z.object({
  roles: z.array(roleKeysSchema),
})

usersRouter.post("/:id/roles", requireAuth, requirePermission("roles.manage"), (req, res) => {
  const userId = String(req.params.id)
  const target = requireUser(userId)
  const input = parse(rolesSchema, req.body)
  const nextRoles = [...new Set(input.roles)]

  const currentRoles = rolesByUserId([userId]).get(userId) ?? []
  const removesChairman = currentRoles.includes("chairman") && !nextRoles.includes("chairman")
  if (removesChairman && countActiveChairmenExcluding(userId) === 0) {
    // Count every other chairman, active or not: removing the last one is never allowed.
    const otherChairmen = one<{ c: number }>(
      `SELECT COUNT(*) AS c
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE r.key = 'chairman' AND ur.user_id != ?`,
      userId,
    )?.c ?? 0
    if (otherChairmen === 0) throw conflict("The Chairman must keep this role. There must always be a Chairman.")
  }

  const timestamp = nowIso()
  transaction(() => {
    run("DELETE FROM user_roles WHERE user_id = ?", userId)
    assignRoles(userId, nextRoles, req.auth!.id, timestamp)
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "user.roles_update", entityType: "user", entityId: userId,
    summary: `Roles for ${target.email} changed`,
    detail: { before: currentRoles, after: nextRoles },
    ip: req.ip,
  })

  res.json({ user: loadUserDto(userId) })
})

usersRouter.post("/:id/deactivate", requireAuth, requirePermission("users.manage"), (req, res) => {
  const userId = String(req.params.id)
  const target = requireUser(userId)

  if (target.status === "active" && isChairman(userId) && countActiveChairmenExcluding(userId) === 0) {
    throw conflict("You cannot deactivate the last active Chairman.")
  }

  const timestamp = nowIso()
  transaction(() => {
    run("UPDATE users SET status = 'inactive', deactivated_at = ?, updated_at = ? WHERE id = ?", timestamp, timestamp, userId)
    revokeAllSessions(userId)
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "user.deactivate", entityType: "user", entityId: userId,
    summary: `Account ${target.email} deactivated`, ip: req.ip,
  })

  res.json({ user: loadUserDto(userId) })
})

usersRouter.post("/:id/activate", requireAuth, requirePermission("users.manage"), (req, res) => {
  const userId = String(req.params.id)
  const target = requireUser(userId)
  const timestamp = nowIso()

  run(
    `UPDATE users SET status = 'active', deactivated_at = NULL, failed_login_count = 0, locked_until = NULL, updated_at = ?
      WHERE id = ?`,
    timestamp, userId,
  )

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "user.activate", entityType: "user", entityId: userId,
    summary: `Account ${target.email} activated`, ip: req.ip,
  })

  res.json({ user: loadUserDto(userId) })
})

usersRouter.post("/:id/reset", requireAuth, requirePermission("users.manage"), (req, res) => {
  const userId = String(req.params.id)
  const target = requireUser(userId)

  const rawToken = token(32)
  const expiresAt = isoPlusMs(60 * 60 * 1000)
  const timestamp = nowIso()

  transaction(() => {
    run("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL", userId)
    run(
      `INSERT INTO password_resets (id, user_id, token_hash, requested_ip, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      id(), userId, hashToken(rawToken), req.ip ?? null, expiresAt, timestamp,
    )
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "user.password_reset_issued", entityType: "user", entityId: userId,
    summary: `Password reset link issued for ${target.email}`, ip: req.ip,
  })

  // The link is surfaced to the administrator because email delivery may not be configured.
  res.json({ resetUrl: `/reset-password?token=${rawToken}`, expiresAt })
})
