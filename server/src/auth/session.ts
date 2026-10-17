import type { Request, Response } from "express"
import { config } from "../config.js"
import { db, one, run } from "../db/index.js"
import { hashToken, id, token } from "../lib/security.js"
import { isoPlusMs, nowIso } from "../lib/time.js"

export interface SessionRow {
  id: string
  user_id: string
  expires_at: string
  revoked_at: string | null
  last_seen_at: string | null
}

export interface CreatedSession {
  rawToken: string
  expiresAt: string
}

export function createSession(userId: string, meta: { ip?: string; userAgent?: string } = {}): CreatedSession {
  const rawToken = token(32)
  const sessionId = hashToken(rawToken)
  const expiresAt = isoPlusMs(config.session.ttlMs)
  run(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    sessionId, userId, nowIso(), expiresAt, nowIso(), meta.ip ?? null, meta.userAgent ?? null,
  )
  return { rawToken, expiresAt }
}

/** Resolves a raw cookie token to a live session row, enforcing expiry and revocation. */
export function resolveSession(rawToken: string | undefined): SessionRow | null {
  if (!rawToken) return null
  const row = one<SessionRow>("SELECT * FROM sessions WHERE id = ?", hashToken(rawToken))
  if (!row) return null
  if (row.revoked_at) return null
  if (Date.parse(row.expires_at) <= Date.now()) return null
  // Rolling expiry, refreshed at most once a minute to avoid a write per request.
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 60_000) {
    const expiresAt = isoPlusMs(config.session.ttlMs)
    run("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", nowIso(), expiresAt, row.id)
    row.expires_at = expiresAt
  }
  return row
}

export function revokeSession(rawToken: string | undefined): void {
  if (!rawToken) return
  run("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", nowIso(), hashToken(rawToken))
}

export function revokeAllSessions(userId: string): void {
  run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", nowIso(), userId)
}

export function purgeExpiredSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowIso())
}

export function setSessionCookie(res: Response, rawToken: string, expiresAt: string): void {
  res.cookie(config.session.cookieName, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.session.secure,
    path: "/",
    expires: new Date(expiresAt),
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.session.cookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.session.secure,
    path: "/",
  })
}

export function rawSessionToken(req: Request): string | undefined {
  const value = req.cookies?.[config.session.cookieName]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Removes expired sessions; called from the scheduled maintenance tick. */
export function sessionMaintenance(): void {
  purgeExpiredSessions()
}

export function newSessionId(): string {
  return id()
}
