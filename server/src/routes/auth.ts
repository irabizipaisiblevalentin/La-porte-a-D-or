import { Router } from "express"
import { z } from "zod"
import { loadAuthUser } from "../auth/access.js"
import {
  clearSessionCookie,
  createSession,
  rawSessionToken,
  revokeAllSessions,
  revokeSession,
  setSessionCookie,
} from "../auth/session.js"
import { config } from "../config.js"
import { one, run, transaction } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, forbidden, unauthorized } from "../lib/errors.js"
import { parse } from "../lib/http.js"
import { hashPassword, hashToken, id, token, validatePasswordStrength, verifyPassword } from "../lib/security.js"
import { isoPlusMs, isExpired, nowIso } from "../lib/time.js"
import { authRateLimit } from "../middleware/rate-limit.js"
import { requireAuth } from "../middleware/auth.js"
import { hashAndRemember } from "../services/credentials.js"
import { emailDeliveryConfigured } from "../services/email.js"
import { notifyMany } from "../services/notifications.js"
import { isPlaceholderEmail, normalizeUsername } from "../services/usernames.js"

export const authRouter: Router = Router()

interface UserAuthRow {
  id: string
  email: string
  email_normalized: string
  username: string | null
  username_normalized: string | null
  password_hash: string | null
  display_name: string
  status: string
  must_change_password: number
  failed_login_count: number
  locked_until: string | null
}

authRouter.post("/login", authRateLimit(), (req, res) => {
  // `identifier` may be an email address OR a username (for members who applied
  // without an email). `email` is still accepted for older clients.
  const input = parse(z.object({
    identifier: z.string().trim().min(1).optional(),
    email: z.string().trim().min(1).optional(),
    password: z.string().min(1, "Enter your password."),
  }).refine((value) => Boolean(value.identifier || value.email), {
    message: "Enter your email address or username.",
    path: ["identifier"],
  }), req.body)

  const rawIdentifier = (input.identifier ?? input.email ?? "").trim()
  const user = one<UserAuthRow>(
    `SELECT * FROM users
      WHERE email_normalized = ?
         OR (username_normalized IS NOT NULL AND username_normalized = ?)
      LIMIT 1`,
    rawIdentifier.toLowerCase(), normalizeUsername(rawIdentifier),
  )

  if (!user) throw unauthorized("Email/username or password is incorrect.")
  if (user.locked_until && !isExpired(user.locked_until)) {
    throw forbidden("This account is temporarily locked after too many failed attempts. Try again shortly.")
  }
  if (user.status !== "active") {
    throw forbidden("This account is not active. Contact a choir administrator.")
  }
  if (!verifyPassword(input.password, user.password_hash)) {
    registerFailedLogin(user)
    throw unauthorized("Email/username or password is incorrect.")
  }
  if (user.locked_until && !isExpired(user.locked_until)) {
    throw forbidden("This account is temporarily locked after too many failed attempts. Try again shortly.")
  }
  if (user.status !== "active") {
    throw forbidden("This account is not active. Contact a choir administrator.")
  }
  if (!verifyPassword(input.password, user.password_hash)) {
    registerFailedLogin(user)
    throw unauthorized("Email or password is incorrect.")
  }

  run("UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?",
    nowIso(), nowIso(), user.id)
  const session = createSession(user.id, { ip: req.ip, userAgent: req.get("user-agent") ?? undefined })
  setSessionCookie(res, session.rawToken, session.expiresAt)
  recordAudit({
    actorId: user.id,
    actorName: user.display_name,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    summary: `${user.email} signed in`,
    ip: req.ip,
  })
  res.json({ user: loadAuthUser(user.id) })
})

function registerFailedLogin(user: UserAuthRow): void {
  const attempts = user.failed_login_count + 1
  const lockedUntil = attempts >= config.security.maxFailedLogins ? isoPlusMs(config.security.lockoutMs) : null
  run("UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?",
    attempts, lockedUntil, nowIso(), user.id)
}

authRouter.post("/logout", (req, res) => {
  revokeSession(rawSessionToken(req))
  clearSessionCookie(res)
  res.json({ ok: true })
})

authRouter.get("/me", (req, res) => {
  if (!req.auth) {
    res.json({ user: null })
    return
  }
  res.json({ user: req.auth })
})

authRouter.post("/password", requireAuth, (req, res) => {
  const input = parse(z.object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z.string().min(1, "Choose a new password."),
  }), req.body)

  const user = one<UserAuthRow>("SELECT * FROM users WHERE id = ?", req.auth!.id)
  if (!user || !verifyPassword(input.currentPassword, user.password_hash)) {
    throw badRequest("Your current password is incorrect.", { fields: { currentPassword: "Incorrect password." } })
  }
  const strength = validatePasswordStrength(input.newPassword)
  if (!strength.ok) throw badRequest("Choose a stronger password.", { fields: { newPassword: strength.errors.join(" ") } })

  const stored = hashAndRemember(input.newPassword)
  run("UPDATE users SET password_hash = ?, password_enc = ?, must_change_password = 0, updated_at = ? WHERE id = ?",
    stored.hash, stored.enc, nowIso(), user.id)
  recordAudit({
    actorId: user.id,
    actorName: user.display_name,
    action: "auth.password_change",
    entityType: "user",
    entityId: user.id,
    summary: "Password changed by user",
    ip: req.ip,
  })
  res.json({ ok: true })
})

