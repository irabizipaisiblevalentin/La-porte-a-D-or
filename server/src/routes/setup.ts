import fs from "node:fs"
import path from "node:path"
import { Router } from "express"
import { z } from "zod"
import { ADMIN_ROLE_KEYS } from "../auth/permissions.js"
import { loadAuthUser } from "../auth/access.js"
import { createSession, setSessionCookie } from "../auth/session.js"
import { config, dataDir } from "../config.js"
import { one, run } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { forbidden, conflict } from "../lib/errors.js"
import { parse } from "../lib/http.js"
import { hashPassword, hashToken, id, token, validatePasswordStrength } from "../lib/security.js"
import { isoPlusMs, isExpired, nowIso } from "../lib/time.js"

export const setupRouter: Router = Router()

const setupTokenFile = path.join(dataDir, "FIRST-ADMIN-SETUP.txt")

/**
 * First-run detection: true while no administrator account exists.
 * The existence of an admin account is the only signal — no separate flag to drift out of sync.
 */
export function needsInitialSetup(): boolean {
  const row = one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE r.key IN (${ADMIN_ROLE_KEYS.map(() => "?").join(",")})`,
    ...ADMIN_ROLE_KEYS,
  )
  return (row?.c ?? 0) === 0
}

/**
 * Issues a one-time setup token and writes it to a 0600 file plus the console.
 * Possession of this token is what proves the caller is the deploying owner.
 */
export function issueSetupToken(): string {
  const raw = token(32)
  run(
    "INSERT INTO setup_tokens (id, token_hash, note, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
    id(), hashToken(raw), "Initial Chairman", isoPlusMs(config.security.setupTokenTtlMs), nowIso(),
  )
  fs.writeFileSync(
    setupTokenFile,
    [
      "Chorale La Porte d'Or — first administrator setup",
      "=================================================",
      "",
      "Open the application and use this one-time token to create the Chairman account:",
      "",
      raw,
      "",
      `This token expires at ${isoPlusMs(config.security.setupTokenTtlMs)} and can be used once.`,
      "Delete this file after the account has been created.",
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  console.log(`\n[setup] First-administrator token written to ${setupTokenFile}\n[setup] Token: ${raw}\n`)
  return raw
}

setupRouter.get("/status", (_req, res) => {
  res.json({
    needsSetup: needsInitialSetup(),
    setupTokenFile: needsInitialSetup() ? setupTokenFile : null,
    appName: config.appName,
  })
})

const setupSchema = z.object({
  token: z.string().min(8, "Enter the one-time setup token."),
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z.string().trim().email("Enter a valid email address.").max(200),
  password: z.string().min(1, "Choose a password."),
})

setupRouter.post("/", (req, res) => {
  if (!needsInitialSetup()) throw forbidden("Initial setup has already been completed.")
  const input = parse(setupSchema, req.body)

  const strength = validatePasswordStrength(input.password)
  if (!strength.ok) throw conflict("Choose a stronger password.", { fields: { password: strength.errors.join(" ") } })

  const setupRow = one<{ id: string; expires_at: string; used_at: string | null }>(
    "SELECT * FROM setup_tokens WHERE token_hash = ?",
    hashToken(input.token),
  )
  if (!setupRow || setupRow.used_at || isExpired(setupRow.expires_at)) {
    throw forbidden("That setup token is invalid or has expired. Restart the server to issue a new one.")
  }

  const emailNormalized = input.email.toLowerCase()
  const userId = id()
  const timestamp = nowIso()

  run(
    `INSERT INTO users (id, email, email_normalized, password_hash, display_name, status, must_change_password,
                        failed_login_count, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 0, 0, NULL, ?, ?)`,
    userId, input.email.trim(), emailNormalized, hashPassword(input.password), input.fullName.trim(), timestamp, timestamp,
  )
  run("INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) VALUES (?, 'role_chairman', NULL, ?)", userId, timestamp)
  run("UPDATE setup_tokens SET used_at = ?, used_by = ? WHERE id = ?", timestamp, userId, setupRow.id)
  try {
    fs.rmSync(setupTokenFile, { force: true })
  } catch {
    // best effort
  }

  recordAudit({
    actorId: userId,
    actorName: input.fullName.trim(),
    action: "user.create",
    entityType: "user",
    entityId: userId,
    summary: `Initial Chairman ${input.email.trim()} created`,
    ip: req.ip,
  })

  const session = createSession(userId, { ip: req.ip, userAgent: req.get("user-agent") ?? undefined })
  setSessionCookie(res, session.rawToken, session.expiresAt)
  res.status(201).json({ user: loadAuthUser(userId) })
})
