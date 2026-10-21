/**
 * Creates the administrator sign-in accounts.
 *
 * This is an OPT-IN script — it is never run automatically on server boot, so no
 * known password is ever present on a normal deployment. Run it deliberately:
 *
 *     npm run seed:admins
 *
 * It is idempotent: running it again re-creates/resets each account to the values
 * below. Each value can be overridden with environment variables (see
 * `defaultAccounts()` in `default-accounts.ts`). For safety it refuses to run under
 * NODE_ENV=production unless you explicitly pass ALLOW_DEFAULT_ACCOUNTS=1.
 *
 * On server boot the same function runs in `create-missing` mode (see
 * `bootstrapAdministrators()` in `index.ts`): accounts that already exist are
 * never modified — their passwords and roles stay untouched — and only the
 * missing ones are inserted.
 */
import { isProd } from "../config.js"
import { migrate, one, run, transaction } from "./index.js"
import { seed } from "./seed.js"
import { DEFAULT_ACCOUNTS, defaultAccounts, type DefaultAccount } from "./default-accounts.js"
import { hashPassword, id, validatePasswordStrength } from "../lib/security.js"
import { nowIso } from "../lib/time.js"
import { createMemberRecord } from "../services/members.js"

export { DEFAULT_ACCOUNTS, defaultAccounts } from "./default-accounts.js"

interface ExistingUser {
  id: string
  email: string
}

/** "reset" rewrites every listed account; "create-missing" only inserts accounts that don't exist yet. */
export type SeedMode = "reset" | "create-missing"

/** The public sample password shipped in the repository for a given role, if any. */
function samplePasswordFor(roleKey: string): string | undefined {
  return DEFAULT_ACCOUNTS.find((account) => account.roleKey === roleKey)?.password
}

/**
 * 1 when the account still carries the public sample password from the repository:
 * in production such an account must choose its own password at first sign-in.
 *
 * A password supplied through the environment is the deployment's own and is
 * trusted, even when it happens to equal the sample — otherwise an operator who
 * deliberately sets the environment to the documented value would silently
 * reintroduce the forced change they were trying to avoid.
 */
function mustChangeOnLogin(account: DefaultAccount): number {
  if (account.passwordFromEnv) return 0
  const sample = samplePasswordFor(account.roleKey)
  return isProd && sample !== undefined && account.password === sample ? 1 : 0
}

function ensureUser(account: DefaultAccount, timestamp: string, mode: SeedMode): string | null {
  const normalized = account.email.toLowerCase()
  const existing = one<ExistingUser>("SELECT id, email FROM users WHERE email_normalized = ?", normalized)

  if (existing) {
    // Never touch an account that already exists — its password (possibly changed
    // by the chairman in the UI), roles and profile stay exactly as they are.
    if (mode === "create-missing") return null
    run(
      `UPDATE users
          SET email = ?, display_name = ?, avatar_path = ?, status = 'active', password_hash = ?,
              must_change_password = ?, failed_login_count = 0, locked_until = NULL, updated_at = ?
        WHERE id = ?`,
      account.email, account.displayName, account.avatarPath, hashPassword(account.password),
      mustChangeOnLogin(account), timestamp, existing.id,
    )
    return existing.id
  }

  const userId = id()
  run(
    `INSERT INTO users (id, email, email_normalized, password_hash, display_name, avatar_path, status,
                        must_change_password, failed_login_count, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, NULL, ?, ?)`,
    userId, account.email, normalized, hashPassword(account.password), account.displayName, account.avatarPath,
    mustChangeOnLogin(account), timestamp, timestamp,
  )
  return userId
}

function ensureRole(userId: string, roleKey: string, timestamp: string): void {
  // Replace any pre-existing roles with the single intended role for this account.
  run("DELETE FROM user_roles WHERE user_id = ?", userId)
  run(
    "INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) VALUES (?, ?, NULL, ?)",
    userId, `role_${roleKey}`, timestamp,
  )
}

function ensureMemberRecord(userId: string, account: DefaultAccount, timestamp: string): string | null {
  if (account.kind !== "member" || !account.groupId) return null
  const existing = one<{ member_no: string }>("SELECT member_no FROM members WHERE user_id = ?", userId)
  if (existing) return existing.member_no

  const created = createMemberRecord({
    groupId: account.groupId,
    fullName: account.displayName,
    userId,
    status: "active",
    notes: "Seeded account. Safe to delete.",
  })
  return created.memberNo
}

export function seedDefaultAccounts(
  log: (message: string) => void = () => {},
  accounts: DefaultAccount[] = defaultAccounts(),
  mode: SeedMode = "reset",
): void {
  if (isProd && process.env.ALLOW_DEFAULT_ACCOUNTS !== "1") {
    throw new Error(
      "Refusing to create default accounts in production. Set ALLOW_DEFAULT_ACCOUNTS=1 to override (not recommended).",
    )
  }

  const timestamp = nowIso()

  for (const account of accounts) {
    // Only accounts that will actually be (re)created need a valid password;
    // an environment override for an account that already exists is irrelevant.
    if (mode === "create-missing" && ensureUserExists(account)) continue
    const strength = validatePasswordStrength(account.password)
    if (!strength.ok) {
      throw new Error(`Default password for ${account.email} is too weak: ${strength.errors.join(" ")}`)
    }
  }

  transaction(() => {
    for (const account of accounts) {
      const userId = ensureUser(account, timestamp, mode)
      if (userId === null) {
        log(`${account.roleKey.padEnd(14)} ${account.email} — already exists, left untouched`)
        continue
      }
      ensureRole(userId, account.roleKey, timestamp)
      const memberNo = ensureMemberRecord(userId, account, timestamp)
      log(`${account.roleKey.padEnd(14)} ${account.email}${memberNo ? `  (${memberNo})` : ""}`)
    }
  })
}

function ensureUserExists(account: DefaultAccount): boolean {
  return one<ExistingUser>("SELECT id, email FROM users WHERE email_normalized = ?", account.email.toLowerCase()) !== undefined
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate((message) => console.log(`[migrate] ${message}`))
  seed((message) => console.log(`[seed] ${message}`))

  const accounts = defaultAccounts()
  console.log("\n[seed:admins] creating administrator accounts…")
  seedDefaultAccounts((message) => console.log(`  ✓ ${message}`), accounts)

  console.log("\n[seed:admins] Administrator sign-in details (change these before going public):\n")
  console.table(
    accounts.map((account) => ({
      Role: account.roleKey,
      Email: account.email,
      Password: account.password,
    })),
  )
  console.log("Administrators sign in at /admin/login. Singers and members sign in at /login.\n")
}
