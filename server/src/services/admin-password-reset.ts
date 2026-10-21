/**
 * The one-time administrator password reset.
 *
 * WHY THIS EXISTS
 *
 * On a normal boot the seeder only ever *creates* accounts that are missing — it
 * will not touch one that already exists, because an account's password may have
 * been changed deliberately in the UI and a restart must never undo that (see
 * `seed-admins.ts`). That is the right default, but it leaves one job with no way
 * to be done: giving a password to administrators whose accounts already exist.
 *
 * This module is that way. It is deliberately narrow and deliberately one-use:
 *
 *   - It is armed only by a secret supplied in the environment
 *     (`ADMIN_PASSWORD_RESET_TOKEN`). Without that variable the endpoint does not
 *     exist at all, so nothing can trip it by accident on an ordinary deployment.
 *
 *   - It sets every configured administrator account to the password the
 *     deployment is configured to use, clears any forced-change flag, and unlocks
 *     anything locked by failed sign-ins.
 *
 *   - It records itself as done and refuses to run a second time. A one-time
 *     action that could be replayed would be a standing way into every account,
 *     which is exactly what this must never become. The record is a row in
 *     `app_settings`, so it lives in the database and survives restarts — and it
 *     replicates to durable storage, so a restart cannot re-arm it.
 *
 *   - It writes a loud audit entry naming every account it changed.
 *
 * The password itself is never returned and never logged. What is reported is who
 * was changed, so the Chairman can see the effect without the value being written
 * anywhere it could later be read.
 */
import { ADMIN_ROLE_KEYS } from "../auth/permissions.js"
import { all, one, run, transaction } from "../db/index.js"
import { ACCOUNT_ENV_PREFIX, defaultAccounts, type DefaultAccount } from "../db/default-accounts.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, forbidden } from "../lib/errors.js"
import { constantTimeEqual, hashPassword, validatePasswordStrength } from "../lib/security.js"
import { nowIso } from "../lib/time.js"

/** The `app_settings` key that records the reset as spent. */
export const RESET_SPENT_KEY = "admin.password_reset_spent_at"

/** True when the deployment has armed the reset by supplying a secret. */
export function resetIsArmed(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ADMIN_PASSWORD_RESET_TOKEN?.trim())
}

/** The secret this deployment expects, or null when the reset is not armed. */
function configuredToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.ADMIN_PASSWORD_RESET_TOKEN?.trim() || null
}

interface AccountRow {
  id: string
  email: string
  display_name: string
  status: string
}

/**
 * The administrator accounts this reset will set the password for: the five
 * configured accounts, and only those.
 *
 * It deliberately keys off the configured list rather than "everyone holding an
 * administrator role". A member who was given a role by hand is not one of the
 * choir's administrators, and silently overwriting their password — which may be
 * the only way they can sign in — would be a worse failure than the one this
 * fixes. Any such account is reported in `untouched` instead, so the caller sees
 * exactly who was left alone.
 */
function administratorAccounts(): {
  targets: { account: DefaultAccount; row: AccountRow }[]
  untouched: { email: string; roleKey: string }[]
} {
  const targets: { account: DefaultAccount; row: AccountRow }[] = []

  for (const account of defaultAccounts()) {
    const prefix = ACCOUNT_ENV_PREFIX[account.roleKey]
    if (!prefix) continue
    const row = one<AccountRow>(
      "SELECT id, email, display_name, status FROM users WHERE email_normalized = ?",
      account.email.toLowerCase(),
    )
    if (row) targets.push({ account, row })
  }

  const targetIds = new Set(targets.map((entry) => entry.row.id))
  const untouched = all<AccountRow & { role_key: string }>(
    `SELECT u.id, u.email, u.display_name, u.status, r.key AS role_key
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.key IN (${ADMIN_ROLE_KEYS.map(() => "?").join(", ")})
      ORDER BY u.email`,
    ...ADMIN_ROLE_KEYS,
  )
    .filter((row) => !targetIds.has(row.id))
    .map((row) => ({ email: row.email, roleKey: row.role_key }))

  return { targets, untouched }
}

export interface ResetOutcome {
  changed: { email: string; displayName: string; roleKey: string }[]
  /** Administrator-role holders that were deliberately left alone, with why. */
  untouched: { email: string; roleKey: string }[]
  spentAt: string
}

/** When the reset was spent, or null if it has not been. */
export function resetSpentAt(): string | null {
  const row = one<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", RESET_SPENT_KEY)
  return row?.value ?? null
}

/**
 * Applies the configured administrator password to every administrator account.
 *
 * Throws rather than returning a soft failure: this is an all-or-nothing change to
 * every account that runs the choir, and a half-applied one would leave people
 * locked out of a system they could not get back into.
 */
export function resetAdministratorPasswords(options: {
  token: string | null
  actorId: string | null
  actorName: string | null
  ip?: string | null
  env?: NodeJS.ProcessEnv
}): ResetOutcome {
  const env = options.env ?? process.env

  if (!resetIsArmed(env)) {
    throw forbidden("This deployment has no administrator password reset enabled.")
  }

  // Constant-time so the comparison cannot be used as an oracle to guess the
  // secret one character at a time.
  if (!options.token || !constantTimeEqual(options.token, configuredToken(env)!)) {
    throw forbidden("The reset token is not correct.")
  }

  if (resetSpentAt()) {
    throw badRequest("The administrator password reset has already been used. It only runs once.")
  }

  const password = env.ADMIN_PASSWORD_RESET_PASSWORD?.trim() || env.DEFAULT_ADMIN_PASSWORD?.trim()
  if (!password) {
    throw badRequest("No password is configured to set. Supply ADMIN_PASSWORD_RESET_PASSWORD.")
  }
  const strength = validatePasswordStrength(password)
  if (!strength.ok) {
    throw badRequest(`The configured password is not strong enough: ${strength.errors.join(" ")}`)
  }

  const { targets, untouched } = administratorAccounts()
  if (targets.length === 0) throw badRequest("No administrator accounts were found to update.")

  const timestamp = nowIso()
  const passwordHash = hashPassword(password)

  transaction(() => {
    for (const { row } of targets) {
      run(
        `UPDATE users
            SET password_hash = ?, status = 'active', must_change_password = 0,
                failed_login_count = 0, locked_until = NULL, updated_at = ?
          WHERE id = ?`,
        passwordHash, timestamp, row.id,
      )
    }
    run(
      `INSERT INTO app_settings (key, value, label, description, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      RESET_SPENT_KEY, timestamp,
      "Administrator password reset used",
      "When the one-time administrator password reset was run. Its presence prevents it running again.",
      options.actorId, timestamp,
    )
  })

  const changed = targets.map(({ account, row }) => ({
    email: row.email,
    displayName: row.display_name,
    roleKey: account.roleKey,
  }))

  recordAudit({
    actorId: options.actorId,
    actorName: options.actorName,
    action: "auth.admin_password_reset_all",
    entityType: "user",
    entityId: null,
    // Names only. The password is deliberately absent.
    summary: `One-time administrator password reset applied to ${changed.length} account${changed.length === 1 ? "" : "s"}`,
    detail: { accounts: changed.map((entry) => entry.email), untouched, count: changed.length },
    ip: options.ip ?? null,
  })

  return { changed, untouched, spentAt: timestamp }
}