authRouter.post("/password/request", authRateLimit(), (req, res) => {
  const input = parse(z.object({ email: z.string().trim().min(1, "Enter your email address.") }), req.body)
  const user = one<UserAuthRow>("SELECT * FROM users WHERE email_normalized = ?", input.email.toLowerCase())

  // Always answer identically so the endpoint cannot be used to enumerate accounts.
  const genericResponse = {
    ok: true,
    message: "If an account exists for that address, a reset link has been recorded.",
    emailDeliveryConfigured: emailDeliveryConfigured(),
  }

  if (!user || user.status !== "active") {
    res.json(genericResponse)
    return
  }

  const raw = token(32)
  transaction(() => {
    run("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL", user.id)
    run("INSERT INTO password_resets (id, user_id, token_hash, requested_ip, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
      id(), user.id, hashToken(raw), req.ip ?? null, isoPlusMs(60 * 60 * 1000), nowIso())
  })

  // Without an email provider the reset link is surfaced to administrators instead of being emailed.
  const admins = one<{ ids: string }>(
    `SELECT GROUP_CONCAT(ur.user_id) AS ids FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'chairman'`,
  )
  const adminIds = (admins?.ids ?? "").split(",").filter(Boolean)
  if (adminIds.length > 0) {
    notifyMany(adminIds.map((adminId) => ({
      userId: adminId,
      type: "password_reset_request",
      title: "Password reset requested",
      body: `${user.email} requested a password reset. Email delivery is not configured, so deliver the reset link manually from Administration → Accounts.`,
      link: "/admin/accounts",
    })))
  }

  recordAudit({
    actorId: null,
    actorName: user.email,
    action: "auth.password_reset_request",
    entityType: "user",
    entityId: user.id,
    summary: `Password reset requested for ${user.email}`,
    ip: req.ip,
  })

  res.json(genericResponse)
})

authRouter.post("/password/reset", authRateLimit(), (req, res) => {
  const input = parse(z.object({
    token: z.string().min(8, "The reset link is invalid."),
    password: z.string().min(1, "Choose a new password."),
  }), req.body)

  const reset = one<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    "SELECT * FROM password_resets WHERE token_hash = ?", hashToken(input.token),
  )
  if (!reset || reset.used_at || isExpired(reset.expires_at)) {
    throw badRequest("This reset link is invalid or has expired. Request a new one.")
  }
  const strength = validatePasswordStrength(input.password)
  if (!strength.ok) throw badRequest("Choose a stronger password.", { fields: { password: strength.errors.join(" ") } })

  transaction(() => {
    const stored = hashAndRemember(input.password)
    run("UPDATE users SET password_hash = ?, password_enc = ?, must_change_password = 0, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
      stored.hash, stored.enc, nowIso(), reset.user_id)
    run("UPDATE password_resets SET used_at = ? WHERE id = ?", nowIso(), reset.id)
  })
  revokeAllSessions(reset.user_id)
  recordAudit({
    action: "auth.password_reset",
    entityType: "user",
    entityId: reset.user_id,
    summary: "Password reset completed",
    ip: req.ip,
  })
  res.json({ ok: true })
})

authRouter.get("/invitation/:token", (req, res) => {
  const invitation = loadInvitation(String(req.params.token))
  if (!invitation) throw badRequest("This invitation link is invalid or has expired.")
  // A name-only account carries a placeholder email; the invite screen shows the
  // username instead, since that is what the applicant signs in with.
  const hasEmail = !isPlaceholderEmail(invitation.email)
  res.json({
    invitation: {
      email: hasEmail ? invitation.email : null,
      username: invitation.username,
      fullName: invitation.display_name,
      hasEmail,
    },
  })
})

authRouter.post("/invitation/:token", authRateLimit(), (req, res) => {
  const invitation = loadInvitation(String(req.params.token))
  if (!invitation) throw badRequest("This invitation link is invalid or has expired.")
  const input = parse(z.object({ password: z.string().min(1, "Choose a password.") }), req.body)
  const strength = validatePasswordStrength(input.password)
  if (!strength.ok) throw badRequest("Choose a stronger password.", { fields: { password: strength.errors.join(" ") } })

  transaction(() => {
    const stored = hashAndRemember(input.password)
    run("UPDATE users SET password_hash = ?, password_enc = ?, status = 'active', must_change_password = 0, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
      stored.hash, stored.enc, nowIso(), invitation.user_id)
    run("UPDATE account_invitations SET used_at = ? WHERE id = ?", nowIso(), invitation.id)
  })
  recordAudit({
    action: "user.activate",
    entityType: "user",
    entityId: invitation.user_id,
    summary: `Invitation accepted for ${invitation.email}`,
    ip: req.ip,
  })
  const session = createSession(invitation.user_id, { ip: req.ip, userAgent: req.get("user-agent") ?? undefined })
  setSessionCookie(res, session.rawToken, session.expiresAt)
  res.json({ user: loadAuthUser(invitation.user_id) })
})

interface InvitationRow {
  id: string
  user_id: string
  email: string
  username: string | null
  display_name: string
  expires_at: string
  used_at: string | null
}

function loadInvitation(rawToken: string): InvitationRow | null {
  const row = one<InvitationRow>(
    `SELECT ai.id, ai.user_id, ai.email, u.username, u.display_name, ai.expires_at, ai.used_at
       FROM account_invitations ai JOIN users u ON u.id = ai.user_id
      WHERE ai.token_hash = ?`,
    hashToken(rawToken),
  )
  if (!row || row.used_at || isExpired(row.expires_at)) return null
  return row
}
