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
 */
import { isProd } from "../config.js"
import { migrate, one, run, transaction } from "./index.js"
import { seed } from "./seed.js"
import { defaultAccounts, type DefaultAccount } from "./default-accounts.js"
import { hashPassword, id, validatePasswordStrength } from "../lib/security.js"
import { nowIso } from "../lib/time.js"
import { createMemberRecord } from "../services/members.js"

export { DEFAULT_ACCOUNTS, defaultAccounts } from "./default-accounts.js"

interface ExistingUser {
  id: string
  email: string
}

function ensureUser(account: DefaultAccount, timestamp: string): string {
  const normalized = account.email.toLowerCase()
  const existing = one<ExistingUser>("SELECT id, email FROM users WHERE email_normalized = ?", normalized)

  if (existing) {
    run(
      `UPDATE users
          SET email = ?, display_name = ?, avatar_path = ?, status = 'active', password_hash = ?,
              must_change_password = 0, failed_login_count = 0, locked_until = NULL, updated_at = ?
        WHERE id = ?`,
      account.email, account.displayName, account.avatarPath, hashPassword(account.password), timestamp, existing.id,
    )
    return existing.id
  }

  const userId = id()
  run(
    `INSERT INTO users (id, email, email_normalized, password_hash, display_name, avatar_path, status,
                        must_change_password, failed_login_count, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', 0, 0, NULL, ?, ?)`,
    userId, account.email, normalized, hashPassword(account.password), account.displayName, account.avatarPath,
    timestamp, timestamp,
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
): void {
  if (isProd && process.env.ALLOW_DEFAULT_ACCOUNTS !== "1") {
    throw new Error(
      "Refusing to create default accounts in production. Set ALLOW_DEFAULT_ACCOUNTS=1 to override (not recommended).",
    )
  }

  const timestamp = nowIso()

  for (const account of accounts) {
    const strength = validatePasswordStrength(account.password)
    if (!strength.ok) {
      throw new Error(`Default password for ${account.email} is too weak: ${strength.errors.join(" ")}`)
    }
  }

  transaction(() => {
    for (const account of accounts) {
      const userId = ensureUser(account, timestamp)
      ensureRole(userId, account.roleKey, timestamp)
      const memberNo = ensureMemberRecord(userId, account, timestamp)
      log(`${account.roleKey.padEnd(14)} ${account.email}${memberNo ? `  (${memberNo})` : ""}`)
    }
  })
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
