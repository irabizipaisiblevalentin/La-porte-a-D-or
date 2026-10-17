import { test } from "node:test"
import assert from "node:assert/strict"
import {
  constantTimeEqual,
  hashPassword,
  hashToken,
  hmacSha256Hex,
  token,
  validatePasswordStrength,
  verifyPassword,
} from "../../src/lib/security.js"
import { decryptSecret, encryptSecret } from "../../src/lib/secrets-box.js"

test("password hashing round-trips", () => {
  const stored = hashPassword("Meadow!Lark77")
  assert.match(stored, /^scrypt\$/)
  assert.equal(verifyPassword("Meadow!Lark77", stored), true)
  assert.equal(verifyPassword("wrong-password", stored), false)
})

test("password hashes are salted (two hashes of the same password differ)", () => {
  const a = hashPassword("Meadow!Lark77")
  const b = hashPassword("Meadow!Lark77")
  assert.notEqual(a, b)
  assert.equal(verifyPassword("Meadow!Lark77", a), true)
  assert.equal(verifyPassword("Meadow!Lark77", b), true)
})

test("verifyPassword is defensive about malformed or missing hashes", () => {
  assert.equal(verifyPassword("x", null), false)
  assert.equal(verifyPassword("x", undefined), false)
  assert.equal(verifyPassword("x", ""), false)
  assert.equal(verifyPassword("x", "not-a-hash"), false)
  assert.equal(verifyPassword("x", "scrypt$16384$8$1$$"), false)
})

test("password strength rules", () => {
  assert.equal(validatePasswordStrength("Meadow!Lark77").ok, true)
  assert.equal(validatePasswordStrength("short1A").ok, false)
  assert.equal(validatePasswordStrength("alllowercase77").ok, false)
  assert.equal(validatePasswordStrength("ALLUPPERCASE77").ok, false)
  assert.equal(validatePasswordStrength("NoNumbersHere").ok, false)
  assert.equal(validatePasswordStrength("MyAdmin123x").ok, false, "common word 'admin' should be rejected")
})

test("opaque tokens are unique and hash deterministically", () => {
  const a = token()
  const b = token()
  assert.notEqual(a, b)
  assert.equal(hashToken(a), hashToken(a))
  assert.notEqual(hashToken(a), hashToken(b))
})

test("constantTimeEqual compares correctly", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true)
  assert.equal(constantTimeEqual("abc", "abd"), false)
  assert.equal(constantTimeEqual("abc", "abcd"), false)
})

test("hmacSha256Hex matches a known vector and is sensitive to secret/body", () => {
  // RFC-style known vector: HMAC_SHA256(key="key", msg="The quick brown fox jumps over the lazy dog")
  assert.equal(
    hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"),
    "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
  )
  // A one-character change to the body, or a different secret, yields a different digest.
  assert.notEqual(
    hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog!"),
    hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"),
  )
  assert.notEqual(hmacSha256Hex("key", "body"), hmacSha256Hex("other", "body"))
  // A Buffer body digests the same as its UTF-8 string equivalent.
  assert.equal(hmacSha256Hex("key", Buffer.from("body", "utf8")), hmacSha256Hex("key", "body"))
})

test("integration secrets encrypt and decrypt, and reject tampering", () => {
  const secret = JSON.stringify({ private_key: "-----BEGIN PRIVATE KEY-----\nxyz\n" })
  const packed = encryptSecret(secret)
  assert.notEqual(packed, secret)
  assert.equal(decryptSecret(packed), secret)

  // A tampered ciphertext must fail authentication and return null rather than garbage.
  const parts = packed.split(".")
  const tampered = [parts[0], parts[1], parts[2], Buffer.from("tampered-payload").toString("base64")].join(".")
  assert.equal(decryptSecret(tampered), null)

  assert.equal(decryptSecret(null), null)
  assert.equal(decryptSecret(undefined), null)
  assert.equal(decryptSecret("nonsense"), null)
})
