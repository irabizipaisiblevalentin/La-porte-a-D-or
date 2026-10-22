import fs from "node:fs"
import path from "node:path"
import { privateStorageDir, publicStorageDir } from "../config.js"
import { one, run } from "../db/index.js"
import { id } from "../lib/security.js"
import { nowIso } from "../lib/time.js"
import { deleteObject, getObjectStream, putObject } from "./object-storage.js"

export type Bucket = "public" | "private"

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
  "audio/flac": ".flac",
  "audio/aac": ".aac",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
}

export interface SavedUpload {
  id: string
  bucket: Bucket
  path: string
  url: string
  size: number
  mimeType: string
}

export interface SaveUploadInput {
  bucket: Bucket
  entityType: string
  entityId: string | null
  originalName: string
  mimeType: string
  data: Buffer
  uploadedBy: string | null
}

/**
 * Writes an upload into the correct bucket with a generated name (never the
 * client-supplied name) and registers it so private files can be access-checked.
 */
export function saveUpload(input: SaveUploadInput): SavedUpload {
  const extension = EXTENSION_BY_MIME[input.mimeType] ?? ""
  const fileId = id()
  const relative = path.join(input.entityType, `${fileId}${extension}`)
  const root = input.bucket === "public" ? publicStorageDir : privateStorageDir
  const absolute = path.join(root, relative)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, input.data, { mode: 0o640 })

  const storedPath = `${input.bucket}/${relative.split(path.sep).join("/")}`
  run(
    `INSERT INTO file_uploads (id, bucket, path, original_name, mime_type, file_size, entity_type, entity_id, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    fileId, input.bucket, storedPath, input.originalName.slice(0, 200), input.mimeType, input.data.byteLength,
    input.entityType, input.entityId, input.uploadedBy, nowIso(),
  )

  // Mirror into the bucket so the file outlives the local disk (Render wipes it
  // on every restart). Best effort: the upload has already been accepted, and a
  // storage outage must never fail the request that carries it.
  void putObject(storedPath, input.data, input.mimeType).catch((error) => {
    console.error(`[storage] could not mirror ${storedPath} to the bucket:`, message(error))
  })

  return {
    id: fileId,
    bucket: input.bucket,
    path: storedPath,
    url: input.bucket === "public" ? `/media/${relative.split(path.sep).join("/")}` : `/api/files/${fileId}`,
    size: input.data.byteLength,
    mimeType: input.mimeType,
  }
}

export interface FileRow {
  id: string
  bucket: Bucket
  path: string
  original_name: string
  mime_type: string | null
  file_size: number | null
  entity_type: string | null
  entity_id: string | null
  uploaded_by: string | null
  created_at: string
}

export function absolutePathFor(file: Pick<FileRow, "bucket" | "path">): string {
  const relative = file.path.replace(`${file.bucket}/`, "")
  const root = file.bucket === "public" ? publicStorageDir : privateStorageDir
  return path.join(root, ...relative.split("/"))
}

/** The URL a stored file is served from, derived from its row. */
export function urlFor(file: Pick<FileRow, "id" | "bucket" | "path">): string {
  if (file.bucket === "public") return `/media/${file.path.replace(/^public\//, "")}`
  return `/api/files/${file.id}`
}

/**
 * Finds the stored file behind a URL.
 *
 * A URL is not a column: it is derived from the row's bucket and path (see
 * `urlFor`). Callers that hold a URL recorded elsewhere — a member's photograph,
 * an account's avatar — use this to reach the row again, for instance to delete
 * the file it points at. Returns `null` when nothing matches, so a stale path left
 * over from an earlier upload is handled rather than throwing.
 */
export function findUploadByUrl(url: string): FileRow | null {
  const privateMatch = /^\/api\/files\/([^/?#]+)$/.exec(url)
  if (privateMatch) {
    return one<FileRow>("SELECT * FROM file_uploads WHERE id = ?", privateMatch[1]) ?? null
  }

  if (url.startsWith("/media/")) {
    return (
      one<FileRow>(
        "SELECT * FROM file_uploads WHERE bucket = 'public' AND path = ?",
        `public/${url.slice("/media/".length)}`,
      ) ?? null
    )
  }
  return null
}

export interface OpenedFile {
  stream: NodeJS.ReadableStream
  mimeType: string | null
  size: number | null
}

/**
 * Opens a stored file for reading: local disk first, otherwise the bucket — and
 * whatever it downloads is written back to disk, so the next request (and every
 * request after the same restart) is served locally again.
 *
 * Returns `null` when the file exists nowhere. The bucket lookup is bounded by
 * `timeoutMs` so an unreachable endpoint cannot pin a request open.
 */
export async function openStoredFile(
  file: Pick<FileRow, "bucket" | "path" | "mime_type">,
  timeoutMs = 20_000,
): Promise<OpenedFile | null> {
  const absolute = absolutePathFor(file)
  if (fs.existsSync(absolute)) {
    return { stream: fs.createReadStream(absolute), mimeType: file.mime_type, size: null }
  }
  if (timeoutMs <= 0) return openRemote(absolute, file)

  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      openRemote(absolute, file),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function openRemote(
  absolute: string,
  file: Pick<FileRow, "path" | "mime_type">,
): Promise<OpenedFile | null> {
  const remote = await getObjectStream(file.path)
  if (!remote) return null
  cacheToDisk(absolute, remote.stream)
  return { stream: remote.stream, mimeType: file.mime_type ?? remote.contentType, size: remote.contentLength }
}

/** Copies a stream to disk while it is being sent to the client. Best effort. */
function cacheToDisk(absolute: string, source: NodeJS.ReadableStream): void {
  try {
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    const out = fs.createWriteStream(absolute, { mode: 0o640 })
    source.on("data", (chunk) => out.write(chunk as Buffer))
    source.on("end", () => out.end())
    source.on("error", () => out.destroy())
    out.on("error", () => {})
  } catch {
    /* the cache is an optimisation, never a requirement */
  }
}

export function deleteFile(file: Pick<FileRow, "id" | "bucket" | "path">): void {
  const absolute = absolutePathFor(file)
  fs.rmSync(absolute, { force: true })
  void deleteObject(file.path).catch((error) => {
    console.error(`[storage] could not delete ${file.path} from the bucket:`, message(error))
  })
  run("DELETE FROM file_uploads WHERE id = ?", file.id)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
