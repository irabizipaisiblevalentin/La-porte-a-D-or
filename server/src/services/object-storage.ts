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

export interface ObjectStream {
  stream: NodeJS.ReadableStream
  contentLength: number | null
  contentType: string | null
}

/** True when the error means "that object is not there", as opposed to a real failure. */
function isMissingObject(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? ""
  return name === "NoSuchKey" || name === "NotFound" || name === "NoSuchBucket"
}

/**
 * Opens the object as a stream, or returns `null` when it is absent (or storage
 * is off). Streaming keeps an 80 MB song out of the Node heap.
 */
export async function getObjectStream(storedPath: string): Promise<ObjectStream | null> {
  const s3 = await getClient()
  if (!s3) return null
  const { GetObjectCommand } = await import("@aws-sdk/client-s3")
  try {
    const result = (await s3.send(
      new GetObjectCommand({ Bucket: objectStorage.bucket, Key: objectKeyFor(storedPath) }),
    )) as { Body?: unknown; ContentLength?: number; ContentType?: string }
    const body = result.Body as NodeJS.ReadableStream | undefined
    if (!body || typeof (body as { pipe?: unknown }).pipe !== "function") return null
    return {
      stream: body,
      contentLength: typeof result.ContentLength === "number" ? result.ContentLength : null,
      contentType: result.ContentType ?? null,
    }
  } catch (error) {
    if (isMissingObject(error)) return null
    throw error
  }
}

/** Returns the object's bytes, or `null` when it is absent (or storage is off). */
export async function getObject(storedPath: string): Promise<Buffer | null> {
  const object = await getObjectStream(storedPath)
  if (!object) return null
  const chunks: Buffer[] = []
  for await (const chunk of object.stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks)
}

export async function deleteObject(storedPath: string): Promise<boolean> {
  const s3 = await getClient()
  if (!s3) return false
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3")
  await s3.send(new DeleteObjectCommand({ Bucket: objectStorage.bucket, Key: objectKeyFor(storedPath) }))
  return true
}
