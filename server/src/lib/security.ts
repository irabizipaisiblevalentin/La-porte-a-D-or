import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto"

export function id(): string {
  return randomUUID()
}

/** URL-safe opaque token for sessions, invitations and setup links. */
export function token(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

/** SHA-256 hex digest used to store opaque tokens at rest. */
export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * HMAC-SHA256 of a request body, as a lowercase hex string. Used to verify the
 * signature the Google Apps Script sends over the exact bytes it POSTs.
 * Accepts a Buffer so the digest is computed over the raw received bytes.
 */
export function hmacSha256Hex(secret: string, body: Buffer | string): string {
  return createHmac("sha256", secret).update(body).digest("hex")
}

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64

/** scrypt password hash: `scrypt$N$r$p$salt$hash` (no native dependency). */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(normalizePassword(plain), salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64"), derived.toString("base64")].join("$")
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false
  const salt = Buffer.from(parts[4], "base64")
  const expected = Buffer.from(parts[5], "base64")
  if (expected.length === 0) return false
  let actual: Buffer
  try {
    actual = scryptSync(normalizePassword(plain), salt, expected.length, { N: n, r, p })
  } catch {
    return false
  }
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function normalizePassword(plain: string): string {
  return plain.normalize("NFKC")
}

export interface PasswordCheck {
  ok: boolean
  errors: string[]
}

export function validatePasswordStrength(plain: string): PasswordCheck {
  const errors: string[] = []
  if (plain.length < 10) errors.push("Use at least 10 characters.")
  if (plain.length > 200) errors.push("Use at most 200 characters.")
  if (!/[a-z]/.test(plain)) errors.push("Include at least one lowercase letter.")
  if (!/[A-Z]/.test(plain)) errors.push("Include at least one uppercase letter.")
  if (!/[0-9]/.test(plain)) errors.push("Include at least one number.")
  const common = ["password", "12345678", "qwerty", "letmein", "changeme", "chorale", "admin123"]
  if (common.some((c) => plain.toLowerCase().includes(c))) errors.push("Avoid common or predictable words.")
  return { ok: errors.length === 0, errors }
}
