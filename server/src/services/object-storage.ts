import { objectStorage } from "../config.js"

/**
 * Thin, optional wrapper around an S3-compatible bucket (Backblaze B2, Cloudflare
 * R2, AWS S3…). Every function is a no-op (or returns `null`) when object storage
 * is not configured, so development and tests keep using the local filesystem.
 *
 * The bucket is the durable source of truth for uploads on hosts whose disk is
 * wiped on restart (e.g. Render's free plan). Local disk acts as a cache: writes
 * go to both, and reads fall back to the bucket when the local copy is gone.
 */

interface S3ClientLike {
  send(command: unknown): Promise<unknown>
}

let client: S3ClientLike | null = null

/** Lazily construct the AWS SDK client so importing this module stays side-effect free. */
async function getClient(): Promise<S3ClientLike | null> {
  if (!objectStorage.enabled) return null
  if (client) return client
  const { S3Client } = await import("@aws-sdk/client-s3")
  client = new S3Client({
    region: objectStorage.region,
    endpoint: objectStorage.endpoint,
    forcePathStyle: objectStorage.forcePathStyle,
    credentials: {
      accessKeyId: objectStorage.accessKeyId,
      secretAccessKey: objectStorage.secretAccessKey,
    },
  })
  return client
}

/**
 * Maps a stored upload path (e.g. `public/brand/logo.png`) to the object key it
 * is saved under in the bucket. Keeping the bucket/private split in the key means
 * a single bucket holds both, mirroring the local `storage/` layout.
 */
export function objectKeyFor(storedPath: string): string {
  const clean = storedPath.replace(/^\/+/, "")
  return objectStorage.prefix ? `${objectStorage.prefix}/${clean}` : clean
}

export async function putObject(storedPath: string, data: Buffer, contentType: string): Promise<boolean> {
  const s3 = await getClient()
  if (!s3) return false
  const { PutObjectCommand } = await import("@aws-sdk/client-s3")
  await s3.send(
    new PutObjectCommand({
      Bucket: objectStorage.bucket,
      Key: objectKeyFor(storedPath),
      Body: data,
      ContentType: contentType,
    }),
  )
  return true
}

/** Returns the object's bytes, or `null` when it is absent (or storage is off). */
export async function getObject(storedPath: string): Promise<Buffer | null> {
  const s3 = await getClient()
  if (!s3) return null
  const { GetObjectCommand } = await import("@aws-sdk/client-s3")
  try {
    const result = (await s3.send(
      new GetObjectCommand({ Bucket: objectStorage.bucket, Key: objectKeyFor(storedPath) }),
    )) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } }
    if (!result.Body) return null
    if (typeof result.Body.transformToByteArray === "function") {
      return Buffer.from(await result.Body.transformToByteArray())
    }
    return null
  } catch (error) {
    const name = (error as { name?: string })?.name
    if (name === "NoSuchKey" || name === "NotFound") return null
    throw error
  }
}

export async function deleteObject(storedPath: string): Promise<boolean> {
  const s3 = await getClient()
  if (!s3) return false
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3")
  await s3.send(new DeleteObjectCommand({ Bucket: objectStorage.bucket, Key: objectKeyFor(storedPath) }))
  return true
}
