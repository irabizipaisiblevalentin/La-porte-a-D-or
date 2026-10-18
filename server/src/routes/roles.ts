import { Router } from "express"
import { PERMISSIONS } from "../auth/permissions.js"
import { all } from "../db/index.js"
import { requireAuth } from "../middleware/auth.js"

export const rolesRouter: Router = Router()

interface RoleRow {
  id: string
  key: string
  name: string
  description: string
}

interface GrantRow {
  key: string
  scope: string
}

const ROLE_ORDER = `CASE r.key
  WHEN 'chairman' THEN 1
  WHEN 'senior_leader' THEN 2
  WHEN 'junior_admin' THEN 3
  WHEN 'members_admin' THEN 4
  WHEN 'senior_singer' THEN 5
  WHEN 'junior_singer' THEN 6
  WHEN 'support_member' THEN 7
  ELSE 99
END`

/**
 * The roles and permissions catalogue. Roles are system-managed and read-only,
 * so this endpoint only reports what the reference seed grants.
 */
rolesRouter.get("/", requireAuth, (_req, res) => {
  const roles = all<RoleRow>(
    `SELECT r.id, r.key, r.name, r.description FROM roles r ORDER BY ${ROLE_ORDER}, r.name COLLATE NOCASE`,
  ).map((role) => ({
    key: role.key,
    name: role.name,
    description: role.description,
    grants: all<GrantRow>(
      `SELECT p.key AS key, rp.scope AS scope
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ?
        ORDER BY p.key, rp.scope`,
      role.id,
    ).map((grant) => ({ key: grant.key, scope: grant.scope })),
  }))

  const permissions = PERMISSIONS.map((permission) => ({
    key: permission.key,
    name: permission.name,
    description: permission.description,
    scopes: permission.scopes,
  }))

  res.json({ roles, permissions })
})
