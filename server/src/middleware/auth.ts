import type { NextFunction, Request, Response } from "express"
import { can, groupScope, loadAuthUser, type AuthUser } from "../auth/access.js"
import type { PermissionScope } from "../auth/permissions.js"
import { rawSessionToken, resolveSession } from "../auth/session.js"
import { forbidden, unauthorized } from "../lib/errors.js"

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthUser
    }
  }
}

/** Resolves the session cookie into `req.auth` when present. Never rejects. */
export function attachAuth(req: Request, _res: Response, next: NextFunction): void {
  const session = resolveSession(rawSessionToken(req))
  if (session) {
    const user = loadAuthUser(session.user_id)
    if (user && user.status === "active") req.auth = user
  }
  next()
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(unauthorized())
  if (req.auth.mustChangePassword && !isSessionRoute(req)) {
    return next(forbidden("You must set a new password before continuing."))
  }
  next()
}

/**
 * Routes that stay open while a temporary password is in use: the `/api/auth`
 * router, whose `POST /password` is the only thing that can clear the flag.
 *
 * The full path is rebuilt from `baseUrl + path` because Express strips the mount
 * point inside a mounted router: there, `req.path` is just "/password", so the
 * earlier check against "/api/auth/password" never matched. The member was then
 * refused the one route that would let them in — and stayed locked out of the
 * whole platform for good.
 */
function isSessionRoute(req: Request): boolean {
  const full = `${req.baseUrl}${req.path}`
  return full === "/api/auth" || full.startsWith("/api/auth/")
}

/** Requires a permission at a fixed scope. */
export function requirePermission(key: string, scope?: PermissionScope) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized())
    if (!can(req.auth, key, scope)) return next(forbidden())
    next()
  }
}

export function requireAnyPermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized())
    if (!keys.some((key) => can(req.auth, key))) return next(forbidden())
    next()
  }
}

export function requireRole(...roleKeys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized())
    if (!req.auth.roles.some((role) => roleKeys.includes(role))) return next(forbidden())
    next()
  }
}

/**
 * Asserts that a user holds `key` for a specific group, or at global scope.
 * Used by route handlers once the target group is known (body/params/lookup).
 */
export function assertGroupAccess(user: AuthUser, key: string, groupId: string | null | undefined): void {
  if (can(user, key, "global")) return
  const scope = groupScope(groupId)
  if (scope && can(user, key, scope)) return
  throw forbidden()
}

/** Groups a user may act on for a given permission, for building filtered queries. */
export function permittedGroupIds(user: AuthUser, key: string): string[] | "all" {
  if (can(user, key, "global")) return "all"
  const ids: string[] = []
  if (can(user, key, "senior")) ids.push("grp_senior")
  if (can(user, key, "junior")) ids.push("grp_junior")
  if (can(user, key, "members")) ids.push("grp_members")
  return ids
}
