import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
// src/ in dev (tsx), dist/ when built — package root is one level up either way.
export const packageRoot = path.resolve(here, "..")

export const dataDir = process.env.DATA_DIR ?? path.join(packageRoot, "data")
export const storageDir = path.join(dataDir, "storage")
export const publicStorageDir = path.join(storageDir, "public")
export const privateStorageDir = path.join(storageDir, "private")
export const databaseFile = process.env.DATABASE_FILE ?? path.join(dataDir, "chorale.db")
export const webDistDir = process.env.WEB_DIST_DIR ?? path.resolve(packageRoot, "..", "web", "dist")

for (const dir of [dataDir, storageDir, publicStorageDir, privateStorageDir]) {
  fs.mkdirSync(dir, { recursive: true })
}

/** Application secret used for session-token hashing and at-rest secret encryption. */
function resolveSecret(): string {
  if (process.env.APP_SECRET && process.env.APP_SECRET.length >= 16) return process.env.APP_SECRET
  const file = path.join(dataDir, ".app-secret")
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim()
  const generated = randomToken(48)
  fs.writeFileSync(file, generated, { mode: 0o600 })
  return generated
}

function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(buf)
  return Buffer.from(buf).toString("base64url")
}

export const config = {
  appName: "Chorale La Porte d'Or",
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  secret: resolveSecret(),
  secretIsGenerated: !process.env.APP_SECRET,
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME ?? "cldo_session",
    ttlMs: Number(process.env.SESSION_TTL_DAYS ?? 7) * 24 * 60 * 60 * 1000,
    rolling: true,
    secure: process.env.SESSION_COOKIE_SECURE === "true",
  },
  uploads: {
    maxImageBytes: Number(process.env.MAX_IMAGE_BYTES ?? 8 * 1024 * 1024),
    maxAudioBytes: Number(process.env.MAX_AUDIO_BYTES ?? 80 * 1024 * 1024),
    maxDocumentBytes: Number(process.env.MAX_DOCUMENT_BYTES ?? 16 * 1024 * 1024),
    allowedImageTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"],
    allowedAudioTypes: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/flac", "audio/aac", "audio/x-m4a"],
    allowedDocumentTypes: ["application/pdf", "text/plain", "text/csv", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  },
  security: {
    maxFailedLogins: 8,
    lockoutMs: 15 * 60 * 1000,
    setupTokenTtlMs: 24 * 60 * 60 * 1000,
    invitationTtlMs: 7 * 24 * 60 * 60 * 1000,
    rateLimitWindowMs: 60 * 1000,
    rateLimitMaxAuth: 20,
    rateLimitMaxGeneral: 1200,
  },
  memberNo: {
    prefix: "CHR",
  },
}

/**
 * Optional S3-compatible object storage (Backblaze B2, Cloudflare R2, AWS S3…).
 *
 * When enabled, uploaded files are written to the bucket in addition to local
 * disk, and reads fall back to the bucket if the local copy is missing. This is
 * what makes uploads survive on hosts with an ephemeral filesystem (e.g. Render's
 * free plan, which wipes /data on every restart and idle spin-down).
 *
 * Everything stays local-only when these variables are unset, so development and
 * the test suite behave exactly as before.
 */
function resolveObjectStorage() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY
  const bucket = process.env.S3_BUCKET
  const endpoint = process.env.S3_ENDPOINT
  const enabled = Boolean(bucket && endpoint && accessKeyId && secretAccessKey)
  return {
    enabled,
    endpoint: endpoint ?? "",
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: bucket ?? "",
    accessKeyId: accessKeyId ?? "",
    secretAccessKey: secretAccessKey ?? "",
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    // Optional key prefix so several apps can share one bucket safely.
    prefix: (process.env.S3_PREFIX ?? "").replace(/^\/+|\/+$/g, ""),
  }
}

export const objectStorage = resolveObjectStorage()

export const isProd = config.env === "production"
