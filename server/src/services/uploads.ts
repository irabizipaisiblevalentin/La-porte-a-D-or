import fs from "node:fs"
import path from "node:path"
import { privateStorageDir, publicStorageDir } from "../config.js"
import { run } from "../db/index.js"
import { id } from "../lib/security.js"
import { nowIso } from "../lib/time.js"

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

export function deleteFile(file: Pick<FileRow, "id" | "bucket" | "path">): void {
  const absolute = absolutePathFor(file)
  fs.rmSync(absolute, { force: true })
  run("DELETE FROM file_uploads WHERE id = ?", file.id)
}
