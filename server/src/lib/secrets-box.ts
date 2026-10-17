import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto"
import { config } from "../config.js"

const MAGIC = "v1"

function deriveKey(): Buffer {
  return scryptSync(config.secret, "chorale-la-porte-dor-secret-box", 32)
}

/** AES-256-GCM encryption for integration secrets stored in the database. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [MAGIC, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".")
}

export function decryptSecret(packed: string | null | undefined): string | null {
  if (!packed) return null
  const parts = packed.split(".")
  if (parts.length !== 4 || parts[0] !== MAGIC) return null
  try {
    const iv = Buffer.from(parts[1], "base64")
    const tag = Buffer.from(parts[2], "base64")
    const data = Buffer.from(parts[3], "base64")
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")
  } catch {
    return null
  }
}
