import { one } from "../db/index.js"
import { decryptSecret, encryptSecret } from "../lib/secrets-box.js"
import { hashPassword } from "../lib/security.js"

/**
 * Accounts keep two copies of every password the application sets:
 *
 *  - `hash` is the one-way scrypt verifier login checks against. It is the only
 *    thing that authorizes a sign-in, and it never changes shape.
 *  - `enc`  is a reversible AES-256-GCM copy (under APP_SECRET) that the member's
 *    own record and the approval message can read back. Administrators hand
 *    credentials to new members, so the plain text has to survive the request
 *    that created it.
 *
 * Writing both in the same statement is what keeps them in step, so every
 * password-setting call site goes through this helper.
 */
export function hashAndRemember(plain: string): { hash: string; enc: string } {
  return { hash: hashPassword(plain), enc: encryptSecret(plain) }
}

/** The reversible copy of an account's current password, or null when unknown. */
export function rememberedPassword(userId: string | null | undefined): string | null {
  if (!userId) return null
  const row = one<{ password_enc: string | null }>("SELECT password_enc FROM users WHERE id = ?", userId)
  return decryptSecret(row?.password_enc ?? null)
}
